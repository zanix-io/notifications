import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { sanitizeHtml } from 'utils/sanitize-html.ts'

/**
 * Regression coverage for a confirmed risk: `GenericTemplateSchema.content`/`.footer` are rendered
 * unescaped ({{{content}}}/{{{footer}}}) — intentional, since a caller may supply real rich-HTML
 * formatting, but the same field is just as reachable by an app that naively forwards
 * user-influenced text into it. `sanitizeHtml` (and `@zanix/helpers`'s `sanitizeUrl`, which it
 * delegates its own URL-scheme check to — see that package's own tests for coverage of the
 * predicate itself) are this library's own last line of defense against that, run on every value
 * before it reaches the template.
 */

Deno.test('sanitizeHtml: ordinary formatting markup passes through unchanged', () => {
  const html = '<p>Hello <strong>world</strong>, visit <a href="https://zanix.dev">us</a>.</p>'
  assertEquals(sanitizeHtml(html), html)
})

Deno.test('sanitizeHtml: strips a <script> element and its content', () => {
  assertEquals(
    sanitizeHtml('<p>hi</p><script>alert(document.cookie)</script><p>bye</p>'),
    '<p>hi</p><p>bye</p>',
  )
})

Deno.test('sanitizeHtml: strips <style>/<iframe>/<object>/<embed> elements', () => {
  assertEquals(sanitizeHtml('<style>body{color:red}</style><p>ok</p>'), '<p>ok</p>')
  assertEquals(sanitizeHtml('<iframe src="https://evil.example"></iframe><p>ok</p>'), '<p>ok</p>')
  assertEquals(sanitizeHtml('<object data="evil.swf"></object><p>ok</p>'), '<p>ok</p>')
  assertEquals(sanitizeHtml('<embed src="evil.swf"><p>ok</p>'), '<p>ok</p>')
})

Deno.test('sanitizeHtml: strips an on* event-handler attribute, any quoting style', () => {
  assertEquals(sanitizeHtml('<img src="x.png" onerror="alert(1)">'), '<img src="x.png">')
  assertEquals(sanitizeHtml(`<div onclick='alert(1)'>hi</div>`), '<div>hi</div>')
  assertEquals(sanitizeHtml('<div onmouseover=alert(1)>hi</div>'), '<div>hi</div>')
})

Deno.test('sanitizeHtml: strips a javascript: href, keeps a safe one', () => {
  assertEquals(
    sanitizeHtml('<a href="javascript:alert(1)">click</a>'),
    '<a>click</a>',
  )
  assertEquals(
    sanitizeHtml('<a href="https://zanix.dev">click</a>'),
    '<a href="https://zanix.dev">click</a>',
  )
})

Deno.test('sanitizeHtml: strips a vbscript: src, keeps a data:image src', () => {
  assertEquals(sanitizeHtml('<img src="vbscript:msgbox(1)">'), '<img>')
  assertEquals(
    sanitizeHtml('<img src="data:image/png;base64,AAAA">'),
    '<img src="data:image/png;base64,AAAA">',
  )
})

Deno.test('sanitizeHtml: strips a non-image data: URI (e.g. data:text/html)', () => {
  assertEquals(sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>'), '<a>x</a>')
})

Deno.test('sanitizeHtml: catches an obfuscated scheme via an embedded tab', () => {
  assertEquals(sanitizeHtml('<a href="java\tscript:alert(1)">click</a>'), '<a>click</a>')
})
