import { HttpError } from '@zanix/errors'
import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { stub } from '@std/testing/mock'
import { VonageSmsAdapter } from 'modules/sms/vonage.ts'
import logger from '@zanix/logger'

const config = {
  apiKey: 'test_api_key',
  apiSecret: 'test_api_secret',
  from: 'AcmeInc',
}

console.error = () => {}

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
  'VonageSmsAdapter: send() posts form-urlencoded api_key/api_secret/to/from/text to sms/json',
  async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(
          JSON.stringify({
            'message-count': '1',
            messages: [{ to: '15551234567', 'message-id': '0A00', status: '0' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
      async () => {
        const adapter = new VonageSmsAdapter(config)
        await adapter.send({ to: '+15551234567', content: 'Your code is 123456' })
      },
    )

    assertEquals(capturedUrl, 'https://rest.nexmo.com/sms/json')
    assertEquals(capturedInit?.method, 'POST')

    const headers = capturedInit?.headers as Record<string, string>
    assertEquals(headers['Content-Type'], 'application/x-www-form-urlencoded')

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('api_key'), config.apiKey)
    assertEquals(body.get('api_secret'), config.apiSecret)
    assertEquals(body.get('to'), '+15551234567')
    assertEquals(body.get('from'), config.from)
    assertEquals(body.get('text'), 'Your code is 123456')
  },
)

Deno.test(
  "VonageSmsAdapter: send() uses the message's own `from` over the configured default",
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(
          JSON.stringify({ messages: [{ to: '15559998888', status: '0' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
      () =>
        new VonageSmsAdapter(config).send({
          to: '+15551234567',
          content: 'hi',
          from: '+15559998888',
        }),
    )

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('from'), '+15559998888')
  },
)

Deno.test(
  'VonageSmsAdapter: send() throws HttpError when Vonage responds 200 with a non-zero message status',
  async () => {
    await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            'message-count': '1',
            messages: [{
              to: 'not-a-number',
              status: '3',
              'error-text': 'Bad parameters',
            }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      async () => {
        const adapter = new VonageSmsAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: 'not-a-number', content: 'hi' }),
          HttpError,
        )

        assertStringIncludes((error.cause as Error).message, 'Bad parameters')
      },
    )
  },
)

Deno.test(
  'VonageSmsAdapter: send() falls back to a generic message when the rejected entry has no error-text',
  async () => {
    await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({ messages: [{ to: '15551234567', status: '4' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      async () => {
        const adapter = new VonageSmsAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: '+15551234567', content: 'hi' }),
          HttpError,
        )
        assertStringIncludes((error.cause as Error).message, 'status 4')
      },
    )
  },
)

Deno.test(
  'VonageSmsAdapter: send() resolves without throwing when status is "0"',
  async () => {
    await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({ messages: [{ to: '15551234567', status: '0' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      () => new VonageSmsAdapter(config).send({ to: '+15551234567', content: 'hi' }),
    )
  },
)

Deno.test(
  'VonageSmsAdapter: send() throws HttpError on a non-2xx transport-level response',
  async () => {
    await withFakeFetch(
      () => new Response('not json', { status: 500 }),
      async () => {
        const adapter = new VonageSmsAdapter(config)
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
  'VonageSmsAdapter: send() logs via logger.error when Vonage rejects the message, without the message payload',
  async () => {
    const errorStub = stub(logger, 'error', () => undefined)

    try {
      await withFakeFetch(
        () =>
          new Response(
            JSON.stringify({
              messages: [{
                to: 'not-a-number',
                status: '3',
                'error-text': 'Bad parameters',
              }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        () =>
          assertRejects(
            () =>
              new VonageSmsAdapter(config).send({
                to: 'not-a-number',
                content: 'this is the secret sms body',
              }),
            HttpError,
          ),
      )

      assertEquals(errorStub.calls.length, 1)
      const loggedText = JSON.stringify(errorStub.calls[0].args)

      // The message content, the recipient, and Vonage's own free-text error must never appear.
      assertEquals(loggedText.includes('this is the secret sms body'), false)
      assertEquals(loggedText.includes('not-a-number'), false)
      assertEquals(loggedText.includes('Bad parameters'), false)
      // Only safe provider/channel/status-code metadata is logged.
      assertStringIncludes(loggedText, 'vonage')
      assertStringIncludes(loggedText, 'sms')
      assertStringIncludes(loggedText, '3')
    } finally {
      errorStub.restore()
    }
  },
)

Deno.test(
  'VonageSmsAdapter: send() logs via logger.error on a transport-level failure, without the message payload',
  async () => {
    const errorStub = stub(logger, 'error', () => undefined)

    try {
      await withFakeFetch(
        () => new Response('not json', { status: 500 }),
        () =>
          assertRejects(
            () =>
              new VonageSmsAdapter(config).send({
                to: '+15551234567',
                content: 'this is the secret sms body',
              }),
            HttpError,
          ),
      )

      assertEquals(errorStub.calls.length, 1)
      const loggedText = JSON.stringify(errorStub.calls[0].args)

      assertEquals(loggedText.includes('this is the secret sms body'), false)
      assertEquals(loggedText.includes('+15551234567'), false)
      assertStringIncludes(loggedText, 'vonage')
      assertStringIncludes(loggedText, 'sms')
    } finally {
      errorStub.restore()
    }
  },
)
