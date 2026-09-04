import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { deriveAvailableVariables } from 'modules/templates/handlebars/derive-available-variables.ts'

Deno.test('deriveAvailableVariables: collects flat top-level mustache variables', () => {
  assertEquals(deriveAvailableVariables('<h1>{{title}}</h1>{{{content}}}'), ['content', 'title'])
})

Deno.test('deriveAvailableVariables: collects dotted paths', () => {
  assertEquals(deriveAvailableVariables('<html lang="{{html.lang}}">{{html.title}}</html>'), [
    'html.lang',
    'html.title',
  ])
})

Deno.test('deriveAvailableVariables: excludes styles.* entirely', () => {
  assertEquals(
    deriveAvailableVariables(
      '<style>{{styles.css}}</style><div class="{{styles.containerClass}}">{{title}}</div>',
    ),
    ['title'],
  )
})

Deno.test('deriveAvailableVariables: a bare {{styles}} reference is also excluded', () => {
  assertEquals(deriveAvailableVariables('{{styles}}{{title}}'), ['title'])
})

Deno.test('deriveAvailableVariables: collects a block helper param ({{#if}}) without the helper name itself', () => {
  assertEquals(
    deriveAvailableVariables('{{#if buttonText}}{{buttonText}}{{/if}}'),
    ['buttonText'],
  )
})

Deno.test('deriveAvailableVariables: an {{else}} branch is collected in the OUTER context, not a nested one', () => {
  assertEquals(
    deriveAvailableVariables('{{#if a}}{{a}}{{else}}{{b}}{{/if}}'),
    ['a', 'b'],
  )
})

Deno.test('deriveAvailableVariables: {{#each items}} collects the block param, not item-relative fields', () => {
  assertEquals(
    deriveAvailableVariables('{{#each items}}{{this.description}}{{/each}}'),
    ['items'],
  )
})

Deno.test('deriveAvailableVariables: a ../-prefixed path inside {{#each}} resolves back to the root field', () => {
  // The real shape `email/data-table/main.hbs` uses: `{{#if ../currency}}{{../currency}}{{/if}}`
  // nested inside `{{#each items}}` — must resolve to root `currency`, not `items.currency`.
  assertEquals(
    deriveAvailableVariables('{{#each items}}{{#if ../currency}}{{../currency}}{{/if}}{{/each}}'),
    ['currency', 'items'],
  )
})

Deno.test('deriveAvailableVariables: a bare {{this}}/{{.}} inside {{#each}} has no field name to report', () => {
  assertEquals(deriveAvailableVariables('{{#each items}}{{this}}{{.}}{{/each}}'), ['items'])
})

Deno.test('deriveAvailableVariables: excludes @index/@key private data variables', () => {
  assertEquals(
    deriveAvailableVariables('{{#each items}}{{@index}}: {{this.name}}{{/each}}'),
    ['items'],
  )
})

Deno.test('deriveAvailableVariables: {{#with x}} also shifts context, like {{#each}}', () => {
  assertEquals(
    deriveAvailableVariables('{{#with address}}{{this.city}}{{../name}}{{/with}}'),
    ['address', 'name'],
  )
})

Deno.test(
  'deriveAvailableVariables: a MustacheStatement/SubExpression own path is always collected too ' +
    '(this package registers no custom Handlebars helper — confirmed via `grep -rn registerHelper` ' +
    '— so a helper-call-shaped mustache like this never appears in a real template)',
  () => {
    assertEquals(
      deriveAvailableVariables('{{safe (concat baseUrl slug)}}'),
      ['baseUrl', 'concat', 'safe', 'slug'],
    )
  },
)

Deno.test('deriveAvailableVariables: deduplicates repeated references and sorts the result', () => {
  assertEquals(deriveAvailableVariables('{{b}}{{a}}{{b}}'), ['a', 'b'])
})

Deno.test("deriveAvailableVariables: matches email/generic/main.hbs's real, full variable list", () => {
  const hbs = `<html lang="{{html.lang}}">
    <title>{{html.title}}</title>
    <style>{{styles.css}}</style>
    <div class="{{styles.containerClass}}">
      <h1 class="{{styles.titleClass}}">{{title}}</h1>
      <div class="{{styles.contentClass}}">{{{content}}}</div>
      {{#if buttonText}}
        {{#if buttonLink}}
          <a href="{{buttonLink}}" class="{{styles.buttonClass}}">{{buttonText}}</a>
        {{else}}
          <span class="{{styles.buttonClass}}">{{buttonText}}</span>
        {{/if}}
      {{/if}}
      {{#if message}}<p class="{{styles.messageClass}}">{{message}}</p>{{/if}}
      {{#if footer}}<div class="{{styles.footerClass}}">{{{footer}}}</div>{{/if}}
    </div>
  </html>`

  assertEquals(deriveAvailableVariables(hbs), [
    'buttonLink',
    'buttonText',
    'content',
    'footer',
    'html.lang',
    'html.title',
    'message',
    'title',
  ])
})
