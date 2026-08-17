import { HttpError } from 'jsr:@zanix/utils@2.*/errors'
import { assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.15'
import { FakeTime } from '@std/testing/time'
import { generateRSAKeys } from '@zanix/helpers'
import {
  RemoteTemplateBackend,
  resetRemoteTemplateBackendAuthClient,
  resetRemoteTemplateBackendCache,
  resetRemoteTemplateBackendSyncState,
} from 'modules/templates/db/remote-backend.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

console.error = () => {}
console.warn = () => {}

const record: ZanixTemplateAttrs = {
  channel: 'email',
  name: 'welcome',
  hbs: '<p>{{content}}</p>',
  source: 'database',
  active: true,
  version: 1,
  hash: 'hash-1',
}

/** Records the last `fetch` call and lets tests control the (fake) response — mirrors `twilio-adapter.test.ts`'s own helper. */
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

/**
 * Every `resolve()` call now also triggers the once-per-process `POST admin/templates/sync`
 * (see `db/remote-backend.ts`'s `#ensureSynced()`) before doing its own `GET`. Tests below that
 * were written before that existed assert on the *last* fetch call and/or count fetch calls
 * precisely — wrapping `respond` with this auto-responds to the sync POST transparently (without
 * touching the wrapped test's own counters/captured values), so those assertions keep meaning
 * exactly what they did before. The dedicated sync-trigger tests further down don't use this.
 */
function autoSync(
  respond: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): (
  input: string | URL | Request,
  init?: RequestInit,
) => Response | Promise<Response> {
  return (input, init) => {
    if (
      init?.method === 'POST' && String(input).endsWith('/admin/templates/sync')
    ) {
      return new Response(JSON.stringify({ seeded: 0, resynced: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return respond(input, init)
  }
}

function freshBackend(cacheTtlMs?: number): RemoteTemplateBackend {
  resetRemoteTemplateBackendCache()
  resetRemoteTemplateBackendSyncState()
  return new RemoteTemplateBackend({
    url: 'https://templates.internal.example',
    serviceId: 'billing',
    token: 'service-token',
    cacheTtlMs,
  })
}

Deno.test(
  'RemoteTemplateBackend: resolve() GETs admin/templates/:channel/:name with the machine-credential headers',
  async () => {
    let capturedUrl: string | undefined
    let capturedInit: RequestInit | undefined

    const result = await withFakeFetch(
      autoSync((input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      () => freshBackend().resolve('email', 'welcome'),
    )

    assertEquals(
      capturedUrl,
      'https://templates.internal.example/admin/templates/email/welcome',
    )
    assertEquals(capturedInit?.method, 'GET')

    const headers = capturedInit?.headers as Record<string, string>
    assertEquals(headers['X-Znx-Authorization'], 'Bearer service-token')
    assertEquals(headers['X-Znx-Admin-Protocol'], '1')

    assertEquals(result, record)
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() resolves to undefined (no throw) on a 404, mirroring a missing local record',
  async () => {
    let fetchCalls = 0

    await withFakeFetch(
      autoSync(() => {
        fetchCalls++
        return new Response('not found', { status: 404 })
      }),
      async () => {
        const backend = freshBackend()
        const result = await backend.resolve('email', 'does-not-exist')
        assertEquals(result, undefined)
      },
    )

    assertEquals(fetchCalls, 1)
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() rethrows HttpError on a non-404 failure response',
  async () => {
    await withFakeFetch(
      autoSync(() => new Response('server exploded', { status: 500 })),
      async () => {
        const backend = freshBackend()
        await assertRejects(
          () => backend.resolve('email', 'welcome'),
          HttpError,
        )
      },
    )
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() rethrows on a network error',
  async () => {
    await withFakeFetch(
      autoSync(() => {
        throw new TypeError('network is down')
      }),
      async () => {
        const backend = freshBackend()
        await assertRejects(() => backend.resolve('email', 'welcome'))
      },
    )
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() serves a cache hit within the TTL window without refetching',
  async () => {
    let fetchCalls = 0

    await withFakeFetch(
      autoSync(() => {
        fetchCalls++
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      async () => {
        const backend = freshBackend(60_000)
        await backend.resolve('email', 'welcome')
        await backend.resolve('email', 'welcome')
      },
    )

    assertEquals(fetchCalls, 1)
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() refetches once the TTL cache entry expires',
  async () => {
    using time = new FakeTime()
    let fetchCalls = 0

    await withFakeFetch(
      autoSync(() => {
        fetchCalls++
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      async () => {
        const backend = freshBackend(1_000)
        await backend.resolve('email', 'welcome')
        time.tick(1_001)
        await backend.resolve('email', 'welcome')
      },
    )

    assertEquals(fetchCalls, 2)
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() caches a 404 for the TTL window too, not just a success',
  async () => {
    let fetchCalls = 0

    await withFakeFetch(
      autoSync(() => {
        fetchCalls++
        return new Response('not found', { status: 404 })
      }),
      async () => {
        const backend = freshBackend(60_000)
        await backend.resolve('email', 'does-not-exist')
        await backend.resolve('email', 'does-not-exist')
      },
    )

    assertEquals(fetchCalls, 1)
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() never caches a thrown error — the next call retries immediately',
  async () => {
    let fetchCalls = 0

    await withFakeFetch(
      autoSync(() => {
        fetchCalls++
        return new Response('server exploded', { status: 500 })
      }),
      async () => {
        const backend = freshBackend(60_000)
        await assertRejects(() => backend.resolve('email', 'welcome'))
        await assertRejects(() => backend.resolve('email', 'welcome'))
      },
    )

    assertEquals(fetchCalls, 2)
  },
)

// --- sync trigger --------------------------------------------------------------------------

Deno.test(
  'RemoteTemplateBackend: resolve() triggers a POST admin/templates/sync with its serviceId, exactly once per process',
  async () => {
    const postCalls: unknown[] = []
    let getCalls = 0

    await withFakeFetch(
      (_, init) => {
        if (init?.method === 'POST') {
          postCalls.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ seeded: 3, resynced: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        getCalls++
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      async () => {
        const backend = freshBackend()
        await backend.resolve('email', 'welcome')
        await backend.resolve('sms', 'welcome')
        await backend.resolve('whatsapp', 'welcome')
      },
    )

    assertEquals(postCalls.length, 1)
    assertEquals(getCalls, 3)
    assertEquals(postCalls[0], { serviceId: 'billing' })
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() still resolves when the sync POST itself fails',
  async () => {
    await withFakeFetch(
      (_$, init) => {
        if (init?.method === 'POST') {
          return new Response('server exploded', { status: 500 })
        }
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      async () => {
        const backend = freshBackend()
        const result = await backend.resolve('email', 'welcome')
        assertEquals(result, record)
      },
    )
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() does not retry the sync POST on a later call after it failed once',
  async () => {
    let postCalls = 0

    await withFakeFetch(
      (_, init) => {
        if (init?.method === 'POST') {
          postCalls++
          return new Response('server exploded', { status: 500 })
        }
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
      async () => {
        const backend = freshBackend()
        await backend.resolve('email', 'welcome')
        await backend.resolve('email', 'welcome')
      },
    )

    assertEquals(postCalls, 1)
  },
)

Deno.test(
  'RemoteTemplateBackend: resolve() rethrows a raw (non-HttpError) error thrown before the request is even sent',
  async () => {
    resetRemoteTemplateBackendCache()
    resetRemoteTemplateBackendSyncState()

    // `RestClient#http()` only wraps errors thrown *inside* its own fetch try/catch into
    // `HttpError` — a `Headers` value with a newline in it makes the underlying `new Headers(...)`
    // throw synchronously *before* that block (see `identityKey()` in `@zanix/server`'s
    // `rest.ts`), so `resolve()`'s catch receives the raw `TypeError` unwrapped. This is exactly
    // the case `realHttpStatus()`'s `!(error instanceof HttpError)` branch exists for: `fetch` is
    // never even reached, so no fake response is needed here.
    const backend = new RemoteTemplateBackend({
      url: 'https://templates.internal.example',
      serviceId: 'billing',
      token: 'bad\ntoken',
    })

    await assertRejects(() => backend.resolve('email', 'welcome'), TypeError)
  },
)

Deno.test(
  'RemoteTemplateBackend: sends no X-Znx-Authorization header at all when neither token nor auth is configured',
  async () => {
    let capturedInit: RequestInit | undefined

    await withFakeFetch(
      autoSync((_input, init) => {
        capturedInit = init
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
      () => {
        resetRemoteTemplateBackendCache()
        resetRemoteTemplateBackendSyncState()
        resetRemoteTemplateBackendAuthClient()
        const backend = new RemoteTemplateBackend({
          url: 'https://templates.internal.example',
          serviceId: 'billing',
        })
        return backend.resolve('email', 'welcome')
      },
    )

    const headers = capturedInit?.headers as Record<string, string>
    assertEquals(headers['X-Znx-Authorization'], undefined)
  },
)

Deno.test(
  'RemoteTemplateBackend: auth mode signs+exchanges a credential and sends it as X-Znx-Authorization, on both the sync POST and the resolve GET',
  async () => {
    const { privateKey } = await generateRSAKeys()
    const calls: string[] = []
    const headersSent: (string | null)[] = []

    await withFakeFetch(
      (input, init) => {
        const url = String(input)
        calls.push(url)
        headersSent.push(
          (init?.headers as Record<string, string> | undefined)?.[
            'X-Znx-Authorization'
          ] ?? null,
        )

        if (url.endsWith('/admin/service-token')) {
          return new Response(
            JSON.stringify({
              accessToken: 'exchanged-token',
              expiresIn: 1800,
              serviceId: 'hub',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.endsWith('/admin/templates/sync')) {
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
      () => {
        resetRemoteTemplateBackendCache()
        resetRemoteTemplateBackendSyncState()
        resetRemoteTemplateBackendAuthClient()
        const backend = new RemoteTemplateBackend({
          url: 'https://templates.internal.example',
          serviceId: 'billing',
          auth: { serviceId: 'billing-service', privateKey: btoa(privateKey) },
        })
        return backend.resolve('email', 'welcome')
      },
    )

    assertEquals(
      calls,
      [
        'https://templates.internal.example/admin/service-token',
        'https://templates.internal.example/admin/templates/sync',
        'https://templates.internal.example/admin/templates/email/welcome',
      ],
    )
    // The sync POST and the resolve GET both carry the exchanged token — only the exchange
    // call itself (first) has none, since it's what obtains the token in the first place.
    assertEquals(headersSent, [
      null,
      'Bearer exchanged-token',
      'Bearer exchanged-token',
    ])
  },
)

Deno.test(
  'RemoteTemplateBackend: a static token takes priority over auth — auth is never even attempted when both are set',
  async () => {
    const { privateKey } = await generateRSAKeys()
    let exchangeCalled = false

    await withFakeFetch(
      autoSync((input, init) => {
        if (String(input).endsWith('/admin/service-token')) {
          exchangeCalled = true
        }
        return new Response(JSON.stringify(record), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Sent-Auth': (init?.headers as Record<string, string> | undefined)?.[
              'X-Znx-Authorization'
            ] ?? '',
          },
        })
      }),
      async () => {
        resetRemoteTemplateBackendCache()
        resetRemoteTemplateBackendSyncState()
        resetRemoteTemplateBackendAuthClient()
        const backend = new RemoteTemplateBackend({
          url: 'https://templates.internal.example',
          serviceId: 'billing',
          token: 'static-token',
          auth: { serviceId: 'billing-service', privateKey: btoa(privateKey) },
        })
        return await backend.resolve('email', 'welcome')
      },
    )

    assertEquals(exchangeCalled, false)
  },
)

Deno.test(
  'RemoteTemplateBackend: preload() is a no-op — resolves to undefined without ever calling fetch',
  async () => {
    let fetchCalls = 0

    const result = await withFakeFetch(
      () => {
        fetchCalls++
        throw new Error('fetch should never be called by preload()')
      },
      () => {
        resetRemoteTemplateBackendCache()
        resetRemoteTemplateBackendSyncState()
        const backend = new RemoteTemplateBackend({
          url: 'https://templates.internal.example',
          serviceId: 'billing',
        })
        return backend.preload('email', 'welcome')
      },
    )

    assertEquals(result, undefined)
    assertEquals(fetchCalls, 0)
  },
)
