import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { TemplateBackend } from './backend.ts'
import type { ServiceAuthClientOptions } from '@zanix/auth'

import { ADMIN_PROTOCOL_HEADER, AUTH_HEADERS, RestClient } from '@zanix/server'
import { createServiceAuthClient } from '@zanix/auth'
import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'

/** Default TTL (ms) for the local `{hbs,hash}` fetch cache — see `TEMPLATES_SERVICE_CACHE_TTL_MS`. */
const DEFAULT_CACHE_TTL_MS = 45_000

/**
 * Machine-credential header for `@zanix/auth`'s `type: 'api'` contract (RS256, verified against
 * `JWK_PUB`) — see `docs/templates.md#mode-c-remote-only-templates`. `TEMPLATES_SERVICE_TOKEN` is
 * expected to already be a valid, pre-issued `type: 'api'` token; this package never mints one
 * itself. `AUTH_HEADERS.api` is `@zanix/server`'s copy of the same header name `@zanix/auth` itself
 * signs against — see its `docs/CONFIGURATION.md#auth--admin-protocol-headers`.
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

/**
 * Shared {@link createServiceAuthClient} instance, module-level for the same reason
 * `remoteFetchCache`/`syncPromise` above are: `TemplateProvider.#backend()` builds a fresh
 * `RemoteTemplateBackend` on every call, so a per-instance auth client would rebuild (and never
 * reuse) its own sign+exchange+cache state, defeating the whole point of that cache — every
 * `resolve()` would re-exchange a credential instead of reusing the cached one. There is only ever
 * one central service per process (one `TEMPLATES_SERVICE_URL`), so a single shared instance is
 * always correct — never rebuilt once created, even if a later call passes different `auth`
 * options (env vars are boot-time config here, not expected to change mid-process).
 */
let authClient: ReturnType<typeof createServiceAuthClient> | undefined

/** Resets the module-level auth client — test-only. */
export function resetRemoteTemplateBackendAuthClient(): void {
  authClient = undefined
}

/** Config for {@link RemoteTemplateBackend} — see `TEMPLATES_SERVICE_URL`/`TEMPLATES_SERVICE_TOKEN`. */
export interface RemoteTemplateBackendConfig {
  /**
   * Base URL of the central Notification/Template Service's *admin* server — today an anchored
   * `'admin'`-Application listener on its own port (`@zanix/core`'s `admin` option, see its
   * `docs/admin-apis.md`), not the service's default-Application port. Do not include
   * `/admin/templates`; the path is appended per call. Also where `auth` (below) exchanges a
   * credential, at this same base URL's own `/admin/service-token` — the fixed route every admin
   * surface mounts, same convention `@zanix/admin`'s `createServiceRegistryAuthHeaders` uses.
   */
  url: string
  /**
   * This service's own identity, as registered in the central service's `ServiceRegistry` (see
   * `@zanix/admin`'s `setServiceRegistry`/`ZANIX_ADMIN_SERVICES`) under a `serviceId` mapped to a
   * reachable base URL for THIS process's own `/.well-known/zanix/code-templates` endpoint (see
   * `defineCodeTemplatesDiscovery`, exported by this package). The central service pulls this
   * service's code templates by that identity — it never receives them as a request body.
   *
   * **Distinct from `auth.serviceId` below** — this one is a routing/lookup key the central
   * service's own registry uses; `auth.serviceId` is this service's signing identity when
   * authenticating *to* the central service. They're independent concepts and don't need to match
   * (though nothing stops you from choosing the same string for both).
   */
  serviceId: string
  /**
   * Pre-issued `type: 'api'` machine credential, sent as `X-Znx-Authorization: Bearer <token>` —
   * see `TEMPLATES_SERVICE_TOKEN`. This package never mints it; **you** obtain it out-of-band (e.g.
   * `@zanix/auth`'s `createAppToken({ type: 'api', ... })`, run once as a setup step) and configure
   * it statically. This is the only option that works against a central service outside the Zanix
   * ecosystem (anything that can verify an RS256 `type: 'api'` JWT, without needing to also expose
   * a `/admin/service-token` exchange endpoint). **Takes priority over `auth` below** — set both
   * and `token` wins, `auth` is never even attempted.
   */
  token?: string
  /**
   * Alternative to `token`, for a central service that IS itself Zanix-based (exposes
   * `/admin/service-token`, `@zanix/admin`'s `createServiceExchangeController`): signs a
   * short-lived assertion and exchanges it for a real access token automatically, via
   * `@zanix/auth`'s `createServiceAuthClient` — the same primitive `ZanixAdminHub.start({ auth })`
   * uses, adapted here for a single fixed target instead of a `ServiceRegistry`. No static token to
   * generate/rotate by hand; the credential is signed, exchanged, and cached (re-exchanged
   * automatically near expiry) on demand. Ignored entirely when `token` is set.
   */
  auth?: ServiceAuthClientOptions
  /** TTL (ms) for the local `{hbs,hash}` fetch cache — see `TEMPLATES_SERVICE_CACHE_TTL_MS`. */
  cacheTtlMs?: number
}

/**
 * Extracts the real HTTP status code a failed `RestClient` call actually received.
 *
 * `@zanix/server`'s `RestClient` always throws `HttpError('BAD_REQUEST')` on any non-2xx response
 * (see its `#http()`) — `error.status.value` is therefore always `400`, never the real status. The
 * only place the real code survives is `error.cause.message`'s `"[HTTP <code>] <statusText>"`
 * prefix — the same limitation `TwilioSmsAdapter`'s own tests already assert against directly.
 *
 * @returns The real HTTP status code, or `undefined` if `error` isn't a `RestClient`-shaped `HttpError`.
 */
function realHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof HttpError) || !(error.cause instanceof Error)) return undefined
  const match = error.cause.message.match(/^\[HTTP (\d+)\]/)
  return match ? Number(match[1]) : undefined
}

/**
 * `TemplateBackend` for Mode C (remote-only templates, no local Mongo access at all) — see
 * `docs/templates.md#mode-c-remote-only-templates`. Calls the central Notification/Template
 * Service's `GET /admin/templates/:channel/:name` (the same read endpoint `@zanix/core`'s
 * `TemplatesAdminRepository.get()` backs) via `@zanix/server`'s `RestClient`, the same
 * HTTP-adapter convention every other outbound REST integration in this package uses (see
 * `modules/sms/twilio.ts`).
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
  #exchangeUrl?: string

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

    // `token` (a pre-issued static credential) always wins when set — `auth` (dynamic
    // sign+exchange) is only ever attempted when there's no static token to fall back to. Reuses
    // the module-level `authClient` (see its own doc) rather than building a fresh one per
    // instance — `TemplateProvider.#backend()` constructs a new `RemoteTemplateBackend` on every
    // call, so a per-instance client would never actually cache anything.
    if (!config.token && config.auth) {
      authClient ??= createServiceAuthClient(config.auth)
      this.#exchangeUrl = `${config.url}/admin/service-token`
    }
  }

  /**
   * Resolves the `X-Znx-Authorization` header to send on this call — a static `Bearer <token>` if
   * `token` was configured, a signed-and-exchanged (cached, auto-renewing) one via the shared
   * `authClient` if `auth` was configured instead, or no header at all if neither was — better than
   * always sending a malformed `Bearer ` with nothing after it, which a receiving guard would treat
   * as "no token provided" anyway, just with a more confusing error.
   */
  async #authHeaders(): Promise<Record<string, string> | undefined> {
    if (this.#staticToken) return { [API_AUTH_HEADER]: `Bearer ${this.#staticToken}` }
    if (authClient && this.#exchangeUrl) {
      // `targetServiceId` is only ever used internally as this client's own cache key — there's
      // exactly one central service per `RemoteTemplateBackend`, so any constant works here.
      return await authClient('central-templates-service', this.#exchangeUrl)
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
   * `POST admin/templates/sync` — the same hand-rolled `RestClient` primitive `resolve()`'s own
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
      await this.http.post('admin/templates/sync', {
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
  public async resolve(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs | undefined> {
    await this.#ensureSynced()

    const key = `${channel}:${name}`
    const cached = remoteFetchCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    let value: ZanixTemplateAttrs | undefined
    try {
      value = await this.http.get<ZanixTemplateAttrs>(`admin/templates/${channel}/${name}`, {
        headers: await this.#authHeaders(),
      })
    } catch (error) {
      if (realHttpStatus(error) === 404) {
        value = undefined
      } else {
        throw error
      }
    }

    remoteFetchCache.set(key, { value, expiresAt: Date.now() + this.#cacheTtlMs })
    return value
  }
}
