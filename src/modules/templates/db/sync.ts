import type { Notifiers } from 'typings/general.ts'
import type { TemplateSource } from 'typings/templates-db.ts'

import { planCodeSync } from '@zanix/helpers'

/** A code template entry, with its content hash precomputed (see `manifest.ts`'s `hashContent`). */
export interface StaticTemplateEntry {
  channel: Notifiers
  name: string
  hbs: string
  hash: string
}

/** A persisted `source: 'code'` template entry, as read back from the database. */
export interface ExistingTemplateEntry {
  _id: unknown
  channel: Notifiers
  name: string
  hbs: string
  version: number
  lastSyncedHbs?: string
}

/** What a code→database sync pass should do to the persisted templates collection. */
export interface TemplateSyncPlan {
  /** `_id`s of `source:'code'` entries whose `{channel,name}` no longer has a `.hbs` in code — flipped to `source:'database'`, never deleted (see rationale below). */
  toOrphan: Array<{ _id: unknown }>
  /** Entries whose content should be overwritten with the current code content. */
  toResync: Array<{ _id: unknown; hbs: string; hash: string; version: number }>
  /** `{channel,name}` pairs with a `.hbs` in code and no persisted entry at all yet. */
  toSeed: StaticTemplateEntry[]
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
 * `planCodeSync` itself doesn't know about.
 */
export function planTemplateSync(
  staticEntries: StaticTemplateEntry[],
  existing: ExistingTemplateEntry[],
): TemplateSyncPlan {
  const versionById = new Map(existing.map((entry) => [entry._id, entry.version]))

  const plan = planCodeSync<StaticTemplateEntry>(
    staticEntries.map((entry) => ({ key: `${entry.channel}:${entry.name}`, value: entry })),
    existing.map((entry) => ({
      _id: entry._id,
      key: `${entry.channel}:${entry.name}`,
      value: { channel: entry.channel, name: entry.name, hbs: entry.hbs, hash: '' },
      lastSyncedValue: entry.lastSyncedHbs === undefined ? undefined : {
        channel: entry.channel,
        name: entry.name,
        hbs: entry.lastSyncedHbs,
        hash: '',
      },
    })),
    (a, b) => a.hbs === b.hbs,
  )

  return {
    toOrphan: plan.toOrphan,
    toResync: plan.toResync.map(({ _id, value }) => ({
      _id,
      hbs: value.hbs,
      hash: value.hash,
      // `_id` always comes from `existing` (see planCodeSync above), so this is always present.
      version: (versionById.get(_id) ?? 0) + 1,
    })),
    toSeed: plan.toSeed.map((entry) => entry.value),
  }
}

/** `ZanixTemplate.source` value used for every entry seeded or resynced from code. */
export const CODE_SOURCE: TemplateSource = 'code'
