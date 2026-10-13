import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@^1.0.15'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { TemplatesAdminRepository } from 'modules/templates/db/templates.repository.ts'

import { TemplatesAdminService } from 'modules/templates/db/templates.service.ts'
import { DERIVED_TEMPLATES, starterHbsFor } from 'modules/templates/db/manifest.ts'
import { assertValidHandlebarsSyntax } from 'modules/templates/hbs-validation.ts'
import { createRenderHelpers } from 'modules/templates/render-helpers.ts'
import { buildStarterHbs, starterFor } from 'modules/templates/transactional/starter.ts'
import genericCss from 'modules/templates/handlebars/email/generic/styles.css' with { type: 'text' }

function fakeService(repository: Partial<TemplatesAdminRepository>) {
  const instance = Object.create(TemplatesAdminService.prototype)
  Object.defineProperty(instance, 'providers', { value: { get: () => repository } })
  return instance as TemplatesAdminService
}

const record = (fields: Partial<ZanixTemplateAttrs>): ZanixTemplateAttrs => ({
  channel: 'email',
  name: 'login-otp',
  parent: 'generic',
  source: 'database',
  active: true,
  version: 1,
  hash: 'h',
  ...fields,
})

Deno.test('starters: every derived email template declares a starter', () => {
  // A derived email template without one gives an operator nothing to start a body of their own from:
  // add `starter` to its declaration (see `DerivedTemplateDeclaration.starter`).
  const missing = DERIVED_TEMPLATES
    .filter((entry) => entry.channel === 'email' && !entry.starter)
    .map((entry) => entry.name)
  assertEquals(missing, [], `email templates declared without a starter: ${missing.join(', ')}`)
})

Deno.test('starters: every declared starter generates valid Handlebars', async () => {
  const declared = DERIVED_TEMPLATES.filter((entry) => entry.starter)
  assert(declared.length > 0)
  for (const entry of declared) {
    // deno-lint-ignore no-await-in-loop
    const starter = await starterFor(entry)
    assert(starter, `${entry.channel}/${entry.name} generates its starter`)
    // deno-lint-ignore no-await-in-loop
    await assertValidHandlebarsSyntax(starter)
  }
})

Deno.test("starters: every email starter inlines the parent's styles.css and its class names", async () => {
  const squash = (text: string) => text.replace(/\s+/g, ' ')
  for (const entry of DERIVED_TEMPLATES.filter((e) => e.channel === 'email')) {
    // deno-lint-ignore no-await-in-loop
    const starter = (await starterFor(entry)) as string
    assert(squash(starter).includes(squash(genericCss.trim())), `${entry.name} inlines the css`)
    assert(starter.includes('<div class="container">'))
    assertEquals(starter.includes('styles.'), false)
  }
})

const PARENT = {
  hbs: [
    '<style>{{styles.css}}</style>',
    '<h1 class="{{styles.titleClass}}">{{title}}</h1>',
    '<div>{{{content}}}</div>',
    '{{#if buttonText}}<b>{{buttonText}}</b>{{else if footer}}x{{/if}}',
    '{{#unless message}}no{{/unless}}<i>{{html.title}}</i>{{footer}}',
  ].join('\n'),
  css: 'h1 { color: red; }\n',
  classDefaults: { titleClass: 'title' },
}

Deno.test('buildStarterHbs: replaces printed, unescaped and conditional uses of a variable, nothing else', () => {
  const out = buildStarterHbs(PARENT, {
    title: "t 'a.title'",
    content: "t 'a.content' n=n",
    buttonText: 'code',
    footer: "t 'a.footer' app=app",
    message: 'ttl',
    'html.title': "defaultTo html.title 'Doc'",
  })
  assertEquals(
    out,
    [
      '<style>h1 { color: red; }</style>',
      `<h1 class="title">{{t 'a.title'}}</h1>`,
      `<div>{{{t 'a.content' n=n}}}</div>`,
      `{{#if code}}<b>{{code}}</b>{{else if (t 'a.footer' app=app)}}x{{/if}}`,
      `{{#unless ttl}}no{{/unless}}<i>{{defaultTo html.title 'Doc'}}</i>{{t 'a.footer' app=app}}`,
    ].join('\n'),
  )
})

Deno.test('buildStarterHbs: a variable that is not assigned keeps reading the data, and a prefix name is not matched', () => {
  const out = buildStarterHbs(PARENT, { title: 'x' })
  assert(out.includes('{{{content}}}'))
  assert(out.includes('{{#if buttonText}}<b>{{buttonText}}</b>'))
  // `title` does not touch `html.title`.
  assert(out.includes('<i>{{html.title}}</i>'))
  assertEquals(buildStarterHbs(PARENT, { 'html.title': 'y' }).includes('{{y}}'), true)
})

Deno.test('buildStarterHbs: a fragment replaces a printed variable and is rejected as a condition', () => {
  const out = buildStarterHbs(PARENT, { content: { fragment: '{{{a}}}{{#if b}}c{{/if}}' } })
  assert(out.includes('<div>{{{a}}}{{#if b}}c{{/if}}</div>'))
  assertThrows(() => buildStarterHbs(PARENT, { buttonText: { fragment: 'z' } }), Error, 'fragment')
})

Deno.test('buildStarterHbs: a change in the parent source reaches the starter without editing any declaration', async () => {
  const entry = DERIVED_TEMPLATES.find((e) => e.channel === 'email' && e.name === 'login-otp')
  assert(entry?.starter)
  const generated = (await starterFor(entry)) as string
  const edited = buildStarterHbs(
    {
      hbs: PARENT.hbs.replace('<h1', '<h1 data-marker="edited"'),
      css: PARENT.css,
      classDefaults: PARENT.classDefaults,
    },
    entry.starter,
  )
  assert(edited.includes(`<h1 data-marker="edited" class="title">{{t 'login-otp.title'}}</h1>`))
  assertEquals(generated.includes('data-marker'), false)
})

Deno.test('starterHbsFor: the starter of a declared derived template, nothing for any other name', async () => {
  assert((await starterHbsFor('sms', 'otp'))?.includes("{{{t 'sms.otp.content'"))
  assertEquals(await starterHbsFor('sms', 'generic'), undefined)
  assertEquals(await starterHbsFor('email', 'otp'), undefined)
  assertEquals(await starterHbsFor('email', 'invoice-created'), undefined)
})

Deno.test('TemplatesAdminService.get adds starterHbs to a derived record with no hbs, computed on read', async () => {
  const stored = record({})
  const service = fakeService({ get: () => Promise.resolve(stored) })

  const result = await service.get('email', 'login-otp')

  assertEquals(result.starterHbs, await starterHbsFor('email', 'login-otp'))
  assertEquals(result.parent, 'generic')
  // The record read from storage is not modified: the field is never part of what is stored.
  assertEquals('starterHbs' in stored, false)
})

Deno.test('TemplatesAdminService.get leaves starterHbs out of a record with its own hbs and of a non-derived one', async () => {
  const own = fakeService({ get: () => Promise.resolve(record({ hbs: '<p>{{code}}</p>' })) })
  assertEquals((await own.get('email', 'login-otp')).starterHbs, undefined)

  const custom = fakeService({
    get: () => Promise.resolve(record({ name: 'invoice-created', parent: undefined })),
  })
  assertEquals((await custom.get('email', 'invoice-created')).starterHbs, undefined)

  const missing = fakeService({ get: () => Promise.reject(new Error('NOT_FOUND')) })
  await assertRejects(() => missing.get('email', 'login-otp'), Error, 'NOT_FOUND')
})

Deno.test('render helpers: currentYear, defaultTo and withSuffix', () => {
  const helpers = createRenderHelpers((key) => key) as Record<string, (...a: unknown[]) => unknown>
  assertEquals(helpers.currentYear(), new Date().getFullYear())
  assertEquals(helpers.defaultTo(undefined, 'Zanix'), 'Zanix')
  assertEquals(helpers.defaultTo('', 'Zanix'), 'Zanix')
  assertEquals(helpers.defaultTo('Presenza', 'Zanix'), 'Presenza')
  assertEquals(helpers.withSuffix('Presenza', ' '), 'Presenza ')
  assertEquals(helpers.withSuffix(undefined, ' '), '')
  assertEquals(helpers.withSuffix('', ' '), '')
})

Deno.test('TemplatesAdminService.get generates the starter from the body the parent holds now, not from its code source', async () => {
  const branded =
    "<main data-brand='presenza'><h1>{{title}}</h1>{{#if buttonText}}<b>{{buttonText}}</b>{{/if}}</main>"
  const parent = record({ name: 'generic', parent: undefined, hbs: branded })
  const service = fakeService({
    get: (_channel: string, name: string) =>
      Promise.resolve(name === 'generic' ? parent : record({})),
  })

  const { starterHbs } = await service.get('email', 'login-otp')

  assertEquals(
    starterHbs,
    "<main data-brand='presenza'><h1>{{t 'login-otp.title'}}</h1>{{#if code}}<b>{{code}}</b>{{/if}}</main>",
  )
  // The library's own `generic` is not in it.
  assertEquals(starterHbs?.includes('class="container"'), false)
})

Deno.test('TemplatesAdminService.get falls back to the parent code source when the parent cannot be read or has no body', async () => {
  const unreadable = fakeService({
    get: (_channel: string, name: string) =>
      name === 'generic' ? Promise.reject(new Error('not found')) : Promise.resolve(record({})),
  })
  assertEquals(
    (await unreadable.get('email', 'login-otp')).starterHbs,
    await starterHbsFor('email', 'login-otp'),
  )

  const bodiless = fakeService({
    get: (_channel: string, name: string) =>
      Promise.resolve(record(name === 'generic' ? { name: 'generic', parent: undefined } : {})),
  })
  assertEquals(
    (await bodiless.get('email', 'login-otp')).starterHbs,
    await starterHbsFor('email', 'login-otp'),
  )
})
