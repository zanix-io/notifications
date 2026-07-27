import type { ServerConfig, SmtpResponseCode } from 'typings/email.ts'

import { smtpResponseCode } from 'utils/constants.ts'
import { decoder, encoder } from '@zanix/helpers'

/**
 * Thrown when an SMTP connection is found closed (idle timeout, remote reset, etc.) while being
 * used. Distinct from a generic `Error` so `SmtpClient.send()` can tell "connection died" apart
 * from any other failure and react to it (reconnect and retry, or discard from the pool).
 */
export class SmtpConnectionClosedError extends Error {
  constructor(cause?: unknown) {
    super('SMTP connection closed unexpectedly (idle timeout or remote reset)', { cause })
    this.name = 'SmtpConnectionClosedError'
  }
}

/**
 * A single authenticated SMTP session over one TLS connection.
 *
 * Only ever obtained via `SmtpConnection.open()`, which dials and completes the full handshake
 * (EHLO, AUTH LOGIN) before returning — so there's no "constructed but not ready" state to guard
 * against here; that responsibility belongs to whatever holds a (possibly not-yet-assigned)
 * reference to one of these, e.g. `SmtpClient`.
 */
export class SmtpConnection {
  #reader: ReadableStreamDefaultReader<Uint8Array>
  #writer: WritableStreamDefaultWriter<Uint8Array>

  /** Private — instances are only ever created by `open()`, already handshaken and ready. */
  private constructor(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writer: WritableStreamDefaultWriter<Uint8Array>,
  ) {
    this.#reader = reader
    this.#writer = writer
  }

  /** Dials the server and completes the SMTP handshake, returning a ready-to-use session. */
  public static async open(config: ServerConfig): Promise<SmtpConnection> {
    const connection = await Deno.connectTls({ hostname: config.hostname, port: config.port })
    const session = new SmtpConnection(
      connection.readable.getReader(),
      connection.writable.getWriter(),
    )

    await session.sendCommand(undefined, smtpResponseCode.READY)
    await session.sendCommand(`EHLO ${config.hostname}`, smtpResponseCode.OK)
    await session.sendCommand('AUTH LOGIN', smtpResponseCode.AUTH_NEXT)
    await session.sendCommand(btoa(config.username), smtpResponseCode.AUTH_NEXT)
    await session.sendCommand(btoa(config.password), smtpResponseCode.AUTH_SUCCESS)

    return session
  }

  /**
   * Writes a command to the server and optionally checks the response code.
   * @param command Command line to send
   * @param expectedCode Expected SMTP response code
   */
  public async sendCommand(command?: string, expectedCode?: SmtpResponseCode) {
    if (command) {
      await this.#writer.ready
      await this.#writer.write(encoder.encode(`${command}\r\n`)).catch((e) =>
        this.#closeUnexpectedly(e)
      )
    }
    if (expectedCode) {
      const result = await this.#reader.read().catch((e) => this.#closeUnexpectedly(e))
      if (result.done) this.#closeUnexpectedly()
      const response = decoder.decode(result.value).trim()
      if (!response) throw new Error('Invalid response from server')
      const lines = response.split('\r\n')
      // deno-lint-ignore no-non-null-assertion
      const code = parseInt(lines.at(-1)!.slice(0, 3).trim())
      if (code !== expectedCode) throw new Error(`Expected code: ${expectedCode}, got: ${code}`)
    }
  }

  /**
   * Ends the SMTP session for good: sends QUIT and closes the underlying socket.
   *
   * Only meant for the non-pooled path — a pooled connection is never terminated by the pool
   * itself: a healthy one between borrows is released back to it (see
   * `SmtpConnectionPool.release()`), and a dead one is dropped via `SmtpConnectionPool.discard()`
   * without a `QUIT`, since its socket is already gone by the time it's found to be dead.
   */
  public async terminate() {
    try {
      await this.sendCommand('QUIT', smtpResponseCode.BYE)
    } finally {
      await this.#writer.close().catch(() => {})
    }
  }

  #closeUnexpectedly(cause?: unknown): never {
    throw new SmtpConnectionClosedError(cause)
  }
}

/**
 * A small pool of persistent, authenticated `SmtpConnection`s, shared across requests.
 *
 * Concurrency safety comes from borrowing, not from serializing method calls: only one caller
 * ever holds a given connection at a time, so at most `size` SMTP commands are ever in flight at
 * once, regardless of how many requests are sending concurrently.
 *
 * There's no idle-eviction here by design: a connection the remote silently closed while sitting
 * idle in the pool is detected reactively (via `SmtpConnectionClosedError`) the next time someone
 * tries to use it, and gets `discard()`ed and replaced then — see `SmtpClient.initialize()`.
 */
export class SmtpConnectionPool {
  #size: number
  #idle: SmtpConnection[] = []
  #activeCount = 0
  #waiters: Array<{
    resolve: (connection: SmtpConnection) => void
    reject: (error: unknown) => void
    connect: () => Promise<SmtpConnection>
  }> = []

  constructor(size: number) {
    this.#size = size
  }

  /**
   * Borrows a connection: an idle one if available, a freshly dialed one if under capacity, or
   * waits for the next `release()`/`discard()` otherwise.
   * @param connect Creates a new authenticated connection; called on a capacity cache-miss, and
   * again later by `discard()` if this call ends up queued and gets serviced that way.
   */
  public async acquire(connect: () => Promise<SmtpConnection>): Promise<SmtpConnection> {
    const idle = this.#idle.pop()
    if (idle) return idle

    if (this.#activeCount < this.#size) {
      this.#activeCount++
      return await connect()
    }

    return await new Promise((resolve, reject) => this.#waiters.push({ resolve, reject, connect }))
  }

  /** Returns a still-healthy connection to the pool for reuse. */
  public release(connection: SmtpConnection) {
    const waiter = this.#waiters.shift()
    if (waiter) {
      waiter.resolve(connection)
      return
    }
    this.#idle.push(connection)
  }

  /**
   * Drops a connection that turned out to be dead, freeing its slot for the next `acquire()` —
   * or, if a caller is already queued waiting for a slot, dials a replacement immediately (using
   * that waiter's own `connect`) to service it instead of leaving it queued indefinitely for a
   * `release()` that, since the pool never idle-evicts, may never come.
   */
  public discard(connection: SmtpConnection) {
    const idleIndex = this.#idle.indexOf(connection)
    if (idleIndex !== -1) this.#idle.splice(idleIndex, 1)
    this.#activeCount--

    const waiter = this.#waiters.shift()
    if (!waiter) return

    this.#activeCount++
    waiter.connect().then(waiter.resolve, (error) => {
      this.#activeCount--
      waiter.reject(error)
    })
  }
}

let smtpPool: SmtpConnectionPool | undefined
let smtpPoolResolved = false

/**
 * Resolves the shared SMTP connection pool from the `SMTP_POOL_SIZE` env var, once per process.
 *
 * `1` — the default, applied when the variable is unset or not a valid number greater than `1` —
 * disables pooling entirely: `SmtpClient` dials a fresh connection per request, exactly as before
 * pooling existed. Any value greater than `1` enables a shared pool of that many persistent,
 * authenticated connections.
 */
export function getSmtpPool(): SmtpConnectionPool | undefined {
  if (!smtpPoolResolved) {
    const size = Number(Deno.env.get('SMTP_POOL_SIZE') ?? '1')
    smtpPool = size > 1 ? new SmtpConnectionPool(size) : undefined
    smtpPoolResolved = true
  }
  return smtpPool
}
