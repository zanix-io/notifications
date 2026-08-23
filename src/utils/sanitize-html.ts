import { sanitizeUrl } from '@zanix/helpers'

const DANGEROUS_ELEMENTS = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const DANGEROUS_ELEMENTS_VOID = /<(script|style|iframe|object|embed)\b[^>]*\/?>/gi
const EVENT_HANDLER_DQUOTE = /\son\w+\s*=\s*"[^"]*"/gi
const EVENT_HANDLER_SQUOTE = /\son\w+\s*=\s*'[^']*'/gi
const EVENT_HANDLER_UNQUOTED = /\son\w+\s*=\s*[^\s"'>]+/gi
const NAVIGABLE_ATTRIBUTE = /\s(?:href|src|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi

/**
 * Denylist HTML sanitizer for `GenericTemplateSchema.content`/`.footer` (`email/generic`'s own
 * schema — see `schema.ts`): those two fields are rendered unescaped (`{{{content}}}`), by
 * design — a caller may supply real rich-HTML formatting, and every built-in template's own
 * default already is one. That same field is just as reachable by a calling app that naively
 * forwards user-influenced text (a comment, a support-ticket body) into it, so this runs on every
 * value before it reaches the template, whether it's a built-in default or caller-supplied.
 *
 * Strips, case-insensitively: `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` elements
 * (including their content), every `on*` event-handler attribute, and a
 * `javascript:`/`vbscript:`/non-image `data:` URI in an `href`/`src`/`action`/`formaction`
 * attribute. Ordinary formatting markup (`<p>`, `<strong>`, `<a href="https://...">`, `<br>`,
 * ...) passes through untouched.
 *
 * This is a regex-based denylist, not a full HTML parser — it closes the concrete
 * script-execution vectors above, not a general-purpose HTML sanitizer's full surface (e.g. it
 * doesn't validate tag nesting or attribute-list well-formedness). Sufficient for its actual job
 * here: neutralizing script execution in an HTML email body, not accepting arbitrary untrusted
 * HTML as a document.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(DANGEROUS_ELEMENTS, '')
    .replace(DANGEROUS_ELEMENTS_VOID, '')
    .replace(EVENT_HANDLER_DQUOTE, '')
    .replace(EVENT_HANDLER_SQUOTE, '')
    .replace(EVENT_HANDLER_UNQUOTED, '')
    .replace(NAVIGABLE_ATTRIBUTE, (match, quoted) => {
      const value = quoted.replace(/^["']|["']$/g, '')
      // `sanitizeUrl` neutralizes an unsafe scheme to `''` — but an already-empty attribute value
      // also sanitizes to `''` without being unsafe, so only a NON-empty value that came back
      // empty is what actually signals a rejected scheme (never an already-empty `href=""`).
      return value !== '' && sanitizeUrl(value) === '' ? '' : match
    })
}
