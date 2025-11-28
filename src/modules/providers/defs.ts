/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { NotifierProvider } from './notifier.ts'
import { Provider } from '@zanix/server'

/**
 * DSL function that defines and registers a notifier provider `NotifierProvider` using the Zanix `@Provider` decorator.
 *
 * The returned class is configured with lazy initialization and can be used in Interactor decorators,
 * for example: `@Interactor({ Provider: createNotifierProvider() })`, or registered directly in your `base.defs.ts` file.
 *
 * **Usage recommendation:** call `createNotifierProvider()` only once. After registration, you can use
 * the `NotifierProvider` class directly throughout the application.
 *
 * @returns A decorated notifier provider class.
 */
export const createNotifierProvider = (): typeof NotifierProvider => {
  Provider({ lifetime: 'SCOPED' })(NotifierProvider)
  return NotifierProvider
}
