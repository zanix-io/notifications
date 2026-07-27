import { assertEquals, assertRejects, assertStrictEquals } from 'jsr:@std/assert@^1.0.15'
import { SmsClient } from 'modules/sms/connector.ts'
import type { SmsMessage, SmsProviderAdapter } from 'typings/sms.ts'

const twilioConfig = { accountSid: 'AC_sid', authToken: 'token', from: '+15005550006' }

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

/** A no-op `SmsProviderAdapter` that records every message it's asked to send. */
function fakeAdapter(overrides: Partial<SmsProviderAdapter> = {}) {
  const sent: SmsMessage[] = []
  const adapter: SmsProviderAdapter = {
    send: overrides.send ?? ((message) => {
      sent.push(message)
      return Promise.resolve()
    }),
  }
  return { adapter, sent }
}

Deno.test('SmsClient: merges static config with instance config, static config wins', async () => {
  let capturedUrl: string | undefined

  SmsClient.config = twilioConfig
  try {
    await withFakeFetch(
      (input) => {
        capturedUrl = String(input)
        return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 })
      },
      async () => {
        // Instance config sets a different accountSid; the static one must win.
        const client = new SmsClient({ accountSid: 'AC_instance_sid', autoInitialize: false })
        client['initialize']()
        await client.send({ to: '+15551234567', content: 'hi' })
      },
    )
  } finally {
    // deno-lint-ignore no-explicit-any
    SmsClient.config = undefined as any
  }

  // See TwilioSmsAdapter's JSDoc: RestClient lowercases the whole URL via cleanRoute().
  assertEquals(
    capturedUrl,
    `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Messages.json`,
  )
})

Deno.test(
  'SmsClient: builds the default TwilioSmsAdapter and reaches Twilio when no custom adapter is configured',
  async () => {
    let capturedUrl: string | undefined

    await withFakeFetch(
      (input) => {
        capturedUrl = String(input)
        return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 })
      },
      async () => {
        const client = new SmsClient({ ...twilioConfig, autoInitialize: false })
        client['initialize']()
        await client.send({ to: '+15551234567', content: 'hi' })
      },
    )

    assertEquals(
      capturedUrl,
      `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Messages.json`,
    )
  },
)

Deno.test('SmsClient: a custom adapter bypasses the built-in Twilio adapter entirely', async () => {
  const { adapter, sent } = fakeAdapter()
  const client = new SmsClient({ adapter, autoInitialize: false })
  client['initialize']()

  await client.send({ to: '+15551234567', content: 'hi there' })

  assertEquals(sent.length, 1)
  assertEquals(sent[0], { to: '+15551234567', content: 'hi there', from: undefined })
})

Deno.test('SmsClient: send() throws before initialize() has run', async () => {
  const client = new SmsClient({ ...twilioConfig, autoInitialize: false })

  await assertRejects(
    () => client.send({ to: '+15551234567', content: 'hi' }),
    Error,
    'not initialized',
  )
})

Deno.test('SmsClient: isHealthy() is false before initialize() and true after', () => {
  const client = new SmsClient({ ...twilioConfig, autoInitialize: false })
  assertEquals(client.isHealthy(), false)

  client['initialize']()
  assertEquals(client.isHealthy(), true)
})

Deno.test('SmsClient: close() is a no-op', async () => {
  const client = new SmsClient({ ...twilioConfig, autoInitialize: false })
  client['initialize']()

  await client.close()
  // Still healthy afterward — close() doesn't tear down the adapter.
  assertEquals(client.isHealthy(), true)
})

Deno.test(
  'SmsClient: send() ignores subject/date and forwards to/content/from to the adapter',
  async () => {
    const { adapter, sent } = fakeAdapter()
    const client = new SmsClient({ adapter, autoInitialize: false })
    client['initialize']()

    await client.send({
      to: '+15551234567',
      from: '+19998887777',
      subject: 'ignored for SMS',
      date: 'ignored for SMS',
      content: 'the actual text',
    })

    assertStrictEquals(sent.length, 1)
    assertEquals(sent[0], { to: '+15551234567', from: '+19998887777', content: 'the actual text' })
  },
)
