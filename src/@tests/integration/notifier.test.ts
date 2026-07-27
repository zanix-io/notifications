import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import type { ZanixNotifierConnector } from 'modules/base.ts'

import { NotifierProvider, sendBackgroundMessage } from 'modules/providers/notifier.ts'
// Registers `TemplateProvider` in the DI container (`this.providers.get(TemplateProvider)`,
// used by `NotifierProvider.#dispatch()`) — needed even with the database feature untouched,
// since `TemplateProvider` itself is unconditionally required infrastructure (see `core.ts`).
import 'modules/templates/core.ts'

console.error = () => {}

/**
 * Builds a fake `ZanixNotifierConnector` (with a `sendTemplate`, for whatsapp-shaped tests) that
 * records every `send()`/`sendTemplate()` call instead of talking to a real transport, so
 * `NotifierProvider.sendMessage()`/`sendTemplate()` can be exercised without a real SMTP
 * connection or DI-registered connector.
 */
function makeFakeConnector(
  overrides: {
    send?: (data: unknown) => Promise<void>
    sendTemplate?: (data: unknown) => Promise<void>
    isReady?: Promise<boolean>
  } = {},
) {
  const calls: unknown[] = []
  const templateCalls: unknown[] = []
  const connector = {
    isReady: overrides.isReady ?? Promise.resolve(true),
    send: overrides.send ?? ((data: unknown) => {
      calls.push(data)
      return Promise.resolve()
    }),
    sendTemplate: overrides.sendTemplate ?? ((data: unknown) => {
      templateCalls.push(data)
      return Promise.resolve()
    }),
    close: async () => {},
  }
  return { connector: connector as unknown as ZanixNotifierConnector, calls, templateCalls }
}

/**
 * Fake Web Worker used to stand in for the real OS-level worker `WorkerManager` spins up on
 * construction. Simulates a successful round trip: every `postMessage` eventually triggers
 * `onmessage` with a canned "OK" response, without ever creating a real worker thread.
 */
class FakeWorker {
  public static instances: FakeWorker[] = []
  public onmessage: ((e: { data: unknown }) => void) | null = null
  public onerror: ((e: unknown) => void) | null = null
  public terminated = false
  public sent: { taskName: string; parameters: unknown[]; messageId: string }[] = []

  constructor() {
    FakeWorker.instances.push(this)
  }

  public postMessage(data: { taskName: string; parameters: unknown[]; messageId: string }) {
    this.sent.push(data)
    queueMicrotask(() => {
      this.onmessage?.({ data: { response: 'OK', error: null, messageId: data.messageId } })
    })
  }

  public terminate() {
    this.terminated = true
  }
}

/** Stubs the global `Worker` constructor with `FakeWorker` for the duration of `fn`. */
async function withFakeWorker<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = globalThis.Worker
  FakeWorker.instances = []
  // deno-lint-ignore no-explicit-any
  globalThis.Worker = FakeWorker as any
  try {
    return await fn()
  } finally {
    globalThis.Worker = original
  }
}

Deno.test('NotifierProvider: sendMessage sends immediately with a string body', async () => {
  const provider = new NotifierProvider()
  const { connector, calls } = makeFakeConnector()
  provider.use = (() => connector) as typeof provider.use

  await provider.sendMessage('email', {
    to: 'dest@example.com',
    from: 'me@example.com',
    subject: 'Hi',
    content: 'plain text body',
  })

  assertEquals(calls.length, 1)
  assertEquals(calls[0], {
    to: 'dest@example.com',
    from: 'me@example.com',
    subject: 'Hi',
    content: 'plain text body',
  })
})

Deno.test('NotifierProvider: sendMessage renders a templated body before sending', async () => {
  const provider = new NotifierProvider()
  const { connector, calls } = makeFakeConnector()
  provider.use = (() => connector) as typeof provider.use

  await provider.sendMessage('email', {
    to: 'dest@example.com',
    subject: 'Welcome',
    zanixTemplate: 'welcome',
    data: { buttonText: 'Click here' },
  })

  assertEquals(calls.length, 1)
  const sentData = calls[0] as { content: string; to: string; subject: string }
  assertEquals(sentData.to, 'dest@example.com')
  assertEquals(sentData.subject, 'Welcome')
  assertStringIncludes(sentData.content, 'Click here')
})

Deno.test(
  "NotifierProvider: sms() renders using the sms template registry, not email's",
  async () => {
    const provider = new NotifierProvider()
    const { connector, calls } = makeFakeConnector()
    provider.use = (() => connector) as typeof provider.use

    await provider.sms({
      to: '+15551234567',
      zanixTemplate: 'generic',
      data: { content: 'Your code is 123456' },
    })

    assertEquals(calls.length, 1)
    const sentData = calls[0] as { content: string; to: string }
    assertEquals(sentData.to, '+15551234567')
    assertStringIncludes(sentData.content, '123456')
  },
)

Deno.test('NotifierProvider: whatsapp() renders using the whatsapp template registry', async () => {
  const provider = new NotifierProvider()
  const { connector, calls } = makeFakeConnector()
  provider.use = (() => connector) as typeof provider.use

  await provider.whatsapp({
    to: '+15551234567',
    zanixTemplate: 'generic',
    data: { content: 'Your code is 654321' },
  })

  assertEquals(calls.length, 1)
  const sentData = calls[0] as { content: string; to: string }
  assertEquals(sentData.to, '+15551234567')
  assertStringIncludes(sentData.content, '654321')
})

Deno.test(
  "NotifierProvider: whatsapp() dispatches to sendTemplate() for Meta's templateName shape",
  async () => {
    const provider = new NotifierProvider()
    const { connector, calls, templateCalls } = makeFakeConnector()
    provider.use = (() => connector) as typeof provider.use

    await provider.whatsapp({
      to: '+15551234567',
      templateName: 'otp_code',
      templateLanguage: 'en_US',
      templateParams: ['123456'],
    })

    assertEquals(calls.length, 0)
    assertEquals(templateCalls, [{
      to: '+15551234567',
      templateName: 'otp_code',
      templateLanguage: 'en_US',
      templateParams: ['123456'],
    }])
  },
)

Deno.test(
  "NotifierProvider: whatsapp() dispatches to sendTemplate() for Twilio's contentSid shape",
  async () => {
    const provider = new NotifierProvider()
    const { connector, calls, templateCalls } = makeFakeConnector()
    provider.use = (() => connector) as typeof provider.use

    await provider.whatsapp({
      to: '+15551234567',
      contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
      contentVariables: { '1': '409173' },
    })

    assertEquals(calls.length, 0)
    assertEquals(templateCalls, [{
      to: '+15551234567',
      contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
      contentVariables: { '1': '409173' },
    }])
  },
)

Deno.test('NotifierProvider: sendTemplate() sends immediately by default', async () => {
  const provider = new NotifierProvider()
  const { connector, templateCalls } = makeFakeConnector()
  provider.use = (() => connector) as typeof provider.use

  await provider.sendTemplate({
    to: '+15551234567',
    contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
  })

  assertEquals(templateCalls, [{
    to: '+15551234567',
    contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
  }])
})

Deno.test('NotifierProvider: sendTemplate() wraps a send failure as Interrupted', async () => {
  const provider = new NotifierProvider()
  const originalError = new Error('boom')
  const { connector } = makeFakeConnector({
    sendTemplate: () => {
      throw originalError
    },
  })
  provider.use = (() => connector) as typeof provider.use

  let caught: unknown
  try {
    await provider.sendTemplate({ to: '+15551234567', contentSid: 'HX123' })
  } catch (error) {
    caught = error
  }

  assert(caught instanceof Deno.errors.Interrupted)
  assertEquals((caught as Error).cause, originalError)
})

Deno.test("NotifierProvider: email() is equivalent to sendMessage('email', ...)", async () => {
  const provider = new NotifierProvider()
  const { connector, calls } = makeFakeConnector()
  provider.use = (() => connector) as typeof provider.use

  await provider.email({ to: 'dest@example.com', subject: 'Hi', content: 'plain text body' })

  assertEquals(calls.length, 1)
  assertEquals(calls[0], { to: 'dest@example.com', subject: 'Hi', content: 'plain text body' })
})

Deno.test('NotifierProvider: sendMessage wraps a send failure as Interrupted', async () => {
  const provider = new NotifierProvider()
  const originalError = new Error('boom')
  const { connector } = makeFakeConnector({
    send: () => {
      throw originalError
    },
  })
  provider.use = (() => connector) as typeof provider.use

  let caught: unknown
  try {
    await provider.sendMessage('email', { to: 'a@b.com', subject: 'x', content: 'y' })
  } catch (error) {
    caught = error
  }

  assert(caught instanceof Deno.errors.Interrupted)
  assertEquals((caught as Error).cause, originalError)
})

Deno.test('NotifierProvider: onDestroy is a no-op when the queue is empty', async () => {
  await withFakeWorker(() => {
    const provider = new NotifierProvider()
    provider['onDestroy']()
    assertEquals(FakeWorker.instances.length, 0)
  })
})

Deno.test('NotifierProvider: sendMessage queues, onDestroy flushes via worker', async () => {
  await withFakeWorker(async () => {
    const provider = new NotifierProvider()
    const responses: unknown[] = []

    await provider.sendMessage('email', {
      to: 'a@b.com',
      subject: 'One',
      content: 'body-1',
    }, {
      useOneTimeWorker: {
        callback: (response) => responses.push(response),
      },
    })
    await provider.sendMessage('email', {
      to: 'c@d.com',
      subject: 'Two',
      content: 'body-2',
    }, {
      useOneTimeWorker: true,
    })

    provider['onDestroy']()

    // Let the fake worker's queued microtask (postMessage -> onmessage) settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(FakeWorker.instances.length, 1)
    const [{ taskName, parameters }] = FakeWorker.instances[0].sent
    assertEquals(taskName, 'sendBackgroundMessage')

    const queuedMessages = parameters[0] as { notifier: string; kind: string; message: unknown }[]
    assertEquals(queuedMessages.length, 2)
    assertEquals(queuedMessages[0], {
      notifier: 'email',
      kind: 'message',
      message: { to: 'a@b.com', subject: 'One', content: 'body-1' },
    })
    assertEquals(queuedMessages[1], {
      notifier: 'email',
      kind: 'message',
      message: { to: 'c@d.com', subject: 'Two', content: 'body-2' },
    })

    // Only the first queued message registered a callback.
    assertEquals(responses.length, 1)
  })
})

Deno.test(
  'NotifierProvider: sendTemplate() queues with kind "template", onDestroy flushes via worker',
  async () => {
    await withFakeWorker(async () => {
      const provider = new NotifierProvider()

      await provider.sendTemplate({
        to: '+15551234567',
        contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
      }, { useOneTimeWorker: true })

      provider['onDestroy']()

      await new Promise((resolve) => setTimeout(resolve, 0))

      assertEquals(FakeWorker.instances.length, 1)
      const [{ parameters }] = FakeWorker.instances[0].sent
      const queuedMessages = parameters[0] as {
        notifier: string
        kind: string
        message: unknown
      }[]
      assertEquals(queuedMessages, [{
        notifier: 'whatsapp',
        kind: 'template',
        message: { to: '+15551234567', contentSid: 'HX229f5a04fd0510ce1b071852155d3e75' },
      }])
    })
  },
)

Deno.test('sendBackgroundMessage: resolves immediately with an empty queue', async () => {
  await sendBackgroundMessage([])
})

Deno.test('sendBackgroundMessage: rejects if connector is unregistered', async () => {
  // Without SMTP_* env vars, `email/defs.ts` short-circuits and never registers SmtpClient,
  // so `NotifierProvider.use('email')` fails with CONNECTOR_INSTANCE_NOT_FOUND, which
  // `sendMessage` re-wraps as `Deno.errors.Interrupted`. This exercises the real (non-stubbed)
  // dynamic-import + provider construction + sendMessage path of `sendBackgroundMessage`
  // without needing a live SMTP server or full framework DI bootstrap.
  const smtpEnvKeys = ['SMTP_PORT', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']
  const previous = Object.fromEntries(smtpEnvKeys.map((key) => [key, Deno.env.get(key)]))
  smtpEnvKeys.forEach((key) => Deno.env.delete(key))

  let caught: unknown
  try {
    await sendBackgroundMessage([
      {
        notifier: 'email',
        kind: 'message',
        message: { to: 'a@b.com', subject: 'x', content: 'y' },
      },
    ])
  } catch (error) {
    caught = error
  } finally {
    smtpEnvKeys.forEach((key) => {
      const value = previous[key]
      if (value === undefined) Deno.env.delete(key)
      else Deno.env.set(key, value)
    })
  }

  assert(caught instanceof Deno.errors.Interrupted)
})
