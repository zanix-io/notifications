import type { ServerConfig, SmtpResponseCode } from 'typings/email.ts'

import { SMTP_RESPONSE_CODE } from 'utils/constants.ts'
import { decoder, encoder } from '@zanix/helpers'
import { ApplicationError, InternalError } from '@zanix/errors'
import logger from '@zanix/logger'

/**
 * Env var naming the shared SMTP connection pool's size — read by `pool.ts`'s `getSmtpPool()`, not
 * by `registerSmtpConnector()` itself. Exported from here (rather than from `pool.ts`, where it's
 * consumed) so it lives alongside this module's other `SMTP_*_ENV` constants, the same single home
 * every other SMTP env var name already has.
 */
export const SMTP_POOL_SIZE_ENV = 'SMTP_POOL_SIZE'

/**
 * The one standard implicit-TLS ("SMTPS") SMTP port — see `ServerConfig.port`'s own doc. Every
 * other port (587, 25, a local dev catcher's arbitrary port, ...) is dialed in plaintext first;
 * `SmtpConnection.open()` only upgrades it via `STARTTLS` if the server's own `EHLO` response
 * actually advertises that capability, never unconditionally.
 */
const SMTP_IMPLICIT_TLS_PORT = 465

/**
 * Thrown when an SMTP connection is found closed (idle timeout, remote reset, etc.) while being
 * used. Distinct from a generic error so `SmtpClient.send()` can tell "connection died" apart
 * from any other failure and react to it (reconnect and retry, or discard from the pool).
 *
 * Extends `ApplicationError` (not `Error` directly, as before) — gets `id`/`code`/`cause`/
 * `shouldLog` for free while keeping its own distinct, `instanceof`-catchable type (see
 * `@zanix/errors`' docs, "Choosing a class"). `ApplicationError`'s `shouldLog: false` default is
 * deliberately kept: a closed connection here is expected/recoverable (the whole point of this
 * class is that its caller reconnects and retries), not an `InternalError`-shaped surprise.
 */
export class SmtpConnectionClosedError extends ApplicationError {
  constructor(cause?: unknown) {
    super(
      'SMTP connection closed unexpectedly (idle timeout or remote reset)',
      { cause, code: 'SMTP_CONNECTION_CLOSED' },
    )
    this.name = 'SmtpConnectionClosedError'
  }
}

/**
 * A single authenticated SMTP session.
 *
 * Only ever obtained via `SmtpConnection.open()`, which dials and completes the full handshake
 * (EHLO, optionally STARTTLS, AUTH LOGIN) before returning — so there's no "constructed but not
 * ready" state to guard against here; that responsibility belongs to whatever holds a (possibly
 * not-yet-assigned) reference to one of these, e.g. `SmtpClient`.
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

  /**
   * Dials the server and completes the SMTP handshake, returning a ready-to-use session.
   *
   * Only `SMTP_IMPLICIT_TLS_PORT` (465, "SMTPS") is wrapped in TLS from the first byte. Every
   * other port is dialed in plaintext (`Deno.connect`) and only upgraded via `STARTTLS`
   * (`Deno.startTls`) when the server's own `EHLO` response actually advertises that capability —
   * never unconditionally. This matches standard SMTP client behavior and is what real relays
   * expecting STARTTLS on 587 (Gmail, SES, SendGrid, ...) and local dev catchers with no TLS at
   * all (MailDev, Mailpit, MailHog, smtp4dev, ...) both need: dialing every connection straight
   * into `Deno.connectTls` made Deno's own TLS record-layer parser reject a plaintext server's `220`
   * greeting as a corrupt TLS record, tearing the connection down before the handshake ever began.
   */
  public static async open(config: ServerConfig): Promise<SmtpConnection> {
    const implicitTls = config.port === SMTP_IMPLICIT_TLS_PORT

    const connection = implicitTls
      ? await Deno.connectTls({ hostname: config.hostname, port: config.port })
      : await Deno.connect({ hostname: config.hostname, port: config.port })

    let session = new SmtpConnection(
      connection.readable.getReader(),
      connection.writable.getWriter(),
    )

    await session.sendCommand(undefined, SMTP_RESPONSE_CODE.READY)
    const ehloResponse = await session.sendCommand(
      `EHLO ${config.hostname}`,
      SMTP_RESPONSE_CODE.OK,
    )

    if (!implicitTls && ehloResponse?.toUpperCase().includes('STARTTLS')) {
      // The `220` reply to `STARTTLS` shares the same code as the initial greeting (RFC 3207).
      await session.sendCommand('STARTTLS', SMTP_RESPONSE_CODE.READY)
      // `Deno.startTls` takes over the raw TCP socket — it requires the streams handed out above
      // to have no active lock on them.
      session.#reader.releaseLock()
      session.#writer.releaseLock()
      const tlsConnection = await Deno.startTls(connection as Deno.TcpConn, {
        hostname: config.hostname,
      })
      session = new SmtpConnection(
        tlsConnection.readable.getReader(),
        tlsConnection.writable.getWriter(),
      )
      // The server forgets any capabilities announced before the upgrade — RFC 3207 requires
      // re-issuing EHLO over the now-encrypted channel before authenticating.
      await session.sendCommand(`EHLO ${config.hostname}`, SMTP_RESPONSE_CODE.OK)
    }

    await session.sendCommand('AUTH LOGIN', SMTP_RESPONSE_CODE.AUTH_NEXT)
    await session.sendCommand(
      btoa(config.username),
      SMTP_RESPONSE_CODE.AUTH_NEXT,
    )
    await session.sendCommand(
      btoa(config.password),
      SMTP_RESPONSE_CODE.AUTH_SUCCESS,
    )

    return session
  }

  /**
   * Writes a command to the server and optionally checks the response code.
   * @param command Command line to send
   * @param expectedCode Expected SMTP response code
   * @returns The raw (trimmed) response text when `expectedCode` is given — e.g. so `open()` can
   * inspect an `EHLO` reply for a `STARTTLS` capability line — `undefined` otherwise.
   */
  public async sendCommand(
    command?: string,
    expectedCode?: SmtpResponseCode,
  ): Promise<string | undefined> {
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
      // An SMTP server misbehaving mid-protocol is exactly the "caller had no control over it" case
      // `InternalError` is for, not the caller's mistake.
      // No manual `logger.error` call needed at either throw below: `InternalError` defaults
      // `shouldLog` to `true` (see `@zanix/errors`), so its own constructor already logs
      // `this.message` + the full (already payload-safe — no raw response text, just the numeric
      // `meta.expectedCode`/`actualCode`) error object. A manual call here would double-log the
      // same event.
      if (!response) {
        throw new InternalError('Invalid response from server', { code: 'SMTP_INVALID_RESPONSE' })
      }
      const lines = response.split('\r\n')
      // deno-lint-ignore no-non-null-assertion
      const code = parseInt(lines.at(-1)!.slice(0, 3).trim())
      if (code !== expectedCode) {
        throw new InternalError(`Expected code: ${expectedCode}, got: ${code}`, {
          code: 'SMTP_UNEXPECTED_RESPONSE_CODE',
          meta: { expectedCode, actualCode: code },
        })
      }
      return response
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
      await this.sendCommand('QUIT', SMTP_RESPONSE_CODE.BYE)
    } finally {
      await this.#writer.close().catch(() => {})
    }
  }

  #closeUnexpectedly(cause?: unknown): never {
    // `warn`, not `error`: this is the recoverable case — `SmtpClient.send()` catches
    // `SmtpConnectionClosedError` specifically to reconnect and retry once (see `connector.ts`).
    // Only `cause`'s own `.message` (a low-level TCP/stream error string, never user payload) is
    // logged, never the `cause` object itself.
    logger.warn(
      '[SmtpConnection] SMTP connection closed unexpectedly (idle timeout or remote reset) — will reconnect and retry.',
      { cause: cause instanceof Error ? cause.message : undefined },
    )
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
  public async acquire(
    connect: () => Promise<SmtpConnection>,
  ): Promise<SmtpConnection> {
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
 * Resolves the shared SMTP connection pool from the `SMTP_POOL_SIZE_ENV` env var, once per
 * process.
 *
 * `1` — the default, applied when the variable is unset or not a valid number greater than `1` —
 * disables pooling entirely: `SmtpClient` dials a fresh connection per request, exactly as before
 * pooling existed. Any value greater than `1` enables a shared pool of that many persistent,
 * authenticated connections.
 */
export function getSmtpPool(): SmtpConnectionPool | undefined {
  if (!smtpPoolResolved) {
    const size = Number(Deno.env.get(SMTP_POOL_SIZE_ENV) ?? '1')
    smtpPool = size > 1 ? new SmtpConnectionPool(size) : undefined
    smtpPoolResolved = true
  }
  return smtpPool
}
