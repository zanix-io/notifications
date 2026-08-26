/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 *
 * Raw multi-channel connectors — `SmtpClient`, `SmsClient`, `WhatsappClient` — plus their built-in
 * provider adapters, deliberately without `NotifierProvider`/`TemplateProvider`/`execTemplate` or
 * anything else under `modules/templates/`. `NotifierProvider.sendMessage()`'s template-based
 * dispatch always needs `TemplateProvider`, which reaches every channel's compiled Handlebars
 * template (and each one's own Zod validation schema) — a real cost only a template-rendering
 * consumer should pay. A consumer that only sends plain-`content` messages by calling a connector
 * directly (`new SmtpClient(...)`/`provider.use('sms')`, see `docs/connectors.md`) never needs any
 * of that, and importing this subpath instead of the root `@zanix/notifications` barrel — or
 * `@zanix/notifications/core` for zero-config registration — keeps it that way.
 *
 * Every symbol here is also re-exported from the root `@zanix/notifications` barrel, so switching
 * between the two is never a breaking change in either direction.
 *
 * @module
 */

export { SmtpClient } from './email/connector.ts'
export { SmsClient } from './sms/connector.ts'
export { WhatsappClient } from './whatsapp/connector.ts'
export { ZanixNotifierConnector } from './base.ts'

// Provider adapters
export { TwilioSmsAdapter } from './sms/twilio.ts'
export { VonageSmsAdapter } from './sms/vonage.ts'
export { MetaCloudWhatsappAdapter } from './whatsapp/meta.ts'
export { TwilioWhatsappAdapter } from './whatsapp/twilio.ts'

// Typings
export type { Notifiers, NotifyMessage } from 'typings/general.ts'
export type { ServerConfig, SmtpResponseCode } from 'typings/email.ts'
export type {
  SmsClientConfig,
  SmsMessage,
  SmsProviderAdapter,
  TwilioConfig,
  VonageConfig,
} from 'typings/sms.ts'
export type {
  MetaCloudConfig,
  WhatsappClientConfig,
  WhatsappMessage,
  WhatsappProviderAdapter,
  WhatsappTemplateMessage,
} from 'typings/whatsapp.ts'

/**
 * Every {@link Notifiers} value as a runtime array — see the root barrel's own re-export of this
 * for the full rationale.
 */
export { NOTIFIER_CHANNELS } from 'utils/constants.ts'
