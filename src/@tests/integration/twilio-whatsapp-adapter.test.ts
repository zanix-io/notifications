import { HttpError } from 'jsr:@zanix/utils@2.*/errors'
import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { TwilioWhatsappAdapter } from 'modules/whatsapp/twilio.ts'

const config = {
  accountSid: 'AC_test_sid',
  authToken: 'test_auth_token',
  from: '+14155238886',
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
  'TwilioWhatsappAdapter: send() posts Basic-Auth form-urlencoded to the Messages endpoint with whatsapp: prefixes',
  async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(
          JSON.stringify({ sid: 'SM123', status: 'queued' }),
          { status: 201 },
        )
      },
      async () => {
        const adapter = new TwilioWhatsappAdapter(config)
        await adapter.send({
          to: '+15551234567',
          content: 'Your code is 123456',
        })
      },
    )

    assertEquals(
      capturedUrl,
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    )
    assertEquals(capturedInit?.method, 'POST')

    const headers = capturedInit?.headers as Record<string, string>
    assertEquals(
      headers['Authorization'],
      `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
    )
    assertEquals(headers['Content-Type'], 'application/x-www-form-urlencoded')

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('To'), 'whatsapp:+15551234567')
    assertEquals(body.get('From'), `whatsapp:${config.from}`)
    assertEquals(body.get('Body'), 'Your code is 123456')
  },
)

Deno.test(
  'TwilioWhatsappAdapter: send() posts ContentSid/ContentVariables when contentSid is set',
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(
          JSON.stringify({ sid: 'SM123', status: 'queued' }),
          { status: 201 },
        )
      },
      () =>
        new TwilioWhatsappAdapter(config).send({
          to: '+15551234567',
          contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
          contentVariables: { '1': '409173' },
        }),
    )

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('To'), 'whatsapp:+15551234567')
    assertEquals(body.get('From'), `whatsapp:${config.from}`)
    assertEquals(body.get('ContentSid'), 'HX229f5a04fd0510ce1b071852155d3e75')
    assertEquals(
      body.get('ContentVariables'),
      JSON.stringify({ '1': '409173' }),
    )
    assertEquals(body.get('Body'), null)
  },
)

Deno.test(
  'TwilioWhatsappAdapter: send() omits ContentVariables when contentSid has no variables',
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      },
      () =>
        new TwilioWhatsappAdapter(config).send({
          to: '+15551234567',
          contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
        }),
    )

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('ContentSid'), 'HX229f5a04fd0510ce1b071852155d3e75')
    assertEquals(body.has('ContentVariables'), false)
  },
)

Deno.test(
  'TwilioWhatsappAdapter: send() defaults Body to an empty string when neither content nor contentSid is set',
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(
          JSON.stringify({ sid: 'SM123', status: 'queued' }),
          { status: 201 },
        )
      },
      () => new TwilioWhatsappAdapter(config).send({ to: '+15551234567' }),
    )

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('Body'), '')
  },
)

Deno.test(
  'TwilioWhatsappAdapter: send() throws (without calling Twilio) when templateName is set',
  async () => {
    let fetchCalled = false

    await withFakeFetch(
      () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      },
      async () => {
        const adapter = new TwilioWhatsappAdapter(config)
        await assertRejects(
          () =>
            adapter.send({
              to: '+15551234567',
              templateName: 'otp_code',
              templateLanguage: 'en_US',
            }),
          Error,
          'does not support message.templateName',
        )
      },
    )

    assertEquals(fetchCalled, false)
  },
)

Deno.test(
  "TwilioWhatsappAdapter: send() throws HttpError with Twilio's message on a non-2xx response",
  async () => {
    await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 63016,
            message: 'Failed to send freeform message',
          }),
          { status: 400 },
        ),
      async () => {
        const adapter = new TwilioWhatsappAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: '+15551234567', content: 'hi' }),
          HttpError,
        )

        assertStringIncludes(
          (error.cause as Error).message,
          'Failed to send freeform message',
        )
      },
    )
  },
)
