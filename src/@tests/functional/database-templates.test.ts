import { generateUUID } from '@zanix/helpers'
import { assertNotEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { NotifierProvider } from 'modules/providers/notifier.ts'
import { TEMPLATES_MODEL_ENV } from 'modules/templates/provider.ts'
import { templateModelDefinition } from 'modules/templates/db/schema.ts'
import { loadTestEnv, missingEnv } from './env.ts'
import { registerModel, ZanixMongoConnector } from '@zanix/datamaster'

console.error = () => {}

await loadTestEnv()

const REQUIRED_ENV = ['MONGO_TEST_URI']
const TEST_NAME =
  'Database-backed templates: a real MongoDB edit to a synced template takes effect on the next send'
const NEW_TEMPLATE_TEST_NAME =
  'Database-backed templates: a template created directly in the database, with no code counterpart, sends as-is'
const MODEL_NAME = 'zanix-templates-functional-test'

/**
 * Functional test — hits a real MongoDB (local by default, see `.env.test.example`; CI points
 * `MONGO_TEST_URI` at a service container — see `.github/workflows/publish.yml`) through the real,
 * published `@zanix/datamaster` package (`jsr:@zanix/datamaster@0.*`, not a local override), to
 * validate the full hybrid code-then-database template flow end to end:
 *
 * 1. First send — no `email/generic` record yet, so `TemplateProvider` seeds it from code during
 *    sync (via its own, internally-resolved connector), then renders that just-seeded content.
 * 2. The seeded record is edited directly in MongoDB, through a SEPARATE, standalone
 *    `ZanixMongoConnector` — bypassing `@zanix/notifications` entirely, exactly as a future admin
 *    CRUD API would, and exactly what the sync's "never overwrite a manual edit" rule exists to
 *    protect. `registerModel`'s registration registry is drained by whichever connector
 *    initializes first (see `defineModels()` in datamaster's own connector processor) — since
 *    step 1's connector already consumed it, this standalone connector needs it registered again
 *    before it boots.
 * 3. Second send — must reflect the manual edit, not the original code-seeded content, proving the
 *    database really is the runtime source of truth once a record exists.
 */
Deno.test({
  name: TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, TEST_NAME),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const MONGO_URI = Deno.env.get('MONGO_TEST_URI') as string
    Deno.env.set('MONGO_URI', MONGO_URI)
    Deno.env.set(TEMPLATES_MODEL_ENV, MODEL_NAME)

    // Registers the real Mongo connector under the 'database' core key (MONGO_URI is set) — the
    // same zero-config mechanism a real app gets via `@zanix/datamaster/core`.
    await import('@zanix/datamaster/core')
    // Registers `TemplateProvider` (see `templates/core.ts`'s own doc comment for why this is
    // unconditional, unlike the channel connectors).
    await import('../../modules/templates/core.ts')

    const calls: Array<{ content: string }> = []
    const provider = new NotifierProvider()
    // Stubs only the final "send" step — SMTP isn't what this test is about; template CONTENT
    // resolution (against a real database) is.
    provider.use = (() => ({
      isReady: Promise.resolve(true),
      send: (data: unknown) => {
        calls.push(data as { content: string })
        return Promise.resolve()
      },
      close: () => Promise.resolve(),
      // deno-lint-ignore no-explicit-any
    })) as any

    let db: ZanixMongoConnector | undefined

    try {
      await provider.email({
        to: 'dest@example.com',
        subject: 'Hi',
        zanixTemplate: 'generic',
        data: { title: 'Hello', content: 'World' },
      })
      const seeded = calls.at(-1)?.content ?? ''
      assertStringIncludes(seeded, 'World')

      // A separate, standalone `ZanixMongoConnector` — bypassing `@zanix/notifications` entirely,
      // exactly as a future admin CRUD API would. `TemplateProvider`'s own internally-resolved
      // connector (constructed above, during the first send) already drained `registerModel`'s
      // registry, so this connector needs it registered again before its own `isReady` runs.
      registerModel({ name: MODEL_NAME, ...templateModelDefinition() })
      db = new ZanixMongoConnector({ uri: MONGO_URI })
      await db.isReady

      const Model = db.getModel(MODEL_NAME)
      await Model.updateOne(
        { channel: 'email', name: 'generic' },
        {
          $set: {
            hbs: '<p>EDITED-BY-TEST: {{title}} {{content}}</p>',
            // Any distinct-from-before string invalidates `TemplateProvider`'s compiled-render
            // cache — `generateUUID()` (from `@zanix/helpers`) is a convenient way to guarantee
            // that without hand-rolling one (see docs/templates.md#name-vs-hash).
            hash: generateUUID(),
          },
        },
      )

      calls.length = 0
      await provider.email({
        to: 'dest@example.com',
        subject: 'Hi',
        zanixTemplate: 'generic',
        data: { title: 'Hello', content: 'World' },
      })
      const edited = calls.at(-1)?.content ?? ''

      assertStringIncludes(edited, 'EDITED-BY-TEST: Hello World')
      assertNotEquals(edited, seeded)
    } finally {
      if (db) {
        await db.getModel(MODEL_NAME).deleteMany({})
        await db['close']()
      }
      // `Deno.env` is real process state, not isolated per test file — leaving these set would
      // leak into every test file that runs afterward in the same `deno test` invocation (e.g.
      // `emails.test.ts` would then try the database path with no connector registered there).
      Deno.env.delete('MONGO_URI')
      Deno.env.delete(TEMPLATES_MODEL_ENV)
    }
  },
})

/**
 * Functional test — a `{channel, name}` created directly in the database, with no `.hbs` of its
 * own in code at all (see `db/manifest.ts`'s `CODE_TEMPLATES`), is a `source: 'database'` record.
 * Unlike the edited-`source:'code'` case above, `resolve()` never routes it through
 * `#renderCodeBacked()` — there's no code counterpart to validate against — so `compile(data)`
 * runs directly against whatever `hbs`/`data` the record and caller provide, with no Zod schema
 * constraining the placeholder names. This is the real path for a template that only ever exists
 * in the database (e.g. `invoice-created`), as opposed to editing an existing code-backed one.
 */
Deno.test({
  name: NEW_TEMPLATE_TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, NEW_TEMPLATE_TEST_NAME),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const MONGO_URI = Deno.env.get('MONGO_TEST_URI') as string
    Deno.env.set('MONGO_URI', MONGO_URI)
    Deno.env.set(TEMPLATES_MODEL_ENV, MODEL_NAME)

    await import('@zanix/datamaster/core')
    await import('../../modules/templates/core.ts')

    const calls: Array<{ content: string }> = []
    const provider = new NotifierProvider()
    provider.use = (() => ({
      isReady: Promise.resolve(true),
      send: (data: unknown) => {
        calls.push(data as { content: string })
        return Promise.resolve()
      },
      close: () => Promise.resolve(),
      // deno-lint-ignore no-explicit-any
    })) as any

    let db: ZanixMongoConnector | undefined

    try {
      registerModel({ name: MODEL_NAME, ...templateModelDefinition() })
      db = new ZanixMongoConnector({ uri: MONGO_URI })
      await db.isReady

      const Model = db.getModel(MODEL_NAME)
      await Model.insertMany([{
        channel: 'sms',
        name: 'invoice-created',
        hbs: 'Invoice #{{invoiceId}} for {{amount}} is ready',
        source: 'database',
        active: true,
        version: 1,
        hash: generateUUID(),
      }])

      await provider.sms({
        to: '+15551234567',
        zanixTemplate: 'invoice-created',
        data: { invoiceId: '42', amount: '$10' },
        // deno-lint-ignore no-explicit-any
      } as any)
      const content = calls.at(-1)?.content ?? ''

      assertStringIncludes(content, 'Invoice #42 for $10 is ready')
    } finally {
      if (db) {
        await db.getModel(MODEL_NAME).deleteMany({})
        await db['close']()
      }
      Deno.env.delete('MONGO_URI')
      Deno.env.delete(TEMPLATES_MODEL_ENV)
    }
  },
})
