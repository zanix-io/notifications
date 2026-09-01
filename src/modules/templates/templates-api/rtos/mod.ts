/**
 * The lightweight RTO/DTO layer of this package's own local templates API — pure validation
 * classes, with no data-access dependency at all. Exposed as its own subpath for a consumer that
 * only needs these wire shapes without also resolving {@link TemplatesAdminRepository}/
 * {@link TemplatesAdminService} (`@zanix/notifications/templates-api`'s own root barrel re-exports
 * both from the same file). `@zanix/console`, a remote-API frontend with no database of its own,
 * only needs {@link TemplateParamsRTO}/{@link UpdateTemplateRTO} to validate a form body before
 * forwarding it to a remote templates API — importing them from the root
 * `@zanix/notifications/templates-api` subpath instead pulls in the full Mongo-backed persistence
 * layer for no reason, adding unnecessary weight to a bundle that never touches it.
 *
 * @module
 */
export { CreateTemplateRTO, TemplateParamsRTO, UpdateTemplateRTO } from './templates.rto.ts'
