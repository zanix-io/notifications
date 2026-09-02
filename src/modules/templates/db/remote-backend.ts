import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { TemplateBackend } from './backend.ts'

import { ADMIN_PROTOCOL_HEADER, AUTH_HEADERS, RestClient, RestClientError } from '@zanix/server'
import logger from '@zanix/logger'

/** Default TTL (ms) for the local `{hbs,hash}` fetch cache — see `TEMPLATES_SERVICE_CACHE_TTL_MS`. */
const DEFAULT_CACHE_TTL_MS = 45_000

/**
 * Default route prefix `resolve()`/`#sync()` call at `TEMPLATES_SERVICE_URL` — matches a plain
 * `@zanix/core`-based service's own local admin API (`admin: true`, `@zanix/admin`'s
 * `defineAdminMetadata`, which mounts this package's CRUD controller and this package's own
 * `sync` extension both at a fixed `admin/templates` prefix). **Not** the shape a `ZanixAdminHub`
 * instance mounts its equivalent aggregated routes at — the hub's own `defineAdminHubMetadata`
 * mounts them at a bare `templates` prefix instead, with no `admin/` segment, since the hub's whole
 * server is already admin-scoped. See `RemoteTemplateBackendConfig.pathPrefix` for pointing this
 * class at a hub instead of a single service.
 */
const DEFAULT_PATH_PREFIX = 'admin/templates'

/**
 * Builds `{ 'X-Znx-Authorization': 'Bearer <token>' }` (or any other header set) for a given
 * `(targetServiceId, exchangeUrl)` pair — the exact shape `@zanix/auth`'s `createServiceAuthClient(...)`
 * returns, kept type-only here so this module never imports `@zanix/auth` itself (this package's one
 * real, confirmed `notifications -> auth` dependency lives isolated in `remote-backend-auth.ts` — see
 * the `zanix-dependency-direction` skill's own note on it). `RemoteTemplateBackendConfig.authClient`
 * is where a caller injects the real thing; `remote-backend-auth.ts`'s `createRemoteTemplateAuthClient`
 * builds one, and `TemplateProvider.#backend()` (`provider.ts`) wires it in by default for Mode C's
 * own env-var-driven path — this module itself stays agnostic to how (or whether) that happens.
 */
export type ServiceAuthClient = (
  targetServiceId: string,
  exchangeUrl: string,
) => Promise<Record<string, string>>

/**
 * Machine-credential header for `@zanix/auth`'s `type: 'api'` contract (RS256, verified against
 * `JWK_PUB`) — see `docs/templates.md#mode-c-remote-only-templates`. `TEMPLATES_SERVICE_TOKEN` is
 * expected to already be a valid, pre-issued `type: 'api'` token; this package never mints one
 * itself. `AUTH_HEADERS.api` is `@zanix/server`'s copy of the same header name `@zanix/auth` itself
 * signs against — see its `docs/configuration.md#auth--admin-protocol-headers`.
 */
const API_AUTH_HEADER = AUTH_HEADERS.api

/**
 * The admin protocol version this package sends — hand-kept in sync with `@zanix/core`'s own
 * `ADMIN_PROTOCOL_VERSION` (currently `1`). Not imported from `@zanix/core` directly: `@zanix/core`
 * depends on `@zanix/notifications`, so that direction would be circular. Not imported from
 * `@zanix/server` either — unlike the header name (`ADMIN_PROTOCOL_HEADER`), the version number is
 * `@zanix/core`'s own business data, not something `@zanix/server` should own or need to release a
 * new version for every time `@zanix/core`'s admin protocol evolves.
 */
const ADMIN_PROTOCOL_VERSION = 1

interface RemoteCacheEntry {
  value: ZanixTemplateAttrs | undefined
  expiresAt: number
}

/**
 * Fetch cache for `RemoteTemplateBackend.resolve()`, keyed `${channel}:${name}` — separate from
 * `provider.ts`'s hash-keyed compiled-render cache (which caches the *compile*, not the *fetch*,
 * and doesn't expire). Module-level so it's shared across every `SCOPED` `TemplateProvider`
 * instance, the same way that one is.
 */
const remoteFetchCache = new Map<string, RemoteCacheEntry>()

/** Resets the module-level remote fetch cache — test-only. */
export function resetRemoteTemplateBackendCache(): void {
  remoteFetchCache.clear()
}

/**
 * Module-level, once-per-process sync memo — mirrors `local-backend.ts`'s own `#ensureSynced()`
 * convention, but here "sync" is a single `POST admin/templates/sync` telling the central service
 * to pull this service's own `/.well-known/zanix/code-templates` snapshot (see `@zanix/admin`'s
 * `TemplatesAdminService.syncCodeTemplatesFromService`) instead of a direct Mongo write, since this
 * backend has no local database access at all. Unlike the local case, this promise never rejects
 * and is never reset on failure — `#sync()` itself catches and logs — so the sync is attempted at
 * most once per process, not retried on every subsequent `resolve()` call after a failure. Reset
 * only in tests.
 */
let syncPromise: Promise<void> | undefined

/** Resets the module-level sync memo — test-only. */
export function resetRemoteTemplateBackendSyncState(): void {
  syncPromise = undefined
}

/** Config for {@link RemoteTemplateBackend} — see `TEMPLATES_SERVICE_URL`/`TEMPLATES_SERVICE_TOKEN`. */
export interface RemoteTemplateBackendConfig {
  /**
   * Base URL of the central Notification/Template Service — either a single `@zanix/core`-based
   * service's own *admin* server (today an anchored `'admin'`-Application listener on its own
   * port, `@zanix/core`'s `admin` option, see its `docs/admin-apis.md`, not the service's
   * default-Application port), or a `ZanixAdminHub` instance's own aggregated API. Do not include
   * `pathPrefix` (below); the path is appended per call. Also where `authClient` (below) exchanges a
   * credential, at this same base URL's own `/admin/service-token` — the fixed route every admin
   * surface mounts, same convention `@zanix/admin`'s `createServiceRegistryAuthHeaders` uses.
   */
  url: string
  /**
   * Route prefix appended to `url` on every call — see `DEFAULT_PATH_PREFIX`'s own doc for the two
   * real shapes this needs to match. Defaults to `'admin/templates'`, a single `@zanix/core`-based
   * service's own local admin API. **Set this to `'templates'` when `url` instead points at a
   * `ZanixAdminHub` instance** — the hub mounts the equivalent CRUD/`sync` routes without the
   * `admin/` segment. Mirrors `TEMPLATES_SERVICE_PATH_PREFIX_ENV` for the env-var-driven Mode C path
   * (`TemplateProvider.#backend()`); only meaningful for a caller constructing this class directly.
   */
  pathPrefix?: string
  /**
   * This service's own identity, as registered in the central service's `ServiceRegistry` (see
   * `@zanix/admin`'s `setServiceRegistry`/`ZANIX_ADMIN_SERVICES`) under a `serviceId` mapped to a
   * reachable base URL for THIS process's own `/.well-known/zanix/code-templates` endpoint (see
   * `defineCodeTemplatesDiscovery`, exported by this package). The central service pulls this
   * service's code templates by that identity — it never receives them as a request body.
   *
   * **Distinct from `authClient`'s own signing identity (below)** — this one is a routing/lookup
   * key the central service's own registry uses; `authClient`'s signing identity is this service's
   * own identity when authenticating *to* the central service. They're independent concepts and
   * don't need to match (though nothing stops you from choosing the same string for both).
   */
  serviceId: string
  /**
   * Pre-issued `type: 'api'` machine credential, sent as `X-Znx-Authorization: Bearer <token>` —
   * see `TEMPLATES_SERVICE_TOKEN`. This package never mints it; **you** obtain it out-of-band (e.g.
   * `@zanix/auth`'s `createAppToken({ type: 'api', ... })`, run once as a setup step) and configure
   * it statically. This is the only option that works against a central service outside the Zanix
   * ecosystem (anything that can verify an RS256 `type: 'api'` JWT, without needing to also expose
   * a `/admin/service-token` exchange endpoint). **Takes priority over `authClient` below** — set
   * both and `token` wins, `authClient` is never even invoked.
   */
  token?: string
  /**
   * Alternative to `token`, for a central service that IS itself Zanix-based (exposes
   * `/admin/service-token`, `@zanix/admin`'s `createServiceExchangeController`): a pre-built
   * {@link ServiceAuthClient} that signs a short-lived assertion and exchanges it for a real access
   * token automatically. This module never builds one itself — see this file's own
   * `ServiceAuthClient` doc on why — so the caller constructing `RemoteTemplateBackend` (today,
   * exclusively `TemplateProvider.#backend()`) builds it via `remote-backend-auth.ts`'s
   * `createRemoteTemplateAuthClient` (wraps `@zanix/auth`'s `createServiceAuthClient` — the same
   * primitive `ZanixAdminHub.start({ auth })` uses, adapted here for a single fixed target instead
   * of a `ServiceRegistry`) and passes the result here. No static token to generate/rotate by hand;
   * the credential is signed, exchanged, and cached (re-exchanged automatically near expiry) by
   * whatever `ServiceAuthClient` you inject. Ignored entirely when `token` is set.
   */
  authClient?: ServiceAuthClient
  /** TTL (ms) for the local `{hbs,hash}` fetch cache — see `TEMPLATES_SERVICE_CACHE_TTL_MS`. */
  cacheTtlMs?: number
}

/**
 * Extracts the real HTTP status code a failed `RestClient` call actually received, off its own
 * `RestClientError.realHttpStatus` getter — `undefined` for a genuine transport-level failure (no
 * response came back at all — DNS, timeout, connection refused), same as for anything that isn't a
 * `RestClientError` to begin with.
 *
 * @returns The real HTTP status code, or `undefined` if `error` isn't a `RestClientError`.
 */
function realHttpStatus(error: unknown): number | undefined {
  return error instanceof RestClientError ? error.realHttpStatus : undefined
}

/**
 * `TemplateBackend` for Mode C (remote-only templates, no local Mongo access at all) — see
 * `docs/templates.md#mode-c-remote-only-templates`. Calls the central Notification/Template
 * Service's `GET <pathPrefix>/:channel/:name` (`pathPrefix` defaults to `admin/templates`, the same
 * read endpoint `@zanix/core`'s `TemplatesAdminRepository.get()` backs — see
 * `RemoteTemplateBackendConfig.pathPrefix`'s own doc for pointing this at a `ZanixAdminHub` instead)
 * via `@zanix/server`'s `RestClient`, the same HTTP-adapter convention every other outbound REST
 * integration in this package uses (see `modules/sms/twilio.ts`).
 *
 * On top of this class's own TTL cache (below), every `this.http.get()` call already benefits,
 * transparently, from whatever `RestClient` itself provides — including its conditional-`GET`
 * (`ETag`/`If-None-Match`) support: once the central service starts returning `ETag` (the natural
 * value to send is `ZanixTemplateAttrs.hash`, already computed there), calls made after this
 * class's own TTL cache expires get cheap `304`s instead of a full body, with zero code change
 * here. `RestClient` also scopes its `ETag` cache by credential (recognizing this class's own
 * `X-Znx-Authorization` header, among others) — see its own JSDoc — so this composes safely even
 * if multiple `RemoteTemplateBackend`s (different tokens) end up pointed at the same URL.
 */
export class RemoteTemplateBackend extends RestClient implements TemplateBackend {
  #cacheTtlMs: number
  #serviceId: string
  #staticToken?: string
  #authClient?: ServiceAuthClient
  #exchangeUrl?: string
  #pathPrefix: string

  /** Creates a `RemoteTemplateBackend`, pointed at the central service's internal admin base URL. */
  constructor(config: RemoteTemplateBackendConfig) {
    super({
      baseUrl: config.url,
      headers: {
        // Sent preemptively even though `@zanix/core` doesn't verify it on incoming requests yet
        // (see its README's "Admin APIs" section, on `ADMIN_PROTOCOL_HEADER`/
        // `ADMIN_PROTOCOL_VERSION`), so a future server-side upgrade doesn't also require a
        // coordinated client-side release.
        [ADMIN_PROTOCOL_HEADER]: String(ADMIN_PROTOCOL_VERSION),
      },
    })

    this.#cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.#serviceId = config.serviceId
    this.#staticToken = config.token
    this.#pathPrefix = config.pathPrefix ?? DEFAULT_PATH_PREFIX

    // `token` (a pre-issued static credential) always wins when set — `authClient` (dynamic
    // sign+exchange) is only ever attempted when there's no static token to fall back to. Not built
    // here (see this file's own `ServiceAuthClient` doc on why) — whatever the caller injected is
    // used as-is; `remote-backend-auth.ts`'s own module-level cache is what makes reusing the same
    // instance across every fresh `RemoteTemplateBackend` `TemplateProvider.#backend()` constructs
    // actually save the sign+exchange+cache state, not this constructor.
    if (!config.token && config.authClient) {
      this.#authClient = config.authClient
      this.#exchangeUrl = `${config.url}/admin/service-token`
    }
  }

  /**
   * Resolves the `X-Znx-Authorization` header to send on this call — a static `Bearer <token>` if
   * `token` was configured, a signed-and-exchanged (cached, auto-renewing) one via the injected
   * `authClient` if that was configured instead, or no header at all if neither was — better than
   * always sending a malformed `Bearer ` with nothing after it, which a receiving guard would treat
   * as "no token provided" anyway, just with a more confusing error.
   */
  async #authHeaders(): Promise<Record<string, string> | undefined> {
    if (this.#staticToken) {
      return { [API_AUTH_HEADER]: `Bearer ${this.#staticToken}` }
    }
    if (this.#authClient && this.#exchangeUrl) {
      // `targetServiceId` is only ever used internally as this client's own cache key — there's
      // exactly one central service per `RemoteTemplateBackend`, so any constant works here.
      return await this.#authClient('central-templates-service', this.#exchangeUrl)
    }
    return undefined
  }

  /**
   * Ensures the central service has pulled this package's `CODE_TEMPLATES` exactly once for this
   * process — mirrors `LocalTemplateBackend`'s own bootstrap sync, but as a single outbound `POST`
   * triggering a remote pull instead of a direct Mongo write. Always resolves (never rejects):
   * `#sync()` catches and logs its own failure, so a caller can `await` this unconditionally
   * without a `try/catch` of its own.
   */
  async #ensureSynced(): Promise<void> {
    if (!syncPromise) syncPromise = this.#sync()
    return await syncPromise
  }

  /**
   * Tells the central service to pull this service's current `CODE_TEMPLATES` (see `manifest.ts`)
   * from its own `/.well-known/zanix/code-templates` Discovery endpoint, via
   * `POST <pathPrefix>/sync` — the same hand-rolled `RestClient` primitive `resolve()`'s own
   * `GET` uses, not `@zanix/admin`'s `TemplatesAdminClient` (importing it here would be circular:
   * `@zanix/admin` already depends on this package for `ZanixTemplateAttrs`/`Notifiers`). Sends
   * only this instance's `serviceId` — never the template contents themselves — so the central
   * service must have this service registered in its own `ServiceRegistry` first.
   *
   * Best-effort: any failure (network error, non-2xx, unregistered `serviceId`, or the central
   * service not yet supporting this route) is caught and logged as a warning here, never rethrown
   * — seeding the central database is an enhancement, never a hard dependency for `resolve()` to
   * keep working off the code-registry fallback.
   */
  async #sync(): Promise<void> {
    try {
      await this.http.post(`${this.#pathPrefix}/sync`, {
        body: JSON.stringify({ serviceId: this.#serviceId }),
        headers: await this.#authHeaders(),
      })
    } catch (error) {
      logger.warn(
        `[RemoteTemplateBackend] Code-template sync trigger failed — continuing without it. ` +
          `${(error as Error).message}`,
        error,
      )
    }
  }

  /**
   * No-op.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to preload.
   */
  public preload(
    _channel: Notifiers,
    _name: string,
  ): Promise<ZanixTemplateAttrs | undefined> {
    return Promise.resolve(undefined)
  }

  /**
   * Resolves `{channel, name}` against the central service, through a short local TTL cache so a
   * remote outage/latency spike doesn't turn every single `TemplateProvider.resolve()` call into a
   * blocking network round-trip.
   *
   * A `404` (no such template) is cached as `undefined` for the TTL window, silently — mirroring
   * `Model.findOne(...)` returning `null` for `LocalTemplateBackend` today, never a warning. Any
   * other failure (network error, timeout, non-404 status) is deliberately **not** cached — it
   * rethrows immediately so the next call gets its own fresh attempt, and so
   * `TemplateProvider.resolve()`'s existing `logger.warn` fires on every real failure, not just the
   * first one during an outage.
   */
  public async resolve(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined> {
    await this.#ensureSynced()

    const key = `${channel}:${name}`
    const cached = remoteFetchCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    let value: ZanixTemplateAttrs | undefined
    try {
      value = await this.http.get<ZanixTemplateAttrs>(
        `${this.#pathPrefix}/${channel}/${name}`,
        {
          headers: await this.#authHeaders(),
        },
      )
    } catch (error) {
      if (realHttpStatus(error) === 404) {
        value = undefined
      } else {
        throw error
      }
    }

    remoteFetchCache.set(key, {
      value,
      expiresAt: Date.now() + this.#cacheTtlMs,
    })
    return value
  }
}
