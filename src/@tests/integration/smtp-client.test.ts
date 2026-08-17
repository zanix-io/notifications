import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { FakeTime } from '@std/testing/time'
import { SmtpClient } from 'modules/email/connector.ts'
import { encoder } from '@zanix/helpers'

console.error = () => {}

/** Minimal SMTP server config used across these tests. */
const baseConfig = {
  hostname: 'smtp.example.com',
  port: 587,
  username: 'user@example.com',
  password: 's3cr3t',
}

/**
 * Builds a fake `Deno.TlsConn`-shaped connection backed by real Web Streams.
 *
 * - `readable` yields the given canned SMTP response lines, one per `read()` call.
 * - `writable` records every written chunk (decoded) so tests can assert on the
 *   exact commands sent, and tracks whether `close()` was invoked on the writer.
 */
function makeFakeConn(responses: string[]) {
  const written: string[] = []
  let writableClosed = false
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
    close() {
      writableClosed = true
    },
  })

  return {
    conn: { readable, writable } as unknown as Deno.TlsConn,
    written,
    isWritableClosed: () => writableClosed,
  }
}

/** Stubs `Deno.connectTls` to resolve with the given fake connection, restoring it afterward. */
async function withFakeConnectTls<T>(
  conn: Deno.TlsConn,
  fn: () => Promise<T> | T,
  onConnect?: (options: Deno.ConnectTlsOptions) => void,
): Promise<T> {
  const original = Deno.connectTls
  // deno-lint-ignore require-await
  Deno.connectTls = (async (options: Deno.ConnectTlsOptions) => {
    onConnect?.(options)
    return conn
  }) as typeof Deno.connectTls
  try {
    return await fn()
  } finally {
    Deno.connectTls = original
  }
}

function newClient(config: Partial<typeof baseConfig> = {}) {
  return new SmtpClient({
    ...baseConfig,
    ...config,
    autoInitialize: false,
  })
}

Deno.test('SmtpClient: initialize() performs the full SMTP handshake', async () => {
  const { conn, written } = makeFakeConn([
    '220 smtp.example.com Ready\r\n',
    '250 OK\r\n',
    '334 VXNlcm5hbWU6\r\n',
    '334 UGFzc3dvcmQ6\r\n',
    '235 Authentication successful\r\n',
  ])

  const client = newClient()

  await withFakeConnectTls(conn, () => client['initialize']())

  assertEquals(written.length, 4)
  assertStringIncludes(written[0], `EHLO ${baseConfig.hostname}`)
  assertEquals(written[1], 'AUTH LOGIN\r\n')
  assertEquals(written[2], `${btoa(baseConfig.username)}\r\n`)
  assertEquals(written[3], `${btoa(baseConfig.password)}\r\n`)
})

Deno.test('SmtpClient: initialize() sends base64-encoded username and password', async () => {
  const { conn, written } = makeFakeConn([
    '220 Ready\r\n',
    '250 OK\r\n',
    '334 Username\r\n',
    '334 Password\r\n',
    '235 OK\r\n',
  ])

  const client = newClient({
    username: 'someone@example.com',
    password: 'hunter2',
  })

  await withFakeConnectTls(conn, () => client['initialize']())

  assertEquals(written[2], `${btoa('someone@example.com')}\r\n`)
  assertEquals(written[3], `${btoa('hunter2')}\r\n`)
})

Deno.test('SmtpClient: initialize() throws when a response code does not match', async () => {
  const { conn } = makeFakeConn([
    '220 Ready\r\n',
    '554 Transaction failed\r\n',
  ])

  const client = newClient()

  await withFakeConnectTls(
    conn,
    () =>
      assertRejects(
        () => client['initialize'](),
        Error,
        'Expected code',
      ),
  )
})

Deno.test(
  'SmtpClient: initialize() throws a clear error when the connection closes before any data is read',
  async () => {
    // An empty canned-response list makes the fake readable close on the very first read,
    // mirroring a remote SMTP server that dropped the connection (idle timeout, reset, etc.)
    // before ever replying.
    const { conn } = makeFakeConn([])

    const client = newClient()

    await withFakeConnectTls(
      conn,
      () =>
        assertRejects(
          () => client['initialize'](),
          Error,
          'SMTP connection closed unexpectedly',
        ),
    )

    assertEquals(client.isHealthy(), false)
  },
)

Deno.test(
  'SmtpClient: initialize() throws "Invalid response from server" for an empty, non-closing chunk',
  async () => {
    // Unlike the empty-list case above, this stream stays open but the one chunk it yields is
    // empty, so it never triggers the "closed" detection and falls through to this branch.
    const { conn } = makeFakeConn([''])

    const client = newClient()

    await withFakeConnectTls(
      conn,
      () =>
        assertRejects(
          () => client['initialize'](),
          Error,
          'Invalid response from server',
        ),
    )
  },
)

Deno.test(
  'SmtpClient: a write() rejection marks the connection unhealthy and throws a clear error',
  async () => {
    let readCount = 0
    const readable = new ReadableStream<Uint8Array>({
      pull(controller) {
        readCount++
        if (readCount === 1) {
          controller.enqueue(encoder.encode('220 Ready\r\n'))
        } else controller.close()
      },
    })
    const writable = new WritableStream<Uint8Array>({
      write() {
        throw new Error('Broken pipe (os error 32)')
      },
    })
    const conn = { readable, writable } as unknown as Deno.TlsConn

    const client = newClient()

    await withFakeConnectTls(conn, () =>
      assertRejects(
        () => client['initialize'](),
        Error,
        'SMTP connection closed unexpectedly',
      ))

    assertEquals(client.isHealthy(), false)
  },
)

Deno.test(
  'SmtpClient: a read() rejection marks the connection unhealthy and throws a clear error',
  async () => {
    const readable = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(
          "BadResource: The stream's underlying resource was closed or consumed",
        )
      },
    })
    const writable = new WritableStream<Uint8Array>({
      write() {},
    })
    const conn = { readable, writable } as unknown as Deno.TlsConn

    const client = newClient()

    await withFakeConnectTls(conn, () =>
      assertRejects(
        () => client['initialize'](),
        Error,
        'SMTP connection closed unexpectedly',
      ))

    assertEquals(client.isHealthy(), false)
  },
)

Deno.test(
  'SmtpClient: send() reconnects and retries once when the idle remote has closed the connection',
  async () => {
    // Simulates what was observed against a real server: a connection completes a successful
    // send (isHealthy() === true), then sits idle long enough for the remote to close it. The
    // *next* send should transparently reconnect (full handshake again) and retry, rather than
    // failing the notification outright.
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

    // 4 writes happen during initialize() (EHLO, AUTH LOGIN, user, password) and 11 more during
    // the first send() = 15 total. From write #16 on (the second send()'s first command), the
    // remote is treated as having reset the idle connection.
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
      '250 OK\r\n', // RCPT TO
      '354 Go ahead\r\n', // DATA
      '250 OK\r\n', // final '.'
    ])

    const conns = [firstConn, secondConn]
    let connectCount = 0
    const original = Deno.connectTls
    // deno-lint-ignore require-await
    Deno.connectTls = (async () => conns[connectCount++]) as typeof Deno.connectTls

    const client = newClient()
    try {
      await client['initialize']()
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello',
        content: 'body',
      })
      assertEquals(client.isHealthy(), true)

      // Idle timeout: the next send's first write fails, triggering an automatic reconnect+retry.
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello again',
        content: 'body',
      })
    } finally {
      Deno.connectTls = original
    }

    assertEquals(connectCount, 2)
    assertEquals(client.isHealthy(), true)
    assertStringIncludes(secondConnWritten[0], 'EHLO') // full handshake redone on the new connection
    assertStringIncludes(secondConnWritten[4], 'MAIL FROM:') // then the retried send goes through
  },
)

Deno.test(
  'SmtpClient: isHealthy() goes back to false if the reconnect-and-retry also fails',
  async () => {
    // A previously healthy client (isHealthy() === true) must not be left reporting healthy once
    // a send starts failing again, even if the automatic reconnect attempt itself doesn't pan out.
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

    // The reconnect's own handshake gets rejected outright (e.g. credentials revoked meanwhile).
    const { conn: secondConn } = makeFakeConn([
      '220 Ready\r\n',
      '554 Authentication failed\r\n',
    ])

    const conns = [firstConn, secondConn]
    let connectCount = 0
    const original = Deno.connectTls
    // deno-lint-ignore require-await
    Deno.connectTls = (async () => conns[connectCount++]) as typeof Deno.connectTls

    const client = newClient()
    try {
      await client['initialize']()
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello',
        content: 'body',
      })
      assertEquals(client.isHealthy(), true)

      await assertRejects(
        () =>
          client.send({
            to: 'dest@example.com',
            subject: 'Hello again',
            content: 'body',
          }),
        Error,
        'Expected code',
      )
    } finally {
      Deno.connectTls = original
    }

    assertEquals(client.isHealthy(), false)
  },
)

Deno.test(
  'SmtpClient: send() does not reconnect for ordinary (non-connection-closed) failures',
  async () => {
    // A wrong response code is a protocol/business error, not a sign the connection died — it
    // must propagate as-is, with no reconnect attempt.
    const { conn } = makeFakeConn([
      '220 Ready\r\n',
      '250 OK\r\n',
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
      '554 Transaction failed\r\n', // MAIL FROM gets rejected
    ])

    let connectCount = 0
    const original = Deno.connectTls
    // deno-lint-ignore require-await
    Deno.connectTls = (async () => {
      connectCount++
      return conn
    }) as typeof Deno.connectTls

    const client = newClient()
    try {
      await client['initialize']()

      await assertRejects(
        () =>
          client.send({
            to: 'dest@example.com',
            subject: 'Hello',
            content: 'body',
          }),
        Error,
        'Expected code',
      )
    } finally {
      Deno.connectTls = original
    }

    assertEquals(connectCount, 1) // no reconnect was attempted
    assertEquals(client.isHealthy(), false)
  },
)

Deno.test(
  'SmtpClient: send() and close() throw "Connection not ready!" when called before initialize() has run',
  async () => {
    // autoInitialize defaults to true here, so initialize() is scheduled via queueMicrotask —
    // it hasn't had a chance to run yet by the time we synchronously call send()/close() below,
    // exactly like a caller that forgets to `await client.isReady` first. Each client gets its
    // own fake connection since `getReader()`/`getWriter()` can only lock a given stream once.
    const handshakeResponses = [
      '220 Ready\r\n',
      '250 OK\r\n',
      '334 U\r\n',
      '334 P\r\n',
      '235 OK\r\n',
    ]
    const conns = [
      makeFakeConn(handshakeResponses).conn,
      makeFakeConn(handshakeResponses).conn,
    ]

    const original = Deno.connectTls
    let connectCount = 0
    // deno-lint-ignore require-await
    Deno.connectTls = (async () => conns[connectCount++]) as typeof Deno.connectTls

    try {
      const client = new SmtpClient({
        hostname: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        password: 's3cr3t',
      })

      await assertRejects(
        () =>
          client.send({
            to: 'dest@example.com',
            subject: 'Hi',
            content: 'body',
          }),
        Error,
        'Connection not ready!',
      )

      const client2 = new SmtpClient({
        hostname: 'smtp.example.com',
        port: 587,
        username: 'user@example.com',
        password: 's3cr3t',
      })

      assertEquals(await client2.close(), false)

      // Let both background initialize() calls settle before the test ends.
      await client.isReady.catch(() => {})
      await client2.isReady.catch(() => {})
    } finally {
      Deno.connectTls = original
    }
  },
)

Deno.test('SmtpClient: send() writes commands in order and marks the client healthy', async () => {
  using _time = new FakeTime('2025-01-01T00:00:00.000Z')

  const { conn, written } = makeFakeConn([
    '220 Ready\r\n',
    '250 OK\r\n',
    '334 U\r\n',
    '334 P\r\n',
    '235 OK\r\n',
    '250 OK\r\n', // MAIL FROM
    '250 OK\r\n', // RCPT TO
    '354 Go ahead\r\n', // DATA
    '250 OK\r\n', // final '.'
  ])

  const client = newClient()

  await withFakeConnectTls(conn, async () => {
    await client['initialize']()

    assertEquals(client.isHealthy(), false)

    await client.send({
      to: 'dest@example.com',
      subject: 'Hello',
      content: '<p>Hi</p>',
    })
  })

  const sendCommands = written.slice(4) // after EHLO, AUTH LOGIN, username, password from initialize()

  assertStringIncludes(sendCommands[0], 'MAIL FROM:')
  assertStringIncludes(sendCommands[1], 'RCPT TO:')
  assertEquals(sendCommands[2], 'DATA\r\n')
  assertStringIncludes(sendCommands[3], 'Subject: Hello')
  assertStringIncludes(sendCommands[4], 'From:')
  assertStringIncludes(sendCommands[5], 'To:')
  assertEquals(sendCommands[6], `Date: ${new Date().toString()}\r\n`)
  assertEquals(sendCommands[7], 'MIME-Version: 1.0\r\n')
  assertStringIncludes(
    sendCommands[8],
    'Content-Type: text/html;charset=utf-8',
  )
  assertEquals(sendCommands[9], '<p>Hi</p>\r\n')
  assertEquals(sendCommands[10], '.\r\n')

  assertEquals(client.isHealthy(), true)
})

Deno.test('SmtpClient: send() uses email.date, or falls back to now', async () => {
  const responses = [
    '220 Ready\r\n',
    '250 OK\r\n',
    '334 U\r\n',
    '334 P\r\n',
    '235 OK\r\n',
    '250 OK\r\n',
    '250 OK\r\n',
    '354 Go ahead\r\n',
    '250 OK\r\n',
  ]

  // Case 1: explicit date is used as-is.
  {
    const { conn, written } = makeFakeConn(responses)
    const client = newClient()
    await withFakeConnectTls(conn, async () => {
      await client['initialize']()
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello',
        content: 'body',
        date: 'Wed, 01 Jan 2020 00:00:00 GMT',
      })
    })
    const dateLine = written.find((line) => line.startsWith('Date: '))
    assertEquals(dateLine, 'Date: Wed, 01 Jan 2020 00:00:00 GMT\r\n')
  }

  // Case 2: no date provided, falls back to `new Date().toString()`, frozen via FakeTime.
  {
    using _time = new FakeTime('2025-06-15T12:00:00.000Z')
    const { conn, written } = makeFakeConn(responses)
    const client = newClient()
    await withFakeConnectTls(conn, async () => {
      await client['initialize']()
      await client.send({
        to: 'dest@example.com',
        subject: 'Hello',
        content: 'body',
      })
    })
    const dateLine = written.find((line) => line.startsWith('Date: '))
    assertEquals(dateLine, `Date: ${new Date().toString()}\r\n`)
  }
})

Deno.test('SmtpClient: parses display-name and bare email addresses differently', async () => {
  const responses = [
    '220 Ready\r\n',
    '250 OK\r\n',
    '334 U\r\n',
    '334 P\r\n',
    '235 OK\r\n',
    '250 OK\r\n',
    '250 OK\r\n',
    '354 Go ahead\r\n',
    '250 OK\r\n',
  ]

  const { conn, written } = makeFakeConn(responses)
  const client = newClient()

  await withFakeConnectTls(conn, async () => {
    await client['initialize']()
    await client.send({
      from: 'Sender Name <sender@example.com>',
      to: 'plain@example.com',
      subject: 'Hi',
      content: 'body',
    })
  })

  const mailFrom = written.find((line) => line.startsWith('MAIL FROM:'))
  const rcptTo = written.find((line) => line.startsWith('RCPT TO:'))
  const fromHeader = written.find((line) => line.startsWith('From:'))
  const toHeader = written.find((line) => line.startsWith('To:'))

  // Display-name form: the terse form extracts just the <addr> part.
  assertEquals(mailFrom, 'MAIL FROM: <sender@example.com>\r\n')
  assertEquals(fromHeader, 'From: Sender Name <sender@example.com>\r\n')

  // Bare-address form: both terse and full forms wrap the same string.
  assertEquals(rcptTo, 'RCPT TO: <plain@example.com>\r\n')
  assertEquals(toHeader, 'To: <plain@example.com>\r\n')
})

Deno.test('SmtpClient: close() sends QUIT, expects BYE, and closes the writer', async () => {
  const { conn, written, isWritableClosed } = makeFakeConn([
    '220 Ready\r\n',
    '250 OK\r\n',
    '334 U\r\n',
    '334 P\r\n',
    '235 OK\r\n',
    '221 Bye\r\n',
  ])

  const client = newClient()

  await withFakeConnectTls(conn, async () => {
    await client['initialize']()
    await client.close()
  })

  assertEquals(written.at(-1), 'QUIT\r\n')
  assertEquals(isWritableClosed(), true)
})

Deno.test('SmtpClient: static config takes precedence over constructor config', async () => {
  const { conn, written } = makeFakeConn([
    '220 Ready\r\n',
    '250 OK\r\n',
    '334 U\r\n',
    '334 P\r\n',
    '235 OK\r\n',
  ])

  const originalStaticConfig = SmtpClient.config
  SmtpClient.config = {
    hostname: 'static.example.com',
    port: 2525,
    username: 'static-user@example.com',
    password: 'static-pass',
  }

  try {
    const client = new SmtpClient({
      hostname: 'ctor.example.com',
      port: 25,
      username: 'ctor-user@example.com',
      password: 'ctor-pass',
      autoInitialize: false,
    })

    let connectOptions: Deno.ConnectTlsOptions | undefined
    await withFakeConnectTls(conn, () => client['initialize'](), (options) => {
      connectOptions = options
    })

    assertEquals(connectOptions?.hostname, 'static.example.com')
    assertEquals(connectOptions?.port, 2525)
    assertStringIncludes(written[0], 'EHLO static.example.com')
    assertEquals(written[2], `${btoa('static-user@example.com')}\r\n`)
  } finally {
    SmtpClient.config = originalStaticConfig
  }
})
