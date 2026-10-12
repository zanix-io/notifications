import { assert, assertEquals } from 'jsr:@std/assert@^1.0.15'
import { classValidation } from '@zanix/validator'
import {
  CreateTemplateRTO,
  MessageEntriesSearchRTO,
  MessageParamsRTO,
  MessagesSearchRTO,
  PreviewTemplateRTO,
  SetMessageRTO,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from 'modules/templates/templates-api/rtos/templates.rto.ts'

Deno.test('TemplateParamsRTO validates channel/name', async () => {
  const rto = await classValidation(TemplateParamsRTO, {
    channel: 'email',
    name: 'welcome',
  })
  assertEquals(rto.channel, 'email')
  assertEquals(rto.name, 'welcome')
})

Deno.test('CreateTemplateRTO validates channel/name/hbs + optional fields', async () => {
  const rto = await classValidation(CreateTemplateRTO, {
    channel: 'sms',
    name: 'invoice',
    hbs: 'Invoice #{{id}}',
    description: 'invoice notice',
    availableVariables: ['id'],
  })
  assertEquals(rto.channel, 'sms')
  assertEquals(rto.name, 'invoice')
  assertEquals(rto.hbs, 'Invoice #{{id}}')
  assertEquals(rto.description, 'invoice notice')
  assertEquals(rto.availableVariables, ['id'])
})

Deno.test('CreateTemplateRTO leaves optional fields undefined when omitted', async () => {
  const rto = await classValidation(CreateTemplateRTO, {
    channel: 'sms',
    name: 'invoice',
    hbs: 'Invoice #{{id}}',
  })
  assertEquals(rto.description, undefined)
  assertEquals(rto.availableVariables, undefined)
})

Deno.test('UpdateTemplateRTO validates fields when provided', async () => {
  const rto = await classValidation(UpdateTemplateRTO, {
    hbs: 'new content',
    active: false,
    description: 'updated',
    availableVariables: ['a', 'b'],
  })
  assertEquals(rto.hbs, 'new content')
  assertEquals(rto.active, false)
  assertEquals(rto.description, 'updated')
  assertEquals(rto.availableVariables, ['a', 'b'])
})

Deno.test('UpdateTemplateRTO leaves every field undefined when nothing is provided', async () => {
  const rto = await classValidation(UpdateTemplateRTO, {})
  assertEquals(rto.hbs, undefined)
  assertEquals(rto.active, undefined)
  assertEquals(rto.description, undefined)
  assertEquals(rto.availableVariables, undefined)
})

Deno.test('UpdateTemplateRTO rejects a non-boolean active value', async () => {
  let threw = false
  try {
    await classValidation(UpdateTemplateRTO, { active: 'yes' })
  } catch {
    threw = true
  }
  assert(threw)
})

Deno.test('the message RTOs validate the catalog routes', async () => {
  assertEquals((await classValidation(MessagesSearchRTO, { langs: 'es,en' })).langs, 'es,en')
  assertEquals((await classValidation(MessagesSearchRTO, {})).langs, undefined)

  const params = await classValidation(MessageParamsRTO, { lang: 'es-MX', key: 'login-otp.title' })
  assertEquals([params.lang, params.key], ['es-MX', 'login-otp.title'])
  assertEquals((await classValidation(SetMessageRTO, { text: 'Hola {name}' })).text, 'Hola {name}')
})

Deno.test('the catalog-screen RTOs: message-entries search and the preview body', async () => {
  const search = await classValidation(MessageEntriesSearchRTO, { langs: 'es,en', q: 'hola' })
  assertEquals([search.langs, search.q], ['es,en', 'hola'])
  assertEquals((await classValidation(MessageEntriesSearchRTO, {})).q, undefined)

  const body = await classValidation(PreviewTemplateRTO, { data: { name: 'Ana' }, lang: 'es' })
  assertEquals([body.data, body.lang], [{ name: 'Ana' }, 'es'])
  assertEquals((await classValidation(PreviewTemplateRTO, {})).data, undefined)
  assertEquals((await classValidation(PreviewTemplateRTO, {})).texts, undefined)
  const drafted = await classValidation(PreviewTemplateRTO, { texts: { 'welcome.title': 'Hi' } })
  assertEquals(drafted.texts, { 'welcome.title': 'Hi' })
})
