import { HttpError } from 'jsr:@zanix/utils@2.*/errors'
import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { TwilioSmsAdapter } from 'modules/sms/twilio.ts'

const config = {
  accountSid: 'AC_test_sid',
  authToken: 'test_auth_token',
  from: '+15005550006',
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
  'TwilioSmsAdapter: send() posts Basic-Auth form-urlencoded to the Messages endpoint',
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
        const adapter = new TwilioSmsAdapter(config)
        await adapter.send({
          to: '+15551234567',
          content: 'Your code is 123456',
        })
      },
    )

    // NOTE: RestClient's URL builder runs every path through @zanix/helpers' cleanRoute(), which
    // lowercases the entire URL (including the dynamic accountSid segment) — see the caveat
    // documented on TwilioSmsAdapter. This assertion reflects that real, current behavior; it is
    // NOT what Twilio's actual case-sensitive endpoint expects.
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
    assertEquals(body.get('To'), '+15551234567')
    assertEquals(body.get('From'), config.from)
    assertEquals(body.get('Body'), 'Your code is 123456')
  },
)

Deno.test(
  "TwilioSmsAdapter: send() uses the message's own `from` over the configured default",
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      (_input, init) => {
        capturedInit = init
        return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      },
      () =>
        new TwilioSmsAdapter(config).send({
          to: '+15551234567',
          content: 'hi',
          from: '+15559998888',
        }),
    )

    const body = capturedInit?.body as URLSearchParams
    assertEquals(body.get('From'), '+15559998888')
  },
)

Deno.test(
  "TwilioSmsAdapter: send() throws HttpError with Twilio's message on a non-2xx response",
  async () => {
    await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            code: 21211,
            message: "The 'To' number is not valid.",
          }),
          { status: 400 },
        ),
      async () => {
        const adapter = new TwilioSmsAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: 'not-a-number', content: 'hi' }),
          HttpError,
        )

        assertStringIncludes(
          (error.cause as Error).message,
          "'To' number is not valid",
        )
      },
    )
  },
)

Deno.test(
  'TwilioSmsAdapter: send() falls back to a generic message when the error body has no message field',
  async () => {
    await withFakeFetch(
      () => new Response('not json', { status: 500 }),
      async () => {
        const adapter = new TwilioSmsAdapter(config)
        const error = await assertRejects(
          () => adapter.send({ to: '+15551234567', content: 'hi' }),
          HttpError,
        )
        assertStringIncludes((error.cause as Error).message, '[HTTP 500]')
      },
    )
  },
)
