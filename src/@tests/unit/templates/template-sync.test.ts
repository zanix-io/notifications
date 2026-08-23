import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { planTemplateSync } from 'modules/templates/db/sync.ts'
import type { ExistingTemplateEntry, StaticTemplateEntry } from 'modules/templates/db/sync.ts'

const welcome: StaticTemplateEntry = {
  channel: 'email',
  name: 'welcome',
  hbs: 'Hola {{name}}',
  hash: 'hash-v1',
}

function existing(
  overrides: Partial<ExistingTemplateEntry> = {},
): ExistingTemplateEntry {
  return {
    _id: 'id-1',
    channel: 'email',
    name: 'welcome',
    hbs: 'Hola {{name}}',
    version: 1,
    lastSyncedHbs: 'Hola {{name}}',
    ...overrides,
  }
}

Deno.test('planTemplateSync: a new code template with no persisted entry is seeded', () => {
  const plan = planTemplateSync([welcome], [])

  assertEquals(plan.toSeed, [welcome])
  assertEquals(plan.toResync, [])
  assertEquals(plan.toOrphan, [])
})

Deno.test('planTemplateSync: an unchanged, untouched entry is left alone', () => {
  const plan = planTemplateSync([welcome], [existing()])

  assertEquals(plan.toSeed, [])
  assertEquals(plan.toResync, [])
  assertEquals(plan.toOrphan, [])
})

Deno.test(
  'planTemplateSync: a code change resyncs an entry nobody edited since the last sync',
  () => {
    const changedInCode: StaticTemplateEntry = {
      ...welcome,
      hbs: 'Hola {{firstName}}!',
      hash: 'hash-v2',
    }
    const plan = planTemplateSync([changedInCode], [existing()])

    assertEquals(plan.toResync, [
      { _id: 'id-1', hbs: 'Hola {{firstName}}!', hash: 'hash-v2', version: 2 },
    ])
    assertEquals(plan.toSeed, [])
    assertEquals(plan.toOrphan, [])
  },
)

Deno.test(
  'planTemplateSync: a manually-edited entry is never overwritten by a later code change',
  () => {
    const editedByUser = existing({ hbs: '¡Hola {{name}}, bienvenido!' }) // hbs !== lastSyncedHbs
    const changedInCode: StaticTemplateEntry = {
      ...welcome,
      hbs: 'Hola {{firstName}}!',
      hash: 'hash-v2',
    }

    const plan = planTemplateSync([changedInCode], [editedByUser])

    assertEquals(plan.toResync, [])
    assertEquals(plan.toSeed, [])
    assertEquals(plan.toOrphan, [])
  },
)

Deno.test(
  'planTemplateSync: a database-only template (no code entry at all) is never touched',
  () => {
    // A database-only template never appears in `existing` (see `provider.ts`'s `source:'code'`
    // filter) — passing an empty `existing` here just confirms the sync plan has nothing to say
    // about it; `TemplateProvider.resolve()` finds it directly by its own DB lookup, not via sync.
    const plan = planTemplateSync([], [])

    assertEquals(plan.toSeed, [])
    assertEquals(plan.toResync, [])
    assertEquals(plan.toOrphan, [])
  },
)

Deno.test(
  'planTemplateSync: a template removed from code is flipped to database-only, not deleted',
  () => {
    const plan = planTemplateSync([], [existing()])

    assertEquals(plan.toOrphan, [{ _id: 'id-1' }])
    assertEquals(plan.toResync, [])
    assertEquals(plan.toSeed, [])
  },
)

Deno.test(
  'planTemplateSync: an entry with no lastSyncedHbs at all is left alone even if code changed',
  () => {
    // No `lastSyncedValue` mirror to compare against (e.g. a legacy/manually-inserted `source:
    // 'code'` record that was never itself the product of a sync) — treated the same as a
    // manual edit: there's no baseline proving the current `hbs` still matches what was last
    // synced, so it's left alone rather than risk overwriting content nobody can confirm is safe.
    const neverSynced = existing({ lastSyncedHbs: undefined })
    const changedInCode: StaticTemplateEntry = {
      ...welcome,
      hbs: 'Hola {{firstName}}!',
      hash: 'hash-v2',
    }

    const plan = planTemplateSync([changedInCode], [neverSynced])

    assertEquals(plan.toResync, [])
    assertEquals(plan.toSeed, [])
    assertEquals(plan.toOrphan, [])
  },
)

Deno.test('planTemplateSync: handles several channels/names independently in one pass', () => {
  const smsGeneric: StaticTemplateEntry = {
    channel: 'sms',
    name: 'generic',
    hbs: '{{{content}}}',
    hash: 'sms-hash',
  }

  const plan = planTemplateSync(
    [welcome, smsGeneric],
    [
      existing(),
      existing({
        _id: 'id-2',
        channel: 'sms',
        name: 'generic',
        hbs: '',
        lastSyncedHbs: '',
      }),
    ],
  )

  assertEquals(plan.toSeed, [])
  assertEquals(plan.toResync, [
    { _id: 'id-2', hbs: '{{{content}}}', hash: 'sms-hash', version: 2 },
  ])
  assertEquals(plan.toOrphan, [])
})
