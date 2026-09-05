import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from 'jsr:@std/assert@^1.0.15'
import { ApplicationError, InternalError } from '@zanix/errors'
import {
  assertTemplatesBackendConfigValid,
  isTemplatesResourceEnabled,
  resetTemplateProviderState,
  TemplateProvider,
  TEMPLATES_BACKEND_ENV,
  TEMPLATES_MODEL_ENV,
  TEMPLATES_SERVICE_ID_ENV,
  TEMPLATES_SERVICE_URL_ENV,
  templatesBackendMode,
  templatesModelName,
} from 'modules/templates/provider.ts'
import { resetPreloadedDBTemplates } from 'modules/templates/db/manifest.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel } from '@zanix/database'

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
    filter: { _id: string } | Pick<ZanixTemplateAttrs, 'channel' | 'name'>,
    update: {
      $set?: Partial<ZanixTemplateAttrs>
      $setOnInsert?: ZanixTemplateAttrs
    },
    options?: { upsert?: boolean },
  ): Promise<{ upsertedCount: number }>
  insertMany(docs: ZanixTemplateAttrs[]): Promise<unknown>
}

/** An in-memory stand-in for a `ZanixTemplate` model, matching the `FakeTemplateModel` shape `TemplateProvider` relies on. */
function fakeTemplateModel(seed: ZanixTemplateAttrs[] = []) {
  let docs: Array<ZanixTemplateAttrs & { _id: string }> = seed.map((
    doc,
    i,
  ) => ({
    ...doc,
    _id: `seed-${i}`,
  }))
  let nextId = docs.length

  function matches(
    doc: ZanixTemplateAttrs,
    filter: Partial<ZanixTemplateAttrs>,
  ): boolean {
    return Object.entries(filter).every(([key, value]) => (doc as never)[key] === value)
  }

  const model: FakeTemplateModel = {
    findOne: (filter) => ({
      lean: () => Promise.resolve(docs.find((doc) => matches(doc, filter)) ?? null),
    }),
    find: (filter) => ({
      lean: () => Promise.resolve(docs.filter((doc) => matches(doc, filter))),
    }),
    updateOne: (filter, update, options) => {
      if ('_id' in filter) {
        docs = docs.map((doc) => doc._id === filter._id ? { ...doc, ...update.$set } : doc)
        return Promise.resolve({ upsertedCount: 0 })
      }
      const existing = docs.find((doc) => matches(doc, filter))
      if (existing || !options?.upsert) {
        return Promise.resolve({ upsertedCount: 0 })
      }
      docs.push(
        { ...filter, ...update.$setOnInsert, _id: `new-${nextId++}` } as
          & ZanixTemplateAttrs
          & {
            _id: string
          },
      )
      return Promise.resolve({ upsertedCount: 1 })
    },
    insertMany: (newDocs) => {
      docs.push(...newDocs.map((doc) => ({ ...doc, _id: `new-${nextId++}` })))
      return Promise.resolve()
    },
  }

  return { model, docs: () => docs }
}

/** Wraps `model.findOne` to count invocations, without changing its behavior. */
function countFindOne(model: FakeTemplateModel): () => number {
  let count = 0
  const original = model.findOne.bind(model)
  model.findOne = ((filter) => {
    count++
    return original(filter)
  }) as FakeTemplateModel['findOne']
  return () => count
}

/** Installs a fake `this.database` on a `TemplateProvider` instance, and selects Mode A/B (`TEMPLATES_BACKEND=local`). */
function withDatabaseEnabled(
  provider: TemplateProvider,
  model: FakeTemplateModel,
) {
  Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
  Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix_templates_test')
  Object.defineProperty(provider, 'database', {
    configurable: true,
    get: () => ({
      getModel: () => model as unknown as AdaptedModel<ZanixTemplateAttrs>,
    }),
  })
}

/** Clears `TEMPLATES_BACKEND` — the pure code-registry path, `TEMPLATES_MODEL_NAME` left set or not makes no difference once it's never read (see `templatesBackendMode()`'s own doc). */
function withDatabaseDisabled() {
  Deno.env.delete(TEMPLATES_BACKEND_ENV)
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
      Deno.env.delete(TEMPLATES_BACKEND_ENV)
      Deno.env.delete(TEMPLATES_SERVICE_URL_ENV)
      Deno.env.delete(TEMPLATES_SERVICE_ID_ENV)
      resetPreloadedDBTemplates()
    }
  })
}

templateTest(
  'templatesModelName() defaults to DEFAULT_TEMPLATES_MODEL_NAME when TEMPLATES_MODEL_NAME is unset',
  () => {
    assertEquals(templatesModelName(), 'zanix-templates')
  },
)

templateTest(
  'templatesModelName() reflects TEMPLATES_MODEL_NAME when it is set',
  () => {
    Deno.env.set(TEMPLATES_MODEL_ENV, 'custom-templates-collection')
    assertEquals(templatesModelName(), 'custom-templates-collection')
  },
)

templateTest(
  'templatesBackendMode() returns undefined for the pure code-registry path when TEMPLATES_BACKEND is unset',
  () => {
    assertEquals(templatesBackendMode(), undefined)
  },
)

templateTest(
  'templatesBackendMode() reflects "local"/"remote" when TEMPLATES_BACKEND is set to either',
  () => {
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
    assertEquals(templatesBackendMode(), 'local')

    Deno.env.set(TEMPLATES_BACKEND_ENV, 'remote')
    assertEquals(templatesBackendMode(), 'remote')
  },
)

templateTest(
  'templatesBackendMode() throws on any value other than "local"/"remote"/unset',
  () => {
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'database')
    assertThrows(
      () => templatesBackendMode(),
      InternalError,
      'must be "local" or "remote"',
    )
  },
)

templateTest(
  'isTemplatesResourceEnabled("local"): false for the pure code-registry path (TEMPLATES_BACKEND unset)',
  () => {
    assertEquals(isTemplatesResourceEnabled('local'), false)
  },
)

templateTest(
  'isTemplatesResourceEnabled(mode): true only for the matching mode, false for the other',
  () => {
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
    assertEquals(isTemplatesResourceEnabled('local'), true)
    assertEquals(isTemplatesResourceEnabled('remote'), false)

    Deno.env.set(TEMPLATES_BACKEND_ENV, 'remote')
    assertEquals(isTemplatesResourceEnabled('remote'), true)
    assertEquals(isTemplatesResourceEnabled('local'), false)
  },
)

templateTest(
  'TemplateProvider: resolve() ignores a stray TEMPLATES_MODEL_NAME left set with TEMPLATES_BACKEND unset — no longer a conflict, simply never read',
  async () => {
    // Previously (pre-`TEMPLATES_BACKEND`) the mode was inferred from `TEMPLATES_MODEL_NAME`'s own
    // presence, so setting it alone would have activated Mode A/B. Now the selector alone decides —
    // this must resolve via the pure code registry, touching `this.database` not at all.
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix_templates_test')
    const provider = freshProvider()
    // No `this.database` stub installed — if resolve() fell through to the local backend anyway,
    // accessing it would throw and this test would fail below.

    const content = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider: resolve() uses the in-memory code registry with the feature disabled, no database access at all',
  async () => {
    withDatabaseDisabled()
    const provider = freshProvider()
    // No `this.database` stub installed — if resolve() touched it, this would throw.

    const content = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })

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
    const content = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider: resolve() falls back to code once TEMPLATES_BACKEND is cleared, even with a real matching database record and TEMPLATES_MODEL_NAME still set — an explicit unset of the selector always wins, no separate kill switch needed (DATABASE_TEMPLATES=false removed, see CHANGELOG)',
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
    // Clears only the selector — `TEMPLATES_MODEL_NAME` (set by `withDatabaseEnabled`) is left in
    // place, proving it's simply never read once `TEMPLATES_BACKEND` no longer selects `'local'`.
    Deno.env.delete(TEMPLATES_BACKEND_ENV)

    // No `.hbs` of its own for 'invoice-created' in code (see db/manifest.ts), so this can only
    // resolve if the (real, matching) database record is used — proving the cleared selector, not a
    // missing-record fallback, is what's forcing the code path here.
    // Specifically `ApplicationError`, not just any `Error` — locks in the fix that replaced a
    // plain `Error` here (a caller-supplied `channel`/`name` pair that doesn't exist).
    const error = await assertRejects(
      () =>
        provider.resolve('sms', 'invoice-created', {
          invoiceId: '42',
          amount: '$10',
        }),
      ApplicationError,
      'Template not found',
    )
    assertEquals(error.code, 'TEMPLATE_NOT_FOUND')
  },
)

templateTest(
  'TemplateProvider: resolve() renders a derived template (welcome) through its parent (generic) when it has no content of its own — a database-edited generic changes welcome too',
  async () => {
    const { model, docs } = fakeTemplateModel()
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    // First sync seeds `generic` from code AND a content-less `welcome` stub with
    // `parent: 'generic'` (see `db/manifest.ts`'s `DERIVED_TEMPLATES`) — 'welcome' has no `.hbs`
    // of its own, so this exercises the chain walk, not a direct hit.
    const original = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })
    assertStringIncludes(original, 'Click here')
    assertStringIncludes(original, 'Welcome, Astronaut!')

    // Edit `generic` directly, exactly as an admin CRUD API would — this must now be visible
    // through `welcome`'s fallback too, the actual behavior this feature exists for. A distinct
    // `hash` is what invalidates the compiled-render cache (see docs/templates.md#name-vs-hash).
    const generic = docs().filter((doc) => doc.name === 'generic')[0]
    generic.hbs = '<p>EDITED: {{title}} / {{content}}</p>'
    generic.hash = 'edited-hash'

    const edited = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })
    assertStringIncludes(edited, 'EDITED: Welcome, Astronaut!')
    // Not the original compiled layout's wrapping markup — proves the edited hbs rendered,
    // rather than silently reusing the code-compiled version.
    assertEquals(edited.includes('<div class="container">'), false)
  },
)

templateTest(
  'TemplateProvider: resolve() falls back to code when a derived template AND every ancestor in its chain are missing/inactive',
  async () => {
    const { model, docs } = fakeTemplateModel()
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    // Sync seeds `generic` (real content) and the `welcome` stub (parent: 'generic').
    await provider.resolve('email', 'welcome', {})

    // Deactivate — and distinctively edit — `generic`, so a chain that incorrectly ignored
    // `active` would be caught red-handed by the assertion below.
    const generic = docs().filter((doc) => doc.name === 'generic')[0]
    generic.active = false
    generic.hbs = '<p>SHOULD NEVER RENDER: {{title}}</p>'

    const content = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })

    // Falls all the way through to the real code registry — same content a pure code-only
    // consumer would get, and definitely not the deactivated record's hbs.
    assertStringIncludes(content, 'Welcome, Astronaut!')
    assertEquals(content.includes('SHOULD NEVER RENDER'), false)
  },
)

templateTest(
  "resolve() doesn't hang on a parent cycle — falls back to code once the cycle is detected",
  async () => {
    const { model } = fakeTemplateModel([
      {
        channel: 'sms',
        name: 'a',
        parent: 'b',
        source: 'database',
        active: true,
        version: 1,
        hash: 'hash-a',
      },
      {
        channel: 'sms',
        name: 'b',
        parent: 'a',
        source: 'database',
        active: true,
        version: 1,
        hash: 'hash-b',
      },
    ])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    // Neither 'a' nor 'b' has any content or a code-registry counterpart — the cycle guard must
    // still make this terminate (reject with "not found"), not hang or stack-overflow.
    const error = await assertRejects(
      () => provider.resolve('sms', 'a', {}),
      ApplicationError,
      'Template not found: sms/a',
    )
    assertEquals(error.code, 'TEMPLATE_NOT_FOUND')
  },
)

templateTest(
  "TemplateProvider: preloadChain() preloads every hop in a derived template's parent chain, not just the exact name",
  async () => {
    const { model } = fakeTemplateModel()
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)
    const findOneCalls = countFindOne(model)

    const cache = new Map<string, unknown>()
    await provider.preloadChain('email', 'welcome', cache as never)

    // Sync seeds `generic` + the `welcome` stub, then preloadChain does one `findOne` per hop
    // (welcome, then generic) — both ending up in the cache.
    assertEquals([...cache.keys()].sort(), [
      'znx:email:generic',
      'znx:email:welcome',
    ])
    assertEquals(findOneCalls(), 2)
  },
)

templateTest(
  "resolve() walks a multi-level chain through an intermediate parent that isn't a code template at all (not just a direct otp -> generic hop)",
  async () => {
    // 'auth' has no code counterpart whatsoever (not in CODE_TEMPLATES, not a DERIVED_TEMPLATES
    // declaration, no registered transform) — created directly in the database, e.g. by an admin,
    // re-pointing 'otp' at it instead of 'otp''s hardcoded `generic` parent. `parent` is only ever
    // read from the database record, never restricted to a fixed set of names in code.
    const { model, docs } = fakeTemplateModel([
      {
        channel: 'sms',
        name: 'otp',
        parent: 'auth',
        source: 'database',
        active: true,
        version: 1,
        hash: 'hash-otp',
      },
      {
        channel: 'sms',
        name: 'auth',
        parent: 'generic',
        source: 'database',
        active: true,
        version: 1,
        hash: 'hash-auth',
      },
    ])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    // otp -> auth (no transform registered for 'auth', data passes through unchanged) -> generic
    // (code-compiled, `{{{content}}}`), applying `otp`'s own registered transform at the first hop.
    const original = await provider.resolve('sms', 'otp', {
      code: '999999',
      ttl: 7,
    })
    assertStringIncludes(original, '999999')

    // Edit `generic` — two hops away from `otp` — and confirm it still propagates end to end.
    const generic = docs().filter((doc) => doc.name === 'generic' && doc.channel === 'sms')[0]
    generic.hbs = 'EDITED-CHAIN: {{{content}}}'
    generic.hash = 'edited-hash'

    const edited = await provider.resolve('sms', 'otp', {
      code: '999999',
      ttl: 7,
    })
    assertStringIncludes(edited, 'EDITED-CHAIN:')
    assertStringIncludes(edited, '999999')
  },
)

templateTest(
  'sync promotes a content-less collision in place instead of trying to insert a duplicate {channel, name} (would violate the real unique index)',
  async () => {
    // A content-less record for 'generic' already exists — e.g. a DERIVED_TEMPLATES fallback stub
    // seeded before 'generic' itself was ever synced, or one left over from a template that used
    // to be purely derived. Confirmed against real MongoDB (unique index on {channel, name}) that
    // inserting a fresh code-seed here throws a duplicate-key error unless this case is handled.
    const { model, docs } = fakeTemplateModel([{
      channel: 'email',
      name: 'generic',
      parent: 'welcome',
      source: 'database',
      active: true,
      version: 1,
      hash: 'placeholder',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'generic', {
      title: 'Hi',
      content: 'World',
    })

    assertStringIncludes(content, 'World')
    const generic = docs().filter((doc) => doc.name === 'generic' && doc.channel === 'email')[0]
    assertEquals(generic.source, 'code')
    assertStringIncludes(generic.hbs ?? '', '{{content}}')
  },
)

templateTest(
  'sync protects a real-content collision instead of silently overwriting it — a genuine database-only "generic" wins over the code seed',
  async () => {
    // Unlike the content-less case above, this record already has its OWN real content — created
    // directly, coincidentally sharing a name with the code template. Overwriting it would destroy
    // an admin's work; the code seed must be skipped for this one instead.
    const { model, docs } = fakeTemplateModel([{
      channel: 'email',
      name: 'generic',
      hbs: '<p>ADMIN-OWNED: {{content}}</p>',
      source: 'database',
      active: true,
      version: 1,
      hash: 'admin-hash',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'generic', {
      title: 'Hi',
      content: 'World',
    })

    assertStringIncludes(content, 'ADMIN-OWNED: World')
    const generic = docs().filter((doc) => doc.name === 'generic' && doc.channel === 'email')[0]
    assertEquals(generic.source, 'database')
    assertEquals(generic.hbs, '<p>ADMIN-OWNED: {{content}}</p>')
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

    const content = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'TemplateProvider: resolve() throws when the template exists nowhere',
  async () => {
    const { model } = fakeTemplateModel()
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const error = await assertRejects(
      () => provider.resolve('email', 'does-not-exist', {}),
      ApplicationError,
      'Template not found',
    )
    assertEquals(error.code, 'TEMPLATE_NOT_FOUND')
  },
)

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

    assertEquals(
      await provider.resolve('whatsapp', 'invoice-created', { value: 'x' }),
      'v1: x',
    )

    // Mutate the stored hbs WITHOUT changing the hash — resolve() must still use the cached
    // compile (stale content is expected here; this is exactly what `hash` exists to detect).
    docs()[0].hbs = 'v2: {{value}}'
    assertEquals(
      await provider.resolve('whatsapp', 'invoice-created', { value: 'x' }),
      'v1: x',
    )

    // Now bump the hash too — the cache must invalidate and recompile against the new content.
    docs()[0].hash = 'hash-b'
    assertEquals(
      await provider.resolve('whatsapp', 'invoice-created', { value: 'x' }),
      'v2: x',
    )
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

    const content = await provider.resolve('sms', 'no-longer-in-code', {
      value: 'y',
    })

    assertEquals(content, 'still renders: y')
    assertEquals(
      docs().find((doc) => doc.name === 'no-longer-in-code')?.source,
      'database',
    )
  },
)

templateTest(
  'TemplateProvider: resolve() no longer throws when TEMPLATES_SERVICE_URL and TEMPLATES_MODEL_NAME are both set but TEMPLATES_BACKEND is unset — the pre-TEMPLATES_BACKEND "mutually exclusive" conflict can no longer be represented, both vars are simply unread',
  async () => {
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix_templates_test')
    Deno.env.set(
      TEMPLATES_SERVICE_URL_ENV,
      'https://templates.internal.example',
    )
    const provider = freshProvider()
    // No `this.database` stub and no fake fetch installed — if resolve() touched either backend,
    // this would throw for an unrelated reason (a real network call / a missing connector), not
    // the "mutually exclusive" error this test used to lock in pre-`TEMPLATES_BACKEND`.

    const content = await provider.resolve('email', 'welcome', { buttonText: 'Click here' })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'assertTemplatesBackendConfigValid: throws when TEMPLATES_BACKEND=remote is selected without TEMPLATES_SERVICE_URL at all',
  () => {
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'remote')

    assertThrows(
      () => assertTemplatesBackendConfigValid(),
      InternalError,
      TEMPLATES_SERVICE_URL_ENV,
    )
  },
)

templateTest(
  'TemplateProvider: resolve() throws synchronously when TEMPLATES_BACKEND=remote is selected and TEMPLATES_SERVICE_URL is set without TEMPLATES_SERVICE_ID',
  async () => {
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'remote')
    Deno.env.set(
      TEMPLATES_SERVICE_URL_ENV,
      'https://templates.internal.example',
    )
    const provider = freshProvider()
    // No `this.database` stub and no fake fetch installed — this must throw before either is
    // ever touched.

    await assertRejects(
      () => provider.resolve('email', 'welcome', { buttonText: 'Click here' }),
      Error,
      'TEMPLATES_SERVICE_ID',
    )
  },
)

templateTest(
  'resolve() falls back to code when a database record is a genuine dead end — no hbs, no parent',
  async () => {
    // Unlike `welcome`'s usual `DERIVED_TEMPLATES` stub (always seeded with `parent: 'generic'`),
    // this simulates a record created directly with neither — e.g. an admin clearing `parent`
    // without giving it content of its own.
    const { model } = fakeTemplateModel([{
      channel: 'email',
      name: 'welcome',
      source: 'database',
      active: true,
      version: 1,
      hash: 'dead-end-hash',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'welcome', {
      buttonText: 'Click here',
    })

    assertStringIncludes(content, 'Click here')
  },
)

templateTest(
  'sync re-syncs a source:"code" record whose database content is stale relative to code but was never manually edited',
  async () => {
    const staleHbs = '<p>STALE CODE CONTENT</p>'
    const { model, docs } = fakeTemplateModel([{
      channel: 'email',
      name: 'generic',
      hbs: staleHbs,
      lastSyncedHbs: staleHbs,
      lastSyncedHash: 'stale-hash',
      source: 'code',
      active: true,
      version: 1,
      hash: 'stale-hash',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'generic', {
      title: 'Hi',
      content: 'World',
    })

    assertStringIncludes(content, 'World')
    const generic = docs().find((doc) => doc.name === 'generic' && doc.channel === 'email')
    assertEquals(generic?.source, 'code')
    assertEquals(generic?.version, 2)
    assertEquals(generic?.updatedBy, 'system:bootstrap-sync')
    assertEquals(generic?.hbs, generic?.lastSyncedHbs)
    assertEquals(generic?.hbs === staleHbs, false)
  },
)

templateTest(
  'sync backfills lastSyncedHbs for a legacy source:"code" record that predates that tracking, instead of leaving it stuck forever',
  async () => {
    // A `source:'code'` record with no `lastSyncedHbs` at all (predates this field, or was
    // inserted some other way) gives `planCodeSync` no baseline to prove it's still untouched, so
    // it's excluded from `toResync` forever, regardless of how different its content becomes from
    // code — with no error or signal anywhere that this happened. Content is left alone THIS
    // pass (there's no way to retroactively know whether a manual edit already happened before
    // tracking existed), but the baseline is backfilled so a FUTURE code change can resync it.
    const { model, docs } = fakeTemplateModel([{
      channel: 'email',
      name: 'generic',
      hbs: '<p>whatever the legacy content was</p>',
      source: 'code',
      active: true,
      version: 1,
      hash: 'legacy-hash',
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    await provider.resolve('email', 'generic', { title: 'Hi', content: 'World' })

    const generic = docs().find((doc) => doc.name === 'generic' && doc.channel === 'email')
    assertEquals(generic?.hbs, '<p>whatever the legacy content was</p>')
    assertEquals(generic?.version, 1)
    assertEquals(generic?.lastSyncedHbs, '<p>whatever the legacy content was</p>')
    assertEquals(generic?.lastSyncedHash, 'legacy-hash')
  },
)

templateTest(
  'sync refreshes availableVariables/styles for an untouched record even when hbs itself never changed',
  async () => {
    // The sync's own equality check only ever compares `hbs` text, so an entry whose `hbs`
    // genuinely hasn't changed never enters `toResync` — meaning a package upgrade that only
    // changes HOW `availableVariables`/`styles` are derived would otherwise never reach an
    // already-tracked, untouched entry. First pass: let a fresh seed populate `email/generic`
    // with real code-derived content.
    const { model: seedModel, docs: seedDocs } = fakeTemplateModel([])
    const seedProvider = freshProvider()
    withDatabaseEnabled(seedProvider, seedModel)
    await seedProvider.resolve('email', 'generic', { title: 'Hi', content: 'World' })
    const seeded = seedDocs().find((doc) => doc.name === 'generic' && doc.channel === 'email')
    assert(seeded)
    assert(seeded.availableVariables?.length)

    // Second pass: simulate a record synced by an older package version — same `hbs`/`hash`, but
    // no `availableVariables`/`styles`/`derivedVersion` at all (exactly what every `source:'code'`
    // record looked like before this package started deriving these fields).
    const { model, docs } = fakeTemplateModel([{
      ...seeded,
      availableVariables: undefined,
      styles: undefined,
      derivedVersion: undefined,
    }])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    await provider.resolve('email', 'generic', { title: 'Hi', content: 'World' })

    const generic = docs().find((doc) => doc.name === 'generic' && doc.channel === 'email')
    assertEquals(generic?.hbs, seeded.hbs) // content untouched
    assertEquals(generic?.version, seeded.version) // no version bump — not a content resync
    assertEquals(generic?.availableVariables, seeded.availableVariables)
    assertEquals(generic?.styles, seeded.styles)
  },
)

templateTest(
  'sync promotes every colliding content-less stub in place, skipping insertMany entirely when nothing needs inserting',
  async () => {
    // One collision per code template (email/sms/whatsapp `generic`) — every `toSeed` entry is
    // promoted onto an existing stub, so `toInsert` ends up empty and `insertMany` is never
    // reached at all (see `LocalTemplateBackend#sync()`'s `toInsert.length ? ... : Promise.resolve()`).
    const { model, docs } = fakeTemplateModel([
      {
        channel: 'email',
        name: 'generic',
        parent: 'welcome',
        source: 'database',
        active: true,
        version: 1,
        hash: 'placeholder-1',
      },
      {
        channel: 'sms',
        name: 'generic',
        parent: 'otp',
        source: 'database',
        active: true,
        version: 1,
        hash: 'placeholder-2',
      },
      {
        channel: 'whatsapp',
        name: 'generic',
        parent: 'otp',
        source: 'database',
        active: true,
        version: 1,
        hash: 'placeholder-3',
      },
    ])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    const content = await provider.resolve('email', 'generic', {
      title: 'Hi',
      content: 'World',
    })

    assertStringIncludes(content, 'World')
    // No duplicate `generic` inserted for any channel — each collision was promoted in place.
    const generics = docs().filter((doc) => doc.name === 'generic')
    assertEquals(generics.length, 3)
    generics.forEach((doc) => assertEquals(doc.source, 'code'))
  },
)

templateTest(
  'TemplateProvider: preload() fetches and returns the active record directly (same lookup as resolve(), no code fallback)',
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

    const record = await provider.preload('sms', 'invoice-created')

    assertEquals(record?.hbs, 'Invoice #{{invoiceId}} for {{amount}} is ready')
  },
)

templateTest(
  'TemplateProvider: preload() resolves to undefined, with no database access at all, when the feature is disabled',
  async () => {
    withDatabaseDisabled()
    const provider = freshProvider()
    // No `this.database` stub installed — if preload() touched it, this would throw.

    assertEquals(await provider.preload('email', 'welcome'), undefined)
  },
)

templateTest(
  'TemplateProvider: preload() resolves to undefined when no matching record exists in the database',
  async () => {
    const { model } = fakeTemplateModel()
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)

    assertEquals(await provider.preload('sms', 'does-not-exist'), undefined)
  },
)

templateTest(
  "resolve() skips its own database lookup once the worker's cache is hydrated with a preloaded record (the one-time-worker path)",
  async () => {
    const record: ZanixTemplateAttrs = {
      channel: 'sms',
      name: 'invoice-created',
      hbs: 'Invoice #{{invoiceId}} for {{amount}} is ready',
      source: 'database',
      active: true,
      version: 1,
      hash: 'hash-1',
    }
    const { model } = fakeTemplateModel([record])
    const provider = freshProvider()
    withDatabaseEnabled(provider, model)
    const findOneCalls = countFindOne(model)

    // Main-thread side: NotifierProvider.onDestroy() preloads ahead of the worker hand-off.
    const preloaded = await provider.preload('sms', 'invoice-created')
    assertEquals(findOneCalls(), 1)

    // Worker side: sendBackgroundMessage() hydrates its own cache from what was preloaded.
    resetPreloadedDBTemplates(
      new Map([['znx:sms:invoice-created', preloaded]]),
    )

    const content = await provider.resolve('sms', 'invoice-created', {
      invoiceId: '42',
      amount: '$10',
    })

    assertEquals(content, 'Invoice #42 for $10 is ready')
    // No additional database round-trip — the cache hit skipped it entirely.
    assertEquals(findOneCalls(), 1)
  },
)

templateTest(
  'resolve() still hits the database normally when no preloaded cache entry exists for that key (cache-miss fallback)',
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
    const findOneCalls = countFindOne(model)

    // No preload()/resetPreloadedDBTemplates() call — the cache is empty, same as a direct
    // (non-worker) resolve() call.
    const content = await provider.resolve('sms', 'invoice-created', {
      invoiceId: '42',
      amount: '$10',
    })

    assertEquals(content, 'Invoice #42 for $10 is ready')
    assertEquals(findOneCalls(), 1)
  },
)
