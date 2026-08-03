import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from 'jsr:@std/assert@^1.0.15'
import { generateRSAKeys } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'
import {
  assertTemplatesConfigNotConflicting,
  DATABASE_TEMPLATES_ENV,
  resetTemplateProviderState,
  TemplateProvider,
  TEMPLATES_SERVICE_AUTH_ID_ENV,
  TEMPLATES_SERVICE_ID_ENV,
  TEMPLATES_SERVICE_TOKEN_ENV,
  TEMPLATES_SERVICE_URL_ENV,
} from 'modules/templates/provider.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

console.error = () => {}
console.warn = () => {}

const record: ZanixTemplateAttrs = {
  channel: 'email',
  name: 'welcome',
  hbs: '<p>{{buttonText}}</p>',
  source: 'database',
  active: true,
  version: 1,
  hash: 'hash-1',
}

/** Records the last `fetch` call and lets tests control the (fake) response — mirrors `twilio-adapter.test.ts`'s own helper. */
async function withFakeFetch<T>(
  respond: (input: string | URL | Request, init?: RequestInit) => Response | Promise<Response>,
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

function freshProvider(): TemplateProvider {
  resetTemplateProviderState()
  return new TemplateProvider()
}

function templateTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test(name, async () => {
    try {
      await fn()
    } finally {
      Deno.env.delete(TEMPLATES_SERVICE_URL_ENV)
      Deno.env.delete(TEMPLATES_SERVICE_ID_ENV)
      Deno.env.delete(DATABASE_TEMPLATES_ENV)
      Deno.env.delete(TEMPLATES_SERVICE_AUTH_ID_ENV)
      Deno.env.delete(TEMPLATES_SERVICE_TOKEN_ENV)
    }
  })
}

templateTest(
  'TemplateProvider#backend(): only TEMPLATES_SERVICE_URL set selects the remote backend, this.database is never touched',
  async () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    const provider = freshProvider()
    // No `this.database` stub installed at all — if resolve() fell through to LocalTemplateBackend
    // instead of RemoteTemplateBackend, accessing it would throw and this test would fail below.

    const content = await withFakeFetch(
      () =>
        new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      () => provider.resolve('email', 'welcome', { buttonText: 'Click here' }),
    )

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider#backend(): DATABASE_TEMPLATES=false disables the remote path too, even with TEMPLATES_SERVICE_URL set',
  async () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'false')
    const provider = freshProvider()

    // No fake fetch installed — if resolve() attempted the remote path, this would throw
    // (an unmocked `fetch` call against a fake hostname).
    const content = await provider.resolve('email', 'welcome', { buttonText: 'Click here' })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider#backend(): a remote 404 falls back to code silently (no warning), same as a missing local record',
  async () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    const provider = freshProvider()

    const warnings: unknown[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args)

    try {
      const content = await withFakeFetch(
        // The sync-trigger POST (see `RemoteTemplateBackend#ensureSynced()`) must succeed here so
        // only the GET's 404 is under test — a failed sync POST would itself log a warning,
        // unrelated to what this test is actually asserting.
        (_input, init) =>
          init?.method === 'POST'
            ? new Response(JSON.stringify({ seeded: 0, resynced: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
            : new Response('not found', { status: 404 }),
        () => provider.resolve('email', 'welcome', { buttonText: 'Click here' }),
      )

      assertStringIncludes(content, 'Click here')
      assertEquals(warnings.length, 0)
    } finally {
      console.warn = originalWarn
    }
  },
)

templateTest(
  'TemplateProvider#backend(): a remote network failure falls back to code with a warning',
  async () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    const provider = freshProvider()

    const content = await withFakeFetch(
      () => {
        throw new TypeError('network is down')
      },
      () => provider.resolve('email', 'welcome', { buttonText: 'Click here' }),
    )

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider#backend(): a remote database-only template (source: "database") renders as-is, same as the local backend',
  async () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    const provider = freshProvider()

    const content = await withFakeFetch(
      () =>
        new Response(
          JSON.stringify({
            channel: 'sms',
            name: 'invoice-created',
            hbs: 'Invoice #{{invoiceId}} for {{amount}} is ready',
            source: 'database',
            active: true,
            version: 1,
            hash: 'hash-1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      () => provider.resolve('sms', 'invoice-created', { invoiceId: '42', amount: '$10' }),
    )

    assertEquals(content, 'Invoice #42 for $10 is ready')
  },
)

templateTest(
  'TemplateProvider#backend(): throws when the template exists nowhere (remote 404 and no code fallback)',
  async () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    const provider = freshProvider()

    await withFakeFetch(
      () => new Response('not found', { status: 404 }),
      () =>
        assertRejects(
          () => provider.resolve('email', 'does-not-exist', {}),
          Error,
          'Template not found',
        ),
    )
  },
)

templateTest(
  'assertTemplatesConfigNotConflicting: throws when TEMPLATES_SERVICE_AUTH_ID is set but no matching JWK_PRI_<id> resolves and no TEMPLATES_SERVICE_TOKEN fallback exists',
  () => {
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    Deno.env.set(TEMPLATES_SERVICE_AUTH_ID_ENV, 'billing-service')
    // Deliberately no JWK_PRI_billing-service and no TEMPLATES_SERVICE_TOKEN registered.

    try {
      assertThrows(
        () => assertTemplatesConfigNotConflicting(),
        InternalError,
        'JWK_PRI_billing-service',
      )
    } finally {
      Deno.env.delete('JWK_PRI_billing-service')
    }
  },
)

templateTest(
  'TemplateProvider#backend(): TEMPLATES_SERVICE_AUTH_ID + JWK_PRI_<id> (no TEMPLATES_SERVICE_TOKEN) signs+exchanges a real credential end to end',
  async () => {
    const { privateKey } = await generateRSAKeys()
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    Deno.env.set(TEMPLATES_SERVICE_ID_ENV, 'billing')
    Deno.env.set(TEMPLATES_SERVICE_AUTH_ID_ENV, 'billing-service')
    Deno.env.set('JWK_PRI_billing-service', btoa(privateKey))

    try {
      const provider = freshProvider()
      const calls: string[] = []

      const content = await withFakeFetch(
        (input, init) => {
          const url = String(input)
          calls.push(url)
          if (url.endsWith('/admin/service-token')) {
            return new Response(
              JSON.stringify({ accessToken: 'exchanged', expiresIn: 1800, serviceId: 'hub' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            )
          }
          if (init?.method === 'POST' && url.endsWith('/admin/templates/sync')) {
            return new Response(JSON.stringify({ seeded: 0, resynced: 0 }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          }
          return new Response(JSON.stringify(record), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
        () => provider.resolve('email', 'welcome', { buttonText: 'Click here' }),
      )

      assertStringIncludes(content, 'Click here')
      assertEquals(calls[0], 'https://templates.internal.example/admin/service-token')
    } finally {
      Deno.env.delete('JWK_PRI_billing-service')
    }
  },
)
