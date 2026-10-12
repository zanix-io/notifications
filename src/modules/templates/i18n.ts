import logger from '@zanix/logger'
import {
  createTranslator as createBaseTranslator,
  type MessageCatalog,
  type Translator,
} from 'modules/templates/translate.ts'

export {
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

/**
 * Builds the translator a template renders with, as `{{t 'key' name=value}}`: `findText`, and a key no
 * language has is shown as the key itself and logged once with the service logger, never as an empty
 * string.
 *
 * @param catalog The texts loaded for the languages of `chain`.
 * @param chain The languages to try, most specific first.
 * @param escape Whether the values are escaped as HTML (an email) or left as they are (a text message).
 */
export function createTranslator(
  catalog: MessageCatalog,
  chain: string[],
  escape: boolean,
): Translator {
  return createBaseTranslator(catalog, chain, escape, (message) => logger.warn(message))
}
