import type { Translator } from './translate.ts'

/** The helpers one message renders with, as Handlebars takes them. */
export type RenderHelpers = Record<string, (...args: never[]) => unknown>

/** Text Handlebars must not escape again (it asks an object for `toHTML()`): what `{{t}}` returns. */
export class SafeText {
  constructor(private readonly text: string) {}
  public toString(): string {
    return this.text
  }
  public toHTML(): string {
    return this.text
  }
}

/** Whether a template argument carries a value: not absent and not an empty string. */
const hasValue = (value: unknown): boolean => value !== undefined && value !== null && value !== ''

/**
 * Builds the helpers an independent database template renders with, for one message:
 *
 * - `{{t 'key' name=value}}` — the text of `key` in the language of the message, filled with the
 *   `name=value` arguments. The text is trusted markup (an operator wrote it) and the values were
 *   escaped when it was filled, so the result is not escaped a second time.
 * - `{{currentYear}}` — the current calendar year.
 * - `{{defaultTo value 'text'}}` — `value`, or `text` when `value` is absent or empty.
 * - `{{withSuffix value 'text'}}` — `value` followed by `text`, or an empty string when `value` is
 *   absent or empty (`(withSuffix app ' ')` turns an optional name into a prefix that carries its own
 *   separator).
 *
 * `currentYear`, `defaultTo` and `withSuffix` exist so a template can reproduce what a derived template's
 * transform computes (the footer's year, a default app name, an optional prefix) from the send's raw
 * data alone; they also work inside a subexpression, as `app=(defaultTo app 'Zanix')`. A mustache
 * named like one of the four calls the helper and does not read a data field of the same name
 * (`{{this.currentYear}}` reads the field).
 *
 * @param t The translator of the message.
 */
export function createRenderHelpers(t: Translator): RenderHelpers {
  return {
    // Handlebars passes the call's `key=value` arguments as `options.hash`, and its own `options`
    // object last.
    t: function (key: string, options?: { hash?: Record<string, unknown> }) {
      return new SafeText(t(key, options?.hash))
    },
    currentYear: () => new Date().getFullYear(),
    defaultTo: (value: unknown, fallback: unknown) => hasValue(value) ? value : fallback,
    withSuffix: (value: unknown, text: unknown) => hasValue(value) ? `${value}${text}` : '',
  }
}
