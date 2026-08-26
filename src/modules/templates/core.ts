/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { registerModel } from '@zanix/database'
import { Provider } from '@zanix/server'

import {
  assertTemplatesBackendConfigValid,
  TemplateProvider,
  templatesBackendMode,
  templatesModelName,
} from './provider.ts'
import { templateModelDefinition } from './db/schema.ts'

// Fail fast at boot on an invalid `TEMPLATES_BACKEND` value, or an incompletely-configured
// `'remote'` selection — see `assertTemplatesBackendConfigValid()`'s own doc comment. Runs before
// any other boot logic below so a misconfiguration never gets the chance to silently register a
// local model it shouldn't.
assertTemplatesBackendConfigValid()

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

// Boot-time `ZanixTemplate` model registration, gated on `TEMPLATES_BACKEND=local` — the same
// `registerModel` DSL any other Zanix repository provider uses in the consuming provider (no
// schema-building at usage time). This is why `LocalTemplateBackend`'s own `#sync()` only ever does
// a name-only `getModel()`. Skipped entirely for `'remote'` or the unset/pure-code path — the model
// name itself (`templatesModelName()`, optional, defaulting to `DEFAULT_TEMPLATES_MODEL_NAME`) is
// never read unless `'local'` is actually selected — see `templatesBackendMode()`'s own doc.
if (templatesBackendMode() === 'local') {
  registerModel({ name: templatesModelName(), ...templateModelDefinition() })
}

export default zanixTemplateProvider
