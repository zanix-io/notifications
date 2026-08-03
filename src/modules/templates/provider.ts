import type { Notifiers } from 'typings/general.ts'
import type { ZanixMongoConnector } from '@zanix/datamaster'
import type { TemplateBackend } from './db/backend.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

import { ZanixProvider } from '@zanix/server'
import logger from '@zanix/logger'

import emailTemplates from 'modules/templates/transactional/email/mod.ts'
import smsTemplates from 'modules/templates/transactional/sms.ts'
import whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

import { CODE_TEMPLATES, DERIVED_TEMPLATES } from './db/manifest.ts'
import { CODE_SOURCE } from './db/sync.ts'
import { LocalTemplateBackend, resetLocalTemplateBackendState } from './db/local-backend.ts'
import {
  RemoteTemplateBackend,
  resetRemoteTemplateBackendAuthClient,
  resetRemoteTemplateBackendCache,
  resetRemoteTemplateBackendSyncState,
} from './db/remote-backend.ts'
import { resolveServiceAssertionKeyId, resolveServiceAssertionPrivateKey } from '@zanix/auth'
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
 * Env var naming this service's own identity, as registered in the central service's
 * `ServiceRegistry` (see `@zanix/admin`'s `setServiceRegistry`/`ZANIX_ADMIN_SERVICES`) under a
 * `serviceId` mapped to a reachable base URL for this process's own
 * `/.well-known/zanix/code-templates` endpoint (see `defineCodeTemplatesDiscovery`). Required
 * alongside `TEMPLATES_SERVICE_URL_ENV` — the central service pulls this service's code templates
 * by this identity, never as a request body.
 */
export const TEMPLATES_SERVICE_ID_ENV = 'TEMPLATES_SERVICE_ID'

/**
 * Env var holding the pre-issued `type: 'api'` machine credential (see `@zanix/auth`'s
 * `X-Znx-Authorization` contract) sent on every call to `TEMPLATES_SERVICE_URL`. This package
 * never mints this token itself — issuance is the deploying operator's/central service's
 * responsibility, not something `RemoteTemplateBackend` does at runtime. Takes priority over
 * `TEMPLATES_SERVICE_AUTH_ID` below when both are set — the only option that works against a
 * central service outside the Zanix ecosystem.
 */
export const TEMPLATES_SERVICE_TOKEN_ENV = 'TEMPLATES_SERVICE_TOKEN'

/**
 * Env var naming THIS service's own signing identity (the assertion's `iss`/`sub`) when
 * authenticating to the central service via `@zanix/auth`'s service-credential exchange —
 * see `RemoteTemplateBackendConfig.auth`. **Distinct from `TEMPLATES_SERVICE_ID_ENV`**: that one is
 * the lookup key the central service's own `ServiceRegistry` uses; this one is who this service
 * claims to be when signing an assertion. They're independent and don't need to match.
 *
 * Neither the matching private key nor which key to sign with are separate env vars — both resolve
 * automatically via `@zanix/auth`'s own conventions: the private key as `JWK_PRI_<this value>` (or
 * `JWK_PRI_<this value>_<keyId>`), and which key to use as `JWK_ID_<this value>` (defaulting to the
 * bare form when unset) — see `createServiceAssertion`'s own doc. The exact mirror image of
 * `@zanix/auth`'s `resolveServiceAssertionKey` convention on the *verifying* side
 * (`JWK_PUB_<serviceId>`/`JWK_PUB_<serviceId>_<keyId>`) — one naming scheme for "my key to sign as
 * X" and "the key I trust for X", not package-specific env var names to remember on top of it.
 * Ignored entirely when `TEMPLATES_SERVICE_TOKEN_ENV` is set.
 */
export const TEMPLATES_SERVICE_AUTH_ID_ENV = 'TEMPLATES_SERVICE_AUTH_ID'

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
 * "silently picking one," exactly what this guards against. Also refuses `TEMPLATES_SERVICE_URL`
 * set without its required `TEMPLATES_SERVICE_ID` counterpart, and `TEMPLATES_SERVICE_AUTH_ID` set
 * without a resolvable matching `JWK_PRI_<id>` (and no `TEMPLATES_SERVICE_TOKEN` fallback either) —
 * a clear signal of intent to authenticate with nothing actually configured to authenticate with.
 *
 * @throws If both `TEMPLATES_SERVICE_URL`/`TEMPLATES_MODEL_NAME` are set, if
 * `TEMPLATES_SERVICE_URL` is set without `TEMPLATES_SERVICE_ID`, or if `TEMPLATES_SERVICE_AUTH_ID`
 * is set without `TEMPLATES_SERVICE_TOKEN` or a resolvable `JWK_PRI_<id>`.
 */
export function assertTemplatesConfigNotConflicting(): void {
  const serviceUrl = Deno.env.get(TEMPLATES_SERVICE_URL_ENV)

  if (serviceUrl && Deno.env.get(TEMPLATES_MODEL_ENV)) {
    throw new InternalError(
      `[TemplateProvider] "${TEMPLATES_SERVICE_URL_ENV}" and "${TEMPLATES_MODEL_ENV}" are ` +
        `mutually exclusive — set only one, never both.`,
    )
  }

  if (serviceUrl && !Deno.env.get(TEMPLATES_SERVICE_ID_ENV)) {
    throw new InternalError(
      `[TemplateProvider] "${TEMPLATES_SERVICE_ID_ENV}" is required alongside ` +
        `"${TEMPLATES_SERVICE_URL_ENV}" — the central service pulls this service's code ` +
        `templates by that identity.`,
    )
  }

  const authServiceId = Deno.env.get(TEMPLATES_SERVICE_AUTH_ID_ENV)
  if (authServiceId && !Deno.env.get(TEMPLATES_SERVICE_TOKEN_ENV)) {
    // Reuses `@zanix/auth`'s own resolvers rather than duplicating its `JWK_ID_<id>`/`JWK_PRI_<id>`/
    // `JWK_PRI_<id>_<keyId>` naming rules here — throws `InternalError` (propagated as-is, already
    // names the exact missing env var) if nothing is registered.
    const keyId = resolveServiceAssertionKeyId(authServiceId)
    resolveServiceAssertionPrivateKey(authServiceId, keyId)
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

/**
 * Data transform applied by `resolve()`'s database-backed parent-chain walk (`#resolveChain()`)
 * when a `DERIVED_TEMPLATES` entry has no content of its own — the exact same mapping each
 * `transactional/*` wrapper applies before calling `execTemplate()` directly, so a database-edited
 * ancestor (e.g. `generic`) renders with equivalent data regardless of whether the send took the
 * pure code path or fell through to the database. Built directly from `DERIVED_TEMPLATES` — a new
 * derived template only ever needs declaring once, in its own `transactional/*` module (see
 * `typings/templates.ts`'s `DerivedTemplateDeclaration`), never registered separately here too.
 */
const derivedTemplateTransforms = new Map(
  DERIVED_TEMPLATES.map((entry) => [`${entry.channel}:${entry.name}`, entry.transform]),
)

/** Resets every module-level template cache (sync memo, remote fetch cache, compiled-render cache) — test-only. */
export function resetTemplateProviderState(): void {
  resetLocalTemplateBackendState()
  resetRemoteTemplateBackendCache()
  resetRemoteTemplateBackendSyncState()
  resetRemoteTemplateBackendAuthClient()
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
      assertTemplatesConfigNotConflicting()
      const token = Deno.env.get(TEMPLATES_SERVICE_TOKEN_ENV)
      const authServiceId = Deno.env.get(TEMPLATES_SERVICE_AUTH_ID_ENV)
      return new RemoteTemplateBackend({
        url: serviceUrl,
        serviceId: Deno.env.get(TEMPLATES_SERVICE_ID_ENV) as string,
        token,
        // Only built when there's no static `token` — see `RemoteTemplateBackendConfig.auth`'s own
        // doc on the priority between the two. `privateKey`/`keyId` deliberately omitted: their
        // resolvability (`JWK_ID_<authServiceId>`/`JWK_PRI_<authServiceId>[_<keyId>]`) was already
        // checked above by `assertTemplatesConfigNotConflicting()` — `createServiceAssertion`
        // resolves both again, lazily, at actual sign time, so neither has to pass through here.
        auth: !token && authServiceId ? { serviceId: authServiceId } : undefined,
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
   * Fetches `zanixTemplate` for `channel` against the configured backend (mirrors `resolve()`'s
   * backend lookup, without the code-registry fallback), so a caller can build its own
   * request-scoped cache ahead of time — see `NotifierProvider.onDestroy()`.
   *
   * `undefined` if no persisted backend is configured (see `#backend()`) — a no-op in that case.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to preload.
   */
  public preload(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined> | undefined {
    return this.#backend()?.preload(channel, name)
  }

  /**
   * Preloads `{channel, name}` AND every ancestor in its `parent` chain (see `#resolveChain()`'s
   * own chain walk, and `db/manifest.ts`'s `DERIVED_TEMPLATES`) into `cache`, keyed the same way
   * `LocalTemplateBackend`'s own cache is (`` `znx:${channel}:${name}` ``) — so a one-time worker's
   * `resolve()` call can satisfy every hop from the passed-in cache alone, without opening its own
   * database connection for any of them. A no-op (nothing added to `cache`) if no persisted
   * backend is configured — see `preload()`.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name whose whole chain should be preloaded.
   * @param cache The map to populate — see `NotifierProvider.onDestroy()`.
   */
  public async preloadChain(
    channel: Notifiers,
    name: string,
    cache: Map<`znx:${Notifiers}:${string}`, ZanixTemplateAttrs | undefined>,
  ): Promise<void> {
    const backend = this.#backend()
    if (!backend) return

    const visited = new Set<string>()
    let current: string | undefined = name

    while (current && !visited.has(current)) {
      visited.add(current)
      // Each hop's name is only known after the previous one resolves — genuinely sequential,
      // not a batch of independent lookups `Promise.all` could parallelize.
      // deno-lint-ignore no-await-in-loop
      const record = await backend.preload(channel, current)
      cache.set(`znx:${channel}:${current}`, record)
      current = (!record?.hbs && record?.parent) ? record.parent : undefined
    }
  }

  /**
   * Resolves `zanixTemplate` for `channel` against a persisted backend (Modes A/B via
   * `TEMPLATES_MODEL_NAME`, or Mode C via `TEMPLATES_SERVICE_URL` — see `#backend()`) if one is
   * configured, `DATABASE_TEMPLATES` isn't explicitly `'false'`, and a matching, active record
   * exists anywhere in `name`'s `parent` chain (see `#resolveChain()`) — falling back to the
   * in-memory code registry, for the original `name`/`data`, otherwise.
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
   * backend (nor anywhere in its `parent` chain) or the code registry for `channel`.
   */
  public async resolve(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    assertTemplatesConfigNotConflicting()

    const backend = this.#backend()
    if (backend) {
      try {
        const rendered = await this.#resolveChain(channel, name, data, backend, new Set())
        if (rendered !== undefined) return rendered
      } catch (error) {
        logger.warn(
          `[TemplateProvider] Database-backed template resolution failed for "${channel}/${name}"` +
            ` — falling back to code. ${(error as Error).message}`,
        )
      }
    }

    const registry = templatesFor(channel)
    const render = registry[name]
    if (!render) throw new Error(`Template not found: ${channel}/${name}`)
    return await render(data as never)
  }

  /**
   * Walks `record.parent` (see `db/manifest.ts`'s `DERIVED_TEMPLATES`) starting at `{channel,
   * name}`, applying each hop's registered data transform (`derivedTemplateTransforms`, if any),
   * until it finds a record with active content of its own — returning that render — or the chain
   * runs out: no `parent`, a missing/inactive record, or a cycle back to an already-visited name.
   * Returns `undefined` in that case so `resolve()` falls back to the code registry for the
   * ORIGINAL `name`/`data` it was called with, not whatever hop this walk stopped at.
   */
  async #resolveChain(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
    backend: TemplateBackend,
    visited: Set<string>,
  ): Promise<string | undefined> {
    if (visited.has(name)) return undefined
    visited.add(name)

    const record = await backend.resolve(channel, name)
    if (!record) return undefined

    if (record.hbs) {
      const compile = await this.#compile(channel, name, record.hbs, record.hash)
      if (record.source === CODE_SOURCE && this.#isCodeTemplate(channel, name)) {
        return await this.#renderCodeBacked(channel, name, compile, data)
      }
      return compile(data)
    }

    if (!record.parent) return undefined

    const transform = derivedTemplateTransforms.get(`${channel}:${name}`)
    const parentData = transform ? transform(data as never) : data
    return await this.#resolveChain(channel, record.parent, parentData, backend, visited)
  }
}
