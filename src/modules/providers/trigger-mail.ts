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
 * Payload contract for the `mail` trigger action.
 *
 * `@zanix/datamaster` intentionally treats `TriggerActions['mail']` as an opaque payload
 * (`to`/`subject` plus an open-ended object), because it owns trigger persistence rather than the
 * notification protocol itself. This package owns the concrete shape consumed by
 * {@link sendMailTriggerNotification}, since it mirrors the contract accepted by
 * `NotifierProvider.sendMessage('email', ...)`.
 *
 * The type is derived from `NotifyMessageWithTemplate` rather than duplicated manually so it stays
 * aligned with the notifier's own envelope (`to`, `from`, `date`, `subject`) automatically. Only
 * the template-specific fields are reshaped: `content`, `zanixTemplate`, and `data` become
 * `body.template` and `body.data`, because a trigger's template is configured at runtime rather
 * than selected from the compile-time `DefaultTemplates` union.
 */
export type MailTriggerActionData = NotifyMessageWithTemplate<DefaultTemplates>

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
  const { to, subject, from, date, zanixTemplate, data, content, ...rest } = action

  await notifier.sendMessage('email', {
    to,
    subject,
    from,
    date,
    content,
    zanixTemplate,
    data,
    ...rest,
  } as never)
}
