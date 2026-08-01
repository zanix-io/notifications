import type { DiscoveryProvider, MiddlewareGuard } from '@zanix/server'

import { ProgramModule } from '@zanix/server'
import { hashContent, loadCodeTemplates } from './manifest.ts'

/** A single code-defined template entry, as exposed by `/.well-known/zanix/code-templates`. */
export interface CodeTemplateDiscoveryEntry {
  /** The notifier channel this template belongs to (`email`, `sms`, `whatsapp`). */
  channel: string
  /** The template's name within its `channel`. */
  name: string
  /** The template's raw Handlebars source. */
  hbs: string
  /** SHA-256 hex digest of `hbs` — see `manifest.ts`'s `hashContent`. */
  hash: string
}

/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/code-templates` — this package's own
 * `CODE_TEMPLATES` registry (see `manifest.ts`), the same entries a `RemoteTemplateBackend` used to
 * push to a central admin's `/admin/templates/sync`. Snapshotting this instead lets that central
 * admin pull the entries on demand (see `@zanix/admin`'s `TemplatesAdminService
 * .syncCodeTemplatesFromService`) rather than depending on this service to push proactively.
 *
 * Not registered automatically — call {@link defineCodeTemplatesDiscovery} from your own bootstrap.
 */
export function createCodeTemplatesDiscoveryProvider(): DiscoveryProvider<
  CodeTemplateDiscoveryEntry
> {
  return {
    snapshot: async () => {
      const codeTemplates = await loadCodeTemplates()
      return await Promise.all(
        codeTemplates.map(async (entry) => ({
          channel: entry.channel,
          name: entry.name,
          hbs: entry.hbs,
          hash: await hashContent(entry.hbs),
        })),
      )
    },
  }
}

/**
 * Registers this service's `CODE_TEMPLATES` under `/.well-known/zanix/code-templates` — a plain,
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
 *   defineCodeTemplatesDiscovery({ guards: [jwtValidationGuard({ permissions: [ADMIN_ROLE] })] })
 * })
 * ```
 */
export function defineCodeTemplatesDiscovery(options: { guards?: MiddlewareGuard[] } = {}): void {
  ProgramModule.defineDiscovery('code-templates', createCodeTemplatesDiscoveryProvider(), options)
}
