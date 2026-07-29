import type { Notifiers } from 'typings/general.ts'
import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { TemplateBackend } from './db/backend.ts'

import { ZanixProvider } from '@zanix/server'
import logger from '@zanix/logger'

import emailTemplates from 'modules/templates/transactional/email/mod.ts'
import smsTemplates from 'modules/templates/transactional/sms.ts'
import whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

import { CODE_TEMPLATES } from './db/manifest.ts'
import { CODE_SOURCE } from './db/sync.ts'
import { LocalTemplateBackend, resetLocalTemplateBackendState } from './db/local-backend.ts'
import {
  RemoteTemplateBackend,
  resetRemoteTemplateBackendCache,
  resetRemoteTemplateBackendSyncState,
} from './db/remote-backend.ts'
import { InternalError } from '@zanix/errors'

/** Env var naming the `ZanixTemplate` model — presence enables database-backed template resolution (see `resolve()`). Absent, behavior is unchanged from the pure code-registry path. */
export const TEMPLATES_MODEL_ENV = 'TEMPLATES_MODEL_NAME'

/**
 * Env var that, set to `'true'`, enables database-backed templates under the default model name
 * (`'zanix-templates'`) without having to name it explicitly via `TEMPLATES_MODEL_NAME` — see
 * `templates/core.ts`. Never overrides `TEMPLATES_MODEL_NAME` if that's already set (including to
 * an explicit empty string, a valid opt-out). Deliberately NOT tied to any database connector's
 * own configuration (e.g. `MONGO_URI`) — this package has no reason to know that variable exists;
 * enabling the feature always requires this explicit opt-in, in every app, full or standalone.
 *
 * Set to `'false'` instead, it's a kill switch — mirrors `@zanix/datamaster`'s own
 * `DATABASE_SEEDERS === 'false'` convention: it disables database-backed templates entirely, even
 * when `TEMPLATES_MODEL_NAME` is explicitly set to something (see `isDatabaseTemplatesDisabled()`),
 * for the same reason a deployment might want a single environment-level override that wins over
 * whatever an individual app happened to configure.
 */
export const DATABASE_TEMPLATES_ENV = 'DATABASE_TEMPLATES'

/**
 * Whether `DATABASE_TEMPLATES=false` is explicitly disabling database-backed templates — checked
 * both at boot (`templates/core.ts`'s `registerModel()` gate) and at every `resolve()` call, so
 * the kill switch takes effect regardless of whether `TEMPLATES_MODEL_NAME` is also set.
 */
export function isDatabaseTemplatesDisabled(): boolean {
  return Deno.env.get(DATABASE_TEMPLATES_ENV) === 'false'
}

/** Default `ZanixTemplate` model name applied when `DATABASE_TEMPLATES=true` (see `templates/core.ts`'s `defaultTemplatesModelName()`). */
export const DEFAULT_TEMPLATES_MODEL_NAME = 'zanix-templates'

/**
 * Resolves the effective templates collection name (only meaningful once DB mode is active —
 * see {@link isDatabaseTemplatesDisabled}), mirroring `TemplateProvider`'s own resolution.
 */
export const templatesModelName = (): string =>
  Deno.env.get(TEMPLATES_MODEL_ENV) || DEFAULT_TEMPLATES_MODEL_NAME

/**
 * Env var naming the central Notification/Template Service's *internal admin* base URL — presence
 * enables Mode C (remote-only templates, see `docs/templates.md#mode-c-remote-only-templates`): no
 * local `ZanixTemplate` model is registered or synced against; every `resolve()` instead calls out
 * to this URL's `/admin/templates/:channel/:name`. Mutually exclusive with `TEMPLATES_MODEL_ENV` —
 * see `assertTemplatesConfigNotConflicting()`.
 */
export const TEMPLATES_SERVICE_URL_ENV = 'TEMPLATES_SERVICE_URL'

/**
 * Env var holding the pre-issued `type: 'api'` machine credential (see `@zanix/auth`'s
 * `X-Znx-Authorization` contract) sent on every call to `TEMPLATES_SERVICE_URL`. This package
 * never mints this token itself — issuance is the deploying operator's/central service's
 * responsibility, not something `RemoteTemplateBackend` does at runtime.
 */
export const TEMPLATES_SERVICE_TOKEN_ENV = 'TEMPLATES_SERVICE_TOKEN'

/**
 * Env var overriding `RemoteTemplateBackend`'s default local fetch-cache TTL (milliseconds) — see
 * `db/remote-backend.ts`'s `DEFAULT_CACHE_TTL_MS`. Only meaningful alongside `TEMPLATES_SERVICE_URL`.
 */
export const TEMPLATES_SERVICE_CACHE_TTL_ENV = 'TEMPLATES_SERVICE_CACHE_TTL_MS'

/**
 * Refuses a configuration that sets both `TEMPLATES_SERVICE_URL` (Mode C) and `TEMPLATES_MODEL_NAME`
 * (Modes A/B) at once, rather than silently picking one — called at boot (`templates/core.ts`) and
 * at the top of every `resolve()` call. Deliberately left uncaught by `resolve()`'s own
 * warn-and-fallback `try/catch`: silently falling back to the code registry would itself be
 * "silently picking one," exactly what this guards against.
 *
 * @throws If both env vars are set.
 */
export function assertTemplatesConfigNotConflicting(): void {
  if (Deno.env.get(TEMPLATES_SERVICE_URL_ENV) && Deno.env.get(TEMPLATES_MODEL_ENV)) {
    throw new InternalError(
      `[TemplateProvider] "${TEMPLATES_SERVICE_URL_ENV}" and "${TEMPLATES_MODEL_ENV}" are ` +
        `mutually exclusive — set only one, never both.`,
    )
  }
}

type TemplateRegistry = Record<string, (data: never) => Promise<string>>

/** Picks the in-memory template registry that matches a given notifier channel. */
function templatesFor(channel: Notifiers): TemplateRegistry {
  if (channel === 'email') return emailTemplates as TemplateRegistry
  if (channel === 'sms') return smsTemplates as TemplateRegistry
  return whatsappTemplates as TemplateRegistry
}

/** Compiled-render cache, keyed by `{channel}:{name}`, invalidated when the DB `hash` changes — module-level so it's shared across every `SCOPED` `TemplateProvider` instance, the same way `getSmtpPool()`'s pool is. */
const renderCache = new Map<string, { hash: string; render: (data: unknown) => string }>()

/** Resets every module-level template cache (sync memo, remote fetch cache, compiled-render cache) — test-only. */
export function resetTemplateProviderState(): void {
  resetLocalTemplateBackendState()
  resetRemoteTemplateBackendCache()
  resetRemoteTemplateBackendSyncState()
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
   * Picks the `TemplateBackend` to resolve `{channel, name}` against, fresh on every call (not
   * cached on the instance) — mirrors `resolve()`'s own pre-existing pattern of re-reading
   * `Deno.env.get(...)` on every call rather than once at construction, which also sidesteps any
   * assumption about env vars being set before a DI-constructed `TemplateProvider` exists.
   *
   * `undefined` if neither `TEMPLATES_SERVICE_URL` nor `TEMPLATES_MODEL_NAME` is set, or if
   * `DATABASE_TEMPLATES=false` — the pure code-registry path, unchanged from before Mode C existed.
   */
  #backend(): TemplateBackend | undefined {
    if (isDatabaseTemplatesDisabled()) return undefined

    const serviceUrl = Deno.env.get(TEMPLATES_SERVICE_URL_ENV)
    if (serviceUrl) {
      return new RemoteTemplateBackend({
        url: serviceUrl,
        token: Deno.env.get(TEMPLATES_SERVICE_TOKEN_ENV),
        cacheTtlMs: Number(Deno.env.get(TEMPLATES_SERVICE_CACHE_TTL_ENV)) || undefined,
      })
    }

    const modelName = Deno.env.get(TEMPLATES_MODEL_ENV)
    if (modelName) {
      return new LocalTemplateBackend(() => this.database, modelName)
    }

    return undefined
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
   * Resolves `zanixTemplate` for `channel` against a persisted backend (Modes A/B via
   * `TEMPLATES_MODEL_NAME`, or Mode C via `TEMPLATES_SERVICE_URL` — see `#backend()`) if one is
   * configured, `DATABASE_TEMPLATES` isn't explicitly `'false'`, and a matching, active record
   * exists — falling back to the in-memory code registry otherwise.
   *
   * Any failure on the backend path — the connector not actually being configured, a sync error,
   * a network error calling the remote service, an invalid `hbs` record, etc. — is caught and
   * logged as a warning, falling back to the code registry rather than failing the send; enabling
   * either mode is meant to be a safe, additive enhancement over the code path, never a new way for
   * a send to break.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to resolve.
   * @param data The data to render the template with.
   * @throws If `TEMPLATES_SERVICE_URL` and `TEMPLATES_MODEL_NAME` are both set (see
   * `assertTemplatesConfigNotConflicting()`), or if `name` doesn't exist in either the configured
   * backend or the code registry for `channel`.
   */
  public async resolve(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    assertTemplatesConfigNotConflicting()

    const backend = this.#backend()
    const registry = templatesFor(channel)

    if (backend) {
      try {
        const record = await backend.resolve(channel, name)

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
