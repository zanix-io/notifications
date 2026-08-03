import type { DiscoveryProvider, MiddlewareGuard } from '@zanix/server'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

import { ProgramModule } from '@zanix/server'
import { TemplatesAdminRepository } from './templates.repository.ts'

/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/templates` — see `@zanix/server`'s
 * `docs/HANDLERS.md`'s "Discovery" section. `@zanix/admin`'s `defineAdminMetadata` registers it
 * via `ProgramModule.defineDiscovery` alongside composing `createTemplatesController`; this package
 * only authors the provider, since it's the actual owner of the templates collection this reuses
 * `TemplatesAdminRepository.list()` to read.
 *
 * `TemplatesAdminRepository` is resolved fresh on every `snapshot()` call (never cached at
 * construction time here) — deferring DI resolution to request time, well after boot, rather than
 * to whenever this factory itself happens to run during composition, before the underlying Mongo
 * connector is necessarily ready.
 */
export function createTemplatesDiscoveryProvider(): DiscoveryProvider<ZanixTemplateAttrs> {
  return {
    snapshot: () => ProgramModule.providers.get(TemplatesAdminRepository).list(),
  }
}

/**
 * Registers this service's `TEMPLATES` under `/.well-known/zanix/templates` — a plain,
 * re-callable function (never a decorator or cached side-effect import — see `@zanix/server`'s
 * `docs/HANDLERS.md`'s "Discovery" section for why), meant to be called from your own
 * `ProgramModule.defineApplication(...)` scope, the same way `@zanix/admin`'s
 * `defineAdminMetadata()` composes its own Discovery endpoints. This package has no bootstrap of
 * its own, so it cannot register this for you automatically.
 *
 * @param options.guards Middleware guards gating this endpoint — e.g. `@zanix/auth`'s
 * `jwtValidationGuard`. Defaults to none (unauthenticated) — omitting this is a deliberate,
 * explicit choice, not an oversight; see `@zanix/server`'s own "auth is never assumed" principle.
 *
 * @example
 * ```ts
 * await ProgramModule.defineApplication('main', () => {
 *   defineTemplatesDiscovery({ guards: [jwtValidationGuard({ permissions: [ADMIN_ROLE] })] })
 * })
 * ```
 */
export function defineTemplatesDiscovery(options: { guards?: MiddlewareGuard[] } = {}): void {
  ProgramModule.defineDiscovery('templates', createTemplatesDiscoveryProvider(), options)
}
