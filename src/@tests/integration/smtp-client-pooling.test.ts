import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { SmtpClient } from 'modules/email/connector.ts'
import { encoder } from '@zanix/helpers'

console.error = () => {}

/** Builds a fake `Deno.TlsConn`-shaped connection backed by real Web Streams. */
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

  return { conn: { readable, writable } as unknown as Deno.TlsConn, written }
}

function newClient() {
  return new SmtpClient({
    hostname: 'smtp.example.com',
    port: 587,
    username: 'user@example.com',
    password: 's3cr3t',
    autoInitialize: false,
  })
}

Deno.test(
  "SmtpClient + pool: a second client reuses the first one's connection once it's released, " +
    'without redoing the handshake or sending QUIT on close()',
  async () => {
    Deno.env.set('SMTP_POOL_SIZE', '2')

    const { conn, written } = makeFakeConn([
      '220 Ready\r\n', // initialize() handshake — happens exactly once for both clients
      '250 OK\r\n',
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
      '250 OK\r\n', // client1's send(): MAIL FROM
      '250 OK\r\n', // RCPT TO
      '354 Go ahead\r\n', // DATA
      '250 OK\r\n', // final '.'
      '250 OK\r\n', // client2's send(): MAIL FROM
      '250 OK\r\n', // RCPT TO
      '354 Go ahead\r\n', // DATA
      '250 OK\r\n', // final '.'
    ])

    let connectCount = 0
    const original = Deno.connectTls
    Deno.connectTls = (() => {
      connectCount++
      return Promise.resolve(conn)
    }) as typeof Deno.connectTls

    try {
      const client1 = newClient()
      await client1['initialize']()
      await client1.send({
        to: 'dest@example.com',
        subject: 'Hello',
        content: 'body',
      })
      assertEquals(client1.isHealthy(), true)

      await client1.close() // should release to the pool, not send QUIT

      const client2 = newClient()
      await client2['initialize']() // should reuse the released connection, no new dial
      await client2.send({
        to: 'dest@example.com',
        subject: 'Hello again',
        content: 'body',
      })
      assertEquals(client2.isHealthy(), true)
    } finally {
      Deno.connectTls = original
      Deno.env.delete('SMTP_POOL_SIZE')
    }

    assertEquals(connectCount, 1) // only one physical connection was ever dialed
    assertEquals(written.filter((line) => line.startsWith('EHLO')).length, 1) // handshake ran once
    assertEquals(written.some((line) => line.startsWith('QUIT')), false) // never terminated
  },
)

Deno.test(
  'SmtpClient + pool: a dead connection is discarded from the pool (not released) on reconnect',
  async () => {
    Deno.env.set('SMTP_POOL_SIZE', '2')

    const firstConnResponses = [
      '220 Ready\r\n',
      '250 OK\r\n',
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
      '250 OK\r\n', // MAIL FROM
      '250 OK\r\n', // RCPT TO
      '354 Go ahead\r\n', // DATA
      '250 OK\r\n', // final '.'
    ]
    let firstConnReadIndex = 0
    const firstConnReadable = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (firstConnReadIndex < firstConnResponses.length) {
          controller.enqueue(
            encoder.encode(firstConnResponses[firstConnReadIndex++]),
          )
        } else controller.close()
      },
    })
    let firstConnWriteCount = 0
    const firstConnWritable = new WritableStream<Uint8Array>({
      write() {
        firstConnWriteCount++
        if (firstConnWriteCount > 15) {
          throw new Error('Broken pipe (os error 32)')
        }
      },
    })
    const firstConn = {
      readable: firstConnReadable,
      writable: firstConnWritable,
    } as unknown as Deno.TlsConn

    const { conn: secondConn, written: secondConnWritten } = makeFakeConn([
      '220 Ready\r\n', // reconnect handshake
      '250 OK\r\n',
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
      '250 OK\r\n', // MAIL FROM (retried send)
      '250 OK\r\n',
      '354 Go ahead\r\n',
      '250 OK\r\n',
    ])

    const conns = [firstConn, secondConn]
    let connectCount = 0
    const original = Deno.connectTls
    Deno.connectTls = (() => Promise.resolve(conns[connectCount++])) as typeof Deno.connectTls

    try {
      const client = newClient()
      await client['initialize']()
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello',
        content: 'body',
      })
      assertEquals(client.isHealthy(), true)

      // Idle timeout: the pooled connection died, so this reconnects (a fresh dial, since the
      // dead one is discarded rather than released) and retries.
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello again',
        content: 'body',
      })
      assertEquals(client.isHealthy(), true)

      await client.close() // releases the second (healthy) connection back to the pool

      const client2 = newClient()
      await client2['initialize']() // must reuse the released healthy one — no third dial
    } finally {
      Deno.connectTls = original
      Deno.env.delete('SMTP_POOL_SIZE')
    }

    assertEquals(connectCount, 2) // the dead first connection was never handed to anyone else
    assertStringIncludes(secondConnWritten[0], 'EHLO')
  },
)
