import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import {
  registeredMessages,
  registerTemplateSeeds,
  resetTemplateSeeds,
  withRegisteredTemplates,
} from 'modules/templates/db/seeds.ts'
import type { StaticTemplateEntry } from 'modules/templates/db/sync.ts'

const builtIn: StaticTemplateEntry = {
  channel: 'email',
  name: 'generic',
  hbs: '<p>built-in</p>',
  hash: 'built-in',
  availableVariables: [],
  styles: { css: '', classDefaults: {} },
}

Deno.test('seeds: a registered template is added to the library ones, with its hash and variables', async () => {
  resetTemplateSeeds()
  try {
    registerTemplateSeeds({ templates: [{ channel: 'sms', name: 'reminder', hbs: 'Hi {{name}}' }] })

    const merged = await withRegisteredTemplates([builtIn])

    assertEquals(merged.map((entry) => `${entry.channel}/${entry.name}`), [
      'email/generic',
      'sms/reminder',
    ])
    const added = merged[1]
    assertEquals(added.hbs, 'Hi {{name}}')
    assertEquals(added.availableVariables, ['name'])
    assertEquals(added.hash.length > 0, true)
  } finally {
    resetTemplateSeeds()
  }
})

Deno.test('seeds: a registered template that names a built-in replaces it, and a later one replaces an earlier one', async () => {
  resetTemplateSeeds()
  try {
    registerTemplateSeeds({ templates: [{ channel: 'email', name: 'generic', hbs: 'one' }] })
    registerTemplateSeeds({
      templates: [{ channel: 'email', name: 'generic', hbs: 'two', availableVariables: ['x'] }],
    })

    const merged = await withRegisteredTemplates([builtIn])

    assertEquals(merged.length, 1)
    assertEquals([merged[0].hbs, merged[0].availableVariables], ['two', ['x']])
  } finally {
    resetTemplateSeeds()
  }
})

Deno.test('seeds: a template that is not valid Handlebars is skipped, the rest still sync', async () => {
  resetTemplateSeeds()
  try {
    registerTemplateSeeds({
      templates: [
        { channel: 'email', name: 'broken', hbs: '{{#if}}' },
        { channel: 'email', name: 'fine', hbs: 'ok' },
      ],
    })

    const merged = await withRegisteredTemplates([])

    assertEquals(merged.map((entry) => entry.name), ['fine'])
  } finally {
    resetTemplateSeeds()
  }
})

Deno.test('seeds: the message texts of every registration are flattened, a later one winning', async () => {
  resetTemplateSeeds()
  try {
    registerTemplateSeeds({ messages: { es: { a: 'uno', b: 'dos' }, en: { a: 'one' } } })
    registerTemplateSeeds({ messages: { es: { a: 'UNO' } } })

    assertEquals(await registeredMessages(), [
      { lang: 'es', key: 'a', text: 'UNO' },
      { lang: 'es', key: 'b', text: 'dos' },
      { lang: 'en', key: 'a', text: 'one' },
    ])
  } finally {
    resetTemplateSeeds()
  }
})

Deno.test('seeds: messagesDir reads <lang>/*.json files, and messages win on the same key', async () => {
  const dir = await Deno.makeTempDir()
  resetTemplateSeeds()
  try {
    await Deno.mkdir(`${dir}/es`)
    await Deno.mkdir(`${dir}/en`)
    await Deno.writeTextFile(`${dir}/es/mail.json`, JSON.stringify({ a: 'uno', b: 'dos' }))
    await Deno.writeTextFile(`${dir}/es/sms.json`, JSON.stringify({ c: 'tres' }))
    await Deno.writeTextFile(`${dir}/en/mail.json`, JSON.stringify({ a: 'one' }))
    await Deno.writeTextFile(`${dir}/en/notes.txt`, 'ignored')
    registerTemplateSeeds({ messagesDir: dir, messages: { es: { a: 'UNO' } } })

    const found = Object.fromEntries(
      (await registeredMessages()).map(({ lang, key, text }) => [`${lang}:${key}`, text]),
    )

    assertEquals(found, { 'es:a': 'UNO', 'es:b': 'dos', 'es:c': 'tres', 'en:a': 'one' })
  } finally {
    resetTemplateSeeds()
    await Deno.remove(dir, { recursive: true })
  }
})
