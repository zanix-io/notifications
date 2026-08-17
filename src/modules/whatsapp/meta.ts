import type { MetaCloudConfig, WhatsappMessage, WhatsappProviderAdapter } from 'typings/whatsapp.ts'

import { RestClient } from '@zanix/server'

const DEFAULT_API_VERSION = 'v25.0'
const GRAPH_API_BASE = 'https://graph.facebook.com'

/**
 * `WhatsappProviderAdapter` for Meta's WhatsApp Cloud API (see
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages). This is the
 * adapter `WhatsappClient` builds by default whenever no custom `adapter` is configured.
 *
 * Extends `@zanix/server`'s `RestClient` (via `this.http`) for consistency with the rest of the
 * ecosystem's REST-based connectors (e.g. `@zanix/auth`'s `OAuth2Connector`), rather than calling
 * `fetch` directly. Unlike Twilio's adapter, this endpoint's path (`{phoneNumberId}/messages`) is
 * already all-lowercase, so `RestClient`'s `cleanRoute()`-based lowercasing (see `TwilioSmsAdapter`
 * for that caveat) doesn't affect it.
 */
export class MetaCloudWhatsappAdapter extends RestClient implements WhatsappProviderAdapter {
  #phoneNumberId: string

  /**
   * Creates a `MetaCloudWhatsappAdapter`.
   *
   * @param config WhatsApp Cloud API (Meta) credentials.
   */
  constructor(config: MetaCloudConfig) {
    const apiBase = config.apiBase || GRAPH_API_BASE
    const apiVersion = config.apiVersion || DEFAULT_API_VERSION
    super({
      baseUrl: `${apiBase}/${apiVersion}`,
      headers: { 'Authorization': `Bearer ${config.accessToken}` },
    })
    this.#phoneNumberId = config.phoneNumberId
  }

  /**
   * Sends a single WhatsApp message via the Cloud API's `/messages` endpoint — a freeform text
   * message when `message.content` is set, or a pre-approved template message when
   * `message.templateName` is set (see `WhatsappMessage`).
   *
   * @param message Message to send.
   * @throws {HttpError} If Meta responds with a non-2xx status (e.g. invalid token, a
   * recipient outside the 24h session window without a `templateName`, an unapproved template).
   */
  public send(message: WhatsappMessage): Promise<void> {
    const payload = message.templateName
      ? {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.templateLanguage },
          components: message.templateParams?.length
            ? [{
              type: 'body',
              parameters: message.templateParams.map((text) => ({
                type: 'text',
                text,
              })),
            }]
            : undefined,
        },
      }
      : {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'text',
        text: { body: message.content },
      }

    return this.http.post(`${this.#phoneNumberId}/messages`, {
      body: JSON.stringify(payload),
    })
  }
}
