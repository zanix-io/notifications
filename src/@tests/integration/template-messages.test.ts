import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import type { AdaptedModel } from '@zanix/database'
import type { ZanixNotifierConnector } from 'modules/base.ts'
import type { ZanixTemplateAttrs, ZanixTemplateMessageAttrs } from 'typings/templates-db.ts'

import { NotifierProvider, sendBackgroundMessage } from 'modules/providers/notifier.ts'
import 'modules/templates/core.ts'
import '../fixtures.ts'
import {
  resetTemplateProviderState,
  TemplateProvider,
  TEMPLATES_BACKEND_ENV,
  TEMPLATES_MODEL_ENV,
} from 'modules/templates/provider.ts'
import { DEFAULT_LANG_ENV } from 'modules/templates/i18n.ts'
import { LocalTemplateBackend } from 'modules/templates/db/local-backend.ts'
import {
  getPreloadedMessages,
  resetPreloadedDBTemplates,
  resetPreloadedMessages,
} from 'modules/templates/db/manifest.ts'
import { resetTemplateSeeds } from 'modules/templates/db/seeds.ts'

console.error = () => {}
console.warn = () => {}

const MODEL = 'zanix_templates_messages_test'

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
    insertMany: (items: ZanixTemplateAttrs[]) => {
      items.forEach((item, i) => docs.push({ ...item, _id: `n-${docs.length + i}` }))
      return Promise.resolve()
    },
  }
}

/** An in-memory message catalog; `reads` counts the queries made to it. */
function fakeMessages(rows: Pick<ZanixTemplateMessageAttrs, 'lang' | 'key' | 'text'>[]) {
  const state = { reads: 0, fail: false }
  return {
    state,
    model: {
      // The sync of the registered texts reads `{source: 'code'}`; a catalog read asks for languages.
      find: (filter: { lang?: { $in: string[] } }) => ({
        lean: () => {
          if (!filter.lang) return Promise.resolve([])
          state.reads++
          if (state.fail) return Promise.reject(new Error('messages down'))
          return Promise.resolve(rows.filter((row) => filter.lang?.$in.includes(row.lang)))
        },
      }),
      updateOne: () => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 }),
    },
  }
}

const database = (templates: unknown, messages: unknown) => ({
  isReady: Promise.resolve(true),
  getModel: (name: string) =>
    (name.endsWith('-messages') ? messages : templates) as unknown as AdaptedModel<
      ZanixTemplateAttrs
    >,
})

function provider(templates: unknown, messages: unknown): TemplateProvider {
  resetTemplateProviderState()
  Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
  Deno.env.set(TEMPLATES_MODEL_ENV, MODEL)
  Deno.env.set(DEFAULT_LANG_ENV, 'en')
  const instance = new TemplateProvider()
  Object.defineProperty(instance, 'database', {
    configurable: true,
    get: () => database(templates, messages),
  })
  return instance
}

function cleanup() {
  Deno.env.delete(TEMPLATES_BACKEND_ENV)
  Deno.env.delete(TEMPLATES_MODEL_ENV)
  Deno.env.delete(DEFAULT_LANG_ENV)
  resetPreloadedDBTemplates()
  resetPreloadedMessages()
  resetTemplateSeeds()
  resetTemplateProviderState()
}

const greeting = (fields: Partial<ZanixTemplateAttrs> = {}): ZanixTemplateAttrs => ({
  channel: 'email',
  name: 'greeting',
  hbs: '<h1>{{t "greeting.title" name=name}}</h1><p>{{{t "greeting.body"}}}</p>',
  source: 'database',
  active: true,
  version: 1,
  hash: 'greeting-1',
  ...fields,
})

const CATALOG = [
  { lang: 'en', key: 'greeting.title', text: 'Hello {name}' },
  { lang: 'en', key: 'greeting.body', text: 'Welcome <b>aboard</b>.' },
  { lang: 'en', key: 'greeting.subject', text: 'Welcome' },
  { lang: 'es', key: 'greeting.title', text: 'Hola {name}' },
  { lang: 'es', key: 'greeting.subject', text: 'Bienvenida' },
  { lang: 'es-MX', key: 'greeting.title', text: 'Qué onda {name}' },
]

Deno.test('template messages: a template reads its texts in the language of the message, subject included', async () => {
  try {
    const instance = provider(fakeTemplates([greeting()]), fakeMessages(CATALOG).model)

    const es = await instance.resolveMessage('email', 'greeting', { name: 'Ana' }, 'es', {
      subject: true,
    })
    assertEquals(es.body, '<h1>Hola Ana</h1><p>Welcome <b>aboard</b>.</p>')
    assertEquals(es.subject, 'Bienvenida')

    // The more specific language wins where it has the text; its base and the default fill the rest.
    const mx = await instance.resolveMessage('email', 'greeting', { name: 'Ana' }, 'es-MX', {
      subject: true,
    })
    assertStringIncludes(mx.body, '<h1>Qué onda Ana</h1>')
    assertEquals(mx.subject, 'Bienvenida')

    // A language with nothing falls to the default one.
    const fr = await instance.resolveMessage('email', 'greeting', { name: 'Ana' }, 'fr', {
      subject: true,
    })
    assertEquals(fr.subject, 'Welcome')
    assertStringIncludes(fr.body, 'Hello Ana')

    // No language at all: the default.
    assertEquals(
      (await instance.resolveMessage('email', 'greeting', { name: 'Ana' }, undefined, {
        subject: true,
      })).subject,
      'Welcome',
    )
  } finally {
    cleanup()
  }
})

Deno.test('template messages: a derived built-in reads its texts from the catalog, and its subject too', async () => {
  try {
    const generic = greeting({
      name: 'generic',
      hbs: '<h1>{{title}}</h1><div>{{{content}}}</div>',
      hash: 'g',
    })
    const welcome = greeting({ name: 'welcome', hbs: undefined, parent: 'generic', hash: 'w' })
    const catalog = [
      { lang: 'es', key: 'welcome.title', text: 'Hola desde Presenza' },
      { lang: 'es', key: 'welcome.subject', text: 'Bienvenida a Presenza' },
    ]
    const instance = provider(fakeTemplates([generic, welcome]), fakeMessages(catalog).model)

    const es = await instance.resolveMessage('email', 'welcome', {}, 'es', { subject: true })
    // The catalog's text wins; the library's own fill what it does not carry.
    assertStringIncludes(es.body, '<h1>Hola desde Presenza</h1>')
    assertStringIncludes(es.body, 'Nos alegra tenerte en Zanix')
    assertEquals(es.subject, 'Bienvenida a Presenza')

    const en = await instance.resolveMessage('email', 'welcome', {}, 'en', { subject: true })
    assertStringIncludes(en.body, '<h1>Welcome, Astronaut!</h1>')
    assertEquals(en.subject, 'Welcome')
  } finally {
    cleanup()
  }
})

Deno.test('template messages: resolve() still answers with the body alone', async () => {
  try {
    const instance = provider(fakeTemplates([greeting()]), fakeMessages(CATALOG).model)
    const body = await instance.resolve('email', 'greeting', { name: 'Ana' }, 'es')
    assertEquals(typeof body, 'string')
    assertStringIncludes(body, 'Hola Ana')
  } finally {
    cleanup()
  }
})

Deno.test('template messages: the values of an email are escaped, those of an SMS are not', async () => {
  try {
    const sms: ZanixTemplateAttrs = {
      ...greeting({ channel: 'sms', name: 'greeting-sms' }),
      hbs: '{{t "greeting.title" name=name}}',
    }
    const instance = provider(fakeTemplates([greeting(), sms]), fakeMessages(CATALOG).model)

    const email = await instance.resolveMessage('email', 'greeting', { name: "<i>O'N</i>" }, 'en')
    assertStringIncludes(email.body, 'Hello &lt;i&gt;O&#x27;N&lt;/i&gt;')
    // The text itself is trusted markup: `{{{t}}}` is not escaped again.
    assertStringIncludes(email.body, '<p>Welcome <b>aboard</b>.</p>')

    const text = await instance.resolveMessage('sms', 'greeting-sms', { name: "O'Neil" }, 'en')
    assertEquals(text.body, "Hello O'Neil")
  } finally {
    cleanup()
  }
})

Deno.test('template messages: a plural form follows the count', async () => {
  try {
    const plural: ZanixTemplateAttrs = {
      ...greeting({ name: 'plural' }),
      hbs: '{{t "ideas" count=n}}',
    }
    const catalog = [
      { lang: 'es', key: 'ideas.one', text: '{count} idea guardada' },
      { lang: 'es', key: 'ideas.other', text: '{count} ideas guardadas' },
    ]
    const instance = provider(fakeTemplates([plural]), fakeMessages(catalog).model)

    assertEquals(
      (await instance.resolveMessage('email', 'plural', { n: 1 }, 'es')).body,
      '1 idea guardada',
    )
    assertEquals(
      (await instance.resolveMessage('email', 'plural', { n: 4 }, 'es')).body,
      '4 ideas guardadas',
    )
  } finally {
    cleanup()
  }
})

Deno.test('template messages: a template that reads no texts and asks for no subject never touches the catalog', async () => {
  try {
    const plain: ZanixTemplateAttrs = {
      ...greeting({ name: 'plain' }),
      hbs: '<p>{{name}}</p>',
    }
    const messages = fakeMessages(CATALOG)
    const instance = provider(fakeTemplates([plain]), messages.model)

    const result = await instance.resolveMessage('email', 'plain', { name: 'Ana' }, 'es')

    assertEquals(result, { body: '<p>Ana</p>', subject: undefined })
    assertEquals(messages.state.reads, 0)
  } finally {
    cleanup()
  }
})

Deno.test('template messages: the catalog is read once per message, not once per text', async () => {
  try {
    const messages = fakeMessages(CATALOG)
    const instance = provider(fakeTemplates([greeting()]), messages.model)

    await instance.resolveMessage('email', 'greeting', { name: 'Ana' }, 'es', { subject: true })

    assertEquals(messages.state.reads, 1)
  } finally {
    cleanup()
  }
})

Deno.test('template messages: a catalog that cannot be read falls back to the code registry, like any backend failure', async () => {
  try {
    const messages = fakeMessages(CATALOG)
    messages.state.fail = true
    const instance = provider(
      fakeTemplates([greeting(), greeting({ name: 'generic', hash: 'g' })]),
      messages.model,
    )

    // `greeting` has no code counterpart, so the fallback has nothing to render.
    await assertRejects(
      () => instance.resolveMessage('email', 'greeting', { name: 'Ana' }, 'es', { subject: true }),
      Error,
      'Template not found',
    )
  } finally {
    cleanup()
  }
})

Deno.test('template messages: a key no language has shows as the key', async () => {
  try {
    const instance = provider(fakeTemplates([greeting()]), fakeMessages([]).model)
    const result = await instance.resolveMessage('email', 'greeting', { name: 'Ana' }, 'es', {
      subject: true,
    })
    assertStringIncludes(result.body, 'greeting.title')
    // No text, no subject: the email goes out as it was written.
    assertEquals(result.subject, undefined)
  } finally {
    cleanup()
  }
})

Deno.test('template messages: preloadMessages hands the catalog to a worker, an empty language included', async () => {
  try {
    const instance = provider(fakeTemplates([]), fakeMessages(CATALOG).model)
    const cache = new Map<`znx:msg:${string}`, Record<string, string>>()

    await instance.preloadMessages(['es', 'en', 'fr'], cache)

    assertEquals(cache.get('znx:msg:es')?.['greeting.subject'], 'Bienvenida')
    assertEquals(cache.get('znx:msg:fr'), {})
    assertEquals([...cache.keys()].sort(), ['znx:msg:en', 'znx:msg:es', 'znx:msg:fr'])
  } finally {
    cleanup()
  }
})

Deno.test('template messages: a worker reads the texts it was handed and never opens a database', async () => {
  try {
    resetPreloadedMessages(new Map([['znx:msg:es', { k: 'texto' }], ['znx:msg:en', { k: 'text' }]]))
    // A database that fails if it is touched.
    const backend = new LocalTemplateBackend(() => {
      throw new Error('a worker has no database')
    }, MODEL)

    assertEquals(await backend.messages(['es', 'en']), { es: { k: 'texto' }, en: { k: 'text' } })
  } finally {
    cleanup()
  }
})

Deno.test('template messages: sendBackgroundMessage hydrates the preloaded texts for the worker', async () => {
  try {
    const handed = new Map<`znx:msg:${string}`, Record<string, string>>([['znx:msg:es', {
      a: 'b',
    }]])
    await sendBackgroundMessage([], new Map(), handed)
    assert(getPreloadedMessages() === handed)
  } finally {
    cleanup()
  }
})

/** A connector that records what it is asked to send. */
function recorder() {
  const calls: Record<string, unknown>[] = []
  const connector = {
    isReady: Promise.resolve(true),
    send: (data: Record<string, unknown>) => {
      calls.push(data)
      return Promise.resolve()
    },
    close: async () => {},
  }
  return { calls, connector: connector as unknown as ZanixNotifierConnector }
}

Deno.test('template messages: an email with no subject takes the one its template carries, in its language', async () => {
  const original = TemplateProvider.prototype.resolveMessage
  const asked: unknown[][] = []
  TemplateProvider.prototype.resolveMessage = function (...args: unknown[]) {
    asked.push(args)
    return Promise.resolve({ body: '<p>cuerpo</p>', subject: 'Asunto de la plantilla' })
  } as never
  try {
    const notifier = new NotifierProvider()
    const { calls, connector } = recorder()
    notifier.use = (() => connector) as typeof notifier.use

    await notifier.sendMessage('email', {
      to: 'a@b.com',
      zanixTemplate: 'welcome',
      lang: 'es',
      data: {},
    })

    assertEquals(asked[0].slice(0, 2), ['email', 'welcome'])
    assertEquals(asked[0][3], 'es')
    assertEquals(calls[0], {
      to: 'a@b.com',
      subject: 'Asunto de la plantilla',
      content: '<p>cuerpo</p>',
    })
    // `lang` is for the template, never sent on to the channel.
    assertEquals('lang' in calls[0], false)
  } finally {
    TemplateProvider.prototype.resolveMessage = original
  }
})

Deno.test('template messages: a subject set on the message always wins', async () => {
  const original = TemplateProvider.prototype.resolveMessage
  TemplateProvider.prototype.resolveMessage =
    (() => Promise.resolve({ body: 'x', subject: 'From the template' })) as never
  try {
    const notifier = new NotifierProvider()
    const { calls, connector } = recorder()
    notifier.use = (() => connector) as typeof notifier.use

    await notifier.sendMessage('email', {
      to: 'a@b.com',
      subject: 'Mine',
      zanixTemplate: 'welcome',
      data: {},
    })

    assertEquals((calls[0] as { subject: string }).subject, 'Mine')
  } finally {
    TemplateProvider.prototype.resolveMessage = original
  }
})

for (const channel of ['sms', 'whatsapp'] as const) {
  Deno.test(`template messages: a ${channel} message takes lang too, and never gets a subject`, async () => {
    const original = TemplateProvider.prototype.resolveMessage
    const asked: unknown[][] = []
    TemplateProvider.prototype.resolveMessage = function (...args: unknown[]) {
      asked.push(args)
      // Even a template that carries a subject adds none to a channel that has none.
      return Promise.resolve({ body: 'Tu código es 123456', subject: 'Un asunto' })
    } as never
    try {
      const notifier = new NotifierProvider()
      const { calls, connector } = recorder()
      notifier.use = (() => connector) as typeof notifier.use

      await notifier.sendMessage(channel, {
        to: '+5215512345678',
        zanixTemplate: 'otp',
        lang: 'es',
        data: { code: '123456', ttl: 10 },
      })

      assertEquals(asked[0].slice(0, 2), [channel, 'otp'])
      assertEquals(asked[0][3], 'es')
      assertEquals(calls[0], { to: '+5215512345678', content: 'Tu código es 123456' })
    } finally {
      TemplateProvider.prototype.resolveMessage = original
    }
  })
}

Deno.test('template messages: sms() and whatsapp() accept lang, and an email may omit its subject (types)', () => {
  // Never called: this only has to type-check.
  const typed = (notifier: NotifierProvider) => {
    notifier.sms({ to: '+1', zanixTemplate: 'otp', lang: 'es', data: { code: '1', ttl: 1 } })
    notifier.whatsapp({ to: '+1', zanixTemplate: 'otp', lang: 'es', data: { code: '1', ttl: 1 } })
    notifier.email({ to: 'a@b.com', zanixTemplate: 'welcome', lang: 'es', data: {} })
    // A plain-text email still needs its subject, and plain text has no language.
    notifier.email({ to: 'a@b.com', subject: 'Hi', content: 'text' })
    // @ts-expect-error a plain-text email without a subject
    notifier.email({ to: 'a@b.com', content: 'text' })
    // @ts-expect-error plain text has no template to pick a language for
    notifier.sms({ to: '+1', content: 'text', lang: 'es' })
  }
  assert(typeof typed === 'function')
})
