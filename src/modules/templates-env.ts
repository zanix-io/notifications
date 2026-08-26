/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 *
 * `TEMPLATES_BACKEND`/`TEMPLATES_MODEL_NAME`/`TEMPLATES_SERVICE_*` env var selection and validation
 * — see `templates/env.ts`'s own module doc for why this lives in its own file, separate from
 * `templates/provider.ts`'s `TemplateProvider` class. `TemplateProvider` value-imports every
 * channel's compiled Handlebars template registry (and each one's own Zod validation schema), a
 * real cost that has nothing to do with simply knowing WHICH backend mode is currently selected. A
 * consumer that only needs `isTemplatesResourceEnabled()`/`TEMPLATES_BACKEND_ENV`/
 * `TEMPLATES_MODEL_ENV` (e.g. a gating check on whether a `/templates` resource should be exposed
 * at all) never needs any of that, and importing this subpath instead of the root
 * `@zanix/notifications` barrel, `@zanix/notifications/core`, or `@zanix/notifications/templates-api`
 * keeps it that way — all three currently reach `TemplateProvider` and, through it, every compiled
 * template.
 *
 * Every symbol here is also re-exported from the root `@zanix/notifications` barrel (via
 * `templates/provider.ts`'s own re-export of `templates/env.ts`), so switching between the two is
 * never a breaking change in either direction.
 *
 * @module
 */

export * from './templates/env.ts'
