import type { TaskCallback } from '@zanix/types'

import type emailTemplates from 'modules/templates/transactional/email/mod.ts'
import type smsTemplates from 'modules/templates/transactional/sms.ts'
import type whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

/**
 * Represents a notify message.
 */
export interface NotifyMessage {
  /** Recipient address */
  to: string

  /** Sender address */
  from?: string

  /** Optional date string for the message. Defaults to current date if not provided */
  date?: string

  /**
   * Subject line of the message. Email-specific — optional at this shared level only so a
   * channel without a subject (SMS, WhatsApp) still satisfies this interface;
   * `NotifyMessageWithTemplate` re-pins it as required for email.
   */
  subject?: string

  /** Body content of the message (HTML or plain text) */
  content: string
}

/** Zanix Notifiers */
export type Notifiers = 'email' | 'sms' | 'whatsapp'

/**
 * Generic lookup of the data a channel's template registry function accepts, keyed by that
 * registry's own template names. Each channel below builds its own concrete
 * `*TemplateData`/`*MessageContent` alias from this, so a template name from one channel's
 * registry can never be mistaken for another's.
 */
export type TemplateDataOf<
  Templates extends Record<string, (data: never) => Promise<string>>,
  T extends keyof Templates,
> = Parameters<Templates[T]>[0]

/**
 * A message's content: either plain `content` text, or a local (Handlebars-rendered) template name
 * via `zanixTemplate` plus its `data` — mutually exclusive, enforced at the type level by the
 * opposite field being typed `never` in each branch. It sits alongside a channel's other top-level
 * content mechanisms (e.g. WhatsApp's own `templateName`/`contentSid` for its native provider
 * templates — see `WhatsappTemplateMessage`) with one consistent "which fields are present decides
 * what this sends" shape across the whole package. Named `zanixTemplate` (not just `template`) specifically
 * to stay unambiguous next to `templateName` on `WhatsappNotifyMessageWithTemplate`'s WhatsApp
 * sibling type.
 */
export type MessageContentOf<
  Templates extends Record<string, (data: never) => Promise<string>>,
  T extends keyof Templates,
> =
  | { content: string; zanixTemplate?: never; data?: never }
  | { zanixTemplate: T; data?: TemplateDataOf<Templates, T>; content?: never }

// --- Email ---

/** Zanix Base Handlebar Templates */
export type DefaultTemplates = keyof typeof emailTemplates

/** Data payload accepted by a given `DefaultTemplates` entry. */
export type TemplateData<T extends DefaultTemplates> = TemplateDataOf<typeof emailTemplates, T>

/** Message content to send */
export type MessageContent<T extends DefaultTemplates> = MessageContentOf<typeof emailTemplates, T>

/** Notify message options */
export type NotifyMessageWithTemplate<T extends DefaultTemplates> =
  & Omit<NotifyMessage, 'content' | 'subject'>
  & { subject: string }
  & MessageContent<T>

// --- SMS ---

/** Template names available for `NotifierProvider.sms()`/`sendMessage('sms', ...)`. */
export type SmsTemplates = keyof typeof smsTemplates

/** Data payload accepted by a given `SmsTemplates` entry. */
export type SmsTemplateData<T extends SmsTemplates> = TemplateDataOf<typeof smsTemplates, T>

/** SMS message content to send: either plain text, or a local template name plus its data. */
export type SmsMessageContent<T extends SmsTemplates> = MessageContentOf<typeof smsTemplates, T>

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

/**
 * Controls whether `sendMessage()` offloads a message to a one-time background worker instead
 * of sending it inline (see `NotifierProvider.onDestroy`).
 */
export type WithWorker =
  | boolean
  | {
    /**
     * Callback function executed when the worker finishes processing.
     * Should be used only if `useOneTimeWorker` is defined, as it handles post-processing
     * or cleanup after the log-saving task completes.
     */
    callback: TaskCallback
  }
