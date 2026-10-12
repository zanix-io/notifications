import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import emailTemplates from 'modules/templates/transactional/email/mod.ts'
import smsTemplates from 'modules/templates/transactional/sms.ts'
import whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'
import { LIBRARY_MESSAGES, withLibraryTexts } from 'modules/templates/library-messages.ts'
import { DEFAULT_LANG_ENV } from 'modules/templates/i18n.ts'

Deno.env.delete(DEFAULT_LANG_ENV)

Deno.test('library messages: every language has the same keys', () => {
  const keys = (lang: string) => Object.keys(LIBRARY_MESSAGES[lang]).sort()
  assertEquals(keys('es'), keys('en'))
})

Deno.test('library messages: a built-in email renders in English by default and in Spanish with lang', async () => {
  assertStringIncludes(await emailTemplates['password-changed'](), 'Password Successfully Changed')
  assertStringIncludes(await emailTemplates['password-changed']({}, 'es'), 'Contraseña cambiada')
  // A language the library has no texts for falls to the default one.
  assertStringIncludes(await emailTemplates['password-changed']({}, 'fr'), 'Password Successfully')
})

Deno.test('library messages: a built-in email sets <html lang> from the message language, unless html is supplied', async () => {
  assertStringIncludes(await emailTemplates['welcome']({}, 'es'), '<html lang="es"')
  assertStringIncludes(await emailTemplates['welcome'](), '<html lang="en"')
  assertStringIncludes(await emailTemplates['login-otp'](undefined, 'es'), '<html lang="es"')
  assertStringIncludes(
    await emailTemplates['password-changed']({ html: { title: 'T', lang: 'fr' } }, 'es'),
    '<html lang="fr"',
  )
})

Deno.test('library messages: the values an email fills in are escaped, the location line is markup', async () => {
  const html = await emailTemplates['new-login']({
    device: '<b>Pwn</b>',
    time: 'now',
    location: 'Bogotá',
  }, 'es')
  assertStringIncludes(html, '&lt;b&gt;Pwn&lt;/b&gt;')
  assertStringIncludes(html, '<p><strong>Ubicación:</strong> Bogotá</p>')

  const without = await emailTemplates['new-login']({ device: 'Chrome', time: 'now' }, 'es')
  assertEquals(without.includes('Ubicación'), false)
})

Deno.test('library messages: sms and whatsapp read their texts in the language of the message', async () => {
  assertStringIncludes(
    await smsTemplates.otp({ code: '123456', ttl: 5 }, 'es'),
    'Vence en 5 minutos',
  )
  assertStringIncludes(await smsTemplates.otp({ code: '123456', ttl: 5 }), 'expires in 5 minutes')
  assertStringIncludes(
    await smsTemplates['new-login']({
      device: 'Chrome',
      time: 'ayer',
      location: 'CDMX',
      app: 'Presenza',
    }, 'es'),
    'Presenza Nuevo acceso a tu cuenta desde Chrome el ayer (CDMX)',
  )
  assertStringIncludes(
    await whatsappTemplates.otp({ code: '999', ttl: 10, app: 'Presenza' }, 'es'),
    'Tu código de verificación de Presenza es 999',
  )
})

Deno.test('library messages: the database catalog wins over the library texts, which fill what it lacks', () => {
  const merged = withLibraryTexts({ es: { 'welcome.title': 'Hola Presenza' }, fr: { x: 'y' } })

  assertEquals(merged.es['welcome.title'], 'Hola Presenza')
  assertEquals(merged.es['welcome.subject'], LIBRARY_MESSAGES.es['welcome.subject'])
  assertEquals(merged.fr, { x: 'y' })
  assertEquals(merged.en, LIBRARY_MESSAGES.en)
})

Deno.test('library messages: with no database, an email without a subject takes the library one in its language', async () => {
  const { TemplateProvider } = await import('modules/templates/provider.ts')
  const provider = new TemplateProvider()

  const es = await provider.resolveMessage('email', 'welcome', {}, 'es', { subject: true })
  assertEquals(es.subject, 'Te damos la bienvenida')
  assertStringIncludes(es.body, 'Nos alegra tenerte')
  assertEquals(
    (await provider.resolveMessage('email', 'welcome', {}, undefined, { subject: true })).subject,
    'Welcome',
  )
  // Not asked for, or a template with no such text: none.
  assertEquals((await provider.resolveMessage('email', 'welcome', {}, 'es')).subject, undefined)
  assertEquals(
    (await provider.resolveMessage('email', 'generic', {}, 'es', { subject: true })).subject,
    undefined,
  )
})
