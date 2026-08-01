import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import type { NotifierProvider } from 'modules/providers/notifier.ts'

import { sendMailTriggerNotification } from 'modules/providers/trigger-mail.ts'

function makeFakeNotifier() {
  const calls: { notifier: string; message: unknown }[] = []
  const notifier = {
    sendMessage: (notifierArg: string, message: unknown) => {
      calls.push({ notifier: notifierArg, message })
      return Promise.resolve()
    },
  }
  return { notifier: notifier as unknown as NotifierProvider, calls }
}

Deno.test('sendMailTriggerNotification forwards fields to sendMessage', async () => {
  const { notifier, calls } = makeFakeNotifier()

  await sendMailTriggerNotification(notifier, {
    to: 'a@b.com',
    subject: 'Hi',
    from: 'noreply@example.com',
    zanixTemplate: 'welcome',
    data: { buttonLink: 'A' },
  })

  assertEquals(calls.length, 1)
  assertEquals(calls[0].notifier, 'email')
  assertEquals(
    (calls[0].message as { to: string }).to,
    'a@b.com',
  )
  assertEquals(
    (calls[0].message as { zanixTemplate: unknown }).zanixTemplate,
    'welcome',
  )
  assertEquals(
    (calls[0].message as { data: unknown }).data,
    { buttonLink: 'A' },
  )
})

Deno.test('sendMailTriggerNotification forwards a literal string as body.data as-is', async () => {
  const { notifier, calls } = makeFakeNotifier()

  await sendMailTriggerNotification(notifier, {
    to: 'a@b.com',
    subject: 'Hi',
    zanixTemplate: 'generic',
    data: { buttonText: 'plain text body' },
  })

  assertEquals(
    (calls[0].message as { zanixTemplate: unknown }).zanixTemplate,
    'generic',
  )
  assertEquals(
    (calls[0].message as { data: Record<string, string> }).data.buttonText,
    'plain text body',
  )
})
