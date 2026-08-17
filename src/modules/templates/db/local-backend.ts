import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel, ZanixMongoConnector } from '@zanix/datamaster'
import type { TemplateBackend } from './backend.ts'

import {
  getPreloadedDBTemplates,
  hashContent,
  loadCodeTemplates,
  seedMissingDerivedTemplates,
} from './manifest.ts'
import type { ExistingTemplateEntry } from './sync.ts'
import { CODE_SOURCE, planTemplateSync } from './sync.ts'
import logger from '@zanix/logger'

/**
 * Module-level, once-per-process sync memo — mirrors `provider.ts`'s own module-level state
 * convention (e.g. `email/pool.ts`'s `getSmtpPool()` guard), but as a `Promise` (this does async
 * DB I/O, so concurrent first callers must await the SAME in-flight sync instead of triggering it
 * twice). Reset only in tests.
 */
let syncPromise: Promise<AdaptedModel<ZanixTemplateAttrs>> | undefined

/** Resets the module-level sync memo — test-only. */
export function resetLocalTemplateBackendState(): void {
  syncPromise = undefined
}

/**
 * `TemplateBackend` for Modes A/B (per-service or shared `'db:name'` Mongo collection) — the
 * pre-Mode-C behavior, extracted verbatim out of `TemplateProvider` so the same `#ensureSynced()`/
 * `#sync()` logic can sit behind the same interface as `RemoteTemplateBackend`.
 *
 * Takes a lazy `getDatabase` accessor rather than the connector directly, since `this.database`
 * isn't wired onto the owning `TemplateProvider` instance until after DI construction completes
 * (see `provider.ts`'s `#backend()`).
 */
export class LocalTemplateBackend implements TemplateBackend {
  #getDatabase: () => ZanixMongoConnector
  #modelName: string

  constructor(getDatabase: () => ZanixMongoConnector, modelName: string) {
    this.#getDatabase = getDatabase
    this.#modelName = modelName
  }

  /**
   * Ensures the code→database sync (see `db/sync.ts`) has run exactly once for this process. The
   * `ZanixTemplate` model is registered via `registerModel()` at boot (`templates/core.ts`,
   * conditionally on `TEMPLATES_MODEL_NAME`) — but a freshly DI-constructed connector's
   * `initialize()` (which binds registered models, see `defineModels()` in datamaster's own
   * connector processor) resolves asynchronously; `getModel(modelName)`'s name-only lookup only
   * finds something once that's actually finished. `#sync()` awaits `this.#getDatabase().isReady`
   * before calling it for exactly that reason — see its own comment. Only ever called from
   * `resolve()`, itself gated behind `TEMPLATES_MODEL_NAME` being set, so nothing database-related
   * runs at all for a consumer who never enables this feature. Any failure here (connector not
   * configured, sync error, etc.) is caught by `TemplateProvider.resolve()`'s caller, not here.
   */
  async #ensureSynced(): Promise<AdaptedModel<ZanixTemplateAttrs>> {
    if (!syncPromise) {
      syncPromise = this.#sync().catch((error) => {
        syncPromise = undefined
        throw error
      })
    }
    return await syncPromise
  }

  async #sync(): Promise<AdaptedModel<ZanixTemplateAttrs>> {
    const database = this.#getDatabase()

    // Required — a freshly DI-constructed connector's `initialize()` (which binds every model
    // registered via `registerModel()`) resolves asynchronously; calling `getModel(modelName)`
    // (name-only) before it settles races the model's own binding and fails to find it.
    await database.isReady
    const Model = database.getModel<ZanixTemplateAttrs>(this.#modelName)

    const codeTemplates = await loadCodeTemplates()
    const staticEntries = await Promise.all(
      codeTemplates.map(async (entry) => ({
        channel: entry.channel,
        name: entry.name,
        hbs: entry.hbs,
        hash: await hashContent(entry.hbs),
      })),
    )

    // `source: CODE_SOURCE` records always carry a real `hbs` (only `DERIVED_TEMPLATES`' seeded
    // fallback records, always `source: 'database'`, ever omit it — see `ZanixTemplateAttrs.hbs`).
    const existing = await Model.find({ source: CODE_SOURCE })
      .lean() as ExistingTemplateEntry[]
    const plan = planTemplateSync(staticEntries, existing)
    const now = new Date()

    await Promise.all([
      ...plan.toOrphan.map(({ _id }) => Model.updateOne({ _id }, { $set: { source: 'database' } })),
      ...plan.toResync.map(({ _id, hbs, hash, version }) =>
        Model.updateOne({ _id }, {
          $set: {
            hbs,
            lastSyncedHbs: hbs,
            hash,
            lastSyncedHash: hash,
            lastSyncedAt: now,
            version,
            updatedBy: 'system:bootstrap-sync',
          },
        })
      ),
    ])

    // A single broad fetch (every record, any `source`), reused below both to safely reconcile
    // `plan.toSeed` (see immediately below) and to seed any still-missing `DERIVED_TEMPLATES`
    // fallback stub — `plan`/`existing` above only ever see `source: CODE_SOURCE` records, so a
    // database-only template or a derived-template fallback stub sharing a `{channel, name}` with
    // a template that just gained real code content is otherwise invisible to `planTemplateSync`.
    const allExisting = await Model.find({}).lean()
    const allExistingByKey = new Map(
      allExisting.map((doc) => [`${doc.channel}:${doc.name}`, doc]),
    )

    if (plan.toSeed.length) {
      const toInsert: typeof plan.toSeed = []

      const toPromote = plan.toSeed.flatMap((entry) => {
        const collision = allExistingByKey.get(
          `${entry.channel}:${entry.name}`,
        )
        if (!collision) {
          toInsert.push(entry)
          return []
        }
        if (collision.hbs) {
          // A document with real content already owns this `{channel, name}` — a genuine
          // database-only template, or a fallback stub an admin already gave content of its own
          // to (see `docs/templates.md#template-inheritance`). Seeding it as code would either
          // violate the `{channel, name}` unique index or silently destroy that content; leave it
          // alone (manual/existing content always wins, same as `toResync`'s own rule) and warn so
          // a maintainer notices the name collision instead of a template silently never syncing.
          logger.warn(
            `[TemplateProvider] "${entry.channel}/${entry.name}" already has a database record ` +
              `with its own content — skipping the code seed for it. Rename the code template or ` +
              `the existing database record to resolve this collision.`,
          )
          return []
        }
        // A content-less fallback stub for this exact name already exists (either seeded by
        // `DERIVED_TEMPLATES` before this template gained real `.hbs`/code content, or created
        // directly) — safe to promote in place instead of inserting a duplicate.
        return [{ _id: collision._id, entry }]
      })

      await Promise.all([
        ...toPromote.map(({ _id, entry }) =>
          Model.updateOne({ _id }, {
            $set: {
              hbs: entry.hbs,
              lastSyncedHbs: entry.hbs,
              hash: entry.hash,
              lastSyncedHash: entry.hash,
              lastSyncedAt: now,
              source: CODE_SOURCE,
              updatedBy: 'system:bootstrap-sync',
            },
          })
        ),
        toInsert.length
          ? Model.insertMany(
            toInsert.map((entry): ZanixTemplateAttrs => ({
              channel: entry.channel,
              name: entry.name,
              hbs: entry.hbs,
              source: CODE_SOURCE,
              active: true,
              version: 1,
              hash: entry.hash,
              lastSyncedHbs: entry.hbs,
              lastSyncedHash: entry.hash,
              lastSyncedAt: now,
              updatedBy: 'system:bootstrap-sync',
            })),
          )
          : Promise.resolve(),
      ])
    }

    await seedMissingDerivedTemplates(
      Model,
      new Set(allExistingByKey.keys()),
      'system:bootstrap-sync',
    )

    return Model
  }

  public async preload(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined> {
    const Model = await this.#ensureSynced()
    return (await Model.findOne({ channel, name, active: true }).lean()) ??
      undefined
  }

  public async resolve(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined> {
    const preloadedTemplates = getPreloadedDBTemplates()
    if (preloadedTemplates.has(`znx:${channel}:${name}`)) {
      return preloadedTemplates.get(`znx:${channel}:${name}`)
    }
    const Model = await this.#ensureSynced()
    return (await Model.findOne({ channel, name, active: true }).lean()) ??
      undefined
  }
}
