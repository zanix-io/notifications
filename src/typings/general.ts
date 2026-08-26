import type { TaskCallback } from '@zanix/types'
import type { WorkerDispatchMode } from '@zanix/server'

/**
 * Channel-agnostic message/notifier shapes, deliberately kept free of any `typeof` reference to a
 * concrete template registry (`modules/templates/transactional/*`) — that's `typings/
 * template-registry.ts`'s own job. Resolving a `typeof` reference forces the referenced module's
 * whole reachable graph to resolve too (real ES module semantics, not a Deno quirk), and the
 * transactional registries reach `execTemplate`'s Handlebars compiler and each template's own Zod
 * schema — a cost only a template-rendering consumer should pay. Keeping those two concerns in
 * separate files means `SmtpClient`/`SmsClient`/`WhatsappClient` (whose own connector code only
 * needs {@link NotifyMessage}) never pull in Handlebars/Zod just by referencing this file's types.
 */

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

/**
 * Controls whether `sendMessage()` offloads a message to a background worker instead of sending
 * it inline (see `NotifierProvider.onDestroy`), and which of `@zanix/server`'s `dispatchWorkerTask`
 * dispatch strategies to use for it — `'one-time'` (a fresh worker per flush) or `'persisted'`
 * (the app's pooled `'worker'` core provider, falling back to `'one-time'` automatically when
 * that provider isn't available).
 *
 * When several queued messages request different modes before the batch flushes (see
 * `NotifierProvider.onDestroy`), `'persisted'` wins for the whole batch if any one of them asked
 * for it — never silently downgraded to `'one-time'` because of a message that didn't care either
 * way.
 */
export type WithWorker =
  | WorkerDispatchMode
  | {
    /** Which dispatch strategy this message requests — see {@link WithWorker}. */
    mode: WorkerDispatchMode
    /**
     * Callback function executed when the worker finishes processing.
     * Should be used only if `useWorker` is defined, as it handles post-processing
     * or cleanup after the log-saving task completes.
     */
    callback?: TaskCallback
    /** Worker timout. Defaults 20_000 ms*/
    timeout?: number
  }
