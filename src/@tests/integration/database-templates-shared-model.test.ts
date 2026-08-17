import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import {
  resetTemplateProviderState,
  TemplateProvider,
  TEMPLATES_MODEL_ENV,
} from 'modules/templates/provider.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel } from '@zanix/datamaster'

console.error = () => {}

/**
 * `TemplateProvider` has no shared-vs-per-service logic of its own — it just forwards whatever
 * `TEMPLATES_MODEL_NAME` is set to straight into `this.database.getModel(modelName)`. The
 * `'db:name'` split/`useDb()` routing (Mode B, see `docs/templates.md`) is entirely
 * `@zanix/datamaster`'s `createDatabase()` behavior (covered by its own unit test). What's worth
 * proving here, on the `notifications` side, is that this package doesn't itself split, trim, or
 * otherwise mangle a colon-containing model name before handing it off — it must reach
 * `getModel()` byte-for-byte, or Mode B would silently break even though datamaster's own half
 * works fine in isolation.
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

function templateTest(name: string, fn: () => Promise<void> | void): void {
  Deno.test(name, async () => {
    try {
      await fn()
    } finally {
      Deno.env.delete(TEMPLATES_MODEL_ENV)
    }
  })
}

templateTest(
  'TemplateProvider: a "db:name" TEMPLATES_MODEL_NAME reaches getModel() unsplit, Mode B works end-to-end',
  async () => {
    const sharedModelName = 'sharedDb:zanix-templates'
    Deno.env.set(TEMPLATES_MODEL_ENV, sharedModelName)

    const { model } = fakeTemplateModel([{
      channel: 'sms',
      name: 'invoice-created',
      hbs: 'Invoice #{{invoiceId}} for {{amount}} is ready',
      source: 'database',
      active: true,
      version: 1,
      hash: 'hash-1',
    }])

    const getModelCalls: string[] = []
    resetTemplateProviderState()
    const provider = new TemplateProvider()
    Object.defineProperty(provider, 'database', {
      configurable: true,
      get: () => ({
        getModel: (name: string) => {
          getModelCalls.push(name)
          return model as unknown as AdaptedModel<ZanixTemplateAttrs>
        },
      }),
    })

    const content = await provider.resolve('sms', 'invoice-created', {
      invoiceId: '42',
      amount: '$10',
    })

    assertStringIncludes(content, '#42')
    // Every getModel() call carried the full, un-split "sharedDb:zanix-templates" key — proving
    // TemplateProvider treats TEMPLATES_MODEL_NAME as opaque and never mangles the "db:name" form.
    assertEquals(getModelCalls.length > 0, true)
    for (const call of getModelCalls) {
      assertEquals(call, sharedModelName)
    }
  },
)
