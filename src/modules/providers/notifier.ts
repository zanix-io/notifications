import type { ZanixNotifierConnector } from '../base.ts'
import type { TaskCallback } from '@zanix/types'
import type {
  DefaultTemplates,
  Notifiers,
  NotifyMessageWithTemplate,
  WithWorker,
} from 'typings/general.ts'

import templates from 'modules/templates/transactional/mod.ts'
import { ZanixProvider } from '@zanix/server'
import { notifierConnectors } from '../mod.ts'
import { WorkerManager } from '@zanix/workers'

/**
 * NotifierProvider class for handling the dispatch of different types of notifications.
 *
 * The `NotifierProvider` class is responsible for managing the process of sending
 * notifications through various channels. It can be configured to send emails, SMS,
 * or other types of messages. The provider manages message templating, worker handling,
 * and the configuration of various notification channels.
 *
 * It extends `ZanixProvider`, integrating with the Zanix ecosystem and ensuring easy
 * dispatch of notifications to different platforms, while providing a flexible interface
 * for future extensibility.
 *
 * @extends ZanixProvider
 */
export class NotifierProvider extends ZanixProvider {
  #queue: {
    notifier: Notifiers
    message: NotifyMessageWithTemplate<DefaultTemplates>
    callback?: TaskCallback
  }[] = []

  public override use(connector: Notifiers, verbose: boolean = false): ZanixNotifierConnector {
    return this.getProviderConnector<ZanixNotifierConnector>(notifierConnectors[connector], verbose)
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
   * @param {NotifyMessageWithTemplate} message - The message payload to be sent.
   * @param {MessageContent<T>} [message.body] - Body content of the message (HTML, plain text or a template with JSON data)
   * @param {boolean} [options.useWorker] - If true, the message will be processed by a worker.
   * @returns {Promise<void>} Resolves when the message has been sent.
   */
  public async sendMessage<T extends DefaultTemplates>(
    notifier: Notifiers,
    message: NotifyMessageWithTemplate<T>,
    options: { useWorker?: WithWorker } = {},
  ): Promise<void> {
    const { useWorker } = options
    if (useWorker) {
      this.#queue.push({
        callback: typeof useWorker !== 'boolean' ? useWorker.callback : undefined,
        notifier,
        message,
      })
      return
    }

    try {
      const client = this.use(notifier)
      const { body, ...messageData } = message

      const content = typeof body === 'string'
        ? body
        : await templates[body.template](body.data as never)
      const data = { body: content, ...messageData }

      await client.isReady
      await client.send(data)
    } catch (e) {
      throw new Deno.errors.Interrupted(
        'NotifierProvider: An error occurred while sending a message in the background.',
        { cause: e },
      )
    }
  }

  protected override onDestroy(): void {
    const callbacks: TaskCallback[] = []
    const messages = this.#queue.map(({ callback, ...msg }) => {
      if (callback) callbacks.push(callback)
      return msg
    })

    //TODO: use this.worker when available
    const worker = new WorkerManager()
    return worker.task(sendBackgroundMessage, {
      metaUrl: import.meta.url,
      autoClose: true,
      onFinish: (response) => {
        callbacks.forEach((callback) => callback(response))
      },
    }).invoke(messages)
  }
}

export async function sendBackgroundMessage<T extends DefaultTemplates>(data: {
  notifier: Notifiers
  message: NotifyMessageWithTemplate<T>
}[]) {
  const uniqueNotifiers = [
    ...new Set(
      data.map((item) => item.notifier),
    ),
  ]
  await Promise.all(uniqueNotifiers.map((notifier) => import(`../${notifier}/defs.ts`)))

  const provider = new NotifierProvider()

  for await (const { notifier, message } of data) {
    await provider.sendMessage(notifier, message)
  }

  await Promise.all(uniqueNotifiers.map((notifier) => provider.use(notifier)['close']()))
}
