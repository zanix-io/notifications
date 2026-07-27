import type { WhatsappMessage, WhatsappProviderAdapter } from 'typings/whatsapp.ts'
import type { TwilioConfig } from 'typings/sms.ts'

import { RestClient } from '@zanix/server'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

/**
 * `WhatsappProviderAdapter` for Twilio's WhatsApp API (see
 * https://www.twilio.com/docs/whatsapp/api) — an alternative to the default
 * `MetaCloudWhatsappAdapter`. Twilio sends WhatsApp messages through the exact same `Messages`
 * endpoint it uses for SMS (see `sms/twilio.ts`'s `TwilioSmsAdapter`), just with `to`/`from`
 * prefixed `whatsapp:`, so this reuses the same `TwilioConfig` shape (and, in practice, usually
 * the same account credentials — only `from` tends to differ, since a WhatsApp-enabled sender is
 * typically a different number than the plain SMS one).
 *
 * Not the default: `WhatsappClient` builds `MetaCloudWhatsappAdapter` unless a custom `adapter` is
 * configured — set `WhatsappClient.config = { adapter: new TwilioWhatsappAdapter({...}) }` (or
 * the matching `TWILIO_*`/`TWILIO_WHATSAPP_FROM` env vars via `whatsapp/defs.ts`) to use this
 * instead.
 *
 * Supports freeform text (`message.content`) and Twilio's own Content API template messages
 * (`message.contentSid` + `message.contentVariables`, see
 * https://www.twilio.com/docs/content/send-content-with-messaging-api) — e.g.:
 *
 * ```ts
 * await adapter.send({
 *   to: '+15551234567',
 *   contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
 *   contentVariables: { '1': '409173' },
 * })
 * ```
 *
 * `message.templateName` (Meta Cloud API's own template model — a name/language pair) is a
 * different shape that doesn't map onto Twilio's Content SID, so `send()` throws if it's set
 * without a `contentSid`, rather than silently sending something that doesn't match Twilio's
 * actual API.
 */
export class TwilioWhatsappAdapter extends RestClient implements WhatsappProviderAdapter {
  #config: TwilioConfig

  /**
   * Creates a `TwilioWhatsappAdapter`.
   *
   * @param config Twilio account credentials and WhatsApp-enabled sender number.
   */
  constructor(config: TwilioConfig) {
    super({
      baseUrl: config.apiBase || TWILIO_API_BASE,
      headers: {
        'Authorization': `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    this.#config = config
  }

  /**
   * Sends a single WhatsApp message via Twilio's `Messages` endpoint — a Content API template
   * message when `message.contentSid` is set, or freeform text (`message.content`) otherwise.
   *
   * @param message Message to send.
   * @throws If `message.templateName` is set without a `contentSid` (see class docs for why), or
   * `{@link HttpError}` if Twilio responds with a non-2xx status.
   */
  public async send(message: WhatsappMessage): Promise<void> {
    if (message.templateName && !message.contentSid) {
      throw new Error(
        'TwilioWhatsappAdapter does not support message.templateName without a contentSid: ' +
          'Twilio identifies WhatsApp templates by a "Content SID" plus named content variables, ' +
          'not a name/language pair. Set message.contentSid (+ contentVariables) instead, send ' +
          'freeform text via `content`, or provide a custom WhatsappProviderAdapter.',
      )
    }

    const { accountSid, from } = this.#config

    const params: Record<string, string> = {
      To: `whatsapp:${message.to}`,
      From: `whatsapp:${from}`,
    }

    if (message.contentSid) {
      params.ContentSid = message.contentSid
      if (message.contentVariables) {
        params.ContentVariables = JSON.stringify(message.contentVariables)
      }
    } else {
      params.Body = message.content ?? ''
    }

    await this.http.post(`Accounts/${accountSid}/Messages.json`, {
      body: new URLSearchParams(params),
    })
  }
}
