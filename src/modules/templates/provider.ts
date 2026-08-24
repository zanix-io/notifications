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
  resetRemoteTemplateBackendCache,
  resetRemoteTemplateBackendSyncState,
} from './db/remote-backend.ts'
import {
  assertServiceAssertionKeyResolvable,
  createRemoteTemplateAuthClient,
  resetRemoteTemplateAuthClient,
} from './db/remote-backend-auth.ts'
import { ApplicationError, InternalError } from '@zanix/errors'

/**
 * Env var naming the `ZanixTemplate` model — only consulted when `TEMPLATES_BACKEND=local` (see
 * `templatesBackendMode()`); optional even then, defaulting to `DEFAULT_TEMPLATES_MODEL_NAME` via
 * `templatesModelName()`. Setting this alone, with `TEMPLATES_BACKEND` unset or set to `'remote'`,
 * has no effect — it's simply never read, not a conflict to detect (see `templatesBackendMode()`'s
 * own doc for why).
 */
export const TEMPLATES_MODEL_ENV = 'TEMPLATES_MODEL_NAME'

/**
 * Env var selecting which mode `TemplateProvider` resolves templates against — the single source
 * of truth for the local-vs-remote decision (see `templatesBackendMode()`'s own doc for the full
 * rationale).
 *
 * - Unset (or empty string): the pure code-registry path — no database access, no HTTP calls,
 *   nothing to configure.
 * - `'local'`: Modes A/B — a `@zanix/datamaster`-backed `ZanixTemplate` collection, named by
 *   `TEMPLATES_MODEL_ENV` (optional, defaults to `DEFAULT_TEMPLATES_MODEL_NAME`).
 * - `'remote'`: Mode C — a central Notification/Template Service over HTTP, configured via
 *   `TEMPLATES_SERVICE_URL_ENV`/`TEMPLATES_SERVICE_ID_ENV`/etc.
 *
 * Any other value throws — see `templatesBackendMode()`.
 */
export const TEMPLATES_BACKEND_ENV = 'TEMPLATES_BACKEND'

/** The two persisted-backend modes `TEMPLATES_BACKEND` selects between — see its own doc. `undefined` (unset/empty) is the third, implicit state: the pure code-registry path. */
export type TemplatesBackendMode = 'local' | 'remote'

/**
 * Reads and validates `TEMPLATES_BACKEND_ENV` — the explicit selector between Modes A/B (`'local'`)
 * and Mode C (`'remote'`). The mode comes from exactly one place, and each mode's own vars
 * (`TEMPLATES_MODEL_ENV` for `'local'`;
 * `TEMPLATES_SERVICE_URL_ENV`/`TEMPLATES_SERVICE_ID_ENV`/`TEMPLATES_SERVICE_TOKEN_ENV`/
 * `TEMPLATES_SERVICE_AUTH_ID_ENV`/`TEMPLATES_SERVICE_CACHE_TTL_ENV` for `'remote'`) are only ever
 * read once that mode is actually selected — setting one mode's var while a different mode (or no
 * mode) is selected simply has no effect, it's never consulted.
 *
 * @returns `'local'`, `'remote'`, or `undefined` for the pure code-registry path.
 * @throws If `TEMPLATES_BACKEND_ENV` is set to anything other than `'local'`, `'remote'`, or empty.
 */
export function templatesBackendMode(): TemplatesBackendMode | undefined {
  const raw = Deno.env.get(TEMPLATES_BACKEND_ENV)
  if (!raw) return undefined

  if (raw !== 'local' && raw !== 'remote') {
    throw new InternalError(
      `[TemplateProvider] "${TEMPLATES_BACKEND_ENV}" must be "local" or "remote" (or unset, for ` +
        `the pure code-registry path) — got "${raw}".`,
      { code: 'NOTIFICATIONS_TEMPLATES_BACKEND_INVALID', meta: { value: raw } },
    )
  }

  return raw
}

/**
 * Whether `TEMPLATES_BACKEND` currently selects `mode` — a convenience for a downstream consumer
 * (e.g. `@zanix/admin`'s own `/admin/templates` REST/operations gating) that only cares about one
 * specific mode being active, without comparing {@link templatesBackendMode}'s own three-state
 * return value (`'local' | 'remote' | undefined`) itself. Takes `mode` explicitly rather than
 * defaulting to `'local'` — "templates enabled" has no single meaning on its own: a deployment
 * running Mode C (`'remote'`) has templates fully configured, just not `'local'`, so a caller must
 * state which mode it means rather than this function silently assuming the local case.
 */
export const isTemplatesResourceEnabled = (mode: TemplatesBackendMode): boolean =>
  templatesBackendMode() === mode

/** Default `ZanixTemplate` model name applied when `TEMPLATES_BACKEND=local` and `TEMPLATES_MODEL_NAME` is unset — see `templatesModelName()`. */
export const DEFAULT_TEMPLATES_MODEL_NAME = 'zanix-templates'

/**
 * Resolves the effective templates collection name — only meaningful once `TEMPLATES_BACKEND=local`
 * is selected (see `templatesBackendMode()`), mirroring `TemplateProvider`'s own resolution.
 */
export const templatesModelName = (): string =>
  Deno.env.get(TEMPLATES_MODEL_ENV) || DEFAULT_TEMPLATES_MODEL_NAME

/**
 * Env var naming the central Notification/Template Service's *internal admin* base URL — required
 * when `TEMPLATES_BACKEND=remote` is selected (see `templatesBackendMode()`; Mode C,
 * `docs/templates.md#mode-c-remote-only-templates`): every `resolve()` call is then fetched against
 * this URL's `/admin/templates/:channel/:name` instead of a local `ZanixTemplate` model. Setting
 * this without also selecting `TEMPLATES_BACKEND=remote` has no effect — see
 * `templatesBackendMode()`'s own doc.
 */
export const TEMPLATES_SERVICE_URL_ENV = 'TEMPLATES_SERVICE_URL'

/**
 * Env var naming this service's own identity, as registered in the central service's
 * `ServiceRegistry` (see `@zanix/admin`'s `setServiceRegistry`/`ZANIX_ADMIN_SERVICES`) under a
 * `serviceId` mapped to a reachable base URL for this process's own
 * `/.well-known/zanix/code-templates` endpoint (see `defineCodeTemplatesDiscovery`). Only
 * meaningful — and required — under `TEMPLATES_BACKEND=remote`, alongside `TEMPLATES_SERVICE_URL_ENV`
 * — the central service pulls this service's code templates by this identity, never as a request
 * body.
 */
export const TEMPLATES_SERVICE_ID_ENV = 'TEMPLATES_SERVICE_ID'

/**
 * Env var holding the pre-issued `type: 'api'` machine credential (see `@zanix/auth`'s
 * `X-Znx-Authorization` contract) sent on every call to `TEMPLATES_SERVICE_URL`, only meaningful
 * under `TEMPLATES_BACKEND=remote`. This package never mints this token itself — issuance is the
 * deploying operator's/central service's responsibility, not something `RemoteTemplateBackend` does
 * at runtime. Takes priority over `TEMPLATES_SERVICE_AUTH_ID` below when both are set — the only
 * option that works against a central service outside the Zanix ecosystem.
 */
export const TEMPLATES_SERVICE_TOKEN_ENV = 'TEMPLATES_SERVICE_TOKEN'

/**
 * Env var naming THIS service's own signing identity (the assertion's `iss`/`sub`) when
 * authenticating to the central service via `@zanix/auth`'s service-credential exchange — see
 * `RemoteTemplateBackendConfig.authClient`, built (from this value) by `#backend()` below via
 * `remote-backend-auth.ts`'s `createRemoteTemplateAuthClient` — the one module in this package
 * allowed to import `@zanix/auth` directly (see its own doc). **Distinct from
 * `TEMPLATES_SERVICE_ID_ENV`**: that one is the lookup key the central service's own
 * `ServiceRegistry` uses; this one is who this service claims to be when signing an assertion.
 * They're independent and don't need to match.
 *
 * Neither the matching private key nor which key to sign with are separate env vars — both resolve
 * automatically via `@zanix/auth`'s own conventions: the private key as `JWK_PRI_<this value>` (or
 * `JWK_PRI_<this value>_<keyId>`), and which key to use as `JWK_ID_<this value>` (defaulting to the
 * bare form when unset) — see `createServiceAssertion`'s own doc. The exact mirror image of
 * `@zanix/auth`'s `resolveServiceAssertionKey` convention on the *verifying* side
 * (`JWK_PUB_<serviceId>`/`JWK_PUB_<serviceId>_<keyId>`) — one naming scheme for "my key to sign as
 * X" and "the key I trust for X", not package-specific env var names to remember on top of it.
 * Ignored entirely when `TEMPLATES_SERVICE_TOKEN_ENV` is set. Only meaningful under
 * `TEMPLATES_BACKEND=remote`.
 */
export const TEMPLATES_SERVICE_AUTH_ID_ENV = 'TEMPLATES_SERVICE_AUTH_ID'

/**
 * Env var overriding `RemoteTemplateBackend`'s default local fetch-cache TTL (milliseconds) — see
 * `db/remote-backend.ts`'s `DEFAULT_CACHE_TTL_MS`. Only meaningful under `TEMPLATES_BACKEND=remote`.
 */
export const TEMPLATES_SERVICE_CACHE_TTL_ENV = 'TEMPLATES_SERVICE_CACHE_TTL_MS'

/**
 * Validates the configuration required by whichever mode `TEMPLATES_BACKEND_ENV` currently selects
 * (see `templatesBackendMode()`) — called at boot (`templates/core.ts`) and at the top of every
 * `resolve()` call. Deliberately left uncaught by `resolve()`'s own warn-and-fallback `try/catch`:
 * silently falling back to the code registry on a genuine misconfiguration would defeat the point
 * of validating it eagerly.
 *
 * A no-op for the pure code-registry path (`TEMPLATES_BACKEND` unset) and for `'local'`
 * (`TEMPLATES_MODEL_NAME` is optional there, with no required counterpart to check — see
 * `templatesModelName()`). For `'remote'`, refuses to proceed without `TEMPLATES_SERVICE_URL` and
 * its required `TEMPLATES_SERVICE_ID` counterpart, and refuses `TEMPLATES_SERVICE_AUTH_ID` set
 * without a resolvable matching `JWK_PRI_<id>` (and no `TEMPLATES_SERVICE_TOKEN` fallback either) —
 * a clear signal of intent to authenticate with nothing actually configured to authenticate with.
 *
 * Since the mode is selected explicitly by exactly one env var, an invalid combination (both
 * `TEMPLATES_SERVICE_URL` and `TEMPLATES_MODEL_NAME`/`DATABASE_TEMPLATES=true` set at once) can't
 * be represented — a stray `TEMPLATES_MODEL_NAME` left over from a different mode is simply never
 * read, not a conflict to refuse.
 *
 * @throws If `TEMPLATES_BACKEND_ENV` is set to something other than `'local'`/`'remote'` (see
 * `templatesBackendMode()`), if `'remote'` is selected without `TEMPLATES_SERVICE_URL`, if
 * `TEMPLATES_SERVICE_URL` is set without `TEMPLATES_SERVICE_ID`, or if `TEMPLATES_SERVICE_AUTH_ID`
 * is set without `TEMPLATES_SERVICE_TOKEN` or a resolvable `JWK_PRI_<id>`.
 */
export function assertTemplatesBackendConfigValid(): void {
  if (!isTemplatesResourceEnabled('remote')) return

  if (!Deno.env.get(TEMPLATES_SERVICE_URL_ENV)) {
    throw new InternalError(
      `[TemplateProvider] "${TEMPLATES_SERVICE_URL_ENV}" is required when ` +
        `"${TEMPLATES_BACKEND_ENV}=remote" is selected.`,
      { code: 'NOTIFICATIONS_TEMPLATES_REMOTE_SERVICE_URL_MISSING' },
    )
  }

  if (!Deno.env.get(TEMPLATES_SERVICE_ID_ENV)) {
    throw new InternalError(
      `[TemplateProvider] "${TEMPLATES_SERVICE_ID_ENV}" is required alongside ` +
        `"${TEMPLATES_SERVICE_URL_ENV}" — the central service pulls this service's code ` +
        `templates by that identity.`,
      { code: 'NOTIFICATIONS_TEMPLATES_REMOTE_SERVICE_ID_MISSING' },
    )
  }

  const authServiceId = Deno.env.get(TEMPLATES_SERVICE_AUTH_ID_ENV)
  if (authServiceId && !Deno.env.get(TEMPLATES_SERVICE_TOKEN_ENV)) {
    // Delegates to `remote-backend-auth.ts`'s `assertServiceAssertionKeyResolvable` — this package's
    // one real `@zanix/auth` import site (see its own doc) — rather than importing `@zanix/auth`'s
    // `resolveServiceAssertionKeyId`/`resolveServiceAssertionPrivateKey` here directly. Throws
    // `InternalError` (propagated as-is, already names the exact missing env var) if nothing is
    // registered.
    assertServiceAssertionKeyResolvable(authServiceId)
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
const renderCache = new Map<
  string,
  { hash: string; render: (data: unknown) => string }
>()

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
  DERIVED_TEMPLATES.map((
    entry,
  ) => [`${entry.channel}:${entry.name}`, entry.transform]),
)

/** Resets every module-level template cache (sync memo, remote fetch cache, compiled-render cache) — test-only. */
export function resetTemplateProviderState(): void {
  resetLocalTemplateBackendState()
  resetRemoteTemplateBackendCache()
  resetRemoteTemplateBackendSyncState()
  resetRemoteTemplateAuthClient()
  renderCache.clear()
}

/**
 * Resolves a channel's `zanixTemplate` name to its rendered content, on behalf of
 * `NotifierProvider.#dispatch()` — the one place in the package that knows about both the
 * in-memory code registries (`transactional/{email,sms,whatsapp}`) and, when enabled, the
 * database-persisted `ZanixTemplate` collection.
 *
 * With `TEMPLATES_BACKEND` unset, `resolve()` is a pure in-memory registry lookup, no database
 * access at all. Set to `'local'` or `'remote'` (see
 * `templatesBackendMode()`), the selected backend becomes the priority source at runtime for any
 * `{channel, name}` it holds — code is seed data and fallback only, never re-read once a database
 * record exists (see `docs/templates.md`).
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
   * cached on the instance) — mirrors `resolve()`'s own pattern of re-reading `Deno.env.get(...)`
   * on every call rather than once at construction, which also sidesteps any
   * assumption about env vars being set before a DI-constructed `TemplateProvider` exists.
   *
   * `undefined` when `TEMPLATES_BACKEND` is unset — the pure code-registry path. Which concrete
   * backend gets built for `'local'`/`'remote'` is entirely `templatesBackendMode()`'s call; this
   * method only ever reads that one selector to decide, never infers it from which of the
   * mode-specific vars happen to be set.
   */
  #backend(): TemplateBackend | undefined {
    if (!templatesBackendMode()) return undefined

    assertTemplatesBackendConfigValid()

    if (isTemplatesResourceEnabled('remote')) {
      const token = Deno.env.get(TEMPLATES_SERVICE_TOKEN_ENV)
      const authServiceId = Deno.env.get(TEMPLATES_SERVICE_AUTH_ID_ENV)
      return new RemoteTemplateBackend({
        url: Deno.env.get(TEMPLATES_SERVICE_URL_ENV) as string,
        serviceId: Deno.env.get(TEMPLATES_SERVICE_ID_ENV) as string,
        token,
        // Only built when there's no static `token` — see `RemoteTemplateBackendConfig.authClient`'s
        // own doc on the priority between the two. Built via `remote-backend-auth.ts`'s
        // `createRemoteTemplateAuthClient` (this package's one real `@zanix/auth` import site, see
        // its own doc) rather than passing raw options into `RemoteTemplateBackend` itself — it never
        // imports `@zanix/auth`, see `remote-backend.ts`'s own `ServiceAuthClient` doc on why.
        // `privateKey`/`keyId` deliberately omitted: their resolvability
        // (`JWK_ID_<authServiceId>`/`JWK_PRI_<authServiceId>[_<keyId>]`) was already checked above by
        // `assertTemplatesBackendConfigValid()` — `createServiceAssertion` resolves both again,
        // lazily, at actual sign time, so neither has to pass through here.
        authClient: !token && authServiceId
          ? createRemoteTemplateAuthClient({ serviceId: authServiceId })
          : undefined,
        cacheTtlMs: Number(Deno.env.get(TEMPLATES_SERVICE_CACHE_TTL_ENV)) ||
          undefined,
      })
    }

    return new LocalTemplateBackend(() => this.database, templatesModelName())
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
   * `TEMPLATES_BACKEND=local`, or Mode C via `TEMPLATES_BACKEND=remote` — see `#backend()`) if that
   * mode is selected and a matching, active record exists anywhere in `name`'s `parent` chain (see
   * `#resolveChain()`) — falling back to the in-memory code registry, for the original `name`/
   * `data`, otherwise.
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
   * @throws If `TEMPLATES_BACKEND` is set to an invalid value, or `'remote'` is selected without
   * its required config (see `assertTemplatesBackendConfigValid()`), or if `name` doesn't exist in
   * either the configured backend (nor anywhere in its `parent` chain) or the code registry for
   * `channel`.
   */
  public async resolve(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    assertTemplatesBackendConfigValid()

    const backend = this.#backend()
    if (backend) {
      try {
        const rendered = await this.#resolveChain(
          channel,
          name,
          data,
          backend,
          new Set(),
        )
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
    // The caller asked for a `channel`/`name` pair that doesn't exist in either backend — a
    // caller-supplied-bad-identifier, not an internal fault (see `@zanix/errors`' docs, "Choosing
    // a class").
    if (!render) {
      throw new ApplicationError(`Template not found: ${channel}/${name}`, {
        code: 'TEMPLATE_NOT_FOUND',
        meta: { channel, name },
      })
    }
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
      const compile = await this.#compile(
        channel,
        name,
        record.hbs,
        record.hash,
      )
      if (
        record.source === CODE_SOURCE && this.#isCodeTemplate(channel, name)
      ) {
        return await this.#renderCodeBacked(channel, name, compile, data)
      }
      return compile(data)
    }

    if (!record.parent) return undefined

    const transform = derivedTemplateTransforms.get(`${channel}:${name}`)
    const parentData = transform ? transform(data as never) : data
    return await this.#resolveChain(
      channel,
      record.parent,
      parentData,
      backend,
      visited,
    )
  }
}
