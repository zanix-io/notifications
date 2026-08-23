import { HttpError } from '@zanix/errors'
import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { stub } from '@std/testing/mock'
import { MetaCloudWhatsappAdapter } from 'modules/whatsapp/meta.ts'
import logger from '@zanix/logger'

console.error = () => {}

const config = {
  phoneNumberId: '123456789',
  accessToken: 'test_access_token',
}

/** Records the last `fetch` call and lets tests control the (fake) response. */
async function withFakeFetch<T>(
  respond: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Response | Promise<Response>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(respond(input, init))) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

Deno.test(
  'MetaCloudWhatsappAdapter: send() posts a Bearer-auth text message to the default API version',
  async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
          status: 200,
        })
      },
      () =>
        new MetaCloudWhatsappAdapter(config).send({
          to: '+15551234567',
          content: 'Your code is 123456',
        }),
    )

    assertEquals(
      capturedUrl,
      `https://graph.facebook.com/v25.0/${config.phoneNumberId}/messages`,
    )
    assertEquals(capturedInit?.method, 'POST')

    const headers = capturedInit?.headers as Record<string, string>
    assertEquals(headers['Authorization'], `Bearer ${config.accessToken}`)
    assertEquals(headers['Content-Type'], 'application/json')

    const body = JSON.parse(capturedInit?.body as string)
    assertEquals(body, {
      messaging_product: 'whatsapp',
      to: '+15551234567',
      type: 'text',
      text: { body: 'Your code is 123456' },
    })
  },
)

Deno.test('MetaCloudWhatsappAdapter: send() uses the configured apiVersion when set', async () => {
  let capturedUrl: string | undefined

  await withFakeFetch(
    (input) => {
      capturedUrl = String(input)
      return new Response(JSON.stringify({ messages: [] }), { status: 200 })
    },
    () =>
      new MetaCloudWhatsappAdapter({ ...config, apiVersion: 'v19.0' }).send({
        to: '+15551234567',
        content: 'hi',
      }),
  )

  assertEquals(
    capturedUrl,
    `https://graph.facebook.com/v19.0/${config.phoneNumberId}/messages`,
  )
})

Deno.test(
  'MetaCloudWhatsappAdapter: send() posts a template message when templateName is set',
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
          status: 200,
        })
      },
      () =>
        new MetaCloudWhatsappAdapter(config).send({
          to: '+15551234567',
          templateName: 'otp_code',
          templateLanguage: 'en_US',
          templateParams: ['123456'],
        }),
    )

    const body = JSON.parse(capturedInit?.body as string)
    assertEquals(body, {
      messaging_product: 'whatsapp',
      to: '+15551234567',
      type: 'template',
      template: {
        name: 'otp_code',
        language: { code: 'en_US' },
        components: [{
          type: 'body',
          parameters: [{ type: 'text', text: '123456' }],
        }],
      },
    })
  },
)

Deno.test(
  'MetaCloudWhatsappAdapter: send() omits components entirely when a template message has no templateParams',
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
          status: 200,
        })
      },
      () =>
        new MetaCloudWhatsappAdapter(config).send({
          to: '+15551234567',
          templateName: 'welcome',
          templateLanguage: 'en_US',
        }),
    )

    const body = JSON.parse(capturedInit?.body as string)
    // `JSON.stringify` drops keys whose value is `undefined` entirely — asserting the field is
    // absent (rather than comparing the whole object) is what actually proves the `undefined`
    // branch ran, without depending on how `assertEquals` treats a missing vs. `undefined` key.
    assertEquals('components' in body.template, false)
    assertEquals(body.template.name, 'welcome')
    assertEquals(body.template.language, { code: 'en_US' })
  },
)

Deno.test(
  "MetaCloudWhatsappAdapter: send() throws HttpError with Meta's message on a non-2xx response",
  async () => {
    await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            error: { message: 'Invalid OAuth access token.', code: 190 },
          }),
          { status: 401 },
        ),
      async () => {
        const adapter = new MetaCloudWhatsappAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: '+15551234567', content: 'hi' }),
          HttpError,
        )
        assertStringIncludes(
          (error.cause as Error).message,
          'Invalid OAuth access token',
        )
      },
    )
  },
)

Deno.test(
  'MetaCloudWhatsappAdapter: send() falls back to a generic message when the error body has no error.message field',
  async () => {
    await withFakeFetch(
      () => new Response('not json', { status: 500 }),
      async () => {
        const adapter = new MetaCloudWhatsappAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: '+15551234567', content: 'hi' }),
          HttpError,
        )
        assertStringIncludes((error.cause as Error).message, '[HTTP 500]')
      },
    )
  },
)

Deno.test(
  'MetaCloudWhatsappAdapter: send() logs via logger.error on a real send failure, without the message payload',
  async () => {
    const errorStub = stub(logger, 'error', () => undefined)

    try {
      await withFakeFetch(
        () =>
          new Response(
            JSON.stringify({
              error: { message: 'Invalid OAuth access token.', code: 190 },
            }),
            { status: 401 },
          ),
        () =>
          assertRejects(
            () =>
              new MetaCloudWhatsappAdapter(config).send({
                to: '+15551234567',
                content: 'this is the secret whatsapp body',
              }),
            HttpError,
          ),
      )

      assertEquals(errorStub.calls.length, 1)
      const loggedText = JSON.stringify(errorStub.calls[0].args)

      // The message content, the recipient, and Meta's own error text must never appear.
      assertEquals(loggedText.includes('this is the secret whatsapp body'), false)
      assertEquals(loggedText.includes('+15551234567'), false)
      assertEquals(loggedText.includes('Invalid OAuth access token'), false)
      // Only safe provider/channel metadata is logged.
      assertStringIncludes(loggedText, 'meta')
      assertStringIncludes(loggedText, 'whatsapp')
    } finally {
      errorStub.restore()
    }
  },
)
