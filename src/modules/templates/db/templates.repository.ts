import type { Model, ZanixMongoConnector } from '@zanix/datamaster'
import type { Notifiers } from 'typings/general.ts'
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from 'typings/templates-db.ts'

import { Provider, ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { generateUUID, planCodeSync } from '@zanix/helpers'
import { assertValidHandlebarsSyntax } from '../hbs-validation.ts'
import { templatesModelName } from '../provider.ts'

/**
 * Rejects a syntactically invalid `hbs` before persisting it — otherwise `TemplateProvider` only
 * discovers the break the first time it actually tries to send with this template (and even then
 * silently falls back to the code registry instead of surfacing a clear error). Not a full content
 * validation (doesn't check referenced variables) — see `assertValidHandlebarsSyntax`'s own JSDoc.
 */
async function assertValidTemplate(hbs: string): Promise<void> {
  try {
    await assertValidHandlebarsSyntax(hbs)
  } catch (error) {
    throw new HttpError('BAD_REQUEST', {
      message: 'Invalid Handlebars template.',
      cause: error,
      meta: { source: 'zanix', method: 'TemplatesAdminRepository', hbs },
    })
  }
}

/** A single code-defined template entry submitted to {@link TemplatesAdminRepository.syncCodeTemplates}. */
export interface SyncCodeTemplateEntry {
  /** The notifier channel this template belongs to. */
  channel: Notifiers
  /** The template's name within its `channel`. */
  name: string
  /** The template's raw Handlebars source. */
  hbs: string
  /** Cache-invalidation key for this entry's compiled render — see `docs/templates.md#name-vs-hash`. */
  hash: string
}

/**
 * Summary of what a {@link TemplatesAdminRepository.syncCodeTemplates} call actually wrote. A
 * `type` alias, not an `interface` — `@zanix/admin`'s own sync route returns this directly, and
 * only an object type literal (not an `interface`) is structurally compatible with
 * `HandlerResponse`'s implicit index signature.
 */
export type SyncCodeTemplatesResult = {
  seeded: number
  resynced: number
}

/** `updatedBy` stamped on every row `syncCodeTemplates()` seeds/resyncs by default — mirrors this
 * package's own `'system:bootstrap-sync'` convention for its local, same-process sync. */
const SYNC_ACTOR = 'system:remote-sync'

/** Mongo's duplicate-key error code — see `syncCodeTemplates()`'s seed step. */
const DUPLICATE_KEY_ERROR_CODE = 11000

/** Whether `error` is a Mongo duplicate-key failure (a unique-index violation), as opposed to any other write failure. */
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
}

/**
 * Data access for this package's own templates collection (`zanix-templates` by default, or
 * `TEMPLATES_MODEL_NAME`) — separate from `TemplateProvider`, which only exposes read+fallback
 * `resolve()`. Backs `@zanix/admin`'s `/admin/templates`/`/templates` API — this package owns the
 * schema/collection, `@zanix/admin` only composes this into an HTTP surface (see
 * `TemplatesAdminService`, and `@zanix/admin`'s own `templates.handler.ts`).
 *
 * Exported so a consuming app can reuse this same data-access layer to build its own custom
 * templates API instead of duplicating the CRUD logic (see this package's own `docs/templates.md`
 * for the two storage-sharing modes this interacts with).
 */
@Provider()
export class TemplatesAdminRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /** Resolves the underlying templates `Model` once the connector is ready. */
  private async model(): Promise<Model<ZanixTemplateAttrs>> {
    await this.database.isReady
    return this.database.getModel<ZanixTemplateAttrs>(templatesModelName())
  }

  /** Returns every persisted template, optionally filtered to one `channel`. */
  public async list(channel?: Notifiers): Promise<ZanixTemplateAttrs[]> {
    const Model = await this.model()
    return Model.find(channel ? { channel } : {})
  }

  /**
   * Returns a single template entry.
   *
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `{channel, name}`.
   */
  public async get(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs> {
    const Model = await this.model()
    const entry = await Model.findOne({ channel, name })
    if (!entry) throw new HttpError('NOT_FOUND', { meta: { channel, name } })
    return entry
  }

  /**
   * Creates a new template entry.
   *
   * @throws {HttpError} `BAD_REQUEST` if `input.hbs` is syntactically invalid Handlebars.
   * @throws {HttpError} `CONFLICT` if an entry already exists for `{channel, name}`.
   */
  public async create(
    input: CreateTemplateInput,
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs> {
    await assertValidTemplate(input.hbs)

    const Model = await this.model()
    const existing = await Model.findOne({ channel: input.channel, name: input.name })
    if (existing) {
      throw new HttpError('CONFLICT', {
        meta: {
          ...input,
          message:
            `A template named "${input.name}" already exists for channel "${input.channel}".`,
        },
      })
    }
    return Model.create({
      ...input,
      source: 'database',
      active: true,
      version: 1,
      hash: generateUUID(),
      updatedBy,
    })
  }

  /**
   * Applies a partial update to an existing entry, bumping `version`/`hash`.
   *
   * @throws {HttpError} `BAD_REQUEST` if `changes.hbs` is provided and syntactically invalid.
   * @throws {HttpError} `NOT_FOUND` if no entry exists for `{channel, name}`.
   */
  public async update(
    channel: Notifiers,
    name: string,
    changes: UpdateTemplateInput,
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs> {
    if (changes.hbs !== undefined) await assertValidTemplate(changes.hbs)

    const Model = await this.model()
    const entry = await Model.findOne({ channel, name })
    if (!entry) throw new HttpError('NOT_FOUND', { meta: { channel, name } })

    return Model.findOneAndUpdate(
      { channel, name },
      { $set: { ...changes, version: entry.version + 1, hash: generateUUID(), updatedBy } },
      { new: true },
    ) as Promise<ZanixTemplateAttrs>
  }

  /** Soft delete — flips `active: false`, the same mechanism `TemplateProvider.resolve()` already
   * treats as "not found". A real deletion isn't offered: it would break `hash`/`version` history. */
  public async remove(channel: Notifiers, name: string, updatedBy: string): Promise<void> {
    await this.update(channel, name, { active: false }, updatedBy)
  }

  /**
   * Batch code→database sync, for a caller with no local database access of its own — e.g. this
   * package's own `RemoteTemplateBackend` (see `docs/templates.md#mode-c-remote-only-templates`),
   * pulled by `@zanix/admin` via `/.well-known/zanix/code-templates` Discovery rather than pushed
   * directly. Additive — a new capability alongside `create()`/`update()`, not a replacement for
   * their throw-on-conflict, human-facing CRUD semantics, which are unchanged.
   *
   * Reuses the same `planCodeSync` reconciliation this package's own `LocalTemplateBackend` runs
   * locally (seed/resync/orphan, manual-edit-always-wins) rather than reimplementing it — see
   * `@zanix/helpers`' `planCodeSync` for the exact rules.
   *
   * Safe to call concurrently from N replicas of the same business service: each seed is a single
   * atomic `updateOne({channel,name}, {$setOnInsert: ...}, {upsert: true})`, so two replicas racing
   * the same brand-new `{channel,name}` either both no-op onto the same inserted row (only the one
   * whose result carries `upsertedCount: 1` is counted as `seeded`), or one hits the collection's
   * unique `{channel,name}` index as a duplicate-key error — caught here and treated as "already
   * seeded," never surfaced as a failure.
   *
   * @param entries The caller's current code-defined templates (`{channel, name, hbs, hash}`).
   * @param updatedBy Actor stamped on every written row — defaults to `'system:remote-sync'`.
   */
  public async syncCodeTemplates(
    entries: SyncCodeTemplateEntry[],
    updatedBy = SYNC_ACTOR,
  ): Promise<SyncCodeTemplatesResult> {
    const Model = await this.model()

    const existingDocs = await Model.find({ source: 'code' })
    const plan = planCodeSync<SyncCodeTemplateEntry>(
      entries.map((entry) => ({ key: `${entry.channel}:${entry.name}`, value: entry })),
      existingDocs.map((doc) => ({
        _id: doc._id,
        key: `${doc.channel}:${doc.name}`,
        // `existingDocs` is filtered to `source: 'code'` above, which by definition always has
        // real `hbs` content — `?? ''` is just satisfying `ZanixTemplateAttrs.hbs`'s general
        // optionality (a database-only "fallback" record can lack it), mirroring `lastSyncedHash`'s
        // own fallback just below.
        value: { channel: doc.channel, name: doc.name, hbs: doc.hbs ?? '', hash: doc.hash },
        lastSyncedValue: doc.lastSyncedHbs === undefined ? undefined : {
          channel: doc.channel,
          name: doc.name,
          hbs: doc.lastSyncedHbs,
          hash: doc.lastSyncedHash ?? '',
        },
      })),
      (a, b) => a.hbs === b.hbs,
    )

    const now = new Date()

    await Promise.all(
      plan.toOrphan.map(({ _id }) => Model.updateOne({ _id }, { $set: { source: 'database' } })),
    )

    await Promise.all(
      plan.toResync.map(({ _id, value }) =>
        Model.updateOne({ _id }, {
          $set: {
            hbs: value.hbs,
            hash: value.hash,
            lastSyncedHbs: value.hbs,
            lastSyncedHash: value.hash,
            lastSyncedAt: now,
            updatedBy,
          },
          $inc: { version: 1 },
        })
      ),
    )

    const seededFlags = await Promise.all(
      plan.toSeed.map(async ({ value }) => {
        try {
          // `updateOne` (not `findOneAndUpdate`) so the result's `upsertedCount` can tell "actually
          // inserted" apart from "upsert matched an already-inserted row" — `$setOnInsert` makes
          // both cases succeed silently, and only `upsertedCount` (1 on a genuine insert, 0 on a
          // no-op match) distinguishes them. Without it, two replicas racing the same key would
          // both report `seeded: true` even though only one of them actually created a row.
          const { upsertedCount } = await Model.updateOne(
            { channel: value.channel, name: value.name },
            {
              $setOnInsert: {
                channel: value.channel,
                name: value.name,
                hbs: value.hbs,
                source: 'code',
                active: true,
                version: 1,
                hash: value.hash,
                lastSyncedHbs: value.hbs,
                lastSyncedHash: value.hash,
                lastSyncedAt: now,
                updatedBy,
              },
            },
            { upsert: true },
          )
          return Boolean(upsertedCount)
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error
          return false
        }
      }),
    )

    return {
      seeded: seededFlags.filter(Boolean).length,
      resynced: plan.toResync.length,
    }
  }
}
