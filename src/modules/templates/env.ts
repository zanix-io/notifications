import { InternalError } from '@zanix/errors'
import { assertServiceAssertionKeyResolvable } from './db/remote-backend-auth.ts'

/**
 * `TEMPLATES_BACKEND`/`TEMPLATES_MODEL_NAME`/`TEMPLATES_SERVICE_*` env var selection and
 * validation — deliberately kept in its own file, separate from `provider.ts`'s `TemplateProvider`
 * class. `TemplateProvider` value-imports every channel's compiled template registry (reaching
 * Handlebars and each template's own Zod schema), a real cost that has nothing to do with simply
 * knowing WHICH backend mode is selected. Mirrors `sms/defs.ts`'s `resolveSmsProvider()`/
 * `whatsapp/defs.ts`'s `resolveWhatsappProvider()` — both already isolated in an equally lightweight
 * file for the same reason.
 */

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
 *   `TEMPLATES_SERVICE_URL_ENV`/`TEMPLATES_SERVICE_ID_ENV`/etc — see `TEMPLATES_SERVICE_PATH_PREFIX_ENV`
 *   in particular when that URL points at a `ZanixAdminHub` instead of a single service's own admin API.
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
 * `RemoteTemplateBackendConfig.authClient`, built (from this value) by `provider.ts`'s `#backend()`
 * via `remote-backend-auth.ts`'s `createRemoteTemplateAuthClient` — the one module in this package
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
 * Env var overriding the route prefix `RemoteTemplateBackend` calls at `TEMPLATES_SERVICE_URL` —
 * see `db/remote-backend.ts`'s `DEFAULT_PATH_PREFIX`. Optional; defaults to `'admin/templates'`,
 * matching a plain `@zanix/core`-based service's own local admin API (`admin: true`, see
 * `@zanix/admin`'s `defineAdminMetadata`). **Set this to `'templates'` when `TEMPLATES_SERVICE_URL`
 * instead points at a `ZanixAdminHub` instance** — the hub mounts its own aggregated
 * `/templates`/`/templates/sync` routes with no `admin/` segment (`@zanix/admin`'s
 * `defineAdminHubMetadata`), a different route shape from a single service's local admin API. Only
 * meaningful under `TEMPLATES_BACKEND=remote`.
 */
export const TEMPLATES_SERVICE_PATH_PREFIX_ENV = 'TEMPLATES_SERVICE_PATH_PREFIX'

/**
 * Validates the configuration required by whichever mode `TEMPLATES_BACKEND_ENV` currently selects
 * (see `templatesBackendMode()`) — called at boot (`templates/core.ts`) and at the top of every
 * `TemplateProvider.resolve()` call. Deliberately left uncaught by `resolve()`'s own warn-and-
 * fallback `try/catch`: silently falling back to the code registry on a genuine misconfiguration
 * would defeat the point of validating it eagerly.
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
