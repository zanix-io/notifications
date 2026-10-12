import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs, ZanixTemplateMessageAttrs } from 'typings/templates-db.ts'
import type { MessageCatalog } from '../i18n.ts'
import type { AdaptedModel, ZanixMongoConnector } from '@zanix/database'
import type { TemplateBackend } from './backend.ts'

import {
  getPreloadedDBTemplates,
  getPreloadedMessages,
  hashContent,
  loadCodeTemplates,
  seedMissingDerivedTemplates,
} from './manifest.ts'
import type { ExistingTemplateEntry } from './sync.ts'
import { CODE_SOURCE, DERIVED_FIELDS_VERSION, planTemplateSync } from './sync.ts'
import logger from '@zanix/logger'
import { withRegisteredTemplates } from './seeds.ts'
import { adoptRegisteredRecords } from './adopt.ts'
import { ensureMessagesSynced, resetMessagesSyncState } from './messages-sync.ts'

/**
 * Module-level, once-per-process sync memo — mirrors `provider.ts`'s own module-level state
 * convention (e.g. `email/pool.ts`'s `getSmtpPool()` guard), but as a `Promise` (this does async
 * DB I/O, so concurrent first callers must await the SAME in-flight sync instead of triggering it
 * twice). Reset only in tests.
 */
let syncPromise: Promise<AdaptedModel<ZanixTemplateAttrs>> | undefined

/** Resets the module-level sync memos (templates and texts) — test-only. */
export function resetLocalTemplateBackendState(): void {
  syncPromise = undefined
  resetMessagesSyncState()
}

/**
 * Runs the code→database sync (see `db/sync.ts`) for `Model` once per process, then applies the
 * seeds a consumer registered (`registerTemplateSeeds`, `db/seeds.ts`): the built-ins first, so a
 * seed that rewrites one finds it. Shared by `LocalTemplateBackend` (on the first resolve) and the
 * model's own seeder (when the collection becomes ready), so whichever comes first does the work
 * and the other waits for it.
 *
 * @param Model The templates collection.
 */
export function ensureTemplatesSynced(
  Model: AdaptedModel<ZanixTemplateAttrs>,
): Promise<AdaptedModel<ZanixTemplateAttrs>> {
  if (!syncPromise) {
    syncPromise = syncTemplates(Model).catch((error) => {
      syncPromise = undefined
      throw error
    })
  }
  return syncPromise
}

async function syncTemplates(
  Model: AdaptedModel<ZanixTemplateAttrs>,
): Promise<AdaptedModel<ZanixTemplateAttrs>> {
  const codeTemplates = await loadCodeTemplates()
  const libraryEntries = await Promise.all(
    codeTemplates.map(async (entry) => ({
      channel: entry.channel,
      name: entry.name,
      hbs: entry.hbs,
      hash: await hashContent(entry.hbs),
      availableVariables: entry.availableVariables,
      styles: { css: entry.styles, classDefaults: entry.styleDefaults },
    })),
  )
  // The library's own code templates and the ones a consumer registered, synced as one.
  const staticEntries = await withRegisteredTemplates(libraryEntries)
  await adoptRegisteredRecords(Model, staticEntries)

  // `source: CODE_SOURCE` records always carry a real `hbs` (only `DERIVED_TEMPLATES`' seeded
  // fallback records, always `source: 'database'`, ever omit it — see `ZanixTemplateAttrs.hbs`).
  const existing = await Model.find({ source: CODE_SOURCE })
    .lean() as ExistingTemplateEntry[]
  const plan = planTemplateSync(staticEntries, existing)
  const now = new Date()

  await Promise.all([
    ...plan.toOrphan.map(({ _id }) => Model.updateOne({ _id }, { $set: { source: 'database' } })),
    ...plan.toResync.map(
      ({ _id, hbs, hash, version, availableVariables, styles, derivedVersion }) =>
        Model.updateOne({ _id }, {
          $set: {
            hbs,
            lastSyncedHbs: hbs,
            hash,
            lastSyncedHash: hash,
            lastSyncedAt: now,
            version,
            availableVariables,
            styles,
            derivedVersion,
            updatedBy: 'system:bootstrap-sync',
          },
        }),
    ),
    // A `source:'code'` entry with no `lastSyncedHbs` on record has no baseline `planCodeSync`
    // can compare against, so it never enters `toResync` above no matter how code changes —
    // adopting its own current content as that baseline lets a FUTURE code change resync it
    // normally. See `planUntouchedTemplateUpdates`'s own JSDoc for the full rationale.
    ...plan.toBackfillLastSynced.map(({ _id, hbs, hash }) =>
      Model.updateOne({ _id }, {
        $set: {
          lastSyncedHbs: hbs,
          lastSyncedHash: hash,
          lastSyncedAt: now,
          updatedBy: 'system:bootstrap-sync',
        },
      })
    ),
    // An entry whose `hbs` hasn't changed never enters `toResync` above, so a package upgrade
    // that only changes HOW `availableVariables`/`styles` are derived (not the `.hbs` text
    // itself) would otherwise never reach already-tracked entries. Refreshed independently of
    // content, without touching `hbs`/`hash`/`version`.
    ...plan.toRefreshDerived.map(({ _id, availableVariables, styles }) =>
      Model.updateOne({ _id }, {
        $set: {
          availableVariables,
          styles,
          derivedVersion: DERIVED_FIELDS_VERSION,
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
            availableVariables: entry.availableVariables,
            styles: entry.styles,
            derivedVersion: DERIVED_FIELDS_VERSION,
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
            availableVariables: entry.availableVariables,
            styles: entry.styles,
            derivedVersion: DERIVED_FIELDS_VERSION,
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
  #messagesModelName: string

  constructor(
    getDatabase: () => ZanixMongoConnector,
    modelName: string,
    messagesModelName = `${modelName}-messages`,
  ) {
    this.#getDatabase = getDatabase
    this.#modelName = modelName
    this.#messagesModelName = messagesModelName
  }

  /**
   * Ensures the code→database sync (see `db/sync.ts`) has run exactly once for this process. The
   * `ZanixTemplate` model is registered via `registerModel()` at boot (`templates/core.ts`,
   * conditionally on `TEMPLATES_MODEL_NAME`) — but a freshly DI-constructed connector's
   * `initialize()` (which binds registered models, see `defineModels()` in datamaster's own
   * connector processor) resolves asynchronously; `getModel(modelName)`'s name-only lookup only
   * finds something once that's actually finished. This awaits `this.#getDatabase().isReady`
   * before calling it for exactly that reason. Only ever called from
   * `resolve()`, itself gated behind `TEMPLATES_MODEL_NAME` being set, so nothing database-related
   * runs at all for a consumer who never enables this feature. Any failure here (connector not
   * configured, sync error, etc.) is caught by `TemplateProvider.resolve()`'s caller, not here.
   */
  async #ensureSynced(): Promise<AdaptedModel<ZanixTemplateAttrs>> {
    if (syncPromise) return await syncPromise
    const database = this.#getDatabase()
    // Required — see this method's own doc.
    await database.isReady
    return await ensureTemplatesSynced(database.getModel<ZanixTemplateAttrs>(this.#modelName))
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

  /** Reads the texts of `langs` from the message collection (once the collection is synced and seeded). */
  async #loadMessages(langs: string[]): Promise<MessageCatalog> {
    await this.#ensureSynced()
    const MessageModel = await ensureMessagesSynced(
      this.#getDatabase().getModel<ZanixTemplateMessageAttrs>(this.#messagesModelName),
    )
    const rows = await MessageModel.find({ lang: { $in: langs } }).lean() as Pick<
      ZanixTemplateMessageAttrs,
      'lang' | 'key' | 'text'
    >[]
    const catalog: MessageCatalog = {}
    for (const { lang, key, text } of rows) (catalog[lang] ??= {})[key] = text
    return catalog
  }

  public async messages(langs: string[]): Promise<MessageCatalog> {
    // A background worker has no database of its own: it reads what the main thread handed over.
    const preloaded = getPreloadedMessages()
    if (langs.every((lang) => preloaded.has(`znx:msg:${lang}`))) {
      return Object.fromEntries(
        langs.map((lang) => [lang, preloaded.get(`znx:msg:${lang}`) as Record<string, string>]),
      )
    }
    return await this.#loadMessages(langs)
  }

  public async preloadMessages(langs: string[]): Promise<MessageCatalog> {
    return await this.#loadMessages(langs)
  }
}
