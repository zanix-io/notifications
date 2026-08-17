import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import type { ZanixNotifierConnector } from 'modules/base.ts'

import { NotifierProvider, sendBackgroundMessage } from 'modules/providers/notifier.ts'
// Registers `TemplateProvider` in the DI container (`this.providers.get(TemplateProvider)`,
// used by `NotifierProvider.#dispatch()`) — needed even with the database feature untouched,
// since `TemplateProvider` itself is unconditionally required infrastructure (see `core.ts`).
import 'modules/templates/core.ts'
import '../fixtures.ts'

import { TEMPLATES_MODEL_ENV } from 'modules/templates/provider.ts'

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
  return {
    connector: connector as unknown as ZanixNotifierConnector,
    calls,
    templateCalls,
  }
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
  public sent: {
    taskName: string
    parameters: unknown[]
    messageId: string
  }[] = []

  constructor() {
    FakeWorker.instances.push(this)
  }

  public postMessage(
    data: { taskName: string; parameters: unknown[]; messageId: string },
  ) {
    this.sent.push(data)
    queueMicrotask(() => {
      this.onmessage?.({
        data: { response: 'OK', error: null, messageId: data.messageId },
      })
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

  await provider.email({
    to: 'dest@example.com',
    subject: 'Hi',
    content: 'plain text body',
  })

  assertEquals(calls.length, 1)
  assertEquals(calls[0], {
    to: 'dest@example.com',
    subject: 'Hi',
    content: 'plain text body',
  })
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
    await provider.sendMessage('email', {
      to: 'a@b.com',
      subject: 'x',
      content: 'y',
    })
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
      useWorker: {
        mode: 'one-time',
        callback: (response) => responses.push(response),
      },
    })
    await provider.sendMessage('email', {
      to: 'c@d.com',
      subject: 'Two',
      content: 'body-2',
    }, {
      useWorker: 'one-time',
    })

    provider['onDestroy']()

    // Let the fake worker's queued microtask (postMessage -> onmessage) settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    assertEquals(FakeWorker.instances.length, 1)
    const [{ taskName, parameters }] = FakeWorker.instances[0].sent
    assertEquals(taskName, 'sendBackgroundMessage')

    const queuedMessages = parameters[0] as {
      notifier: string
      kind: string
      message: unknown
    }[]
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
  "NotifierProvider: 'persisted' wins the batch mode when only one queued message asked for it, " +
    'falling back safely with no worker provider registered',
  async () => {
    await withFakeWorker(async () => {
      const provider = new NotifierProvider()

      await provider.sendMessage('email', {
        to: 'a@b.com',
        subject: 'One',
        content: 'body-1',
      }, { useWorker: 'one-time' })
      await provider.sendMessage('email', {
        to: 'c@d.com',
        subject: 'Two',
        content: 'body-2',
      }, { useWorker: 'persisted' })

      provider['onDestroy']()

      // Let the fake worker's queued microtask (postMessage -> onmessage) settle.
      await new Promise((resolve) => setTimeout(resolve, 0))

      // No 'worker' core provider is registered in this test process, so 'persisted' falls back
      // to the same one-time WorkerManager path 'one-time' itself uses — still exactly one flush.
      assertEquals(FakeWorker.instances.length, 1)
      const [{ parameters }] = FakeWorker.instances[0].sent
      const queuedMessages = parameters[0] as unknown[]
      assertEquals(queuedMessages.length, 2)
    })
  },
)

Deno.test(
  'NotifierProvider: sendTemplate() queues with kind "template", onDestroy flushes via worker',
  async () => {
    await withFakeWorker(async () => {
      const provider = new NotifierProvider()

      await provider.sendTemplate({
        to: '+15551234567',
        contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
      }, { useWorker: 'one-time' })

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
        message: {
          to: '+15551234567',
          contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
        },
      }])
    })
  },
)

Deno.test(
  'NotifierProvider: onDestroy() preloads the zanixTemplate chain for a queued message that carries one',
  async () => {
    await withFakeWorker(async () => {
      const provider = new NotifierProvider()

      await provider.sendMessage('email', {
        to: 'a@b.com',
        subject: 'Welcome',
        zanixTemplate: 'welcome',
        data: { buttonText: 'Click here' },
      }, { useWorker: 'one-time' })

      // No TEMPLATES_MODEL_NAME/TEMPLATES_SERVICE_URL set — TemplateProvider#backend() is
      // undefined, so preloadChain() is a no-op; this only proves onDestroy() calls it at all
      // for a queued message carrying a `zanixTemplate`, without needing a database.
      await provider['onDestroy']()

      assertEquals(FakeWorker.instances.length, 1)
      const [{ parameters }] = FakeWorker.instances[0].sent
      const templates = parameters[1] as Map<string, unknown>
      assertEquals(templates.size, 0)
    })
  },
)

Deno.test(
  "NotifierProvider: onDestroy() doesn't touch the database for a plain-content message, even with database templates enabled",
  async () => {
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix-templates-test')
    try {
      await withFakeWorker(async () => {
        const provider = new NotifierProvider()

        await provider.sendMessage('email', {
          to: 'a@b.com',
          subject: 'Hi',
          content: 'plain body, no zanixTemplate',
        }, { useWorker: 'one-time' })

        // No `this.database` stub is installed anywhere in this test — if onDestroy() called
        // `TemplateProvider.preload()` for this message (it carries no `zanixTemplate`), that
        // would try to resolve a database connector that was never registered and throw.
        await provider['onDestroy']()

        assertEquals(FakeWorker.instances.length, 1)
        const [{ parameters }] = FakeWorker.instances[0].sent
        const templates = parameters[1] as Map<string, unknown>
        assertEquals(templates.size, 0)
      })
    } finally {
      Deno.env.delete(TEMPLATES_MODEL_ENV)
    }
  },
)

Deno.test('sendBackgroundMessage: resolves immediately with an empty queue', async () => {
  await sendBackgroundMessage([], new Map())
})

Deno.test(
  'sendBackgroundMessage: dispatches a kind "template" entry through sendTemplate()',
  async () => {
    // Without WHATSAPP_* env vars, `whatsapp/defs.ts` never registers a connector, so
    // `NotifierProvider.use('whatsapp')` fails and `sendTemplate` re-wraps it as `Interrupted` —
    // this exercises the `kind === 'template'` branch directly, without a real worker thread (the
    // only other place it runs — see `NotifierProvider.onDestroy()` — spawns a real `Worker`,
    // whose own module graph isn't covered by this process's instrumentation).
    let caught: unknown
    try {
      await sendBackgroundMessage([
        {
          notifier: 'whatsapp',
          kind: 'template',
          message: { to: '+15551234567', contentSid: 'HX123' },
        },
      ], new Map())
    } catch (error) {
      caught = error
    }

    assert(caught instanceof Deno.errors.Interrupted)
  },
)

Deno.test(
  'sendBackgroundMessage: two calls in a row (simulating a reused persisted worker) each get ' +
    "their own SCOPED connector instance, not the previous call's",
  async () => {
    // Regression test for a real bug: `sendBackgroundMessage` used to construct
    // `new NotifierProvider()` with no `contextId`, so its SCOPED `SmtpClient` was cached by the
    // DI container under the same fixed `undefined` bucket every call. A one-time worker masked
    // this by accident (a fresh worker means a fresh module graph, so the bucket starts empty
    // regardless) — but `useWorker: 'persisted'` reuses the same worker (and DI container) across
    // many calls, so the second call resolved the *first* call's already-`close()`d connector
    // instance instead of a fresh one, surfacing as `SmtpClient`'s "Connection not ready!". Fixed
    // by giving `NotifierProvider` a fresh, random `contextId` per batch.
    const { SmtpClient } = await import('modules/email/connector.ts')
    const { Connector } = await import('@zanix/server')

    const seenInstances: unknown[] = []
    const originalInitialize = SmtpClient.prototype['initialize']
    const originalSend = SmtpClient.prototype.send
    const originalClose = SmtpClient.prototype.close // deno-lint-ignore no-explicit-any
    ;(SmtpClient.prototype as any).initialize = function () {
      return Promise.resolve()
    }
    SmtpClient.prototype.send = function (this: unknown) {
      seenInstances.push(this)
      return Promise.resolve()
    }
    SmtpClient.prototype.close = function () {
      return Promise.resolve(true)
    }

    Connector({ startMode: 'lazy', lifetime: 'SCOPED' })(SmtpClient as never)

    try {
      const message = {
        notifier: 'email' as const,
        kind: 'message' as const,
        message: { to: 'a@b.com', subject: 'x', content: 'y' },
      }

      await sendBackgroundMessage([message], new Map())
      await sendBackgroundMessage([message], new Map())

      assertEquals(seenInstances.length, 2)
      assert(seenInstances[0] !== seenInstances[1])
    } finally {
      SmtpClient.prototype['initialize'] = originalInitialize
      SmtpClient.prototype.send = originalSend
      SmtpClient.prototype.close = originalClose
    }
  },
)

Deno.test('sendBackgroundMessage: rejects if connector is unregistered', async () => {
  // Without SMTP_* env vars, `email/defs.ts` short-circuits and never registers SmtpClient,
  // so `NotifierProvider.use('email')` fails with CONNECTOR_INSTANCE_NOT_FOUND, which
  // `sendMessage` re-wraps as `Deno.errors.Interrupted`. This exercises the real (non-stubbed)
  // dynamic-import + provider construction + sendMessage path of `sendBackgroundMessage`
  // without needing a live SMTP server or full framework DI bootstrap.
  const smtpEnvKeys = ['SMTP_PORT', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']
  const previous = Object.fromEntries(
    smtpEnvKeys.map((key) => [key, Deno.env.get(key)]),
  )
  smtpEnvKeys.forEach((key) => Deno.env.delete(key))

  let caught: unknown
  try {
    await sendBackgroundMessage([
      {
        notifier: 'email',
        kind: 'message',
        message: { to: 'a@b.com', subject: 'x', content: 'y' },
      },
    ], new Map())
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
