/**
 * A single WhatsApp message ready to hand off to a provider adapter.
 *
 * Exactly one of `content` (freeform text, only deliverable within WhatsApp's 24h customer-service
 * session window) or a pre-approved template (required to initiate a conversation outside that
 * window) is expected to be set — unrelated to `NotifierProvider.sendMessage()`'s Handlebars-based
 * `{template, data}`, which always renders to a plain `content` string before a message ever reaches
 * this type. The two providers built into this package identify templates differently, so this
 * carries both shapes; each adapter only reads its own:
 * - `templateName`/`templateLanguage`/`templateParams` — WhatsApp Cloud API's (Meta) model, read
 *   by `MetaCloudWhatsappAdapter`.
 * - `contentSid`/`contentVariables` — Twilio's Content API model (a pre-registered "Content SID"
 *   plus named variables, see https://www.twilio.com/docs/content), read by
 *   `TwilioWhatsappAdapter`.
 */
export interface WhatsappMessage {
  /** Recipient phone number, in E.164 format (e.g. `+15551234567`) */
  to: string

  /** Freeform text content */
  content?: string

  /** Name of a pre-approved WhatsApp Business template message (Meta Cloud API) */
  templateName?: string

  /** Template language code (e.g. `en_US`). Required when `templateName` is set (Meta Cloud API) */
  templateLanguage?: string

  /** Positional parameters substituted into the template's body placeholders (Meta Cloud API) */
  templateParams?: string[]

  /** Twilio Content API template SID (e.g. `HX...`) */
  contentSid?: string

  /** Named variables substituted into the Content template's placeholders (e.g. `{"1": "409173"}`) */
  contentVariables?: Record<string, string>
}

/**
 * Recipient plus template identification, for whichever provider is actually configured — the
 * shape `WhatsappClient.sendTemplate()`/`NotifierProvider.sendTemplate()` accept. Either Meta
 * Cloud API's `templateName`/`templateLanguage` (+ optional `templateParams`), or Twilio's
 * Content API `contentSid` (+ optional `contentVariables`); see `WhatsappMessage`.
 */
export type WhatsappTemplateMessage =
  & Pick<WhatsappMessage, 'to'>
  & (
    | (
      & Required<Pick<WhatsappMessage, 'templateName' | 'templateLanguage'>>
      & Pick<WhatsappMessage, 'templateParams'>
    )
    | (
      & Required<Pick<WhatsappMessage, 'contentSid'>>
      & Pick<WhatsappMessage, 'contentVariables'>
    )
  )

/**
 * Pluggable WhatsApp delivery contract. `WhatsappClient` delegates to whichever adapter is
 * configured (see `WhatsappClientConfig.adapter`), so it isn't coupled to any single provider.
 */
export interface WhatsappProviderAdapter {
  /** Sends a single WhatsApp message, throwing on delivery failure. */
  send(message: WhatsappMessage): Promise<void>
}

/** WhatsApp Cloud API (Meta) credentials (see https://developers.facebook.com/docs/whatsapp/cloud-api). */
export interface MetaCloudConfig {
  /** WhatsApp Business phone number ID */
  phoneNumberId: string

  /** Meta Graph API access token */
  accessToken: string

  /** Graph API version, e.g. `v25.0`. Defaults to a recent stable version when omitted */
  apiVersion?: string

  /**
   * Graph API base URL. Defaults to `https://graph.facebook.com`; override to point at a proxy
   * or mock server.
   */
  apiBase?: string
}

/**
 * Configuration for `WhatsappClient`.
 *
 * Provide `adapter` to use a custom WhatsApp provider (e.g. Twilio's WhatsApp API); otherwise the
 * built-in `MetaCloudWhatsappAdapter` is used, built from the remaining (Meta-shaped) fields.
 */
export interface WhatsappClientConfig extends Partial<MetaCloudConfig> {
  /** Custom provider adapter; overrides the built-in Meta Cloud API adapter entirely when provided */
  adapter?: WhatsappProviderAdapter
}
