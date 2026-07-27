import type { ServerConfig } from 'typings/email.ts'
import type { NotifyMessage } from 'typings/general.ts'
import type { ConnectorOptions } from '@zanix/server'

import { smtpResponseCode } from 'utils/constants.ts'
import { ZanixNotifierConnector } from '../base.ts'
import { getSmtpPool, SmtpConnection, SmtpConnectionClosedError } from './pool.ts'

/**
 * SMTP client for sending emails.
 *
 * The `SmtpClient` class is part of the Zanix notifications ecosystem, responsible for
 * handling email delivery via the Simple Mail Transfer Protocol (SMTP). It extends the
 * `ZanixNotifierConnector` class and provides functionality for connecting to an SMTP
 * server, sending email messages, and managing SMTP-specific configurations such as
 * authentication and connection settings.
 *
 * This client supports dynamic email templating and ensures reliable message delivery.
 * It uses data passed through the `sendMessage()` method and supports Handlebars-based
 * templates for rendering personalized email content.
 *
 * Each instance is a thin, per-request handle around an `SmtpConnection` (see `pool.ts`): the
 * actual authenticated SMTP session is either dialed fresh or borrowed from a shared pool,
 * depending on `SMTP_POOL_SIZE`.
 *
 * Registered as `SCOPED`, never `SINGLETON` (see `email/defs.ts`) — deliberately so: SMTP is a
 * stateful, single-socket protocol, a command is written and exactly one response is read before
 * the next command can go out. A singleton `SmtpClient` shared across concurrent requests would
 * interleave unrelated requests' commands/responses on the same connection and corrupt the SMTP
 * session; avoiding that would mean serializing `send()` calls internally (a queue/mutex), trading
 * this per-request handle for a single point of failure and a fully serialized send path.
 *
 * `SCOPED` doesn't mean a fresh TCP+TLS+AUTH handshake per request, though: once `SMTP_POOL_SIZE`
 * is set above its default of `1`, `initialize()` borrows an already-authenticated connection from
 * a shared pool (see `pool.ts`) instead of dialing one, and `close()` releases it back at the end
 * of the request. That `acquire()`/`release()` pair is what makes the reuse safe (only one request
 * holds a given connection at a time) — and it only runs once per request *because* this is
 * `SCOPED`: in `@zanix/server`, `close()`/`onDestroy()` are only ever invoked for instances cached
 * under a real per-request context, which only `SCOPED` instances are. A `SINGLETON` connector
 * would `initialize()` (acquire) exactly once, ever, and never `close()` — permanently starving the
 * pool of that slot while every subsequent request shares that one held connection's `#session`
 * directly, with no exclusivity at all; the exact corruption risk the pool exists to avoid, just
 * relocated. `send()` also self-heals (reconnects and retries once) if a connection was silently
 * closed by the remote since it was last used (idle timeout, reset, etc.).
 *
 * @extends ZanixNotifierConnector
 */
export class SmtpClient extends ZanixNotifierConnector {
  #config: ServerConfig
  #connected: boolean = false
  #session: SmtpConnection | undefined

  /**
   * Shared SMTP connection settings applied to every `SmtpClient` instance.
   *
   * Set once (typically from `SMTP_*` environment variables — see `email/defs.ts`) before any
   * instance is constructed; per-instance config passed to the constructor is merged on top.
   */
  public static config: ServerConfig

  /**
   * Creates an `SmtpClient` bound to a connector context.
   *
   * @param config Per-instance connection settings, merged with `SmtpClient.config`, plus the
   * connector's own `contextId`/`autoInitialize` options.
   */
  constructor({ contextId, autoInitialize, ...config }: ServerConfig & ConnectorOptions) {
    super({ contextId, autoInitialize })

    this.#config = { ...config, ...SmtpClient.config }
  }

  /**
   * Connects to the SMTP server and authenticates — or borrows an already-authenticated
   * connection from the shared pool, when `SMTP_POOL_SIZE` enables one (see `pool.ts`).
   *
   * Safe to call again on an already-initialized instance (e.g. to reconnect after the remote
   * closed an idle connection — see `send()`): any previous session is discarded from the pool
   * (it's already dead, that's why we're here), or terminated for good when pooling is off,
   * before acquiring the replacement.
   */
  protected async initialize(): Promise<void> {
    const pool = getSmtpPool()

    if (this.#session) {
      if (pool) pool.discard(this.#session)
      else await this.#session.terminate().catch(() => {})
    }

    this.#session = pool
      ? await pool.acquire(() => SmtpConnection.open(this.#config))
      : await SmtpConnection.open(this.#config)
  }

  /**
   * Closes the SMTP connection: released back to the shared pool for reuse when pooling is
   * enabled, or terminated for good (QUIT + socket close) otherwise.
   */
  public async close() {
    if (!this.#session) throw new Error('Connection not ready!')

    const session = this.#session
    this.#session = undefined

    const pool = getSmtpPool()
    if (pool) pool.release(session)
    else await session.terminate()
  }

  /**
   * Sends an email.
   *
   * If the connection was silently closed by the remote (idle timeout, reset, etc.), this
   * reconnects once (dialing fresh, or borrowing another pooled connection) and retries the send
   * before giving up, since a previously healthy connection dying between sends is expected over
   * a long-lived client.
   *
   * @param email Email to send
   */
  public async send(email: NotifyMessage) {
    try {
      await this.#deliver(email)
    } catch (error) {
      if (!(error instanceof SmtpConnectionClosedError)) throw error

      this.#connected = false
      await this.initialize()
      await this.#deliver(email)
    }
  }

  async #deliver(email: NotifyMessage) {
    if (!this.#session) throw new Error('Connection not ready!')
    const session = this.#session

    const [fromAddr, fromFull] = this.#parseEmail(email.from ?? this.#config.username)
    const [toAddr, toFull] = this.#parseEmail(email.to)
    const date = email.date ?? new Date().toString()

    await session.sendCommand(`MAIL FROM: ${fromAddr}`, smtpResponseCode.OK)
    await session.sendCommand(`RCPT TO: ${toAddr}`, smtpResponseCode.OK)
    await session.sendCommand('DATA', smtpResponseCode.BEGIN_DATA)

    await session.sendCommand(`Subject: ${email.subject}`)
    await session.sendCommand(`From: ${fromFull}`)
    await session.sendCommand(`To: ${toFull}`)
    await session.sendCommand(`Date: ${date}`)
    await session.sendCommand('MIME-Version: 1.0')
    await session.sendCommand('Content-Type: text/html;charset=utf-8\r\n')
    await session.sendCommand(email.content)
    await session.sendCommand('.', smtpResponseCode.OK)

    this.#connected = true
  }

  /**
   * Whether the last `send()` completed successfully on the current session.
   *
   * @returns `true` once a message has been delivered without the connection being reset;
   * `false` before any send, or after a reconnect until the retried send succeeds.
   */
  public override isHealthy(): boolean {
    return this.#connected
  }

  /**
   * Parses an email address into SMTP format
   * @param email Email string
   * @returns Tuple of [SMTP format, full string]
   */
  #parseEmail(email: string): [string, string] {
    const match = email.toString().match(/(.*)\s*<(.*)>/)
    return match?.length === 3 ? [`<${match[2]}>`, email] : [`<${email}>`, `<${email}>`]
  }
}
