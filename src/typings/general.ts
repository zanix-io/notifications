import type { TaskCallback } from '@zanix/types'

import type templates from 'modules/templates/transactional/mod.ts'

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

  /** Subject line of the message */
  subject: string

  /** Body content of the message (HTML or plain text) */
  body: string
}

/** Zanix Notifiers */
export type Notifiers = 'email'

/** Zanix Base Handlebar Templates */
export type DefaultTemplates = keyof typeof templates

type TemplateData<T extends DefaultTemplates> = Parameters<typeof templates[T]>[0]

/** Message content to send */
export type MessageContent<T extends DefaultTemplates> = {
  template: T
  data?: TemplateData<T>
} | string

/** Notify message options */
export type NotifyMessageWithTemplate<T extends DefaultTemplates> = Omit<NotifyMessage, 'body'> & {
  body: MessageContent<T>
}

export type WithWorker =
  | boolean
  | {
    /**
     * Callback function executed when the worker finishes processing.
     * Should be used only if `useWorker` is defined, as it handles post-processing
     * or cleanup after the log-saving task completes.
     */
    callback: TaskCallback
  }
