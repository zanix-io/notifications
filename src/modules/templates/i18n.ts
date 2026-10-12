import logger from '@zanix/logger'

/**
 * The language a message falls back to when its own has no text for a key: the value of this env var,
 * or `'en'` when unset.
 */
export const DEFAULT_LANG_ENV = 'NOTIFICATIONS_DEFAULT_LANG'

const FALLBACK_DEFAULT_LANG = 'en'

/** The texts of one language, by key. */
export type MessageTexts = Record<string, string>

/** The texts of several languages, by language and then by key. */
export type MessageCatalog = Record<string, MessageTexts>

/** The language a message uses when it names none, and the last one a missing key falls back to. */
export function defaultLang(): string {
  return Deno.env.get(DEFAULT_LANG_ENV)?.trim() || FALLBACK_DEFAULT_LANG
}

/**
 * The languages to try for a message, most specific first: the language itself (`es-MX`), its base
 * (`es`), and the default language, with no repeats. A message that names no language tries only the
 * default one.
 *
 * @param lang The language the message asks for, as a BCP 47 tag.
 */
export function langChain(lang?: string): string[] {
  const asked = lang?.trim()
  const chain = asked ? [asked, asked.split('-')[0]] : []
  chain.push(defaultLang())
  return [...new Set(chain.filter(Boolean))]
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}

/** Escapes the characters that mean something in HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char])
}

/**
 * Fills the `{name}` placeholders of `text` with `values`. A placeholder with no value stays as it is,
 * so a missing variable shows up in the message instead of vanishing from it.
 *
 * @param escape Escape each value as HTML: the text itself is trusted markup (an operator wrote it),
 * the values are not.
 */
export function interpolate(
  text: string,
  values: Record<string, unknown>,
  escape: boolean,
): string {
  return text.replace(/\{([A-Za-z0-9_.]+)\}/g, (placeholder, name: string) => {
    if (!(name in values) || values[name] === undefined || values[name] === null) {
      return placeholder
    }
    const value = String(values[name])
    return escape ? escapeHtml(value) : value
  })
}

/** Options of one `t` call: the variables of the text, and `count` to pick a plural form. */
export type TranslateValues = Record<string, unknown> & { count?: number }

/** Resolves the text for a key in the language of a message. */
export type Translator = (key: string, values?: TranslateValues) => string

/**
 * Looks up the text for `key` in each language of the chain in turn, filled with `values`. With a
 * numeric `count`, the plural form of that language is tried first (`key.one`, `key.other`, ... from
 * `Intl.PluralRules`), then the plain key.
 *
 * @param catalog The texts loaded for the languages of `chain`.
 * @param chain The languages to try, most specific first (see {@linkcode langChain}).
 * @param key The key to look up.
 * @param values The variables of the text, and `count` to pick a plural form.
 * @param escape Whether the values are escaped as HTML (an email) or left as they are.
 * @returns The text, or `undefined` when no language has it.
 */
export function findText(
  catalog: MessageCatalog,
  chain: string[],
  key: string,
  values: TranslateValues = {},
  escape = false,
): string | undefined {
  const { count, ...rest } = values
  for (const lang of chain) {
    const texts = catalog[lang]
    if (!texts) continue
    const plural = typeof count === 'number'
      ? texts[`${key}.${new Intl.PluralRules(lang).select(count)}`] ?? texts[`${key}.other`]
      : undefined
    const text = plural ?? texts[key]
    if (text !== undefined) {
      return interpolate(text, { ...rest, ...(count !== undefined && { count }) }, escape)
    }
  }
  return undefined
}

/**
 * Builds the translator a template renders with, as `{{t 'key' name=value}}`: {@linkcode findText}, and
 * a key no language has is shown as the key itself and logged once, never as an empty string.
 *
 * @param catalog The texts loaded for the languages of `chain`.
 * @param chain The languages to try, most specific first (see {@linkcode langChain}).
 * @param escape Whether the values are escaped as HTML (an email) or left as they are (a text message).
 */
export function createTranslator(
  catalog: MessageCatalog,
  chain: string[],
  escape: boolean,
): Translator {
  const warned = new Set<string>()
  return (key, values) => {
    const text = findText(catalog, chain, key, values, escape)
    if (text !== undefined) return text
    if (!warned.has(key)) {
      warned.add(key)
      logger.warn(`[Templates] no text for "${key}" in ${chain.join(', ')}`)
    }
    return key
  }
}
