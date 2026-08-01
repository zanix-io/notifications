/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import type { DefaultTemplates, NotifyMessageWithTemplate } from 'typings/general.ts'
import type { NotifierProvider } from './notifier.ts'

/**
 * The `mail` trigger action's payload contract — what `@zanix/datamaster`'s generic
 * `TriggerActions['mail']` (typed there as `to`/`subject` plus an open catch-all, since datamaster
 * doesn't know this package's contract) is expected to satisfy by the time it reaches
 * {@link sendMailTriggerNotification}. Owned here, not in datamaster, since it mirrors
 * `NotifierProvider.sendMessage('email', ...)`'s own contract exactly.
 *
 * Derived from `NotifyMessageWithTemplate` (not hand-duplicated) so it stays in sync with the
 * notifier's own envelope fields (`to`/`from`/`date`/`subject`) automatically — only `content`/
 * `zanixTemplate`/`data` are replaced by `body.template`/`body.data`, since `template` here is
 * authored dynamically (a trigger's own config) and can't be statically narrowed to
 * `NotifyMessageWithTemplate`'s `DefaultTemplates`-keyed `MessageContent` union the way a
 * compile-time-known template can.
 */
export type MailTriggerActionData =
  & Omit<NotifyMessageWithTemplate<DefaultTemplates>, 'content' | 'zanixTemplate' | 'data'>
  & {
    body: {
      /** The name of the notification template to render. Resolved at runtime — see {@link sendMailTriggerNotification}. */
      template: string
      /** The template's render data, or a literal string for plain-content templates. */
      data?: Record<string, unknown> | string
    }
  }

/**
 * Sends the email a `mail` trigger action describes, via `NotifierProvider.sendMessage('email',
 * ...)`. `body.template` is authored dynamically (e.g. a trigger's own config), so it can't be
 * statically narrowed to `sendMessage`'s fixed `DefaultTemplates` union — trusted at runtime
 * instead; an unregistered template name surfaces as `TemplateProvider.resolve()`'s own runtime
 * error.
 *
 * @param notifier A resolved `NotifierProvider` instance (e.g. from
 * `this.providers.get('notifications')` inside a job handler).
 * @param action The trigger's `mail` action data.
 * @returns Resolves when the message has been sent.
 */
export async function sendMailTriggerNotification(
  notifier: NotifierProvider,
  action: MailTriggerActionData,
): Promise<void> {
  const { to, subject, from, date, body } = action

  await notifier.sendMessage('email', {
    to,
    subject,
    from,
    date,
    zanixTemplate: body.template,
    data: body.data,
  } as never)
}
