import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import {
  DERIVED_FIELDS_VERSION,
  planTemplateSync,
  planUntouchedTemplateUpdates,
} from 'modules/templates/db/sync.ts'
import type {
  DerivedTemplateFields,
  ExistingTemplateEntry,
  StaticTemplateEntry,
  TrackedTemplateEntry,
} from 'modules/templates/db/sync.ts'

const welcome: StaticTemplateEntry = {
  channel: 'email',
  name: 'welcome',
  hbs: 'Hola {{name}}',
  hash: 'hash-v1',
  availableVariables: ['name'],
  styles: { css: '', classDefaults: {} },
}

function existing(
  overrides: Partial<ExistingTemplateEntry> = {},
): ExistingTemplateEntry {
  return {
    _id: 'id-1',
    channel: 'email',
    name: 'welcome',
    hbs: 'Hola {{name}}',
    hash: 'hash-v1',
    version: 1,
    lastSyncedHbs: 'Hola {{name}}',
    derivedVersion: DERIVED_FIELDS_VERSION,
    ...overrides,
  }
}

Deno.test('planTemplateSync: a new code template with no persisted entry is seeded', () => {
  const plan = planTemplateSync([welcome], [])

  assertEquals(plan.toSeed, [welcome])
  assertEquals(plan.toResync, [])
  assertEquals(plan.toOrphan, [])
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [])
})

Deno.test('planTemplateSync: an unchanged, untouched, up-to-date entry is left alone', () => {
  const plan = planTemplateSync([welcome], [existing()])

  assertEquals(plan.toSeed, [])
  assertEquals(plan.toResync, [])
  assertEquals(plan.toOrphan, [])
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [])
})

Deno.test(
  'planTemplateSync: a code change resyncs an entry nobody edited since the last sync',
  () => {
    const changedInCode: StaticTemplateEntry = {
      ...welcome,
      hbs: 'Hola {{firstName}}!',
      hash: 'hash-v2',
      availableVariables: ['firstName'],
    }
    const plan = planTemplateSync([changedInCode], [existing()])

    assertEquals(plan.toResync, [
      {
        _id: 'id-1',
        hbs: 'Hola {{firstName}}!',
        hash: 'hash-v2',
        version: 2,
        availableVariables: ['firstName'],
        styles: { css: '', classDefaults: {} },
        derivedVersion: DERIVED_FIELDS_VERSION,
      },
    ])
    assertEquals(plan.toSeed, [])
    assertEquals(plan.toOrphan, [])
    assertEquals(plan.toBackfillLastSynced, [])
    assertEquals(plan.toRefreshDerived, [])
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
    // A manual edit doesn't stop at `hbs`/`hash` resync — it also protects derived fields from
    // being silently recomputed against content the record no longer actually has.
    assertEquals(plan.toBackfillLastSynced, [])
    assertEquals(plan.toRefreshDerived, [])
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
    // Orphaned — no matching code entry to backfill/refresh derived fields from.
    assertEquals(plan.toBackfillLastSynced, [])
    assertEquals(plan.toRefreshDerived, [])
  },
)

Deno.test(
  'planTemplateSync: an entry with no lastSyncedHbs is backfilled instead of left stuck forever',
  () => {
    // No `lastSyncedValue` mirror to compare against (e.g. a legacy/manually-inserted `source:
    // 'code'` record that was never itself the product of a sync) — `planCodeSync` itself treats
    // this the same as a manual edit (never resyncs content it can't prove is still untouched),
    // but that would otherwise leave the record permanently excluded from `toResync`, forever,
    // with no signal anywhere that this happened. Backfilling `lastSyncedHbs`/
    // `lastSyncedHash` with the record's own current content re-enters it into normal
    // reconciliation from the NEXT code change onward, without resyncing content this same pass.
    const neverSynced = existing({ lastSyncedHbs: undefined, hash: 'legacy-hash' })
    const changedInCode: StaticTemplateEntry = {
      ...welcome,
      hbs: 'Hola {{firstName}}!',
      hash: 'hash-v2',
    }

    const plan = planTemplateSync([changedInCode], [neverSynced])

    assertEquals(plan.toResync, [])
    assertEquals(plan.toSeed, [])
    assertEquals(plan.toOrphan, [])
    assertEquals(plan.toBackfillLastSynced, [
      { _id: 'id-1', hbs: 'Hola {{name}}', hash: 'legacy-hash' },
    ])
    assertEquals(plan.toRefreshDerived, [])
  },
)

Deno.test(
  'planTemplateSync: an untouched entry with a stale derivedVersion gets its derived fields refreshed even though hbs itself never changed',
  () => {
    // What this covers: a package upgrade that only changes HOW `availableVariables`/`styles`
    // are computed — not the `.hbs` text itself — must still reach an already-tracked, untouched
    // entry. A plain `hbs` equality check can never trigger this on its own, since the entry
    // never enters `toResync` in the first place.
    const staleDerived = existing({ derivedVersion: undefined })
    const sameCodeButNewDerivation: StaticTemplateEntry = {
      ...welcome,
      availableVariables: ['name', 'title'],
      styles: { css: '.x{}', classDefaults: { titleClass: 'title' } },
    }

    const plan = planTemplateSync([sameCodeButNewDerivation], [staleDerived])

    assertEquals(plan.toResync, [])
    assertEquals(plan.toSeed, [])
    assertEquals(plan.toOrphan, [])
    assertEquals(plan.toBackfillLastSynced, [])
    assertEquals(plan.toRefreshDerived, [
      {
        _id: 'id-1',
        availableVariables: ['name', 'title'],
        styles: { css: '.x{}', classDefaults: { titleClass: 'title' } },
      },
    ])
  },
)

Deno.test('planTemplateSync: handles several channels/names independently in one pass', () => {
  const smsGeneric: StaticTemplateEntry = {
    channel: 'sms',
    name: 'generic',
    hbs: '{{{content}}}',
    hash: 'sms-hash',
    availableVariables: ['content'],
    styles: { css: '', classDefaults: {} },
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
        hash: '',
        lastSyncedHbs: '',
      }),
    ],
  )

  assertEquals(plan.toSeed, [])
  assertEquals(plan.toResync, [
    {
      _id: 'id-2',
      hbs: '{{{content}}}',
      hash: 'sms-hash',
      version: 2,
      availableVariables: ['content'],
      styles: { css: '', classDefaults: {} },
      derivedVersion: DERIVED_FIELDS_VERSION,
    },
  ])
  assertEquals(plan.toOrphan, [])
})

// --- planUntouchedTemplateUpdates ------------------------------------------------------------------------
// Exercised directly (not just through `planTemplateSync` above) since `TemplatesAdminRepository
// .syncCodeTemplates` (Mode C) calls this same generic function with its own document shape —
// string `_id`s here stand in for that caller's raw Mongo ids, as opposed to `planTemplateSync`'s
// own tests above.

const genericCurrent: DerivedTemplateFields = {
  availableVariables: ['content'],
  styles: { css: '.y{}', classDefaults: {} },
}

function tracked(
  overrides: Partial<TrackedTemplateEntry<string>> = {},
): TrackedTemplateEntry<string> {
  return {
    _id: 'doc-1',
    key: 'email:generic',
    hbs: '<p>{{content}}</p>',
    hash: 'hash-1',
    lastSyncedHbs: '<p>{{content}}</p>',
    derivedVersion: DERIVED_FIELDS_VERSION,
    ...overrides,
  }
}

Deno.test('planUntouchedTemplateUpdates: an entry already handled this pass (toResync/toOrphan) is skipped entirely', () => {
  const plan = planUntouchedTemplateUpdates(
    [tracked({ lastSyncedHbs: undefined, derivedVersion: undefined })],
    new Map([['email:generic', genericCurrent]]),
    new Set(['doc-1']),
  )
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [])
})

Deno.test('planUntouchedTemplateUpdates: an orphaned entry (no matching code key) is skipped', () => {
  const plan = planUntouchedTemplateUpdates(
    [tracked({ key: 'email:retired', lastSyncedHbs: undefined })],
    new Map([['email:generic', genericCurrent]]),
    new Set(),
  )
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [])
})

Deno.test("planUntouchedTemplateUpdates: backfills lastSyncedHbs/hash from the entry's own current content", () => {
  const plan = planUntouchedTemplateUpdates(
    [tracked({ lastSyncedHbs: undefined, hbs: '<p>legacy</p>', hash: 'legacy-hash' })],
    new Map([['email:generic', genericCurrent]]),
    new Set(),
  )
  assertEquals(plan.toBackfillLastSynced, [
    { _id: 'doc-1', hbs: '<p>legacy</p>', hash: 'legacy-hash' },
  ])
  assertEquals(plan.toRefreshDerived, [])
})

Deno.test('planUntouchedTemplateUpdates: refreshes derived fields for an untouched entry with a stale derivedVersion', () => {
  const plan = planUntouchedTemplateUpdates(
    [tracked({ derivedVersion: undefined })],
    new Map([['email:generic', genericCurrent]]),
    new Set(),
  )
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [{ _id: 'doc-1', ...genericCurrent }])
})

Deno.test('planUntouchedTemplateUpdates: leaves an up-to-date, untouched entry alone', () => {
  const plan = planUntouchedTemplateUpdates(
    [tracked()],
    new Map([['email:generic', genericCurrent]]),
    new Set(),
  )
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [])
})

Deno.test('planUntouchedTemplateUpdates: never refreshes derived fields for a manually-diverged entry, even with a stale derivedVersion', () => {
  const plan = planUntouchedTemplateUpdates(
    [tracked({ hbs: '<p>manually edited</p>', derivedVersion: undefined })],
    new Map([['email:generic', genericCurrent]]),
    new Set(),
  )
  assertEquals(plan.toBackfillLastSynced, [])
  assertEquals(plan.toRefreshDerived, [])
})
