import type { SmsClientConfig, SmsProviderAdapter, TwilioConfig } from 'typings/sms.ts'
import type { NotifyMessage } from 'typings/general.ts'
import type { ConnectorOptions } from '@zanix/server'

import { ZanixNotifierConnector } from '../base.ts'
import { TwilioSmsAdapter } from './twilio.ts'

/**
 * SMS client for sending text messages.
 *
 * The `SmsClient` class is part of the Zanix notifications ecosystem, responsible for handling
 * SMS delivery. It extends `ZanixNotifierConnector` and provides a straightforward interface to
 * configure and send text messages.
 *
 * Delivery itself is delegated to a `SmsProviderAdapter` (see `typings/sms.ts`) rather than being
 * hardcoded to one vendor: `TwilioSmsAdapter` is the built-in default (see `twilio.ts`), built
 * from `SmsClient.config`'s Twilio-shaped fields, but any other provider (AWS SNS, Vonage, etc.)
 * can be used by setting `SmsClient.config = { adapter: myAdapter }`.
 *
 * Registered as `SCOPED` (see `sms/defs.ts`), for consistency with the other notifier connectors
 * — unlike `SmtpClient`, there's no persistent-connection safety concern here (each `send()` is
 * an independent HTTP request via the configured adapter), so a `SINGLETON` registration would
 * also be safe if avoiding per-request construction ever matters.
 *
 * @extends ZanixNotifierConnector
 */
export class SmsClient extends ZanixNotifierConnector {
  #config: SmsClientConfig
  #adapter: SmsProviderAdapter | undefined

  /**
   * Shared SMS provider settings applied to every `SmsClient` instance.
   *
   * Set once (typically from `TWILIO_*` environment variables — see `sms/defs.ts`) before any
   * instance is constructed; per-instance config passed to the constructor is merged on top.
   */
  public static config: SmsClientConfig

  /**
   * Creates an `SmsClient` bound to a connector context.
   *
   * @param config Per-instance provider settings, merged with `SmsClient.config`, plus the
   * connector's own `contextId`/`autoInitialize` options.
   */
  constructor({ contextId, autoInitialize, ...config }: SmsClientConfig & ConnectorOptions) {
    super({ contextId, autoInitialize })

    this.#config = { ...config, ...SmsClient.config }
  }

  /**
   * Builds the provider adapter: the configured custom `adapter`, or a `TwilioSmsAdapter` built
   * from the remaining (Twilio-shaped) config fields.
   *
   * Like `SmtpClient`, this doesn't validate credentials up front — a missing/invalid Twilio
   * field is only discovered when the adapter's first `send()` call reaches Twilio and gets
   * rejected.
   */
  protected initialize(): void {
    // Config fields beyond `adapter` are trusted to be Twilio-shaped when no custom adapter is
    // given; an incomplete config fails naturally on first send (see above), not here.
    this.#adapter = this.#config.adapter ?? new TwilioSmsAdapter(this.#config as TwilioConfig)
  }

  /** No-op: a provider adapter is a stateless HTTP client, there's no connection to close. */
  public close(): void {}

  /**
   * Sends an SMS message.
   *
   * @param message Message to send — `content` is required; `subject`/`date` are ignored (SMS has
   * neither).
   * @throws If called before initialization has completed, or if the underlying adapter's
   * `send()` throws (e.g. `HttpError`).
   */
  public async send(message: NotifyMessage): Promise<void> {
    if (!this.#adapter) throw new Error('SmsClient not initialized!')

    await this.#adapter.send({ to: message.to, content: message.content, from: message.from })
  }

  /**
   * Whether the provider adapter has been constructed and is ready to attempt sends.
   *
   * @returns `true` once `initialize()` has run.
   */
  public isHealthy(): boolean {
    return !!this.#adapter
  }
}
