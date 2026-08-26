/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 *
 * Pure data-shape types for this package's own persisted templates collection —
 * `ZanixTemplateAttrs`/`CreateTemplateInput`/`UpdateTemplateInput`/`TemplateSource`/
 * `SyncCodeTemplateEntry`/`SyncCodeTemplatesResult` (`typings/templates-db.ts`) and
 * `TemplatesControllerOptions` (`typings/templates-api.ts`) — deliberately without
 * `TemplatesAdminService`/`TemplatesAdminRepository`/`createTemplatesController` or anything else
 * that actually touches Handlebars/Mongo. Every one of those types only ever references
 * `Notifiers` (re-exported below from `typings/general.ts`, itself a plain string-union with no
 * imports of its own) or `@zanix/server`'s own ambient types — none of them require resolving the
 * heavy classes they happen to describe the inputs/outputs of.
 *
 * The only currently-exposed subpaths that reach these types — the root `@zanix/notifications`
 * barrel, `@zanix/notifications/core`, and `@zanix/notifications/templates-api` — ALL also
 * value-import `TemplatesAdminService`/`TemplatesAdminRepository` (real Handlebars-validating,
 * Mongo-backed classes) or `TemplateProvider` (every channel's compiled Handlebars template
 * registry). A consumer that only needs to type a payload shape it reads or writes — e.g. an admin
 * UI, or a remote sync client posting `{channel, name, hbs, hash}` entries — never needs any of
 * that, and importing this subpath instead keeps it that way.
 *
 * `typings/templates-db.ts`'s six types are also re-exported from the root `@zanix/notifications`
 * barrel; `TemplatesControllerOptions` is also re-exported from `@zanix/notifications/templates-api`
 * (not from root, which never exposed the templates-api controller surface). Switching between this
 * subpath and whichever of those a consumer already imports from is never a breaking change in any
 * direction.
 *
 * @module
 */

export type {
  CreateTemplateInput,
  SyncCodeTemplateEntry,
  SyncCodeTemplatesResult,
  TemplateSource,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from 'typings/templates-db.ts'
export type { TemplatesControllerOptions } from 'typings/templates-api.ts'
export type { Notifiers } from 'typings/general.ts'
