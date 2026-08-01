/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { ZanixProvidersGetter } from '@zanix/server'

import { DEFAULT_TRIGGER_JOBS, registerTriggerActionJob } from '@zanix/datamaster'
import type { NotifierProvider } from './notifier.ts'
import { type MailTriggerActionData, sendMailTriggerNotification } from './trigger-mail.ts'

/**
 * The `mail` trigger action's job handler — resolves the `'notifications'` core-provider (see
 * `providers/core.ts`) and delegates to {@link sendMailTriggerNotification}. Typed against a
 * minimal `this.providers` context (not `@zanix/asyncmq`'s own `Job` type), matching
 * `@zanix/database`'s `TriggerActionJobHandler` shape, so this package doesn't need to depend on
 * `@zanix/asyncmq` itself — `@zanix/core` performs the actual `registerJob` call, once it drains
 * this self-registration (see `registerMailTriggerJob`'s own doc).
 */
function mailTriggerJobHandler(
  this: { providers: ZanixProvidersGetter },
  args: MailTriggerActionData,
): Promise<void> {
  return sendMailTriggerNotification(this.providers.get<NotifierProvider>('notifications'), args)
}

/**
 * Self-registers the `mail` trigger action's job descriptor with `@zanix/database`'s
 * `registerTriggerActionJob` — the same zero-config pattern `providers/core.ts` already uses to
 * register `NotifierProvider` itself. `@zanix/notifications` owns `NotifierProvider`'s contract,
 * so it owns this job's logic too; only the actual `@zanix/asyncmq` `registerJob` call happens
 * elsewhere (`@zanix/core`, the one package that composes datamaster, notifications, and asyncmq
 * together — see that package's own `registerPendingTriggerActionJobs`).
 */
const registerMailTriggerJob = () => {
  registerTriggerActionJob('mail', {
    name: DEFAULT_TRIGGER_JOBS.mail,
    processingQueue: 'soft',
    handler: mailTriggerJobHandler,
  })
}

/**
 * Core `mail` trigger-action loader for Zanix.
 *
 * Self-registers this package's own job descriptor for `@zanix/datamaster`'s built-in `mail`
 * trigger action, so it works end-to-end with zero consumer-side setup once bootstrapped via
 * `@zanix/core` — `@zanix/core` itself only drains and performs the real job registration, never
 * authoring the `mail` handler's logic.
 *
 * Loaded by `@zanix/core`'s `defineCoreMetadata()` (via this package's own `/core` entrypoint) —
 * runs for both the main server process (`Zanix.start()`) and the worker process
 * (`Zanix.startWorker()`), so the registration reaches whichever process actually executes the job.
 *
 * @requires @zanix/datamaster
 * @decorator registerTriggerActionJob
 *
 * @module
 */
const zanixMailTriggerJobCore: void = registerMailTriggerJob()

export default zanixMailTriggerJobCore
