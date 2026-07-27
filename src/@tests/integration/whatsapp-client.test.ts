import { assertEquals, assertRejects, assertStrictEquals } from 'jsr:@std/assert@^1.0.15'
import { WhatsappClient } from 'modules/whatsapp/connector.ts'
import type { WhatsappMessage, WhatsappProviderAdapter } from 'typings/whatsapp.ts'

const metaConfig = { phoneNumberId: '123456789', accessToken: 'test_token' }

/** Stubs `globalThis.fetch`, restoring the original afterward. */
async function withFakeFetch<T>(
  respond: (input: string | URL | Request) => Response | Promise<Response>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const original = globalThis.fetch
  // deno-lint-ignore require-await
  globalThis.fetch = (async (input: string | URL | Request) => respond(input)) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

/** A no-op `WhatsappProviderAdapter` that records every message it's asked to send. */
function fakeAdapter(overrides: Partial<WhatsappProviderAdapter> = {}) {
  const sent: WhatsappMessage[] = []
  const adapter: WhatsappProviderAdapter = {
    send: overrides.send ?? ((message) => {
      sent.push(message)
      return Promise.resolve()
    }),
  }
  return { adapter, sent }
}

Deno.test(
  'WhatsappClient: merges static config with instance config, static config wins',
  async () => {
    let capturedUrl: string | undefined

    WhatsappClient.config = metaConfig
    try {
      await withFakeFetch(
        (input) => {
          capturedUrl = String(input)
          return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 })
        },
        async () => {
          // Instance config sets a different phoneNumberId; the static one must win.
          const client = new WhatsappClient({
            phoneNumberId: 'instance-id',
            autoInitialize: false,
          })
          client['initialize']()
          await client.send({ to: '+15551234567', content: 'hi' })
        },
      )
    } finally {
      // deno-lint-ignore no-explicit-any
      WhatsappClient.config = undefined as any
    }

    assertEquals(
      capturedUrl,
      `https://graph.facebook.com/v25.0/${metaConfig.phoneNumberId}/messages`,
    )
  },
)

Deno.test(
  'WhatsappClient: builds the default MetaCloudWhatsappAdapter and reaches Meta when no custom adapter is configured',
  async () => {
    let capturedUrl: string | undefined

    await withFakeFetch(
      (input) => {
        capturedUrl = String(input)
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), { status: 200 })
      },
      async () => {
        const client = new WhatsappClient({ ...metaConfig, autoInitialize: false })
        client['initialize']()
        await client.send({ to: '+15551234567', content: 'hi' })
      },
    )

    assertEquals(
      capturedUrl,
      `https://graph.facebook.com/v25.0/${metaConfig.phoneNumberId}/messages`,
    )
  },
)

Deno.test(
  'WhatsappClient: a custom adapter bypasses the built-in Meta adapter entirely',
  async () => {
    const { adapter, sent } = fakeAdapter()
    const client = new WhatsappClient({ adapter, autoInitialize: false })
    client['initialize']()

    await client.send({ to: '+15551234567', content: 'hi there' })

    assertEquals(sent, [{ to: '+15551234567', content: 'hi there' }])
  },
)

Deno.test('WhatsappClient: send() throws before initialize() has run', async () => {
  const client = new WhatsappClient({ ...metaConfig, autoInitialize: false })

  await assertRejects(
    () => client.send({ to: '+15551234567', content: 'hi' }),
    Error,
    'not initialized',
  )
})

Deno.test('WhatsappClient: sendTemplate() throws before initialize() has run', async () => {
  const client = new WhatsappClient({ ...metaConfig, autoInitialize: false })

  await assertRejects(
    () =>
      client.sendTemplate({
        to: '+15551234567',
        templateName: 'otp_code',
        templateLanguage: 'en_US',
      }),
    Error,
    'not initialized',
  )
})

Deno.test('WhatsappClient: sendTemplate() forwards template fields to the adapter', async () => {
  const { adapter, sent } = fakeAdapter()
  const client = new WhatsappClient({ adapter, autoInitialize: false })
  client['initialize']()

  await client.sendTemplate({
    to: '+15551234567',
    templateName: 'otp_code',
    templateLanguage: 'en_US',
    templateParams: ['123456'],
  })

  assertStrictEquals(sent.length, 1)
  assertEquals(sent[0], {
    to: '+15551234567',
    templateName: 'otp_code',
    templateLanguage: 'en_US',
    templateParams: ['123456'],
  })
})

Deno.test(
  "WhatsappClient: sendTemplate() also accepts Twilio's contentSid/contentVariables shape",
  async () => {
    const { adapter, sent } = fakeAdapter()
    const client = new WhatsappClient({ adapter, autoInitialize: false })
    client['initialize']()

    await client.sendTemplate({
      to: '+15551234567',
      contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
      contentVariables: { '1': '409173' },
    })

    assertStrictEquals(sent.length, 1)
    assertEquals(sent[0], {
      to: '+15551234567',
      contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
      contentVariables: { '1': '409173' },
    })
  },
)

Deno.test('WhatsappClient: isHealthy() is false before initialize() and true after', () => {
  const client = new WhatsappClient({ ...metaConfig, autoInitialize: false })
  assertEquals(client.isHealthy(), false)

  client['initialize']()
  assertEquals(client.isHealthy(), true)
})

Deno.test('WhatsappClient: close() is a no-op', async () => {
  const client = new WhatsappClient({ ...metaConfig, autoInitialize: false })
  client['initialize']()

  await client.close()
  assertEquals(client.isHealthy(), true)
})

Deno.test(
  'WhatsappClient: send() ignores subject/date/from and forwards only to/content to the adapter',
  async () => {
    const { adapter, sent } = fakeAdapter()
    const client = new WhatsappClient({ adapter, autoInitialize: false })
    client['initialize']()

    await client.send({
      to: '+15551234567',
      from: 'ignored for WhatsApp',
      subject: 'ignored for WhatsApp',
      date: 'ignored for WhatsApp',
      content: 'the actual text',
    })

    assertEquals(sent, [{ to: '+15551234567', content: 'the actual text' }])
  },
)
