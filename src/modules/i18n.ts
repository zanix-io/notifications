/**
 * The translation primitives behind the `{{t 'key'}}` template helper, for a consumer that renders
 * or previews the same catalogs outside a send (a console, a browser): language chain, `{name}`
 * interpolation, plural forms and fallback. Pure functions with no Handlebars, database, server or
 * connector in the module graph; a missing key is logged with `console.warn` unless `warn` says
 * otherwise. `createRenderHelpers()` builds the helpers an independent template renders with (`t`,
 * `currentYear`, `defaultTo`, `withSuffix`), so a consumer that previews a template renders it as a
 * send does.
 *
 * @module
 */

export {
  createTranslator,
  DEFAULT_LANG_ENV,
  defaultLang,
  findText,
  interpolate,
  langChain,
  type MessageCatalog,
  type MessageTexts,
  type TranslateValues,
  type Translator,
} from 'modules/templates/translate.ts'

export {
  createRenderHelpers,
  type RenderHelpers,
  SafeText,
} from 'modules/templates/render-helpers.ts'
