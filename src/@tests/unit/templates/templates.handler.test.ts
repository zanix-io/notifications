// deno-lint-ignore-file no-explicit-any
import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import type { GuardContext, HandlerContext } from '@zanix/server'
import {
  combineGuards,
  createTemplatesController,
} from 'modules/templates/templates-api/templates.handler.ts'

const TemplatesController = createTemplatesController()

function fakeThis(interactor: Record<string, any>) {
  const instance = new TemplatesController({ id: 'test-ctx' } as never)
  Object.defineProperty(instance, 'interactor', { value: interactor })
  return instance
}

const handler = TemplatesController.prototype

Deno.test('TemplatesController.list forwards to interactor.list()', () => {
  const calls: unknown[][] = []
  const result: unknown = handler.list.call(
    fakeThis({
      list: (...args: unknown[]) => (calls.push(args), 'list-result'),
    }),
  )
  assertEquals(result, 'list-result')
  assertEquals(calls, [[]])
})

Deno.test('TemplatesController.get forwards channel/name, spreads the result', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' } },
  } as HandlerContext<
    never
  >
  const result: unknown = await handler.get.call(
    fakeThis({
      get: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ name: 'welcome' })),
    }),
    ctx,
  )
  assertEquals(result, { name: 'welcome' })
  assertEquals(calls, [['email', 'welcome']])
})

Deno.test('TemplatesController.create forwards body + session id to create()', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' } },
    session: { id: 'admin-1' },
  } as HandlerContext<never>
  const result: unknown = await handler.create.call(
    fakeThis({
      create: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ name: 'invoice' })),
    }),
    ctx,
  )
  assertEquals(result, { name: 'invoice' })
  assertEquals(calls, [[
    { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' },
    'admin-1',
  ]])
})

Deno.test("TemplatesController.create falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' } },
  } as HandlerContext<never>
  await handler.create.call(
    fakeThis({
      create: (...args: unknown[]) => (calls.push(args), Promise.resolve({})),
    }),
    ctx,
  )
  assertEquals(calls[0][1], 'unknown')
})

Deno.test('TemplatesController.update forwards fields to update()', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: {
      params: { channel: 'email', name: 'welcome' },
      body: { hbs: '<p>new</p>' },
    },
    session: { id: 'admin-2' },
  } as HandlerContext<never>
  const result: unknown = await handler.update.call(
    fakeThis({
      update: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ version: 2 })),
    }),
    ctx,
  )
  assertEquals(result, { version: 2 })
  assertEquals(calls, [['email', 'welcome', { hbs: '<p>new</p>' }, 'admin-2']])
})

Deno.test("TemplatesController.update falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: {
      params: { channel: 'email', name: 'welcome' },
      body: { hbs: '<p>new</p>' },
    },
  } as HandlerContext<never>
  await handler.update.call(
    fakeThis({
      update: (...args: unknown[]) => (calls.push(args), Promise.resolve({})),
    }),
    ctx,
  )
  assertEquals(calls[0][3], 'unknown')
})

Deno.test('TemplatesController.remove forwards fields, reports deactivated', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' } },
    session: { id: 'admin-3' },
  } as HandlerContext<never>
  const result = await handler.remove.call(
    fakeThis({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    }),
    ctx,
  )
  assertEquals(result, { deactivated: 'welcome' })
  assertEquals(calls, [['email', 'welcome', 'admin-3']])
})

Deno.test("TemplatesController.remove falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' } },
  } as HandlerContext<
    never
  >
  await handler.remove.call(
    fakeThis({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    }),
    ctx,
  )
  assertEquals(calls[0][2], 'unknown')
})

Deno.test('TemplatesController: with no guards passed, every route allows the call through', () => {
  // The "no guard, not a fake one" default (see the factory's own doc) — this package never
  // assumes an auth mechanism. Verified here structurally; a real composer (e.g. @zanix/admin) is
  // expected to always pass real guards in production.
  const result: unknown = handler.list.call(fakeThis({ list: () => 'ok' }))
  assertEquals(result, 'ok')
})

/**
 * `combineGuards()` itself — `@Guard(guard)` is pure route metadata (never baked into a handler's
 * own method body, see `@zanix/server`'s own `Guard` decorator doc), so calling the raw prototype
 * method directly (as every test above does) never actually runs this function with more than the
 * empty-list default. These call it directly instead — the real combine/short-circuit/ordering
 * logic `createTemplatesController({ guards })` builds from `TemplatesControllerOptions.guards`.
 */
const fakeGuardContext = {} as GuardContext

Deno.test('combineGuards: an empty/omitted list always allows (returns {})', async () => {
  const guard = combineGuards(undefined)
  assertEquals(await guard(fakeGuardContext), {})

  const guardFromEmpty = combineGuards([])
  assertEquals(await guardFromEmpty(fakeGuardContext), {})
})

Deno.test(
  'combineGuards: a denying guard short-circuits — a later guard in the list never runs',
  async () => {
    const denyResponse = new Response('denied', { status: 403 })
    let secondGuardCalled = false

    const guard = combineGuards([
      () => ({ response: denyResponse }),
      () => {
        secondGuardCalled = true
        return {}
      },
    ])

    const result = await guard(fakeGuardContext)

    assertEquals(result.response, denyResponse)
    assertEquals(secondGuardCalled, false)
  },
)

Deno.test(
  'combineGuards: guards run in declaration order — an allowing first guard lets a later denying guard still run and decide',
  async () => {
    const denyResponse = new Response('denied', { status: 403 })
    const callOrder: string[] = []

    const guard = combineGuards([
      () => (callOrder.push('first'), {}),
      () => (callOrder.push('second'), { response: denyResponse }),
    ])

    const result = await guard(fakeGuardContext)

    assertEquals(callOrder, ['first', 'second'])
    assertEquals(result.response, denyResponse)
  },
)

Deno.test(
  'combineGuards: every guard allowing resolves to an empty (no response) result',
  async () => {
    const guard = combineGuards([() => ({}), () => ({})])
    assertEquals(await guard(fakeGuardContext), {})
  },
)
