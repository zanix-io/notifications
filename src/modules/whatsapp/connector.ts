import type {
  WhatsappClientConfig,
  WhatsappProviderAdapter,
  WhatsappTemplateMessage,
} from 'typings/whatsapp.ts'
import type { NotifyMessage } from 'typings/general.ts'
import type { ConnectorOptions } from '@zanix/server'

import { ZanixNotifierConnector } from '../base.ts'
import { MetaCloudWhatsappAdapter } from './meta.ts'

/**
 * WhatsApp client for sending messages.
 *
 * The `WhatsappClient` class is part of the Zanix notifications ecosystem, responsible for
 * handling WhatsApp delivery. It extends `ZanixNotifierConnector` and provides a straightforward
 * interface to configure and send messages.
 *
 * Delivery itself is delegated to a `WhatsappProviderAdapter` (see `typings/whatsapp.ts`) rather
 * than being hardcoded to one vendor: `MetaCloudWhatsappAdapter` is the built-in default (see
 * `meta.ts`), built from `WhatsappClient.config`'s Meta-shaped fields. `TwilioWhatsappAdapter`
 * (see `twilio.ts`) is a second built-in option — set
 * `WhatsappClient.config = { adapter: new TwilioWhatsappAdapter({...}) }`, or the matching
 * `TWILIO_*`/`TWILIO_WHATSAPP_FROM` env vars (see `whatsapp/defs.ts`), to use it instead. Any
 * other provider can be plugged in the same way with a custom `WhatsappProviderAdapter`.
 *
 * `send()` (the `ZanixNotifierConnector` contract, driven by `NotifierProvider`) only ever sends
 * freeform text — WhatsApp Cloud API's own pre-approved "template message" feature, required to
 * initiate a conversation outside the 24h customer-service window, is a distinct capability
 * exposed separately via `sendTemplate()`, since `NotifyMessage` has no template fields.
 *
 * Registered as `SCOPED` (see `whatsapp/defs.ts`), for consistency with the other notifier
 * connectors — unlike `SmtpClient`, there's no persistent-connection safety concern here (each
 * send is an independent HTTP request via the configured adapter), so a `SINGLETON` registration
 * would also be safe if avoiding per-request construction ever matters.
 *
 * @extends ZanixNotifierConnector
 */
export class WhatsappClient extends ZanixNotifierConnector {
  #config: WhatsappClientConfig
  #adapter: WhatsappProviderAdapter | undefined

  /**
   * Shared WhatsApp provider settings applied to every `WhatsappClient` instance.
   *
   * Set once (typically from `META_*` environment variables — see `whatsapp/defs.ts`) before any
   * instance is constructed; per-instance config passed to the constructor is merged on top.
   */
  public static config: WhatsappClientConfig

  /**
   * Creates a `WhatsappClient` bound to a connector context.
   *
   * @param config Per-instance provider settings, merged with `WhatsappClient.config`, plus the
   * connector's own `contextId`/`autoInitialize` options.
   */
  constructor(
    { contextId, autoInitialize, ...config }:
      & WhatsappClientConfig
      & ConnectorOptions,
  ) {
    super({ contextId, autoInitialize })

    this.#config = { ...config, ...WhatsappClient.config }
  }

  /**
   * Builds the provider adapter: the configured custom `adapter`, or a `MetaCloudWhatsappAdapter`
   * built from the remaining (Meta-shaped) config fields.
   *
   * Like `SmtpClient`, this doesn't validate credentials up front — a missing/invalid field is
   * only discovered when the adapter's first send call reaches Meta and gets rejected.
   */
  protected initialize(): void {
    // Config fields beyond `adapter` are trusted to be Meta-shaped when no custom adapter is
    // given; an incomplete config fails naturally on first send (see above), not here.
    this.#adapter = this.#config.adapter ??
      new MetaCloudWhatsappAdapter(
        this.#config as Required<
          Pick<WhatsappClientConfig, 'phoneNumberId' | 'accessToken'>
        >,
      )
  }

  /** No-op: a provider adapter is a stateless HTTP client, there's no connection to close. */
  public close(): void {}

  /**
   * Sends a freeform WhatsApp text message.
   *
   * @param message Message to send — `content` is required; `subject`/`date` are ignored (WhatsApp
   * has neither). For a pre-approved template message, use `sendTemplate()` instead.
   * @throws If called before initialization has completed, or if the underlying adapter's
   * `send()` throws (e.g. `HttpError`).
   */
  public async send(message: NotifyMessage): Promise<void> {
    if (!this.#adapter) throw new Error('WhatsappClient not initialized!')

    await this.#adapter.send({ to: message.to, content: message.content })
  }

  /**
   * Sends a pre-approved WhatsApp Business template message — the mechanism required to initiate
   * a conversation outside the 24h customer-service session window (see `WhatsappMessage`).
   *
   * Accepts either provider's template shape: Meta Cloud API's `templateName`/`templateLanguage`
   * (+ optional `templateParams`), or Twilio's Content API `contentSid` (+ optional
   * `contentVariables`) — whichever matches the adapter actually configured.
   *
   * @param message Recipient plus the template identification for whichever provider is
   * configured.
   * @throws If called before initialization has completed, or if the underlying adapter's
   * `send()` throws (e.g. `HttpError`, or a plain `Error` if the shape doesn't match the
   * configured adapter's provider).
   */
  public async sendTemplate(message: WhatsappTemplateMessage): Promise<void> {
    if (!this.#adapter) throw new Error('WhatsappClient not initialized!')

    await this.#adapter.send(message)
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
