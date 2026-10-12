import { assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.15'
import { TemplatesAdminService } from 'modules/templates/db/templates.service.ts'
import type { TemplatesAdminRepository } from 'modules/templates/db/templates.repository.ts'

function fakeService(repository: Partial<TemplatesAdminRepository>) {
  const instance = Object.create(TemplatesAdminService.prototype)
  Object.defineProperty(instance, 'providers', {
    value: { get: () => repository },
  })
  return instance
}

Deno.test('TemplatesAdminService delegates every method to the repository', async () => {
  const calls: unknown[] = []
  const repository: Partial<TemplatesAdminRepository> = {
    list: (channel) => (calls.push(['list', channel]), Promise.resolve([])) as never,
    get: (
      channel,
      name,
    ) => (calls.push(['get', channel, name]), Promise.resolve({} as never)),
    create: (input, updatedBy) => (
      calls.push(['create', input, updatedBy]), Promise.resolve({} as never)
    ),
    update: (channel, name, changes, updatedBy) => (
      calls.push(['update', channel, name, changes, updatedBy]), Promise.resolve({} as never)
    ),
    remove: (channel, name, updatedBy) => (
      calls.push(['remove', channel, name, updatedBy]), Promise.resolve()
    ),
    syncCodeTemplates: (entries, updatedBy) => (
      calls.push(['syncCodeTemplates', entries, updatedBy]),
        Promise.resolve({ seeded: 0, resynced: 0 })
    ),
  }
  const service: TemplatesAdminService = fakeService(repository)

  await service.list('email')
  await service.get('email', 'welcome')
  await service.create(
    { channel: 'email', name: 'welcome', hbs: '<p>hi</p>' },
    'admin-1',
  )
  await service.update('email', 'welcome', { active: false }, 'admin-1')
  await service.remove('email', 'welcome', 'admin-1')
  await service.syncCodeTemplates(
    [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
    'admin-1',
  )

  assertEquals(calls, [
    ['list', 'email'],
    ['get', 'email', 'welcome'],
    [
      'create',
      { channel: 'email', name: 'welcome', hbs: '<p>hi</p>' },
      'admin-1',
    ],
    ['update', 'email', 'welcome', { active: false }, 'admin-1'],
    ['remove', 'email', 'welcome', 'admin-1'],
    [
      'syncCodeTemplates',
      [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
      'admin-1',
    ],
  ])
})

Deno.test('TemplatesAdminService delegates the message catalog to the repository', async () => {
  const calls: unknown[] = []
  const repository: Partial<TemplatesAdminRepository> = {
    listMessages: (langs) => (calls.push(['listMessages', langs]), Promise.resolve({})),
    setMessage: (lang, key, text, by) => (
      calls.push(['setMessage', lang, key, text, by]), Promise.resolve({} as never)
    ),
    removeMessage: (lang, key) => (calls.push(['removeMessage', lang, key]), Promise.resolve()),
  }
  const service: TemplatesAdminService = fakeService(repository)

  await service.listMessages(['es'])
  await service.setMessage('es', 'k', 'texto', 'admin')
  await service.removeMessage('es', 'k')

  assertEquals(calls, [
    ['listMessages', ['es']],
    ['setMessage', 'es', 'k', 'texto', 'admin'],
    ['removeMessage', 'es', 'k'],
  ])
})

Deno.test('TemplatesAdminService delegates the catalog listing and the reset to the repository', async () => {
  const calls: unknown[] = []
  const service: TemplatesAdminService = fakeService({
    listMessageEntries: (options) => (calls.push(['entries', options]), Promise.resolve([])),
    resetMessage: (lang, key, by) => (
      calls.push(['reset', lang, key, by]), Promise.resolve({} as never)
    ),
  })

  await service.listMessageEntries({ langs: ['es'], search: 'hola' })
  await service.resetMessage('es', 'k', 'admin')

  assertEquals(calls, [['entries', { langs: ['es'], search: 'hola' }], [
    'reset',
    'es',
    'k',
    'admin',
  ]])
})

function previewService(resolveMessage: (...args: unknown[]) => Promise<unknown>) {
  const instance = Object.create(TemplatesAdminService.prototype)
  Object.defineProperty(instance, 'providers', { value: { get: () => ({ resolveMessage }) } })
  return instance as TemplatesAdminService
}

Deno.test('TemplatesAdminService.preview renders like a send does, asking an email for its subject', async () => {
  const asked: unknown[][] = []
  const service = previewService((...args) => {
    asked.push(args)
    return Promise.resolve({ body: '<p>hola</p>', subject: 'Asunto' })
  })

  assertEquals(await service.preview('email', 'welcome', { a: 1 }, 'es'), {
    body: '<p>hola</p>',
    subject: 'Asunto',
  })
  assertEquals(asked[0], ['email', 'welcome', { a: 1 }, 'es', { subject: true }])

  const sms = previewService((...args) => (asked.push(args), Promise.resolve({ body: 'hola' })))
  assertEquals(await sms.preview('sms', 'otp', {}), { body: 'hola' })
  assertEquals(asked[1][4], { subject: false })
})

Deno.test('TemplatesAdminService.preview answers BAD_REQUEST when the template cannot be rendered', async () => {
  const service = previewService(() => Promise.reject(new Error('Template not found: email/x')))

  const error = await assertRejects(() => service.preview('email', 'x', {}), Error)

  assertEquals((error as { status?: { code: string } }).status?.code, 'BAD_REQUEST')
})

Deno.test('TemplatesAdminService.preview forwards the draft texts to the provider, and only when given', async () => {
  const asked: unknown[][] = []
  const service = previewService((...args) => (asked.push(args), Promise.resolve({ body: 'x' })))

  await service.preview('email', 'welcome', {}, 'es', { 'welcome.title': 'Draft' })
  await service.preview('email', 'welcome', {}, 'es')

  assertEquals(asked[0][4], { subject: true, texts: { 'welcome.title': 'Draft' } })
  assertEquals(asked[1][4], { subject: true })
})

Deno.test('TemplatesAdminService.preview bounds the draft texts: 200 keys, 200-char keys, 20000-char texts, strings only', async () => {
  const asked: unknown[][] = []
  const service = previewService((...args) => (asked.push(args), Promise.resolve({ body: 'x' })))
  const status = async (texts: unknown) => {
    const error = await assertRejects(
      () => service.preview('email', 'welcome', {}, 'es', texts as Record<string, string>),
      Error,
    )
    return (error as { status?: { code: string } }).status?.code
  }
  const keys = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, 't']))

  // At the limits: accepted.
  await service.preview('email', 'welcome', {}, 'es', keys(200))
  await service.preview('email', 'welcome', {}, 'es', { ['k'.repeat(200)]: 't'.repeat(20000) })
  assertEquals(asked.length, 2)

  assertEquals(await status(keys(201)), 'BAD_REQUEST')
  assertEquals(await status({ ['k'.repeat(201)]: 't' }), 'BAD_REQUEST')
  assertEquals(await status({ a: 't'.repeat(20001) }), 'BAD_REQUEST')
  assertEquals(await status({ a: 1 }), 'BAD_REQUEST')
  assertEquals(await status(['a']), 'BAD_REQUEST')
  assertEquals(await status(null), 'BAD_REQUEST')
  // A rejected draft never reaches the provider.
  assertEquals(asked.length, 2)
})
