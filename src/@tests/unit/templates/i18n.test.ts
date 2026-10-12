import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import {
  createTranslator,
  DEFAULT_LANG_ENV,
  defaultLang,
  escapeHtml,
  interpolate,
  langChain,
} from 'modules/templates/i18n.ts'

console.warn = () => {}

function withDefaultLang<T>(lang: string | undefined, fn: () => T): T {
  const before = Deno.env.get(DEFAULT_LANG_ENV)
  try {
    if (lang === undefined) Deno.env.delete(DEFAULT_LANG_ENV)
    else Deno.env.set(DEFAULT_LANG_ENV, lang)
    return fn()
  } finally {
    if (before === undefined) Deno.env.delete(DEFAULT_LANG_ENV)
    else Deno.env.set(DEFAULT_LANG_ENV, before)
  }
}

Deno.test('i18n: the default language is the env var, else en', () => {
  assertEquals(withDefaultLang(undefined, defaultLang), 'en')
  assertEquals(withDefaultLang('es', defaultLang), 'es')
  assertEquals(withDefaultLang('  es-MX ', defaultLang), 'es-MX')
})

Deno.test('i18n: the chain is the language, its base, then the default, with no repeats', () => {
  withDefaultLang('es', () => {
    assertEquals(langChain('es-MX'), ['es-MX', 'es'])
    assertEquals(langChain('en-US'), ['en-US', 'en', 'es'])
    assertEquals(langChain('es'), ['es'])
    assertEquals(langChain(undefined), ['es'])
    assertEquals(langChain('  '), ['es'])
  })
})

Deno.test('i18n: interpolate fills placeholders and leaves a missing one visible', () => {
  assertEquals(
    interpolate('Hola {name}, {n} cosas', { name: 'Ana', n: 3 }, false),
    'Hola Ana, 3 cosas',
  )
  assertEquals(interpolate('Hola {name}', {}, false), 'Hola {name}')
  assertEquals(interpolate('Hola {name}', { name: null }, false), 'Hola {name}')
})

Deno.test('i18n: with escape on, the values are escaped and the text is not', () => {
  assertEquals(
    escapeHtml(`<b>"x" & 'y'</b>`),
    '&lt;b&gt;&quot;x&quot; &amp; &#x27;y&#x27;&lt;/b&gt;',
  )
  assertEquals(
    interpolate('<strong>{name}</strong>', { name: '<script>' }, true),
    '<strong>&lt;script&gt;</strong>',
  )
  assertEquals(
    interpolate('<strong>{name}</strong>', { name: "O'Neil" }, false),
    "<strong>O'Neil</strong>",
  )
})

Deno.test('i18n: a key is looked up in each language of the chain in turn', () => {
  const t = createTranslator(
    {
      'es-MX': { a: 'a mx' },
      es: { a: 'a es', b: 'b es' },
      en: { a: 'a en', b: 'b en', c: 'c en' },
    },
    ['es-MX', 'es', 'en'],
    false,
  )
  assertEquals(t('a'), 'a mx')
  assertEquals(t('b'), 'b es')
  assertEquals(t('c'), 'c en')
})

Deno.test('i18n: a key no language has is shown as the key, never empty', () => {
  const t = createTranslator({ en: {} }, ['en'], false)
  assertEquals(t('missing.key'), 'missing.key')
})

Deno.test('i18n: count picks the plural form of the language, then the plain key', () => {
  const t = createTranslator(
    {
      es: { items: '{count} cosas', 'items.one': '{count} cosa', 'items.other': '{count} cosas' },
      en: { 'items.one': '{count} thing', 'items.other': '{count} things', plain: 'x {count}' },
    },
    ['es', 'en'],
    false,
  )
  assertEquals(t('items', { count: 1 }), '1 cosa')
  assertEquals(t('items', { count: 3 }), '3 cosas')
  // No plural form needed: the plain key takes the count as a value.
  assertEquals(t('plain', { count: 2 }), 'x 2')
  // Without count the plain key is used.
  assertEquals(t('items'), '{count} cosas')
})

Deno.test('i18n: the translator escapes values only when asked', () => {
  const catalog = { en: { hi: '<b>Hi {name}</b>' } }
  assertEquals(
    createTranslator(catalog, ['en'], true)('hi', { name: "<i>O'N</i>" }),
    '<b>Hi &lt;i&gt;O&#x27;N&lt;/i&gt;</b>',
  )
  assertEquals(createTranslator(catalog, ['en'], false)('hi', { name: "O'N" }), "<b>Hi O'N</b>")
})
