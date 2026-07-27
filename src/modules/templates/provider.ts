import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel, ZanixMongoConnector } from '@zanix/datamaster'

import { ZanixProvider } from '@zanix/server'
import logger from '@zanix/logger'

import emailTemplates from 'modules/templates/transactional/email/mod.ts'
import smsTemplates from 'modules/templates/transactional/sms.ts'
import whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

import { CODE_TEMPLATES, hashContent, loadCodeTemplates } from './db/manifest.ts'
import { CODE_SOURCE, planTemplateSync } from './db/sync.ts'

/** Env var naming the `ZanixTemplate` model — presence enables database-backed template resolution (see `resolve()`). Absent, behavior is unchanged from the pure code-registry path. */
export const TEMPLATES_MODEL_ENV = 'TEMPLATES_MODEL_NAME'

type TemplateRegistry = Record<string, (data: never) => Promise<string>>

/** Picks the in-memory template registry that matches a given notifier channel. */
function templatesFor(channel: Notifiers): TemplateRegistry {
  if (channel === 'email') return emailTemplates as TemplateRegistry
  if (channel === 'sms') return smsTemplates as TemplateRegistry
  return whatsappTemplates as TemplateRegistry
}

/** Module-level, once-per-process sync memo — mirrors `email/pool.ts`'s `getSmtpPool()` guard, but as a `Promise` (this does async DB I/O, so concurrent first callers must await the SAME in-flight sync instead of triggering it twice). Reset only in tests. */
let syncPromise: Promise<AdaptedModel<ZanixTemplateAttrs>> | undefined

/** Compiled-render cache, keyed by `{channel}:{name}`, invalidated when the DB `hash` changes — module-level so it's shared across every `SCOPED` `TemplateProvider` instance, the same way `getSmtpPool()`'s pool is. */
const renderCache = new Map<string, { hash: string; render: (data: unknown) => string }>()

/** Resets the module-level sync/render caches — test-only. */
export function resetTemplateProviderState(): void {
  syncPromise = undefined
  renderCache.clear()
}

/**
 * Resolves a channel's `zanixTemplate` name to its rendered content, on behalf of
 * `NotifierProvider.#dispatch()` — the one place in the package that knows about both the
 * in-memory code registries (`transactional/{email,sms,whatsapp}`) and, when enabled, the
 * database-persisted `ZanixTemplate` collection.
 *
 * With `TEMPLATES_MODEL_NAME` unset, `resolve()` is exactly the pre-existing behavior: an in-memory
 * registry lookup, no database access at all. Set, it becomes the priority source at runtime for
 * any `{channel, name}` it holds — code is seed data and fallback only, never re-read once a
 * database record exists (see `docs/templates.md`).
 *
 * Registered `SCOPED` (see `templates/core.ts`), for the same reason `NotifierProvider` is: a
 * `SINGLETON` provider would pin `this.database`'s resolution to a fixed, non-request context
 * forever (see `providers/core.ts`'s own comment on this).
 *
 * @extends ZanixProvider
 */
export class TemplateProvider extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /**
   * Ensures the code→database sync (see `db/sync.ts`) has run exactly once for this process. The
   * `ZanixTemplate` model is registered via `registerModel()` at boot (`templates/core.ts`,
   * conditionally on `TEMPLATES_MODEL_NAME`) — but a freshly DI-constructed connector's
   * `initialize()` (which binds registered models, see `defineModels()` in datamaster's own
   * connector processor) resolves asynchronously; `getModel(modelName)`'s name-only lookup only
   * finds something once that's actually finished. `#sync()` awaits `this.database.isReady`
   * before calling it for exactly that reason — see its own comment. Only ever called from
   * `resolve()`, itself gated behind `TEMPLATES_MODEL_NAME` being set, so nothing database-related
   * runs at all for a consumer who never enables this feature. Any failure here (connector not
   * configured, sync error, etc.) is caught by `resolve()`'s caller, not here — see its own doc
   * comment.
   */
  async #ensureSynced(modelName: string): Promise<AdaptedModel<ZanixTemplateAttrs>> {
    if (!syncPromise) {
      syncPromise = this.#sync(modelName).catch((error) => {
        syncPromise = undefined
        throw error
      })
    }
    return await syncPromise
  }

  async #sync(modelName: string): Promise<AdaptedModel<ZanixTemplateAttrs>> {
    // Required — a freshly DI-constructed connector's `initialize()` (which binds every model
    // registered via `registerModel()`) resolves asynchronously; calling `getModel(modelName)`
    // (name-only) before it settles races the model's own binding and fails to find it.
    await this.database.isReady
    const Model = this.database.getModel<ZanixTemplateAttrs>(modelName)

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

  /** Whether `{channel, name}` owns a real `.hbs` in code (see `db/manifest.ts`). */
  #isCodeTemplate(channel: Notifiers, name: string): boolean {
    return CODE_TEMPLATES.some((entry) => entry.channel === channel && entry.name === name)
  }

  /**
   * Renders a `source:'code'` database record with the same validation/styling its compiled
   * code counterpart applies (`schema.ts`'s Zod parse + the embedded `styles.css`), so an online
   * edit stays visually consistent with its code-defined layout — see `compiler.ts`.
   */
  async #renderCodeBacked(
    channel: Notifiers,
    name: string,
    compile: (data: unknown) => string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const [{ default: dataSchema }, { styles }] = await Promise.all([
      import(`./handlebars/${channel}/${name}/schema.ts`),
      import(`./handlebars/${channel}/${name}/main.js`),
    ])
    // deno-lint-ignore no-explicit-any
    const validated = dataSchema.parse(data) as any
    validated.styles.css = `\n${styles}\n${validated.styles.css}`
    return compile(validated)
  }

  /** Compiles (or reuses the cached compile of) a database record's live `hbs`. */
  async #compile(channel: Notifiers, name: string, hbs: string, hash: string) {
    const cacheKey = `${channel}:${name}`
    const cached = renderCache.get(cacheKey)
    if (cached && cached.hash === hash) return cached.render

    const { default: Handlebars } = await import('handlebars')
    const render = Handlebars.compile(hbs)
    renderCache.set(cacheKey, { hash, render })
    return render
  }

  /**
   * Resolves `zanixTemplate` for `channel` against the database (if `TEMPLATES_MODEL_NAME` is
   * set and a matching, active record exists) or the in-memory code registry otherwise.
   *
   * Any failure on the database path — the connector not actually being configured, a sync error,
   * an invalid `hbs` record, etc. — is caught and logged as a warning, falling back to the code
   * registry rather than failing the send; setting `TEMPLATES_MODEL_NAME` is meant to be a safe,
   * additive enhancement over the code path, never a new way for a send to break.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to resolve.
   * @param data The data to render the template with.
   * @throws If `name` doesn't exist in either the database or the code registry for `channel`.
   */
  public async resolve(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const modelName = Deno.env.get(TEMPLATES_MODEL_ENV)
    const registry = templatesFor(channel)

    if (modelName) {
      try {
        const Model = await this.#ensureSynced(modelName)
        const record = await Model.findOne({ channel, name, active: true }).lean()

        if (record) {
          const compile = await this.#compile(channel, name, record.hbs, record.hash)
          if (record.source === CODE_SOURCE && this.#isCodeTemplate(channel, name)) {
            return await this.#renderCodeBacked(channel, name, compile, data)
          }
          return compile(data)
        }
      } catch (error) {
        logger.warn(
          `[TemplateProvider] Database-backed template resolution failed for "${channel}/${name}"` +
            ` — falling back to code. ${(error as Error).message}`,
        )
      }
    }

    const render = registry[name]
    if (!render) throw new Error(`Template not found: ${channel}/${name}`)
    return await render(data as never)
  }
}
