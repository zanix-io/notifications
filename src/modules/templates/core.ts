/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { registerModel } from '@zanix/datamaster'
import { Provider } from '@zanix/server'

import {
  assertTemplatesConfigNotConflicting,
  DATABASE_TEMPLATES_ENV,
  DEFAULT_TEMPLATES_MODEL_NAME,
  isDatabaseTemplatesDisabled,
  TemplateProvider,
  TEMPLATES_MODEL_ENV,
  TEMPLATES_SERVICE_URL_ENV,
} from './provider.ts'
import { templateModelDefinition } from './db/schema.ts'

// Fail fast at boot if both `TEMPLATES_SERVICE_URL` (Mode C) and `TEMPLATES_MODEL_NAME` (Modes
// A/B) are set — see `assertTemplatesConfigNotConflicting()`'s own doc comment. Runs before any
// other boot logic below so a misconfiguration never gets the chance to silently register a local
// model it shouldn't.
assertTemplatesConfigNotConflicting()

/**
 * `DATABASE_TEMPLATES=true` is a convenience opt-in for the DEFAULT model name — lets an app
 * enable database-backed templates without having to name the model itself via
 * `TEMPLATES_MODEL_NAME`. Deliberately explicit (never inferred from a database connector being
 * configured, e.g. `MONGO_URI`): this package has no reason to know that variable's name, and no
 * app — full or standalone — gets this feature without asking for it. Never overrides
 * `TEMPLATES_MODEL_NAME` if that's already set, including to an explicit empty string (a valid
 * opt-out even with `DATABASE_TEMPLATES=true`). Extracted as its own function (rather than inline
 * top-level code) so it's directly callable/testable without relying on module-import side effects.
 *
 * The `!Deno.env.has(TEMPLATES_SERVICE_URL_ENV)` guard below is defense-in-depth, not the primary
 * enforcement of that conflict: `assertTemplatesConfigNotConflicting()` (called at this module's own
 * top level, BEFORE this function runs — see above) now throws outright if `DATABASE_TEMPLATES=true`
 * and `TEMPLATES_SERVICE_URL` are both set, so this function's own guard should never actually be
 * the thing that catches it in practice — it's kept so this function stays correct even if called
 * directly, standalone, without that boot-time assertion having run first.
 */
export function defaultTemplatesModelName(): void {
  if (
    Deno.env.get(DATABASE_TEMPLATES_ENV) === 'true' &&
    !Deno.env.has(TEMPLATES_MODEL_ENV) &&
    !Deno.env.has(TEMPLATES_SERVICE_URL_ENV)
  ) {
    Deno.env.set(TEMPLATES_MODEL_ENV, DEFAULT_TEMPLATES_MODEL_NAME)

    // Required for `--watch`: remove the temporary env var before the process exits,
    // so the next restarted process starts with a clean environment.
    const cleanup = () => {
      Deno.env.delete(TEMPLATES_MODEL_ENV)

      Deno.removeSignalListener('SIGINT', cleanup)
      Deno.removeSignalListener('SIGTERM', cleanup)
    }

    Deno.addSignalListener('SIGINT', cleanup)
    Deno.addSignalListener('SIGTERM', cleanup)
  }
}

/**
 * Core Template provider loader for Zanix.
 *
 * Registers `TemplateProvider` under its own class identity — deliberately NOT under a
 * `CoreProviders` string type like `NotifierProvider`'s `'notifications'` (see
 * `providers/core.ts`), since `TemplateProvider` is resolved by class reference
 * (`this.providers.get(TemplateProvider)`, from `NotifierProvider.#dispatch()`), not by a
 * well-known string key. The decorator is applied as a plain function call directly on the
 * exported class — not on a wrapping subclass — so that identity matches: `@zanix/server` keys
 * provider registration on the exact class reference passed to `Provider()` (a `WeakMap`, see
 * `getTargetKey`), and a subclass wrapper would register a different, unreachable identity.
 *
 * `SCOPED` for the same reason `NotifierProvider` is (see `providers/core.ts`'s own comment): a
 * `SINGLETON` would pin `this.database`'s resolution to a fixed, non-request context forever.
 *
 * @requires TemplateProvider
 * @decorator Provider
 *
 * @module
 */
const zanixTemplateProvider: void = Provider({ lifetime: 'SCOPED' })(
  TemplateProvider,
)

defaultTemplatesModelName()

// Boot-time `ZanixTemplate` model registration, conditional on `TEMPLATES_MODEL_NAME` — the same
// `registerModel` DSL any other Zanix repository provider uses in the consuming provider — no schema-building
// at usage time). This is why `LocalTemplateBackend`'s own `#sync()` only ever does a name-only
// `getModel()`.
// Also skipped when `DATABASE_TEMPLATES=false` (see `isDatabaseTemplatesDisabled()`'s own comment)
// — no point registering a model for a feature the app explicitly turned off.
const modelName = Deno.env.get(TEMPLATES_MODEL_ENV)
if (modelName && !isDatabaseTemplatesDisabled()) {
  registerModel({ name: modelName, ...templateModelDefinition() })
}

export default zanixTemplateProvider
