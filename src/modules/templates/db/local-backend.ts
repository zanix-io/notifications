import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel, ZanixMongoConnector } from '@zanix/datamaster'
import type { TemplateBackend } from './backend.ts'

import { hashContent, loadCodeTemplates } from './manifest.ts'
import { CODE_SOURCE, planTemplateSync } from './sync.ts'

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

    const existing = await Model.find({ source: CODE_SOURCE }).lean()
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

    if (plan.toSeed.length) {
      await Model.insertMany(
        plan.toSeed.map((entry): ZanixTemplateAttrs => ({
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
    }

    return Model
  }

  public async resolve(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs | undefined> {
    const Model = await this.#ensureSynced()
    return (await Model.findOne({ channel, name, active: true }).lean()) ?? undefined
  }
}
