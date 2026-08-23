import type { ServiceAuthClientOptions } from '@zanix/auth'
import type { ServiceAuthClient } from './remote-backend.ts'

import {
  createServiceAuthClient,
  resolveServiceAssertionKeyId,
  resolveServiceAssertionPrivateKey,
} from '@zanix/auth'

/**
 * The ONLY module in `@zanix/notifications` that imports a real value from `@zanix/auth` — see the
 * `zanix-dependency-direction` skill's `notifications -> auth` note (a same-tier "domain
 * infrastructure" sideways dependency, confirmed real: `RemoteTemplateBackend` genuinely needs to
 * authenticate its own service-to-service fetch against `@zanix/auth`'s `type: 'api'` contract for
 * Mode C — see `docs/templates.md#mode-c-remote-only-templates`).
 *
 * Neither `provider.ts` nor `remote-backend.ts` reaches into `@zanix/auth` directly — they only see
 * this module's exports plus `remote-backend.ts`'s own type-only {@link ServiceAuthClient} seam.
 * Mirrors `@zanix/admin`'s own `modules/registry/auth.ts` (the identical shape, used to keep
 * `TriggersAggregator`'s `TriggersClientFactory` seam out of `@zanix/auth`), adapted for the one
 * difference this package has: `@zanix/admin` has an external composing layer
 * (`ZanixAdminHub.start({ auth })`) that wires the real adapter into the seam; this package doesn't —
 * `TemplateProvider.#backend()` (`provider.ts`) IS the composing layer, since it's the only place
 * `RemoteTemplateBackend` is ever constructed from env vars alone (Mode C stays self-configuring,
 * with zero external wiring required, exactly as before this module existed). A caller constructing
 * `RemoteTemplateBackend` directly (bypassing `TemplateProvider`) is its own composing layer too, and
 * calls {@link createRemoteTemplateAuthClient} itself the same way — see `remote-template-backend.test.ts`.
 *
 * @module
 */

/**
 * Module-level, build-once cache — mirrors `remote-backend.ts`'s other module-level state
 * (`remoteFetchCache`/`syncPromise`): `TemplateProvider.#backend()` builds a fresh
 * `RemoteTemplateBackend` on every call, so a per-call client would rebuild (and never reuse) its own
 * sign+exchange+cache state, defeating the whole point of that cache — every `resolve()` would
 * re-exchange a credential instead of reusing the cached one. There is only ever one central service
 * per process (one `TEMPLATES_SERVICE_URL`), so a single shared instance is always correct — never
 * rebuilt once created, even if a later call passes different `options` (env vars are boot-time
 * config here, not expected to change mid-process).
 */
let cachedAuthClient: ServiceAuthClient | undefined

/** Resets the module-level cached auth client — test-only. */
export function resetRemoteTemplateAuthClient(): void {
  cachedAuthClient = undefined
}

/**
 * Builds (once per process, cached — see {@link resetRemoteTemplateAuthClient}) the
 * {@link ServiceAuthClient} a `RemoteTemplateBackend` injects to sign+exchange a dynamic credential
 * for every outbound request — a thin wrapper over `@zanix/auth`'s own `createServiceAuthClient`, the
 * same primitive `ZanixAdminHub.start({ auth })` uses. Not attempted at all when a static
 * `TEMPLATES_SERVICE_TOKEN` is configured instead — see `RemoteTemplateBackendConfig.authClient`'s own
 * doc on the priority between the two.
 *
 * @param options This caller's own signing identity — see `@zanix/auth`'s `ServiceAuthClientOptions`.
 * `provider.ts` only ever passes `{ serviceId }` (resolved from `TEMPLATES_SERVICE_AUTH_ID`); the
 * richer fields (`privateKey`, `keyId`, `assertionExpiration`, `httpClient`) exist for a caller
 * constructing `RemoteTemplateBackend` directly instead of going through `TemplateProvider`.
 */
export function createRemoteTemplateAuthClient(
  options: ServiceAuthClientOptions,
): ServiceAuthClient {
  cachedAuthClient ??= createServiceAuthClient(options)
  return cachedAuthClient
}

/**
 * Validates that a signing key actually resolves for `serviceId` (`JWK_ID_<id>`/
 * `JWK_PRI_<id>[_<keyId>]` — see `@zanix/auth`'s own resolvers) WITHOUT signing or exchanging
 * anything — the pre-flight check `assertTemplatesBackendConfigValid()` (`provider.ts`) runs at
 * boot, before Mode C's dynamic-auth path is ever attempted, so a misconfigured
 * `TEMPLATES_SERVICE_AUTH_ID` fails fast with a clear "missing env var" error instead of surfacing
 * only on the first real send.
 *
 * @throws {InternalError} If nothing is registered under the resolved env var name — propagated
 * as-is from `@zanix/auth`'s own `resolveServiceAssertionPrivateKey`, which already names the exact
 * missing env var.
 */
export function assertServiceAssertionKeyResolvable(serviceId: string): void {
  const keyId = resolveServiceAssertionKeyId(serviceId)
  resolveServiceAssertionPrivateKey(serviceId, keyId)
}
