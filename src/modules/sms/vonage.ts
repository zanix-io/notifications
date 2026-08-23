import type { SmsMessage, SmsProviderAdapter, VonageConfig } from 'typings/sms.ts'

import { RestClient } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'

const VONAGE_API_BASE = 'https://rest.nexmo.com'

/**
 * A single entry of Vonage's `POST /sms/json` response `messages` array — one per message segment
 * actually sent (a long message may be split into several). See
 * https://developer.vonage.com/en/api/sms#send-an-sms.
 */
interface VonageSmsResponseMessage {
  /** `"0"` on success (accepted for delivery — not a delivery confirmation); non-zero on rejection */
  status: string

  /** Present only when `status` is non-zero, describing why Vonage rejected the message */
  'error-text'?: string
}

/** Vonage's `POST /sms/json` response body shape. */
interface VonageSmsResponse {
  messages?: VonageSmsResponseMessage[]
}

/**
 * `SmsProviderAdapter` for Vonage's classic SMS API (see
 * https://developer.vonage.com/en/api/sms#send-an-sms) — an alternative to the default
 * `TwilioSmsAdapter`.
 *
 * Not the default: `SmsClient` builds `TwilioSmsAdapter` unless a custom `adapter` is configured —
 * set `SmsClient.config = { adapter: new VonageSmsAdapter({...}) }` (or the matching `VONAGE_*` env
 * vars via `sms/defs.ts`) to use this instead.
 *
 * Extends `@zanix/server`'s `RestClient` (via `this.http`), same as `TwilioSmsAdapter`, rather than
 * calling `fetch` directly.
 *
 * ⚠️ **Known caveat, distinct from `TwilioSmsAdapter`'s**: Vonage's classic SMS API always responds
 * `HTTP 200` — even for a rejected/invalid send — and reports per-message success/failure only via
 * the JSON body's `messages[].status` field (`"0"` = accepted, non-zero = rejected, with
 * `error-text` describing why). `RestClient` only throws `HttpError` on a non-2xx transport
 * response, so a plain `await adapter.send(...)` that merely didn't throw would NOT by itself prove
 * Vonage accepted the message. This adapter inspects the parsed response body itself and throws
 * `HttpError` on a non-zero `status`, so `send()`'s own contract (resolves only on real acceptance,
 * throws otherwise) still holds — don't remove that check while "simplifying" this adapter to just
 * `await this.http.post(...)` the way `TwilioSmsAdapter` does; that would silently swallow rejected
 * sends.
 */
export class VonageSmsAdapter extends RestClient implements SmsProviderAdapter {
  #config: VonageConfig

  /**
   * Creates a `VonageSmsAdapter`.
   *
   * @param config Vonage API key/secret, default sender, and optional API base override.
   */
  constructor(config: VonageConfig) {
    super({
      baseUrl: config.apiBase || VONAGE_API_BASE,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    this.#config = config
  }

  /**
   * Sends a single SMS via Vonage's `sms/json` endpoint.
   *
   * @param message Message to send.
   * @throws {HttpError} If the transport-level response is a non-2xx status (e.g. malformed
   * request), or if Vonage responds `200` but rejects the message itself (e.g. invalid `to`,
   * insufficient balance) — see the class's own caveat above for why both surface the same way.
   */
  public async send(message: SmsMessage): Promise<void> {
    const { apiKey, apiSecret, from } = this.#config

    const body = new URLSearchParams({
      api_key: apiKey,
      api_secret: apiSecret,
      to: message.to,
      from: message.from ?? from,
      text: message.content,
    })

    let response: VonageSmsResponse
    try {
      response = await this.http.post<VonageSmsResponse>('sms/json', { body })
    } catch (error) {
      // Metadata only — provider/channel are safe, the SMS `content`/`to` and the transport
      // error's own `cause` (which may echo request data back) are deliberately left unlogged.
      logger.error('[VonageSmsAdapter] SMS send request failed (transport-level).', {
        provider: 'vonage',
        channel: 'sms',
      })
      throw error
    }
    const result = response.messages?.[0]

    if (result && result.status !== '0') {
      // `result.status` is Vonage's own small numeric rejection-code enum, not free text — safe
      // to log; `result['error-text']` is left out of the log (still available in the thrown
      // error's `cause` for anyone catching it) since it's free-form text from Vonage that could
      // in principle reflect request data back.
      logger.error(
        `[VonageSmsAdapter] Vonage rejected the SMS (status ${result.status}).`,
        { provider: 'vonage', channel: 'sms', status: result.status },
      )
      throw new HttpError('BAD_REQUEST', {
        cause: new Error(
          result['error-text'] ?? `Vonage rejected the message (status ${result.status})`,
        ),
        message: 'Vonage Sms Error',
        meta: { source: 'zanix', status: result.status },
      })
    }
  }
}
