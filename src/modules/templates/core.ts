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

import { TemplateProvider, TEMPLATES_MODEL_ENV } from './provider.ts'
import { templateModelDefinition } from './db/schema.ts'

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
const zanixTemplateProvider: void = Provider({ lifetime: 'SCOPED' })(TemplateProvider)

// Boot-time `ZanixTemplate` model registration, conditional on `TEMPLATES_MODEL_NAME` — the same
// `registerModel` DSL any other Zanix repository provider uses (see `ContractRepository` in
// aeratech-ms-blockchain for the established real-world pattern: `registerModel` once at import
// time, then a plain `this.database.getModel(name)` in the consuming provider — no schema-building
// at usage time). This is why `TemplateProvider.#sync()` only ever does a name-only `getModel()`.
const modelName = Deno.env.get(TEMPLATES_MODEL_ENV)
if (modelName) {
  registerModel({ name: modelName, ...templateModelDefinition() })
}

export default zanixTemplateProvider
