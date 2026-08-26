import type { MiddlewareGuard, VersionProtocolOption } from '@zanix/server'

/**
 * Options accepted by `createTemplatesController` (`modules/templates/templates-api/
 * templates.handler.ts`) — kept in its own file, separate from that handler's own
 * `TemplatesAdminService`/Handlebars-coupled code, since this interface only ever references
 * `@zanix/server`'s own `MiddlewareGuard`/`VersionProtocolOption` types. Resolving
 * `TemplatesControllerInstance` (the handler's other exported type) still requires the real
 * `TemplatesAdminService` class — genuinely coupled to Handlebars/Mongo — so it stays declared where
 * it is; only this pure options shape moves.
 */
export interface TemplatesControllerOptions {
  /** The route prefix, e.g. `'templates'` (default) for `/templates`. */
  prefix?: string
  /**
   * Guards applied to every route on this controller, run in order, short-circuiting on the first
   * denial. Omitted/empty means no guard at all — this package never assumes an auth mechanism (it
   * doesn't depend on `@zanix/auth`) and never invents its own `permissions`/`roles` concept; the
   * composer (typically `@zanix/admin`) is the one that knows what "admin" means and builds the
   * real guard, e.g. from `@zanix/auth`'s `jwtValidationGuard`. See the "Local API vs Aggregator
   * API" rule in the `zanix-libraries-architecture` skill for why the auth mechanism is always
   * supplied by the composer, never assumed here.
   */
  guards?: MiddlewareGuard[]
  /**
   * Protocol-version negotiation for this controller, passed straight to `@Controller`. Defaults to
   * `@zanix/server`'s own generic default when omitted — a composer preserving an existing wire
   * contract (e.g. `@zanix/admin`'s own protocol config) should pass it explicitly here instead of
   * this package hardcoding a value with "admin" in its name.
   */
  versionProtocol?: VersionProtocolOption
}
