import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import {
  DATABASE_TEMPLATES_ENV,
  resetTemplateProviderState,
  TemplateProvider,
  TEMPLATES_MODEL_ENV,
  TEMPLATES_SERVICE_URL_ENV,
} from 'modules/templates/provider.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel } from '@zanix/datamaster'

console.error = () => {}
console.warn = () => {}

/**
 * Minimal, test-only shape covering just the 4 methods `TemplateProvider` actually calls — the
 * real `AdaptedModel<ZanixTemplateAttrs>` (a full Mongoose `Model`) has dozens of unrelated
 * methods a fake has no reason to implement; cast to it at the boundary (`withDatabaseEnabled`)
 * instead of trying to structurally satisfy it here.
 */
interface FakeTemplateModel {
  findOne(
    filter: Partial<ZanixTemplateAttrs>,
  ): { lean(): Promise<(ZanixTemplateAttrs & { _id: string }) | null> }
  find(
    filter: Partial<ZanixTemplateAttrs>,
  ): { lean(): Promise<Array<ZanixTemplateAttrs & { _id: string }>> }
  updateOne(
    filter: { _id: string },
    update: { $set: Partial<ZanixTemplateAttrs> },
  ): Promise<unknown>
  insertMany(docs: ZanixTemplateAttrs[]): Promise<unknown>
}

/** An in-memory stand-in for a `ZanixTemplate` model, matching the `FakeTemplateModel` shape `TemplateProvider` relies on. */
function fakeTemplateModel(seed: ZanixTemplateAttrs[] = []) {
  let docs: Array<ZanixTemplateAttrs & { _id: string }> = seed.map((doc, i) => ({
    ...doc,
    _id: `seed-${i}`,
  }))
  let nextId = docs.length

  function matches(doc: ZanixTemplateAttrs, filter: Partial<ZanixTemplateAttrs>): boolean {
    return Object.entries(filter).every(([key, value]) => (doc as never)[key] === value)
  }

  const model: FakeTemplateModel = {
    findOne: (filter) => ({
      lean: () => Promise.resolve(docs.find((doc) => matches(doc, filter)) ?? null),
    }),
    find: (filter) => ({
      lean: () => Promise.resolve(docs.filter((doc) => matches(doc, filter))),
    }),
    updateOne: ({ _id }, { $set }) => {
      docs = docs.map((doc) => doc._id === _id ? { ...doc, ...$set } : doc)
      return Promise.resolve()
    },
    insertMany: (newDocs) => {
      docs.push(...newDocs.map((doc) => ({ ...doc, _id: `new-${nextId++}` })))
      return Promise.resolve()
    },
  }

  return { model, docs: () => docs }
}

/** Installs a fake `this.database` on a `TemplateProvider` instance, and enables the feature. */
function withDatabaseEnabled(provider: TemplateProvider, model: FakeTemplateModel) {
  Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix_templates_test')
  Object.defineProperty(provider, 'database', {
    configurable: true,
    get: () => ({ getModel: () => model as unknown as AdaptedModel<ZanixTemplateAttrs> }),
  })
}

function withDatabaseDisabled() {
  Deno.env.delete(TEMPLATES_MODEL_ENV)
}

/** Fresh `TemplateProvider` + reset module-level sync/cache state (shared across this file's tests, since Deno isolates per FILE, not per `Deno.test`). */
function freshProvider(): TemplateProvider {
  resetTemplateProviderState()
  return new TemplateProvider()
}

/**
 * `Deno.test` wrapper that always deletes `TEMPLATES_MODEL_ENV` after the test runs (pass or
 * fail). Unlike module-level state, `Deno.env` is real OS-process environment — genuinely shared
 * across every test FILE in the same `deno test` invocation, not just within this one — so a test
 * that sets it without cleanup can leak into an unrelated, concurrently-running file's tests.
 */
function templateTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test(name, async () => {
    try {
      await fn()
    } finally {
      Deno.env.delete(TEMPLATES_MODEL_ENV)
      Deno.env.delete(DATABASE_TEMPLATES_ENV)
      Deno.env.delete(TEMPLATES_SERVICE_URL_ENV)
    }
  })
}

templateTest(
  'TemplateProvider: resolve() uses the in-memory code registry with the feature disabled, no database access at all',
  async () => {
    withDatabaseDisabled()
    const provider = freshProvider()
    // No `this.database` stub installed — if resolve() touched it, this would throw.

    const content = await provider.resolve('email', 'welcome', { buttonText: 'Click here' })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  "TemplateProvider: resolve() falls back to code (with a warning) when the feature is enabled but the database connector isn't actually configured",
  async () => {
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix_templates_test')
    const provider = freshProvider()
    // No `this.database` stub installed at all — mirrors a real app that sets
    // `TEMPLATES_MODEL_NAME` without registering a database connector (e.g. running a functional
    // test, or a genuine misconfiguration): `this.database` throws (`TargetError`,
    // `INVALID_INSTANCE`), and `resolve()` must still succeed via the code fallback rather than
    // failing the whole send.
    const content = await provider.resolve('email', 'welcome', { buttonText: 'Click here' })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider: resolve() falls back to code when DATABASE_TEMPLATES=false, even though TEMPLATES_MODEL_NAME is explicitly set',
  async () => {
    const { model } = fakeTemplateModel([{
      channel: 'sms',
      name: 'invoice-created',
      hbs: 'Invoice #{{invoiceId}} for {{amount}} is ready',
      source: 'database',
      active: true,
      version: 1,
      hash: 'hash-1',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)
    // The kill switch — mirrors `@zanix/datamaster`'s own `DATABASE_SEEDERS === 'false'`
    // convention — must win over an explicitly-set `TEMPLATES_MODEL_NAME`, not just an absent one.
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'false')

    // No `.hbs` of its own for 'invoice-created' in code (see db/manifest.ts), so this can only
    // resolve if the (real, matching) database record is used — proving the kill switch, not a
    // missing-record fallback, is what's forcing the code path here.
    await assertRejects(
      () => provider.resolve('sms', 'invoice-created', { invoiceId: '42', amount: '$10' }),
      Error,
      'Template not found',
    )
  },
)

templateTest(
  'TemplateProvider: resolve() falls back to code when the feature is enabled but no matching database record exists',
  async () => {
    const { model } = fakeTemplateModel()
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    // 'welcome' has no `.hbs` of its own (see db/manifest.ts) — sync seeds 'generic' only, so
    // this genuinely misses in the database and must fall back to the code registry.
    const content = await provider.resolve('email', 'welcome', { buttonText: 'Click here' })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider: resolve() uses a database-only template (source: "database"), applying data as-is',
  async () => {
    const { model } = fakeTemplateModel([{
      channel: 'sms',
      name: 'invoice-created',
      hbs: 'Invoice #{{invoiceId}} for {{amount}} is ready',
      source: 'database',
      active: true,
      version: 1,
      hash: 'hash-1',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('sms', 'invoice-created', {
      invoiceId: '42',
      amount: '$10',
    })

    assertEquals(content, 'Invoice #42 for $10 is ready')
  },
)

templateTest(
  'TemplateProvider: resolve() prefers a database-edited "source: code" record over the compiled code version, reapplying the same schema/styles',
  async () => {
    const { model } = fakeTemplateModel([{
      channel: 'email',
      name: 'generic',
      hbs: '<style>{{{styles.css}}}</style><p>{{content}} - {{title}}</p>',
      lastSyncedHbs: 'DIFFERENT — simulates an edit since the last sync',
      source: 'code',
      active: true,
      version: 2,
      hash: 'edited-hash',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'generic', {
      title: 'Hello',
      content: 'World',
    })

    assertStringIncludes(content, '<p>World - Hello</p>')
    // The compiled template's own styles.css injection still applies to the DB-edited hbs.
    assertStringIncludes(content, '.container')
  },
)

templateTest(
  'TemplateProvider: resolve() falls back to code and warns when the database record has invalid Handlebars',
  async () => {
    const { model } = fakeTemplateModel([{
      channel: 'email',
      name: 'welcome',
      hbs: '{{#if broken',
      source: 'database',
      active: true,
      version: 1,
      hash: 'broken-hash',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'welcome', { buttonText: 'Click here' })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest('TemplateProvider: resolve() throws when the template exists nowhere', async () => {
  const { model } = fakeTemplateModel()
  const provider = freshProvider()
  withDatabaseEnabled(provider, model)

  await assertRejects(
    () => provider.resolve('email', 'does-not-exist', {}),
    Error,
    'Template not found',
  )
})

templateTest(
  'TemplateProvider: resolve() caches the compiled render and only recompiles when the hash changes',
  async () => {
    const { model, docs } = fakeTemplateModel([{
      channel: 'whatsapp',
      name: 'invoice-created',
      hbs: 'v1: {{value}}',
      source: 'database',
      active: true,
      version: 1,
      hash: 'hash-a',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    assertEquals(await provider.resolve('whatsapp', 'invoice-created', { value: 'x' }), 'v1: x')

    // Mutate the stored hbs WITHOUT changing the hash — resolve() must still use the cached
    // compile (stale content is expected here; this is exactly what `hash` exists to detect).
    docs()[0].hbs = 'v2: {{value}}'
    assertEquals(await provider.resolve('whatsapp', 'invoice-created', { value: 'x' }), 'v1: x')

    // Now bump the hash too — the cache must invalidate and recompile against the new content.
    docs()[0].hash = 'hash-b'
    assertEquals(await provider.resolve('whatsapp', 'invoice-created', { value: 'x' }), 'v2: x')
  },
)

templateTest(
  'TemplateProvider: a code template removed from the manifest survives sync as database-only',
  async () => {
    const { model, docs } = fakeTemplateModel([{
      channel: 'sms',
      name: 'no-longer-in-code',
      hbs: 'still renders: {{value}}',
      lastSyncedHbs: 'still renders: {{value}}',
      source: 'code',
      active: true,
      version: 1,
      hash: 'hash-x',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('sms', 'no-longer-in-code', { value: 'y' })

    assertEquals(content, 'still renders: y')
    assertEquals(docs().find((doc) => doc.name === 'no-longer-in-code')?.source, 'database')
  },
)

templateTest(
  'TemplateProvider: resolve() throws synchronously, uncaught, when TEMPLATES_SERVICE_URL and TEMPLATES_MODEL_NAME are both set',
  async () => {
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix_templates_test')
    Deno.env.set(TEMPLATES_SERVICE_URL_ENV, 'https://templates.internal.example')
    const provider = freshProvider()
    // No `this.database` stub and no fake fetch installed — if this were caught and fell back
    // to the warn-and-fallback path instead of rethrowing, one of those would have to run.

    await assertRejects(
      () => provider.resolve('email', 'welcome', { buttonText: 'Click here' }),
      Error,
      'mutually exclusive',
    )
  },
)
