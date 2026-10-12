import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { registerModel, ZanixMongoConnector } from '@zanix/database'
import { TEMPLATES_BACKEND_ENV, TEMPLATES_MODEL_ENV } from 'modules/templates/provider.ts'
import { templateModelDefinition } from 'modules/templates/db/schema.ts'
import { templateMessageModelDefinition } from 'modules/templates/db/messages-schema.ts'
import { TemplateProvider } from 'modules/templates/provider.ts'
import { syncMessages } from 'modules/templates/db/messages-sync.ts'
import {
  ensureTemplatesSynced,
  resetLocalTemplateBackendState,
} from 'modules/templates/db/local-backend.ts'
import { TemplatesAdminRepository } from 'modules/templates/db/templates.repository.ts'
import { registerTemplateSeeds, resetTemplateSeeds } from 'modules/templates/db/seeds.ts'
import type { ZanixTemplateAttrs, ZanixTemplateMessageAttrs } from 'typings/templates-db.ts'
import { loadTestEnv, missingEnv } from './env.ts'

console.error = () => {}

await loadTestEnv()

const REQUIRED_ENV = ['MONGO_TEST_URI']
const TEST_NAME =
  'Template seeds: registered templates and texts sync like the built-ins, and an edit is never overwritten'
const MODEL_NAME = 'zanix-templates-seeds-functional-test'
const MESSAGES_MODEL_NAME = `${MODEL_NAME}-messages`

/**
 * Functional test — a real MongoDB through the real `@zanix/datamaster`:
 *
 * 1. Seeds are registered before the connector starts and nothing else is called: the models' own
 *    seeders run the library sync, which now has the consumer's templates and texts in it.
 * 2. A record edited behind this package's back survives new words in the consumer, and a record nobody
 *    edited is brought up to date (`planCodeSync` / `planTemplateSync`).
 * 3. A template that reads texts renders in the language of the message, its subject being the text
 *    `<template>.subject`, from the real collections.
 */
Deno.test({
  name: TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, TEST_NAME),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const MONGO_URI = Deno.env.get('MONGO_TEST_URI') as string
    Deno.env.set('MONGO_URI', MONGO_URI)
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
    Deno.env.set(TEMPLATES_MODEL_ENV, MODEL_NAME)
    Deno.env.set('DATABASE_SEEDERS', 'true')

    resetTemplateSeeds()
    registerTemplateSeeds({
      templates: [
        { channel: 'email', name: 'seed-one', hbs: '<p>one {{name}}</p>' },
        { channel: 'email', name: 'seed-t', hbs: '<h1>{{t "seed.title" name=name}}</h1>' },
        { channel: 'sms', name: 'otp', hbs: 'Branded: {{{code}}}' },
      ],
      messages: {
        es: { 'seed.title': 'Hola {name}', 'seed-t.subject': 'Bienvenida' },
        en: { 'seed.title': 'Hello {name}', 'seed-t.subject': 'Welcome' },
      },
    })

    registerModel({ name: MODEL_NAME, ...templateModelDefinition() })
    registerModel({ name: MESSAGES_MODEL_NAME, ...templateMessageModelDefinition() })
    const db = new ZanixMongoConnector({ uri: MONGO_URI })
    try {
      await db.isReady
      const Model = db.getModel<ZanixTemplateAttrs>(MODEL_NAME)
      const Messages = db.getModel<ZanixTemplateMessageAttrs>(MESSAGES_MODEL_NAME)

      // 1. Built-ins and seeds are in the collections with no call after the start.
      const one = await Model.findOne({ channel: 'email', name: 'seed-one' }).lean()
      assertEquals([one?.hbs, one?.source], ['<p>one {{name}}</p>', 'code'])
      const otp = await Model.findOne({ channel: 'sms', name: 'otp' }).lean()
      assertEquals(otp?.hbs, 'Branded: {{{code}}}')
      const generic = await Model.findOne({ channel: 'email', name: 'generic' }).lean()
      assertStringIncludes(generic?.hbs ?? '', '{{{content}}}')
      const es = await Messages.findOne({ lang: 'es', key: 'seed.title' }).lean()
      assertEquals([es?.text, es?.source], ['Hola {name}', 'code'])

      // 3. A template reads the texts in the message's language, subject included.
      const provider = new TemplateProvider()
      Object.defineProperty(provider, 'database', { configurable: true, get: () => db })
      const spanish = await provider.resolveMessage('email', 'seed-t', { name: 'Ana' }, 'es-MX', {
        subject: true,
      })
      assertEquals(spanish, { body: '<h1>Hola Ana</h1>', subject: 'Bienvenida' })
      const english = await provider.resolveMessage('email', 'seed-t', { name: 'Ana' }, 'en', {
        subject: true,
      })
      assertEquals(english, { body: '<h1>Hello Ana</h1>', subject: 'Welcome' })

      // 2. An edit survives new words in the consumer; what nobody edited is brought up to date.
      await Model.updateOne({ channel: 'email', name: 'seed-one' }, {
        $set: { hbs: '<p>EDITED</p>' },
      })
      await Messages.updateOne({ lang: 'es', key: 'seed.title' }, {
        $set: { text: 'Buenas {name}' },
      })
      resetTemplateSeeds()
      registerTemplateSeeds({
        templates: [
          { channel: 'email', name: 'seed-one', hbs: '<p>one v2</p>' },
          { channel: 'sms', name: 'otp', hbs: 'Branded v2: {{{code}}}' },
        ],
        messages: {
          es: { 'seed.title': 'Hola de nuevo {name}', 'seed-t.subject': 'Bienvenida v2' },
        },
      })
      resetLocalTemplateBackendState()
      await ensureTemplatesSynced(Model)
      await syncMessages(Messages)

      assertEquals(
        (await Model.findOne({ channel: 'email', name: 'seed-one' }).lean())?.hbs,
        '<p>EDITED</p>',
      )
      assertEquals(
        (await Model.findOne({ channel: 'sms', name: 'otp' }).lean())?.hbs,
        'Branded v2: {{{code}}}',
      )
      assertEquals(
        (await Messages.findOne({ lang: 'es', key: 'seed.title' }).lean())?.text,
        'Buenas {name}',
      )
      assertEquals(
        (await Messages.findOne({ lang: 'es', key: 'seed-t.subject' }).lean())?.text,
        'Bienvenida v2',
      )
      // A record the consumer wrote before the code owned it is handed over when its predicate says so.
      await Model.insertMany([
        {
          channel: 'sms',
          name: 'legacy-mine',
          hbs: '{{!-- mine --}}old',
          source: 'database',
          active: true,
          version: 1,
          hash: 'h',
        },
        {
          channel: 'sms',
          name: 'legacy-theirs',
          hbs: 'someone else',
          source: 'database',
          active: true,
          version: 1,
          hash: 'h',
        },
      ] as never)
      resetTemplateSeeds()
      registerTemplateSeeds({
        templates: [
          { channel: 'sms', name: 'legacy-mine', hbs: 'new' },
          { channel: 'sms', name: 'legacy-theirs', hbs: 'new' },
        ],
        adopt: (hbs) => hbs.startsWith('{{!-- mine --}}'),
      })
      resetLocalTemplateBackendState()
      await ensureTemplatesSynced(Model)
      const mine = await Model.findOne({ channel: 'sms', name: 'legacy-mine' }).lean()
      assertEquals([mine?.hbs, mine?.source], ['new', 'code'])
      const theirs = await Model.findOne({ channel: 'sms', name: 'legacy-theirs' }).lean()
      assertEquals([theirs?.hbs, theirs?.source], ['someone else', 'database'])

      // The admin side, as a screen uses it: entries say what is edited, a reset goes back to the code.
      const admin =
        new (TemplatesAdminRepository as unknown as new () => TemplatesAdminRepository)()
      Object.defineProperty(admin, 'database', { configurable: true, get: () => db })
      await admin.setMessage('es', 'seed-t.subject', 'Mi asunto', 'admin-1')
      const entry = (await admin.listMessageEntries({ langs: ['es'], search: 'seed-t.subject' }))[0]
      assertEquals([entry.text, entry.source, entry.edited, entry.defaultText], [
        'Mi asunto',
        'code',
        true,
        'Bienvenida v2',
      ])
      const reset = await admin.resetMessage('es', 'seed-t.subject', 'admin-1')
      assertEquals(reset.text, 'Bienvenida v2')
      assertEquals((await admin.listMessageEntries({ search: 'seed-t.subject' }))[0].edited, false)

      // What the consumer stopped registering stays, no longer tied to the code.
      assertEquals(
        (await Model.findOne({ channel: 'email', name: 'seed-t' }).lean())?.source,
        'database',
      )
    } finally {
      await db.getModel(MODEL_NAME).deleteMany({})
      await db.getModel(MESSAGES_MODEL_NAME).deleteMany({})
      await db['close']()
      resetTemplateSeeds()
    }
  },
})
