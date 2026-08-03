import { assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.15'
import type { Model } from '@zanix/datamaster'
import {
  DERIVED_TEMPLATES,
  DUPLICATE_KEY_ERROR_CODE,
  isDuplicateKeyError,
  seedMissingDerivedTemplates,
} from 'modules/templates/db/manifest.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

// --- isDuplicateKeyError -----------------------------------------------------------------------

Deno.test('isDuplicateKeyError is true for a Mongo duplicate-key error object', () => {
  assertEquals(isDuplicateKeyError({ code: DUPLICATE_KEY_ERROR_CODE }), true)
})

Deno.test('isDuplicateKeyError is false for an object with a different code', () => {
  assertEquals(isDuplicateKeyError({ code: 12345 }), false)
})

Deno.test('isDuplicateKeyError is false for an object with no code', () => {
  assertEquals(isDuplicateKeyError({ message: 'boom' }), false)
})

Deno.test('isDuplicateKeyError is false for null', () => {
  assertEquals(isDuplicateKeyError(null), false)
})

Deno.test('isDuplicateKeyError is false for a non-object error', () => {
  assertEquals(isDuplicateKeyError('boom'), false)
})

// --- seedMissingDerivedTemplates ----------------------------------------------------------------

function fakeModel(
  updateOne: (
    filter: { channel: string; name: string },
  ) => Promise<{ upsertedCount: number }>,
): Model<ZanixTemplateAttrs> {
  return { updateOne } as unknown as Model<ZanixTemplateAttrs>
}

Deno.test(
  'seedMissingDerivedTemplates returns 0 without writing when every derived template already exists',
  async () => {
    let calls = 0
    const existingKeys = new Set(DERIVED_TEMPLATES.map((d) => `${d.channel}:${d.name}`))
    const Model = fakeModel(() => {
      calls++
      return Promise.resolve({ upsertedCount: 0 })
    })
    const result = await seedMissingDerivedTemplates(Model, existingKeys, 'admin-1')
    assertEquals(result, 0)
    assertEquals(calls, 0)
  },
)

Deno.test(
  'seedMissingDerivedTemplates treats a duplicate-key write failure as already-seeded, not an error',
  async () => {
    const Model = fakeModel(() => {
      const error = new Error('E11000 duplicate key error collection')
      Object.assign(error, { code: DUPLICATE_KEY_ERROR_CODE })
      return Promise.reject(error)
    })
    const result = await seedMissingDerivedTemplates(Model, new Set(), 'admin-1')
    assertEquals(result, 0)
  },
)

Deno.test(
  'seedMissingDerivedTemplates rethrows a write failure that is not a duplicate-key error',
  async () => {
    const Model = fakeModel(() => Promise.reject(new Error('connection reset')))
    await assertRejects(
      () => seedMissingDerivedTemplates(Model, new Set(), 'admin-1'),
      Error,
      'connection reset',
    )
  },
)
