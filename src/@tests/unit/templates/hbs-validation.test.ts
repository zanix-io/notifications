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

Deno.test('assertValidHandlebarsSyntax: a template that reads message texts with {{t}} resolves', async () => {
  await assertValidHandlebarsSyntax(
    '<h1>{{t "greeting.title" name=name}}</h1><p>{{{t "greeting.body"}}}</p>',
  )
  await assertValidHandlebarsSyntax('{{t "items" count=n}}')
})

Deno.test('assertValidHandlebarsSyntax: a template with {{t}} and a real syntax error still throws', async () => {
  await assertRejects(() => assertValidHandlebarsSyntax('{{t "a"}}{{#if}}'))
})

Deno.test('assertValidHandlebarsSyntax: only t is stood in for, any other helper is still unknown', async () => {
  await assertRejects(() => assertValidHandlebarsSyntax('{{unknownHelper "a"}}'))
})
