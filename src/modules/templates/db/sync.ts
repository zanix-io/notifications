import type { Notifiers } from 'typings/general.ts'
import type { TemplateSource, ZanixTemplateAttrs } from 'typings/templates-db.ts'

import { planCodeSync } from '@zanix/helpers'

/** A code template entry, with its content hash precomputed (see `manifest.ts`'s `hashContent`). */
export interface StaticTemplateEntry {
  channel: Notifiers
  name: string
  hbs: string
  hash: string
  /** See `ZanixTemplateAttrs.availableVariables`. */
  availableVariables: string[]
  /** See `ZanixTemplateAttrs.styles`. */
  styles: NonNullable<ZanixTemplateAttrs['styles']>
}

/** A persisted `source: 'code'` template entry, as read back from the database. */
export interface ExistingTemplateEntry {
  _id: unknown
  channel: Notifiers
  name: string
  hbs: string
  hash: string
  version: number
  lastSyncedHbs?: string
  /** See {@link ZanixTemplateAttrs.derivedVersion}. */
  derivedVersion?: number
}

/**
 * Version stamp for the algorithm that derives `availableVariables`/`styles` from a `source:'code'`
 * template's `.hbs` (`handlebars/derive-available-variables.ts`/`compiler.ts`) — bump this whenever
 * that algorithm changes. `planUntouchedTemplateUpdates` compares it against each record's own
 * stamped {@link ZanixTemplateAttrs.derivedVersion} to recompute derived fields for already-tracked
 * entries even when their `hbs` text hasn't changed at all (see that function's own JSDoc for why a
 * plain `hbs` equality check can never trigger this on its own).
 */
export const DERIVED_FIELDS_VERSION = 1

/** A tracked `source:'code'` entry's minimal shape for {@link planUntouchedTemplateUpdates} —
 * deliberately narrow so both `planTemplateSync`'s own local-sync caller and `TemplatesAdminRepository
 * .syncCodeTemplates`'s Mode-C caller can share this logic despite using different document shapes
 * for everything else (own `_id` type, extra fields neither of these need). */
export interface TrackedTemplateEntry<Id = unknown> {
  _id: Id
  /** `` `${channel}:${name}` `` — same composite key `planCodeSync` itself reconciles on. */
  key: string
  hbs?: string
  hash: string
  lastSyncedHbs?: string
  derivedVersion?: number
}

/** The subset of {@link ZanixTemplateAttrs} that's purely derived from a code template's current
 * value, as opposed to synced-tracking bookkeeping (`hbs`/`hash`/`lastSynced*`). */
export type DerivedTemplateFields = Pick<ZanixTemplateAttrs, 'availableVariables' | 'styles'>

/** What {@link planUntouchedTemplateUpdates} decided a code→database sync pass should additionally
 * do, beyond `planCodeSync`'s own `toOrphan`/`toResync`/`toSeed`. */
export interface UntouchedTemplateUpdatesPlan<Id = unknown> {
  /** Entries to backfill with their own current `{hbs, hash}` as the new synced baseline. */
  toBackfillLastSynced: Array<{ _id: Id; hbs: string; hash: string }>
  /** Entries whose `availableVariables`/`styles` should be recomputed from the current code value. */
  toRefreshDerived: Array<{ _id: Id } & DerivedTemplateFields>
}

/**
 * Computes additional updates for a `source:'code'` entry `planCodeSync` itself leaves untouched
 * during a sync pass — two cases its own `hbs`-equality reconciliation structurally cannot detect
 * on its own (`docs/templates.md`'s "`availableVariables` and `styles`" section documents the full
 * behavior):
 *
 * - **`toBackfillLastSynced`**: an entry with no `lastSyncedHbs` on record at all (a
 *   legacy/manually-inserted row that predates this tracking, or arrived through some other path)
 *   has no baseline `planCodeSync` can compare against to tell whether it's still untouched, so it
 *   stays excluded from `toResync` regardless of how different its content becomes from code, with
 *   no error or signal anywhere reflecting that. Adopting the entry's OWN current `{hbs, hash}` as
 *   its synced baseline lets a FUTURE code change resync it normally — this deliberately does NOT
 *   resync content itself in the same pass, since there's no way to know whether a manual edit
 *   already happened before this baseline existed.
 * - **`toRefreshDerived`**: an entry whose `hbs` genuinely hasn't changed never enters `toResync`,
 *   so `availableVariables`/`styles` — computed from the current code value, but only ever written
 *   as a side effect of an `hbs`-triggered resync — stay frozen even when a package upgrade changes
 *   HOW they're derived (a new `styles` sub-field, a different `availableVariables` extraction).
 *   Comparing each entry's stamped `derivedVersion` against {@link DERIVED_FIELDS_VERSION} decouples
 *   this from `hbs` equality: any untouched entry whose `derivedVersion` doesn't match gets
 *   `availableVariables`/`styles` recomputed from the current code value, without touching
 *   `hbs`/`hash`/`version` at all.
 *
 * Only considers entries `handledIds` doesn't already cover (`toResync`/`toOrphan` from the same
 * `planCodeSync` pass) — those already get fresh derived fields, and a fresh `derivedVersion`
 * stamp, as part of their own write.
 *
 * @param existing Tracked `source:'code'` entries to check.
 * @param staticByKey The current code-defined entries, keyed the same way as `existing.key`.
 * @param handledIds `_id`s already handled by this pass's own `toResync`/`toOrphan`.
 */
export function planUntouchedTemplateUpdates<Id = unknown>(
  existing: TrackedTemplateEntry<Id>[],
  staticByKey: Map<string, DerivedTemplateFields>,
  handledIds: ReadonlySet<Id>,
): UntouchedTemplateUpdatesPlan<Id> {
  const toBackfillLastSynced: UntouchedTemplateUpdatesPlan<Id>['toBackfillLastSynced'] = []
  const toRefreshDerived: UntouchedTemplateUpdatesPlan<Id>['toRefreshDerived'] = []

  for (const entry of existing) {
    if (handledIds.has(entry._id)) continue
    const current = staticByKey.get(entry.key)
    if (!current) continue // orphaned (or already gone) — not this function's concern

    if (entry.lastSyncedHbs === undefined) {
      toBackfillLastSynced.push({ _id: entry._id, hbs: entry.hbs ?? '', hash: entry.hash })
      continue
    }

    const untouchedSinceLastSync = entry.hbs === entry.lastSyncedHbs
    if (untouchedSinceLastSync && entry.derivedVersion !== DERIVED_FIELDS_VERSION) {
      toRefreshDerived.push({ _id: entry._id, ...current })
    }
  }

  return { toBackfillLastSynced, toRefreshDerived }
}

/** What a code→database sync pass should do to the persisted templates collection. */
export interface TemplateSyncPlan {
  /** `_id`s of `source:'code'` entries whose `{channel,name}` no longer has a `.hbs` in code — flipped to `source:'database'`, never deleted (see rationale below). */
  toOrphan: Array<{ _id: unknown }>
  /** Entries whose content should be overwritten with the current code content. */
  toResync: Array<
    {
      _id: unknown
      hbs: string
      hash: string
      version: number
      availableVariables: string[]
      styles: NonNullable<ZanixTemplateAttrs['styles']>
      derivedVersion: number
    }
  >
  /** `{channel,name}` pairs with a `.hbs` in code and no persisted entry at all yet. */
  toSeed: StaticTemplateEntry[]
  /** See {@link planUntouchedTemplateUpdates}. */
  toBackfillLastSynced: UntouchedTemplateUpdatesPlan['toBackfillLastSynced']
  /** See {@link planUntouchedTemplateUpdates}. */
  toRefreshDerived: UntouchedTemplateUpdatesPlan['toRefreshDerived']
}

/**
 * Plans how the persisted `ZanixTemplate` collection should reconcile with the current code
 * state — pure, no database access, so it's independently testable:
 *
 * - **Orphaned** (a `source:'code'` entry whose `{channel,name}` no longer has a `.hbs` in code) →
 *   flipped to `source: 'database'`, NOT deleted — a rendered template stays perfectly usable even
 *   after code stops declaring it; deleting it would silently destroy content on a code change.
 * - **Changed in code, untouched in the database** (nobody edited `hbs` directly since the last
 *   sync, but the current code `hbs` differs from that) → re-synced to the new code content,
 *   `version` bumped by 1.
 * - **Changed in code, but also edited directly** → left alone; a manual edit always wins over a
 *   later code change, with no exception.
 * - **Not yet persisted at all** (a `{channel,name}` with a `.hbs` in code and no entry) → seeded
 *   fresh, `source: 'code'`.
 *
 * `source: 'database'` entries are never passed in as `existing` (see `provider.ts`'s caller) and
 * never touched by any of this — they're unrelated to any code-side template.
 *
 * The actual reconciliation (the "does the live value still match what code last synced in"
 * mirror-field check) is `@zanix/helpers`' `planCodeSync` — shared with `@zanix/datamaster`'s own
 * trigger sync, the other real consumer of this exact algorithm. This wrapper only translates
 * `{channel, name, hbs}` ↔ the generic `{key, value}` shape and computes the version bump, which
 * `planCodeSync` itself doesn't know about. `planUntouchedTemplateUpdates` (above) additionally
 * covers two cases `planCodeSync` itself can never resolve on its own — see its own JSDoc.
 */
// `existing` (below) only ever needs `hbs` for `planCodeSync`'s equality check — its own
// `availableVariables`/`styles` are never read, so a fixed placeholder satisfies
// `StaticTemplateEntry`'s shape without pretending to know the persisted record's real values.
const UNUSED_PLACEHOLDER: Pick<StaticTemplateEntry, 'availableVariables' | 'styles'> = {
  availableVariables: [],
  styles: { css: '', classDefaults: {} },
}

export function planTemplateSync(
  staticEntries: StaticTemplateEntry[],
  existing: ExistingTemplateEntry[],
): TemplateSyncPlan {
  const versionById = new Map(
    existing.map((entry) => [entry._id, entry.version]),
  )
  const derivedByKey = new Map<string, DerivedTemplateFields>(
    staticEntries.map((entry) => [
      `${entry.channel}:${entry.name}`,
      { availableVariables: entry.availableVariables, styles: entry.styles },
    ]),
  )

  const plan = planCodeSync<StaticTemplateEntry>(
    staticEntries.map((entry) => ({
      key: `${entry.channel}:${entry.name}`,
      value: entry,
    })),
    existing.map((entry) => ({
      _id: entry._id,
      key: `${entry.channel}:${entry.name}`,
      value: {
        channel: entry.channel,
        name: entry.name,
        hbs: entry.hbs,
        hash: '',
        ...UNUSED_PLACEHOLDER,
      },
      lastSyncedValue: entry.lastSyncedHbs === undefined ? undefined : {
        channel: entry.channel,
        name: entry.name,
        hbs: entry.lastSyncedHbs,
        hash: '',
        ...UNUSED_PLACEHOLDER,
      },
    })),
    (a, b) => a.hbs === b.hbs,
  )

  const handledIds = new Set([
    ...plan.toResync.map(({ _id }) => _id),
    ...plan.toOrphan.map(({ _id }) => _id),
  ])
  const untouchedUpdates = planUntouchedTemplateUpdates(
    existing.map((entry) => ({
      _id: entry._id,
      key: `${entry.channel}:${entry.name}`,
      hbs: entry.hbs,
      hash: entry.hash,
      lastSyncedHbs: entry.lastSyncedHbs,
      derivedVersion: entry.derivedVersion,
    })),
    derivedByKey,
    handledIds,
  )

  return {
    toOrphan: plan.toOrphan,
    toResync: plan.toResync.map(({ _id, value }) => ({
      _id,
      hbs: value.hbs,
      hash: value.hash,
      // `_id` always comes from `existing` (see planCodeSync above), so this is always present.
      version: (versionById.get(_id) ?? 0) + 1,
      availableVariables: value.availableVariables,
      styles: value.styles,
      derivedVersion: DERIVED_FIELDS_VERSION,
    })),
    toSeed: plan.toSeed.map((entry) => entry.value),
    ...untouchedUpdates,
  }
}

/** `ZanixTemplate.source` value used for every entry seeded or resynced from code. */
export const CODE_SOURCE: TemplateSource = 'code'
