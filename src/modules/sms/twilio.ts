import type { SmsMessage, SmsProviderAdapter, TwilioConfig } from 'typings/sms.ts'

import { RestClient } from '@zanix/server'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'

/**
 * `SmsProviderAdapter` for Twilio's SMS REST API (see
 * https://www.twilio.com/docs/sms/api/message-resource). This is the adapter `SmsClient` builds
 * by default whenever no custom `adapter` is configured.
 *
 * Extends `@zanix/server`'s `RestClient` (via `this.http`) for consistency with the rest of the
 * ecosystem's REST-based connectors (e.g. `@zanix/auth`'s `OAuth2Connector`), rather than calling
 * `fetch` directly.
 *
 * ⚠️ **Known caveat**: `RestClient` normalizes every request path through `@zanix/helpers`'
 * `cleanRoute()`, which lowercases the entire URL — including the dynamic `accountSid` segment.
 * Twilio's real endpoint (`/Accounts/{AccountSid}/Messages.json`) has case-sensitive path
 * segments and a case-sensitive account identifier, so a lowercased request may not match Twilio's
 * actual routing/auth in production. This is a limitation in `RestClient`/`cleanRoute` itself
 * (`@zanix/server`/`@zanix/helpers`), not something this adapter can work around while still using
 * `this.http` — verify against a real Twilio account before relying on this, and consider fixing
 * `cleanRoute` upstream if it 404s.
 */
export class TwilioSmsAdapter extends RestClient implements SmsProviderAdapter {
  #config: TwilioConfig

  /**
   * Creates a `TwilioSmsAdapter`.
   *
   * @param config Twilio account credentials, default sender, and optional API base override.
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
   * Sends a single SMS via Twilio's `Messages` endpoint.
   *
   * @param message Message to send.
   * @throws {HttpError} If Twilio responds with a non-2xx status (e.g. invalid credentials,
   * unverified number, malformed `to`).
   */
  public send(message: SmsMessage): Promise<void> {
    const { accountSid, from } = this.#config

    const body = new URLSearchParams({
      To: message.to,
      From: message.from ?? from,
      Body: message.content,
    })

    return this.http.post(`Accounts/${accountSid}/Messages.json`, { body })
  }
}
