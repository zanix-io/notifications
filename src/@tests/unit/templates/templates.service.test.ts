import { assertEquals } from 'jsr:@std/assert@^1.0.15'
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
    get: (channel, name) => (calls.push(['get', channel, name]), Promise.resolve({} as never)),
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
  await service.create({ channel: 'email', name: 'welcome', hbs: '<p>hi</p>' }, 'admin-1')
  await service.update('email', 'welcome', { active: false }, 'admin-1')
  await service.remove('email', 'welcome', 'admin-1')
  await service.syncCodeTemplates(
    [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
    'admin-1',
  )

  assertEquals(calls, [
    ['list', 'email'],
    ['get', 'email', 'welcome'],
    ['create', { channel: 'email', name: 'welcome', hbs: '<p>hi</p>' }, 'admin-1'],
    ['update', 'email', 'welcome', { active: false }, 'admin-1'],
    ['remove', 'email', 'welcome', 'admin-1'],
    [
      'syncCodeTemplates',
      [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
      'admin-1',
    ],
  ])
})
