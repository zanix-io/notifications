import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@^1.0.15'
import type { AdaptedModel } from '@zanix/database'
import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

import 'modules/templates/core.ts'
import '../fixtures.ts'
import {
  resetTemplateProviderState,
  TemplateProvider,
  TEMPLATES_BACKEND_ENV,
  TEMPLATES_MODEL_ENV,
} from 'modules/templates/provider.ts'
import { DEFAULT_LANG_ENV } from 'modules/templates/i18n.ts'
import { LIBRARY_MESSAGES } from 'modules/templates/library-messages.ts'
import {
  DERIVED_TEMPLATES,
  resetPreloadedDBTemplates,
  starterHbsFor,
} from 'modules/templates/db/manifest.ts'
import {
  loginWithOTP,
  newLogin,
  passwordChanged,
  passwordRecovery,
  welcome,
} from 'modules/templates/transactional/email/auth.ts'
import smsTemplates from 'modules/templates/transactional/sms.ts'
import whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

console.error = () => {}
console.warn = () => {}

const MODEL = 'zanix_derived_starters_test'

type TemplateDoc = ZanixTemplateAttrs & { _id: string }

/** An in-memory templates collection with only what the provider calls. */
function fakeTemplates(seed: ZanixTemplateAttrs[]) {
  const docs: TemplateDoc[] = seed.map((doc, i) => ({ ...doc, _id: `t-${i}` }))
  const matches = (doc: TemplateDoc, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => (doc as never)[key] === value)
  return {
    findOne: (filter: Record<string, unknown>) => ({
      lean: () => Promise.resolve(docs.find((doc) => matches(doc, filter)) ?? null),
    }),
    find: (filter: Record<string, unknown>) => ({
      lean: () => Promise.resolve(docs.filter((doc) => matches(doc, filter))),
    }),
    updateOne: () => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 }),
    insertMany: () => Promise.resolve(),
  }
}

/** The library's own texts, as the message collection holds them once they are seeded. */
const catalogRows = Object.entries(LIBRARY_MESSAGES).flatMap(([lang, texts]) =>
  Object.entries(texts).map(([key, text]) => ({ lang, key, text }))
)

const messagesModel = {
  find: (filter: { lang?: { $in: string[] } }) => ({
    lean: () =>
      Promise.resolve(
        filter.lang ? catalogRows.filter((row) => filter.lang?.$in.includes(row.lang)) : [],
      ),
  }),
  updateOne: () => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 }),
}

/** A provider over an in-memory collection holding `records`, as the local backend would read them. */
function provider(records: ZanixTemplateAttrs[]): TemplateProvider {
  resetTemplateProviderState()
  Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
  Deno.env.set(TEMPLATES_MODEL_ENV, MODEL)
  Deno.env.set(DEFAULT_LANG_ENV, 'en')
  const templates = fakeTemplates(records)
  const instance = new TemplateProvider()
  Object.defineProperty(instance, 'database', {
    configurable: true,
    get: () => ({
      isReady: Promise.resolve(true),
      getModel: (name: string) =>
        (name.endsWith('-messages') ? messagesModel : templates) as unknown as AdaptedModel<
          ZanixTemplateAttrs
        >,
    }),
  })
  return instance
}

function cleanup() {
  Deno.env.delete(TEMPLATES_BACKEND_ENV)
  Deno.env.delete(TEMPLATES_MODEL_ENV)
  Deno.env.delete(DEFAULT_LANG_ENV)
  resetPreloadedDBTemplates()
  resetTemplateProviderState()
}

/**
 * Whitespace that carries no meaning in the markup is dropped before comparing: every run of
 * whitespace becomes one space, a space touching a tag boundary disappears and the ends are trimmed.
 * Text, attributes, class names and the stylesheet are compared as they are.
 */
const normalize = (output: string): string =>
  output.replace(/\s+/g, ' ').replace(/ ?([<>]) ?/g, '$1').trim()

/** The real derived template, through the library's own render path (the transactional wrapper). */
type DerivedRender = (data: never, lang?: string) => Promise<string>

const DERIVED_RENDERS: Record<string, DerivedRender> = {
  'email:welcome': welcome as DerivedRender,
  'email:password-changed': passwordChanged as DerivedRender,
  'email:password-recovery': passwordRecovery as DerivedRender,
  'email:login-otp': loginWithOTP as DerivedRender,
  'email:new-login': newLogin as DerivedRender,
  'sms:otp': smsTemplates.otp as DerivedRender,
  'sms:new-login': smsTemplates['new-login'] as DerivedRender,
  'whatsapp:otp': whatsappTemplates.otp as DerivedRender,
}

const OTP = { code: '482913', ttl: 7 }
const OTP_APP = { ...OTP, app: 'Presenza' }
const LOGIN = { device: 'Chrome on macOS', time: 'Aug 19, 2026, 10:32 AM' }
const LOGIN_FULL = { ...LOGIN, location: 'Mexico City & suburbs', app: 'Presenza' }

/** Raw data per derived template: the required fields only, then every optional one. */
const CASES: Record<string, Record<string, unknown>[]> = {
  'email:welcome': [{}, { app: 'Presenza' }, {
    app: 'Presenza',
    buttonText: 'Get started',
    buttonLink: 'https://example.com/start?a=1&b=2',
    html: { title: 'Hi', lang: 'fr' },
  }],
  'email:password-changed': [{}, { app: 'Presenza' }],
  'email:password-recovery': [OTP, OTP_APP],
  'email:login-otp': [OTP, OTP_APP, { ...OTP_APP, html: { title: 'Custom', lang: 'xx' } }],
  'email:new-login': [LOGIN, LOGIN_FULL],
  'sms:otp': [OTP, OTP_APP],
  'sms:new-login': [LOGIN, LOGIN_FULL],
  'whatsapp:otp': [OTP, OTP_APP],
}

for (const entry of DERIVED_TEMPLATES) {
  const key = `${entry.channel}:${entry.name}`

  Deno.test(`derived starter: ${key} renders as the derived template does, in en and es`, async () => {
    const starter = await starterHbsFor(entry.channel, entry.name)
    assert(starter, `${key} declares a starter`)
    const derived = DERIVED_RENDERS[key]
    assert(derived, `${key} has a render in this test`)
    try {
      const instance = provider([{
        channel: entry.channel as Notifiers,
        name: entry.name,
        hbs: starter,
        source: 'database',
        active: true,
        version: 1,
        hash: `starter-${key}`,
      }])
      for (const lang of ['en', 'es']) {
        for (const data of CASES[key]) {
          // deno-lint-ignore no-await-in-loop
          const fromDerived = await derived(data as never, lang)
          // deno-lint-ignore no-await-in-loop
          const fromStarter = await instance.resolve(
            entry.channel as Notifiers,
            entry.name,
            data,
            lang,
          )
          assertEquals(
            normalize(fromStarter),
            normalize(fromDerived),
            `${key} (${lang}) with ${JSON.stringify(data)}`,
          )
          assert(fromDerived.trim().length > 0)
        }
      }
    } finally {
      cleanup()
    }
  })
}

Deno.test('derived starter: every declared derived template has a render case in this test', () => {
  for (const entry of DERIVED_TEMPLATES) {
    const key = `${entry.channel}:${entry.name}`
    assert(DERIVED_RENDERS[key] && CASES[key], `${key} is covered`)
  }
})

Deno.test('derived starter: the two languages render different text, so the comparison is not vacuous', async () => {
  const entry = DERIVED_TEMPLATES.find((e) => e.channel === 'sms' && e.name === 'otp')
  assert(entry)
  const starter = await starterHbsFor(entry.channel, entry.name)
  assert(starter)
  try {
    const instance = provider([{
      channel: 'sms',
      name: 'otp',
      hbs: starter,
      source: 'database',
      active: true,
      version: 1,
      hash: 'starter-sms-otp',
    }])
    const en = await instance.resolve('sms', 'otp', OTP_APP, 'en')
    const es = await instance.resolve('sms', 'otp', OTP_APP, 'es')
    assertNotEquals(en, es)
    assertEquals(
      en,
      "Your Presenza verification code is 482913. It expires in 7 minutes. Don't share this code with anyone.",
    )
  } finally {
    cleanup()
  }
})

Deno.test('derived starter: a message without app in the email footer falls back to Zanix with the current year', async () => {
  const entry = DERIVED_TEMPLATES.find((e) =>
    e.channel === 'email' && e.name === 'password-changed'
  )
  assert(entry)
  const starter = await starterHbsFor(entry.channel, entry.name)
  assert(starter)
  try {
    const instance = provider([{
      channel: 'email',
      name: 'password-changed',
      hbs: starter,
      source: 'database',
      active: true,
      version: 1,
      hash: 'starter-email-pc',
    }])
    const html = await instance.resolve('email', 'password-changed', {}, 'en')
    assert(html.includes(`© ${new Date().getFullYear()} Zanix. All rights reserved.`))
  } finally {
    cleanup()
  }
})

Deno.test('derived starter: a body that calls only currentYear or defaultTo, with no {{t}}, still gets the helpers', async () => {
  try {
    const instance = provider([{
      channel: 'email',
      name: 'year-only',
      hbs: "<p>{{currentYear}} {{defaultTo app 'Zanix'}}</p>",
      source: 'database',
      active: true,
      version: 1,
      hash: 'year-only',
    }])
    assertEquals(
      await instance.resolve('email', 'year-only', {}, 'en'),
      `<p>${new Date().getFullYear()} Zanix</p>`,
    )
  } finally {
    cleanup()
  }
})
