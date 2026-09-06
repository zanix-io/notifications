import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { SmtpClient } from 'modules/email/connector.ts'
import { encoder } from '@zanix/helpers'

console.error = () => {}

/** Minimal SMTP server config used across these tests, overridden per test via `newClient()`. */
const baseConfig = {
  hostname: 'smtp.example.com',
  port: 587,
  username: 'user@example.com',
  password: 's3cr3t',
}

/**
 * Builds a fake `Deno.Conn`-shaped connection backed by real Web Streams.
 *
 * - `readable` yields the given canned SMTP response lines, one per `read()` call — a single
 *   entry may itself carry multiple `\r\n`-joined lines, mirroring a real multi-line `EHLO` reply
 *   delivered in one TCP read.
 * - `writable` records every written chunk (decoded) so tests can assert on the exact commands
 *   sent on THIS socket specifically — distinguishing plaintext traffic from what goes out after
 *   a `STARTTLS` upgrade is the whole point of these tests.
 */
function makeFakeConn(responses: string[]) {
  const written: string[] = []
  let index = 0

  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < responses.length) {
        controller.enqueue(encoder.encode(responses[index++]))
      } else {
        controller.close()
      }
    },
  })

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(new TextDecoder().decode(chunk))
    },
  })

  return { conn: { readable, writable } as unknown as Deno.TcpConn, written }
}

function newClient(config: Partial<typeof baseConfig> = {}) {
  return new SmtpClient({ ...baseConfig, ...config, autoInitialize: false })
}

/**
 * Regression coverage for the bug fixed here: `SmtpConnection.open()` used to dial every SMTP
 * connection via `Deno.connectTls` unconditionally, regardless of the configured port or what the
 * target server actually spoke — wrapping a plaintext server's `220` greeting banner in a TLS
 * ClientHello from byte one, which Deno's own TLS record-layer parser rejected as a corrupt
 * record, tearing the connection down before the handshake ever began. This is exactly the shape
 * of a real local dev SMTP catcher (MailDev, Mailpit, MailHog, smtp4dev, ...) and of a relay
 * expecting STARTTLS on port 587 (Gmail, SES, SendGrid, ...) rather than implicit TLS on 465.
 */
Deno.test(
  'SmtpConnection: dials in plaintext (not Deno.connectTls) and completes the handshake when the server never advertises STARTTLS',
  async () => {
    const { conn, written } = makeFakeConn([
      '220 smtp.example.com Ready\r\n',
      '250 OK\r\n', // EHLO reply with no STARTTLS capability line, e.g. a local dev catcher
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
    ])

    let connectTlsCalled = false
    const originalConnectTls = Deno.connectTls
    Deno.connectTls = (() => {
      connectTlsCalled = true
      return Promise.reject(new Error('Deno.connectTls should not be called for this port'))
    }) as typeof Deno.connectTls

    let connectOptions: Deno.ConnectOptions | undefined
    const originalConnect = Deno.connect
    // deno-lint-ignore require-await
    Deno.connect = (async (options: Deno.ConnectOptions) => {
      connectOptions = options
      return conn
    }) as unknown as typeof Deno.connect

    const client = newClient()
    try {
      await client['initialize']()
    } finally {
      Deno.connectTls = originalConnectTls
      Deno.connect = originalConnect
    }

    assertEquals(connectTlsCalled, false)
    assertEquals(connectOptions?.hostname, baseConfig.hostname)
    assertEquals(connectOptions?.port, baseConfig.port)
    // The handshake completes over the plaintext socket: no STARTTLS was ever sent, and AUTH
    // LOGIN follows the EHLO reply directly.
    assertEquals(written.some((line) => line.startsWith('STARTTLS')), false)
    assertStringIncludes(written[0], `EHLO ${baseConfig.hostname}`)
    assertEquals(written[1], 'AUTH LOGIN\r\n')
    assertEquals(client.isHealthy(), false) // not yet sent anything — just handshaken
  },
)

/**
 * The other half of `ServerConfig.port`'s documented contract: 465 ("SMTPS") is the one port
 * still wrapped in implicit TLS from byte one, since that's genuinely what a server listening on
 * it expects — no `STARTTLS` negotiation involved.
 */
Deno.test(
  'SmtpConnection: dials via Deno.connectTls when the configured port is the implicit-TLS port (465)',
  async () => {
    const { conn, written } = makeFakeConn([
      '220 smtp.example.com Ready\r\n',
      '250 OK\r\n',
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
    ])

    let connectCalled = false
    const originalConnect = Deno.connect
    Deno.connect = (() => {
      connectCalled = true
      return Promise.reject(
        new Error('Deno.connect should not be called for the implicit-TLS port'),
      )
    }) as unknown as typeof Deno.connect

    let connectTlsOptions: Deno.ConnectTlsOptions | undefined
    const originalConnectTls = Deno.connectTls
    // deno-lint-ignore require-await
    Deno.connectTls = (async (options: Deno.ConnectTlsOptions) => {
      connectTlsOptions = options
      return conn as unknown as Deno.TlsConn
    }) as typeof Deno.connectTls

    const client = newClient({ port: 465 })
    try {
      await client['initialize']()
    } finally {
      Deno.connect = originalConnect
      Deno.connectTls = originalConnectTls
    }

    assertEquals(connectCalled, false)
    assertEquals(connectTlsOptions?.hostname, baseConfig.hostname)
    assertEquals(connectTlsOptions?.port, 465)
    assertEquals(written.some((line) => line.startsWith('STARTTLS')), false)
    assertStringIncludes(written[0], `EHLO ${baseConfig.hostname}`)
  },
)

/**
 * The STARTTLS negotiation path: a non-465 server that DOES advertise `STARTTLS` in its `EHLO`
 * reply gets upgraded mid-handshake, with a second `EHLO` re-issued over the now-encrypted
 * channel (RFC 3207 — the server forgets any capabilities announced before the upgrade) and
 * `AUTH LOGIN`/credentials sent only after the upgrade completes, never on the plaintext socket.
 */
Deno.test(
  'SmtpConnection: upgrades via STARTTLS when the server advertises it, re-issues EHLO, and only authenticates over the encrypted channel',
  async () => {
    const { conn: plainConn, written: plainWritten } = makeFakeConn([
      '220 smtp.example.com Ready\r\n',
      '250-smtp.example.com\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n', // advertises STARTTLS
      '220 2.0.0 Ready to start TLS\r\n', // STARTTLS reply
    ])
    const { conn: tlsConn, written: tlsWritten } = makeFakeConn([
      '250 OK\r\n', // EHLO re-issued over TLS
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
    ])

    const originalConnect = Deno.connect
    // deno-lint-ignore require-await
    Deno.connect = (async () => plainConn) as unknown as typeof Deno.connect

    let startTlsHostname: string | undefined
    const originalStartTls = Deno.startTls
    Deno.startTls = ((_conn: Deno.TcpConn, options?: Deno.StartTlsOptions) => {
      startTlsHostname = options?.hostname
      return Promise.resolve(tlsConn as unknown as Deno.TlsConn)
    }) as typeof Deno.startTls

    const client = newClient()
    try {
      await client['initialize']()
    } finally {
      Deno.connect = originalConnect
      Deno.startTls = originalStartTls
    }

    // Plaintext socket: only the first EHLO and STARTTLS itself — never any credentials.
    assertEquals(plainWritten.length, 2)
    assertStringIncludes(plainWritten[0], `EHLO ${baseConfig.hostname}`)
    assertEquals(plainWritten[1], 'STARTTLS\r\n')

    // Post-upgrade socket: the re-issued EHLO, then AUTH LOGIN and the base64 credentials.
    assertStringIncludes(tlsWritten[0], `EHLO ${baseConfig.hostname}`)
    assertEquals(tlsWritten[1], 'AUTH LOGIN\r\n')
    assertEquals(tlsWritten[2], `${btoa(baseConfig.username)}\r\n`)
    assertEquals(tlsWritten[3], `${btoa(baseConfig.password)}\r\n`)

    assertEquals(startTlsHostname, baseConfig.hostname)
  },
)
