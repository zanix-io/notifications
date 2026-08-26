/**
 * The local-api layer for this package's own persisted templates collection — a real
 * `@zanix/server` `ZanixController` REST surface over {@link TemplatesAdminService}
 * (`../db/templates.service.ts`), never the other way around. This is the ONLY subpath under
 * `modules/templates/` allowed to import `@zanix/server`'s `Controller`/`ZanixController` family;
 * `../db/**` stays agnostic of HTTP — see `src/@tests/unit/templates/dependency-boundary.test.ts`
 * for the enforced proof.
 *
 * Deliberately CRUD-only — cross-service sync (`POST /templates/sync`, pulling a registered
 * service's own code templates via Discovery) is genuinely aggregator-shaped, not local-api-shaped
 * (it needs a `ServiceRegistry`, a concept this package doesn't know about), so it stays composed
 * separately by `@zanix/admin`'s own `TemplatesSyncController`, mounted alongside this one under
 * the same route prefix.
 *
 * Exposed publicly as `@zanix/notifications/templates-api`, the same subpath-export shape
 * `@zanix/space/assets-api` already establishes for its own local API.
 *
 * @module
 */

export {
  createTemplatesController,
  type TemplatesControllerInstance,
  type TemplatesControllerOptions,
} from './templates.handler.ts'
export { CreateTemplateRTO, TemplateParamsRTO, UpdateTemplateRTO } from './rtos/templates.rto.ts'

/**
 * The CRUD data-access layer {@link createTemplatesController} itself sits on top of — re-exported
 * here so a consumer that composes its own extension on this local API (`@zanix/admin`'s
 * cross-service `POST /templates/sync`, which calls {@link TemplatesAdminRepository.syncCodeTemplates}
 * directly) can reach them without also resolving the root `@zanix/notifications` barrel's
 * unrelated connectors/providers. Adds nothing to this subpath's own reachable graph: this
 * controller already imports {@link TemplatesAdminService} to build its own handlers.
 */
export {
  type SyncCodeTemplateEntry,
  type SyncCodeTemplatesResult,
  TemplatesAdminRepository,
  toSyncCodeTemplateEntries,
} from '../db/templates.repository.ts'
export { TemplatesAdminService } from '../db/templates.service.ts'
