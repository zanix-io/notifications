import type emailTemplates from 'modules/templates/transactional/email/mod.ts'
import type smsTemplates from 'modules/templates/transactional/sms.ts'
import type whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

import type { MessageContentOf, NotifyMessage, TemplateDataOf } from 'typings/general.ts'

/**
 * Types derived from each channel's own compiled template registry (`modules/templates/
 * transactional/*`) — split out of `typings/general.ts` on purpose: a `typeof emailTemplates`/
 * `typeof smsTemplates`/`typeof whatsappTemplates` reference forces resolving those registries'
 * whole reachable graph (`execTemplate`'s Handlebars compiler, each template's own Zod schema), so
 * only a consumer that actually reaches these types — `NotifierProvider`'s template-based
 * `sendMessage()`/`sendTemplate()` overloads, the `mail` trigger action — pays that cost. A plain
 * `SmtpClient`/`SmsClient`/`WhatsappClient` consumer never imports this file.
 */

// --- Email ---

/** Zanix Base Handlebar Templates */
export type DefaultTemplates = keyof typeof emailTemplates

/** Data payload accepted by a given `DefaultTemplates` entry. */
export type TemplateData<T extends DefaultTemplates> = TemplateDataOf<
  typeof emailTemplates,
  T
>

/** Message content to send */
export type MessageContent<T extends DefaultTemplates> = MessageContentOf<
  typeof emailTemplates,
  T
>

/** Notify message options */
export type NotifyMessageWithTemplate<T extends DefaultTemplates> =
  & Omit<NotifyMessage, 'content' | 'subject'>
  & { subject: string }
  & MessageContent<T>

// --- SMS ---

/** Template names available for `NotifierProvider.sms()`/`sendMessage('sms', ...)`. */
export type SmsTemplates = keyof typeof smsTemplates

/** Data payload accepted by a given `SmsTemplates` entry. */
export type SmsTemplateData<T extends SmsTemplates> = TemplateDataOf<
  typeof smsTemplates,
  T
>

/** SMS message content to send: either plain text, or a local template name plus its data. */
export type SmsMessageContent<T extends SmsTemplates> = MessageContentOf<
  typeof smsTemplates,
  T
>

/** Notify message options for the `sms` channel. */
export type SmsNotifyMessageWithTemplate<T extends SmsTemplates> =
  & Omit<NotifyMessage, 'content'>
  & SmsMessageContent<T>

// --- WhatsApp ---

/** Template names available for `NotifierProvider.whatsapp()`/`sendMessage('whatsapp', ...)`. */
export type WhatsappTemplates = keyof typeof whatsappTemplates

/** Data payload accepted by a given `WhatsappTemplates` entry. */
export type WhatsappTemplateData<T extends WhatsappTemplates> = TemplateDataOf<
  typeof whatsappTemplates,
  T
>

/**
 * WhatsApp message content to send: either plain text, or a local template name plus its data.
 *
 * This is unrelated to WhatsApp Cloud API's/Twilio's own native "template message" feature (see
 * `WhatsappTemplateMessage`'s `templateName`/`contentSid`) — `zanixTemplate` always means "render
 * via Handlebars, deliver as free text", exactly like email/SMS.
 */
export type WhatsappMessageContent<T extends WhatsappTemplates> = MessageContentOf<
  typeof whatsappTemplates,
  T
>

/** Notify message options for the `whatsapp` channel. */
export type WhatsappNotifyMessageWithTemplate<T extends WhatsappTemplates> =
  & Omit<NotifyMessage, 'content'>
  & WhatsappMessageContent<T>
