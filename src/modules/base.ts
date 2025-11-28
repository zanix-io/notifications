import type { NotifyMessage } from 'typings/general.ts'

import { ZanixConnector } from '@zanix/server'

/**
 * Abstract connector for sending notifications within the Zanix system.
 *
 * This class defines the interface that all notification connectors must implement.
 * Each concrete connector is responsible for sending messages through its own
 * medium (email, SMS, push, etc.).
 */
export abstract class ZanixNotifierConnector extends ZanixConnector {
  /**
   * Sends a notification message.
   *
   * @abstract
   * @param {NotifyMessage} message - The message to be sent.
   * @returns {Promise<void>} A promise that resolves when the message has been sent.
   */
  abstract send(message: NotifyMessage): Promise<void>
}
