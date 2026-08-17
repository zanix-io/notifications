import type { ZanixNotifierConnector } from '../base.ts'
import type { TaskCallback } from '@zanix/types'
import type {
  DefaultTemplates,
  Notifiers,
  NotifyMessageWithTemplate,
  SmsNotifyMessageWithTemplate,
  SmsTemplates,
  WhatsappNotifyMessageWithTemplate,
  WhatsappTemplates,
  WithWorker,
} from 'typings/general.ts'
import type { WhatsappTemplateMessage } from 'typings/whatsapp.ts'
import type { WhatsappClient } from '../whatsapp/connector.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

import type { CoreModules, WorkerDispatchMode } from '@zanix/server'

import { resetPreloadedDBTemplates } from '../templates/db/manifest.ts'
import { dispatchWorkerTask, ZanixProvider } from '@zanix/server'
import { notifierConnectors } from '../mod.ts'
import { TemplateProvider } from '../templates/provider.ts'

/**
 * Abstract base for the `'notifications'` core-provider slot (see `providers/core.ts`) — owned by
 * `@zanix/notifications`, not `@zanix/server`. Unlike the 6 slots with a dedicated `CoreBaseClass`
 * getter (`cache`, `database`, `asyncmq`, `worker`, `kvLocal`, `search`), notifications has no such
 * getter, so nothing in `@zanix/server`'s own source needs to import this type — it's a purely
 * empty marker class whose only job is to give `@Provider({ type: 'notifications' })`'s
 * `instanceof` check (`defineProviderDecorator`) something to validate concrete implementations
 * against.
 *
 * @abstract
 * @extends ZanixProvider
 */
export abstract class ZanixCoreNotificationsProvider<
  T extends CoreModules = object,
> extends ZanixProvider<T> {}

/**
 * Any channel's `NotifyMessageWithTemplate`-shaped message. This is what `sendMessage`'s
 * dynamic-`notifier` overload (and `sendBackgroundMessage`) accept, since the channel isn't known
 * at compile time there — prefer the channel-specific types (`NotifyMessageWithTemplate`,
 * `SmsNotifyMessageWithTemplate`, `WhatsappNotifyMessageWithTemplate`) when it is.
 */
export type AnyNotifyMessageWithTemplate =
  | NotifyMessageWithTemplate<DefaultTemplates>
  | SmsNotifyMessageWithTemplate<SmsTemplates>
  | WhatsappNotifyMessageWithTemplate<WhatsappTemplates>

/**
 * Whether `message` is a native provider template (Meta's `templateName` or Twilio's
 * `contentSid`) rather than a Handlebars-rendered `content`. Only ever true for the `whatsapp`
 * channel today — see `WhatsappTemplateMessage`.
 */
function isTemplateMessage(
  message: AnyNotifyMessageWithTemplate | WhatsappTemplateMessage,
): message is WhatsappTemplateMessage {
  return 'templateName' in message || 'contentSid' in message
}

/**
 * NotifierProvider class for handling the dispatch of different types of notifications.
 *
 * The `NotifierProvider` class is responsible for managing the process of sending
 * notifications through various channels. It can be configured to send emails, SMS,
 * or other types of messages. The provider manages message templating, worker handling,
 * and the configuration of various notification channels.
 *
 * It extends `ZanixCoreNotificationsProvider` (above), which is what makes it eligible for the
 * `'notifications'` core-provider key — see `providers/core.ts` — integrating with the Zanix
 * ecosystem and ensuring easy dispatch of notifications to different platforms, while providing a
 * flexible interface for future extensibility.
 *
 * @extends ZanixCoreNotificationsProvider
 */
export class NotifierProvider extends ZanixCoreNotificationsProvider {
  #queue: {
    notifier: Notifiers
    kind: 'message' | 'template'
    message: AnyNotifyMessageWithTemplate | WhatsappTemplateMessage
    callback?: TaskCallback
    timeout: number
    mode: WorkerDispatchMode
  }[] = []

  /**
   * Resolves the notifier connector registered for `connector` (see `notifierConnectors`).
   *
   * @param connector The notifier type to resolve.
   * @param verbose Whether to log a diagnostic if the connector instance isn't available. Defaults to `false`.
   * @returns The resolved connector instance.
   * @throws `TargetError` if no instance of that connector is available in this provider's context.
   */
  public override use(
    connector: Notifiers,
    verbose: boolean = false,
  ): ZanixNotifierConnector {
    return this.getProviderConnector<ZanixNotifierConnector>(
      notifierConnectors[connector],
      verbose,
    )
  }

  /**
   * Sends an email notification. Convenience wrapper over `sendMessage('email', ...)`.
   *
   * @param message The message payload to be sent.
   * @param options See `sendMessage`.
   * @returns Resolves when the message has been sent.
   */
  public email<T extends DefaultTemplates>(
    message: NotifyMessageWithTemplate<T>,
    options?: { useWorker?: WithWorker },
  ): Promise<void> {
    return this.sendMessage('email', message, options)
  }

  /**
   * Sends an SMS notification. Convenience wrapper over `sendMessage('sms', ...)`.
   *
   * @param message The message payload to be sent.
   * @param options See `sendMessage`.
   * @returns Resolves when the message has been sent.
   */
  public sms<T extends SmsTemplates>(
    message: SmsNotifyMessageWithTemplate<T>,
    options?: { useWorker?: WithWorker },
  ): Promise<void> {
    return this.sendMessage('sms', message, options)
  }

  /**
   * Sends a WhatsApp notification — a Handlebars-rendered `content` via `sendMessage('whatsapp',
   * ...)`, or a native provider template (Meta's `templateName` or Twilio's `contentSid`) via
   * `sendTemplate(...)`, dispatched automatically based on which fields `message` carries.
   *
   * @param message The message payload to be sent — either shape (see `WhatsappNotifyMessageWithTemplate`/`WhatsappTemplateMessage`).
   * @param options See `sendMessage`.
   * @returns Resolves when the message has been sent.
   */
  public whatsapp<T extends WhatsappTemplates>(
    message: WhatsappNotifyMessageWithTemplate<T> | WhatsappTemplateMessage,
    options?: { useWorker?: WithWorker },
  ): Promise<void> {
    if (isTemplateMessage(message)) return this.sendTemplate(message, options)
    return this.sendMessage('whatsapp', message, options)
  }

  /**
   * Sends a native WhatsApp provider template message — Meta's `templateName`/`templateLanguage`
   * (+ optional `templateParams`), or Twilio's `contentSid` (+ optional `contentVariables`),
   * whichever matches the adapter actually configured (see `WhatsappTemplateMessage`).
   *
   * Distinct from `sendMessage`'s Handlebars-based `zanixTemplate`/`data`: this always goes
   * straight to the provider's own template mechanism, required to initiate a WhatsApp
   * conversation outside the 24h customer-service session window. Supports the same
   * `useWorker` queueing and error wrapping as `sendMessage`.
   *
   * @param message Recipient plus the template identification for whichever provider is configured.
   * @param options See `sendMessage`.
   * @returns Resolves when the message has been sent.
   */
  public sendTemplate(
    message: WhatsappTemplateMessage,
    options: { useWorker?: WithWorker } = {},
  ): Promise<void> {
    return this.#dispatch('whatsapp', 'template', message, options)
  }

  /**
   * Sends a notification message using the specified notifier.
   *
   * This method retrieves the corresponding notification client through `use()`,
   * waits for the client to be ready, and then sends the provided message.
   * Optionally, the message can be processed through a worker when that feature
   * becomes available.
   *
   * @async
   * @param {Notifiers} notifier - The notifier type used to select the appropriate notification client.
   * @param {NotifyMessageWithTemplate} message - The message payload to be sent — either plain
   *    `content` text, or a local `zanixTemplate` name plus its `data` (see `MessageContent`).
   * @param {WithWorker} [options.useWorker] - When set, offloads the message to a background worker (see WithWorker) instead of sending it inline.
   * @returns {Promise<void>} Resolves when the message has been sent.
   */
  public sendMessage<T extends DefaultTemplates>(
    notifier: 'email',
    message: NotifyMessageWithTemplate<T>,
    options?: { useWorker?: WithWorker },
  ): Promise<void>
  /** Sends an SMS notification. Same behavior as the `'email'` overload, for the `sms` channel. */
  public sendMessage<T extends SmsTemplates>(
    notifier: 'sms',
    message: SmsNotifyMessageWithTemplate<T>,
    options?: { useWorker?: WithWorker },
  ): Promise<void>
  /**
   * Sends a WhatsApp notification. Same behavior as the `'email'` overload, for the `whatsapp`
   * channel.
   */
  public sendMessage<T extends WhatsappTemplates>(
    notifier: 'whatsapp',
    message: WhatsappNotifyMessageWithTemplate<T>,
    options?: { useWorker?: WithWorker },
  ): Promise<void>
  /**
   * Sends a notification message using a dynamically-known notifier (i.e. `notifier`'s value
   * isn't known at compile time). Used by `sendBackgroundMessage`, which forwards a heterogeneous
   * batch of queued messages. Prefer the channel-specific overloads above (or `email()`/`sms()`/
   * `whatsapp()`) when the channel is known statically, for compile-time template-name checking.
   */
  public sendMessage(
    notifier: Notifiers,
    message: AnyNotifyMessageWithTemplate,
    options?: { useWorker?: WithWorker },
  ): Promise<void>
  public sendMessage(
    notifier: Notifiers,
    // The public contract is the 4 signatures above; this implementation signature is never seen
    // by callers (TS overload resolution stops at the last declared overload) — loosened to `any`
    // only because the exact `AnyNotifyMessageWithTemplate` union here trips a TS overload/
    // implementation compatibility check that doesn't affect the (verified) plain assignability
    // of any single channel's message type into that union.
    // deno-lint-ignore no-explicit-any
    message: any,
    options: { useWorker?: WithWorker } = {},
  ): Promise<void> {
    return this.#dispatch(notifier, 'message', message, options)
  }

  /**
   * Shared implementation behind `sendMessage()` and `sendTemplate()`: queues (if `useWorker` is
   * set), or resolves the channel's connector and sends immediately, wrapping any failure as
   * `Deno.errors.Interrupted`.
   */
  async #dispatch(
    notifier: Notifiers,
    kind: 'message' | 'template',
    message: AnyNotifyMessageWithTemplate | WhatsappTemplateMessage,
    options: { useWorker?: WithWorker },
  ): Promise<void> {
    const { useWorker } = options
    if (useWorker) {
      const workerData = typeof useWorker === 'string'
        ? { mode: useWorker, callback: undefined, timeout: undefined }
        : useWorker
      this.#queue.push({
        callback: workerData.callback,
        notifier,
        kind,
        message,
        timeout: workerData.timeout ?? 20_000,
        mode: workerData.mode,
      })
      return
    }

    try {
      const client = this.use(notifier)
      await client.isReady

      if (kind === 'template') {
        await (client as WhatsappClient).sendTemplate(
          message as WhatsappTemplateMessage,
        )
        return
      }

      const { zanixTemplate, data, content, ...messageData } =
        message as AnyNotifyMessageWithTemplate
      const body = zanixTemplate
        ? await this.providers.get(TemplateProvider).resolve(
          notifier,
          zanixTemplate,
          data as Record<string, unknown>,
        )
        : content as string

      await client.send({ content: body, ...messageData })
    } catch (e) {
      throw new Deno.errors.Interrupted(
        'NotifierProvider: An error occurred while sending a message in the background.',
        { cause: e },
      )
    }
  }

  /**
   * Flushes any messages queued via `sendMessage()`'s `useWorker` option.
   *
   * Called by the framework when this (scoped) provider instance is torn down at the end of a
   * request; a no-op if nothing was queued. Queued messages are handed off to `@zanix/server`'s
   * `dispatchWorkerTask` (`'persisted'`, via `this.worker`, falling back to `'one-time'`
   * automatically when that provider isn't available — see `WithWorker`) so they're sent after
   * this instance's own lifecycle ends, invoking each message's `callback` (if any) with the
   * worker's response.
   */
  protected override async onDestroy(): Promise<void> {
    if (!this.#queue.length) return

    const callbacks: TaskCallback[] = []
    const templates = new Map<
      `znx:${Notifiers}:${string}`,
      ZanixTemplateAttrs | undefined
    >()
    const preloads: Promise<void>[] = []
    const templateProvider = this.providers.get(TemplateProvider)

    let totalTimeout = 0
    // 'persisted' wins for the whole batch if any queued message asked for it — see `WithWorker`.
    let mode: WorkerDispatchMode = 'one-time'
    const messages = this.#queue.map(
      ({ callback, timeout, mode: itemMode, ...msg }) => {
        if (callback) callbacks.push(callback)
        if (itemMode === 'persisted') mode = 'persisted'

        const zanixTemplate = msg.kind !== 'template'
          ? (msg.message as AnyNotifyMessageWithTemplate).zanixTemplate
          : undefined

        if (zanixTemplate) {
          preloads.push(
            templateProvider.preloadChain(
              msg.notifier,
              zanixTemplate,
              templates,
            ),
          )
        }
        totalTimeout = +timeout
        return msg
      },
    )

    await Promise.all(preloads)

    dispatchWorkerTask(sendBackgroundMessage, {
      mode,
      metaUrl: import.meta.url,
      provider: () => this.worker,
      callback: (response) => {
        callbacks.forEach((callback) => callback(response))
      },
      timeout: totalTimeout,
    })(messages, templates)
  }
}

/**
 * Sends a batch of queued messages from a background worker (see `NotifierProvider.onDestroy`).
 *
 * Dynamically imports each distinct notifier's `defs.ts`, plus `templates/core.ts`
 * (`TemplateProvider`'s own registration — needed regardless of channel), so the worker's own
 * module graph has everything `#dispatch()` resolves registered before constructing a
 * `NotifierProvider` to send through it.
 *
 * The `NotifierProvider` below is given a fresh, random `contextId` rather than none at all —
 * deliberately, not a stylistic choice: a `SCOPED` connector (e.g. `SmtpClient`) is cached by the
 * DI container under its resolving instance's `contextId`, and an omitted `contextId` resolves to
 * the same fixed `undefined` bucket every time. With a one-time worker this went unnoticed by
 * accident — a fresh worker means a fresh module graph, so that bucket starts empty on every call
 * regardless. A `useWorker: 'persisted'` worker is reused across many `sendBackgroundMessage`
 * calls, so its DI container's cache survives between them: a second call resolving that same
 * `undefined` bucket would get back the *first* call's already-`close()`d connector instance
 * instead of a fresh one, surfacing as e.g. `SmtpClient`'s "Connection not ready!". A unique
 * `contextId` per batch keeps every call's connectors properly isolated regardless of which
 * dispatch mode (or worker reuse) ran it.
 *
 * @param data The queued `{notifier, kind, message}` entries to send, potentially spanning
 * several channels in one batch.
 */
export async function sendBackgroundMessage(
  data: {
    notifier: Notifiers
    kind: 'message' | 'template'
    message: AnyNotifyMessageWithTemplate | WhatsappTemplateMessage
  }[],
  templates: Map<
    `znx:${Notifiers}:${string}`,
    ZanixTemplateAttrs | undefined
  >,
) {
  const uniqueNotifiers = [
    ...new Set(
      data.map((item) => item.notifier),
    ),
  ]

  await Promise.all([
    import('../templates/core.ts'),
    ...uniqueNotifiers.map((notifier) => import(`../${notifier}/defs.ts`)),
  ])

  // Safe to hydrate once, unconditionally, before the loop below — a `kind: 'template'` message
  // (`sendTemplate()`) short-circuits inside `#dispatch()` straight to the connector's own
  // `sendTemplate()` and returns, never reaching the `zanixTemplate`/`TemplateProvider.resolve()`
  // branch that's the only thing reading this cache. There's nothing for it to (mis)set for that
  // kind of message, regardless of a batch's message order/mix.
  resetPreloadedDBTemplates(templates)

  const provider = new NotifierProvider(crypto.randomUUID())

  for await (const { notifier, kind, message } of data) {
    if (kind === 'template') {
      await provider.sendTemplate(message as WhatsappTemplateMessage)
    } else {
      await provider.sendMessage(
        notifier,
        message as AnyNotifyMessageWithTemplate,
      )
    }
  }

  await Promise.all(
    uniqueNotifiers.map((notifier) => provider.use(notifier)['close']()),
  )
}
