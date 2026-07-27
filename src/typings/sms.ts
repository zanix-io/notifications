/** A single SMS message ready to hand off to a provider adapter. */
export interface SmsMessage {
  /** Recipient phone number, in E.164 format (e.g. `+15551234567`) */
  to: string

  /** Message text */
  content: string

  /** Sender phone number or alphanumeric sender ID; falls back to the adapter's own configured default (e.g. Twilio's `from`) when omitted */
  from?: string
}

/**
 * Pluggable SMS delivery contract. `SmsClient` delegates to whichever adapter is configured (see
 * `SmsClientConfig.adapter`), so it isn't coupled to any single SMS vendor.
 */
export interface SmsProviderAdapter {
  /** Sends a single SMS message, throwing on delivery failure. */
  send(message: SmsMessage): Promise<void>
}

/** Twilio SMS REST API credentials (see https://www.twilio.com/docs/sms/api). */
export interface TwilioConfig {
  /** Twilio account SID */
  accountSid: string

  /** Twilio auth token */
  authToken: string

  /** Default sender phone number used when a message doesn't set its own `from` */
  from: string

  /**
   * Twilio REST API base URL. Defaults to `https://api.twilio.com/2010-04-01`; override to point
   * at a proxy, mock server, or a different API version.
   */
  apiBase?: string
}

/**
 * Configuration for `SmsClient`.
 *
 * Provide `adapter` to use a custom SMS provider (Vonage, AWS SNS, etc.); otherwise the built-in
 * `TwilioSmsAdapter` is used, built from the remaining (Twilio-shaped) fields.
 */
export interface SmsClientConfig extends Partial<TwilioConfig> {
  /** Custom provider adapter; overrides the built-in Twilio adapter entirely when provided */
  adapter?: SmsProviderAdapter
}
