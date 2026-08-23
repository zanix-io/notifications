import { assertRejects } from 'jsr:@std/assert@^1.0.15'
import { assertValidHandlebarsSyntax } from 'modules/templates/hbs-validation.ts'

Deno.test('assertValidHandlebarsSyntax: a syntactically valid template resolves', async () => {
  await assertValidHandlebarsSyntax('<p>Hello {{name}}</p>')
})

Deno.test('assertValidHandlebarsSyntax: an unclosed block throws', async () => {
  await assertRejects(() => assertValidHandlebarsSyntax('{{#if}}'))
})

Deno.test('assertValidHandlebarsSyntax: an unterminated string literal throws', async () => {
  await assertRejects(() => assertValidHandlebarsSyntax('{{"unterminated}}'))
})
