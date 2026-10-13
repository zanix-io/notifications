import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.15'
import * as subpath from 'modules/i18n.ts'
import * as root from '../../../../mod.ts'

Deno.test('i18n subpath: exports the translation primitives', () => {
  assertEquals(
    Object.keys(subpath).sort(),
    [
      'DEFAULT_LANG_ENV',
      'SafeText',
      'createRenderHelpers',
      'createTranslator',
      'defaultLang',
      'findText',
      'interpolate',
      'langChain',
    ].sort(),
  )
  assertStrictEquals(root.findText, subpath.findText)
  assertStrictEquals(root.langChain, subpath.langChain)
  // One translator, not two with the same name: the root re-exports the subpath's.
  assertStrictEquals(root.createTranslator, subpath.createTranslator)
  assertEquals(typeof subpath.createRenderHelpers, 'function')
})

Deno.test('i18n subpath: renders plurals, falls back, and warns through `warn`', () => {
  const catalog = {
    es: { 'n.one': '{count} mensaje', 'n.other': '{count} mensajes' },
    en: { title: 'Inbox' },
  }
  const warnings: string[] = []
  const t = subpath.createTranslator(catalog, ['es-MX', 'es', 'en'], false, (m) => warnings.push(m))
  assertEquals(t('n', { count: 1 }), '1 mensaje')
  assertEquals(t('n', { count: 3 }), '3 mensajes')
  assertEquals(t('title'), 'Inbox')
  assertEquals(t('nope'), 'nope')
  t('nope')
  assertEquals(warnings.length, 1)
})
