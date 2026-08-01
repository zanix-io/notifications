import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1.0.15'
import { HttpError } from '@zanix/errors'
import { TemplatesAdminRepository } from 'modules/templates/db/templates.repository.ts'
import type { SyncCodeTemplateEntry } from 'modules/templates/db/templates.repository.ts'

// deno-lint-ignore no-explicit-any
function fakeThis(entries: Record<string, any>[]) {
  const model = {
    find: (query: { channel?: string }) =>
      Promise.resolve(query.channel ? entries.filter((e) => e.channel === query.channel) : entries),
    findOne: ({ channel, name }: { channel: string; name: string }) =>
      Promise.resolve(entries.find((e) => e.channel === channel && e.name === name)),
    create: (doc: Record<string, unknown>) => {
      entries.push(doc)
      return Promise.resolve(doc)
    },
    findOneAndUpdate: (
      { channel, name }: { channel: string; name: string },
      { $set }: { $set: Record<string, unknown> },
    ) => {
      const entry = entries.find((e) => e.channel === channel && e.name === name)
      if (!entry) return Promise.resolve(undefined)
      Object.assign(entry, $set)
      return Promise.resolve(entry)
    },
  }
  const instance = Object.create(TemplatesAdminRepository.prototype)
  Object.defineProperty(instance, 'database', {
    value: { isReady: Promise.resolve(), getModel: () => model },
  })
  return instance
}

const repo = TemplatesAdminRepository.prototype

Deno.test('TemplatesAdminRepository.list filters by channel when given', async () => {
  const entries = [
    { channel: 'email', name: 'welcome', active: true },
    { channel: 'sms', name: 'otp', active: true },
  ]
  const result = await repo.list.call(fakeThis(entries), 'email')
  assertEquals(result.length, 1)
  assertEquals(result[0].name, 'welcome')
})

Deno.test('TemplatesAdminRepository.list returns every entry when no channel given', async () => {
  const entries = [
    { channel: 'email', name: 'welcome', active: true },
    { channel: 'sms', name: 'otp', active: true },
  ]
  const result = await repo.list.call(fakeThis(entries))
  assertEquals(result.length, 2)
})

Deno.test('TemplatesAdminRepository.get returns the matching entry when found', async () => {
  const entries = [{ channel: 'email', name: 'welcome', active: true }]
  const result = await repo.get.call(fakeThis(entries), 'email', 'welcome')
  assertEquals(result, entries[0])
})

Deno.test('TemplatesAdminRepository.get throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => repo.get.call(fakeThis([]), 'email', 'missing'),
    HttpError,
  )
})

Deno.test('TemplatesAdminRepository.create rejects a duplicate channel+name', async () => {
  const entries = [{ channel: 'email', name: 'welcome', active: true }]
  await assertRejects(
    () =>
      repo.create.call(fakeThis(entries), {
        channel: 'email',
        name: 'welcome',
        hbs: '<p>hi</p>',
      }, 'admin-1'),
    HttpError,
  )
})

Deno.test('TemplatesAdminRepository.create defaults source/version/active', async () => {
  const created = await repo.create.call(fakeThis([]), {
    channel: 'email',
    name: 'invoice',
    hbs: '<p>invoice</p>',
  }, 'admin-1')
  assertEquals(created.source, 'database')
  assertEquals(created.version, 1)
  assertEquals(created.active, true)
  assertEquals(created.updatedBy, 'admin-1')
  assert(created.hash)
})

Deno.test('TemplatesAdminRepository.update throws NOT_FOUND when missing', async () => {
  await assertRejects(
    () => repo.update.call(fakeThis([]), 'email', 'missing', { active: false }, 'admin-1'),
    HttpError,
  )
})

Deno.test('TemplatesAdminRepository.create rejects a syntactically invalid hbs', async () => {
  await assertRejects(
    () =>
      repo.create.call(fakeThis([]), {
        channel: 'email',
        name: 'broken',
        hbs: '{{#if unclosed',
      }, 'admin-1'),
    HttpError,
  )
})

Deno.test('TemplatesAdminRepository.update bumps version and hash, sets updatedBy', async () => {
  const entries = [
    { channel: 'email', name: 'welcome', active: true, version: 1, hash: 'old-hash' },
  ]
  const updated = await repo.update.call(fakeThis(entries), 'email', 'welcome', {
    hbs: '<p>updated</p>',
  }, 'admin-2')
  assertEquals(updated.version, 2)
  assertEquals(updated.updatedBy, 'admin-2')
  assert(updated.hash !== 'old-hash')
})

Deno.test('TemplatesAdminRepository.update rejects a syntactically invalid hbs', async () => {
  const entries = [
    { channel: 'email', name: 'welcome', active: true, version: 1, hash: 'old-hash' },
  ]
  await assertRejects(
    () => repo.update.call(fakeThis(entries), 'email', 'welcome', { hbs: '{{#each' }, 'admin-2'),
    HttpError,
  )
})

Deno.test('TemplatesAdminRepository.remove soft-deletes, not a real delete', async () => {
  const entries = [
    { channel: 'email', name: 'welcome', active: true, version: 1, hash: 'x' },
  ]
  await repo.remove.call(fakeThis(entries), 'email', 'welcome', 'admin-3')
  assertEquals(entries.length, 1)
  assertEquals(entries[0].active, false)
})

// --- syncCodeTemplates -------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function fakeSyncThis(seed: Record<string, any>[]) {
  // deno-lint-ignore no-explicit-any
  const docs: Array<Record<string, any> & { _id: string }> = seed.map((doc, i) => ({
    ...doc,
    _id: `seed-${i}`,
  }))
  const pendingInserts = new Set<string>()
  let nextId = docs.length

  // deno-lint-ignore no-explicit-any
  function matches(doc: Record<string, any>, filter: Record<string, any>): boolean {
    return Object.entries(filter).every(([key, value]) => doc[key] === value)
  }

  const model = {
    find: (filter: { source?: string }) =>
      Promise.resolve(docs.filter((doc) => matches(doc, filter))),
    // Mirrors real MongoDB's `UpdateResult` shape — `upsertedCount` is only `1` when a genuine
    // insert happened, distinguishing that from an upsert that matched an already-inserted row
    // (both otherwise succeed silently under `$setOnInsert`).
    updateOne: (
      filter: { _id: string } | { channel: string; name: string },
      update: {
        $set?: Record<string, unknown>
        $inc?: { version?: number }
        $setOnInsert?: Record<string, unknown>
      },
      options?: { upsert?: boolean },
    ) => {
      if ('_id' in filter) {
        const entry = docs.find((doc) => doc._id === filter._id)
        if (entry) {
          if (update.$set) Object.assign(entry, update.$set)
          if (update.$inc?.version) entry.version = (entry.version ?? 0) + update.$inc.version
        }
        return Promise.resolve({ matchedCount: entry ? 1 : 0, upsertedCount: 0 })
      }

      const existing = docs.find((doc) => matches(doc, filter))
      if (existing) return Promise.resolve({ matchedCount: 1, upsertedCount: 0 })
      if (!options?.upsert) return Promise.resolve({ matchedCount: 0, upsertedCount: 0 })

      const key = JSON.stringify(filter)
      if (pendingInserts.has(key)) {
        const error = new Error('E11000 duplicate key error collection')
        Object.assign(error, { code: 11000 })
        return Promise.reject(error)
      }
      pendingInserts.add(key)

      docs.push({ ...filter, ...update.$setOnInsert, _id: `new-${nextId++}` })
      return Promise.resolve({ matchedCount: 0, upsertedCount: 1 })
    },
  }
  const instance = Object.create(TemplatesAdminRepository.prototype)
  Object.defineProperty(instance, 'database', {
    value: { isReady: Promise.resolve(), getModel: () => model },
  })
  return { instance, docs }
}

Deno.test('TemplatesAdminRepository.syncCodeTemplates seeds a new {channel,name}', async () => {
  const { instance, docs } = fakeSyncThis([])
  const result = await repo.syncCodeTemplates.call(instance, [
    { channel: 'email', name: 'generic', hbs: '<p>{{content}}</p>', hash: 'hash-1' },
  ])
  assertEquals(result, { seeded: 1, resynced: 0 })
  assertEquals(docs.length, 1)
  assertEquals(docs[0].source, 'code')
  assertEquals(docs[0].active, true)
  assertEquals(docs[0].version, 1)
  assertEquals(docs[0].lastSyncedHbs, '<p>{{content}}</p>')
  assertEquals(docs[0].updatedBy, 'system:remote-sync')
})

Deno.test(
  'TemplatesAdminRepository.syncCodeTemplates resyncs a code entry untouched since last sync',
  async () => {
    const { instance, docs } = fakeSyncThis([{
      channel: 'email',
      name: 'generic',
      hbs: '<p>old</p>',
      source: 'code',
      active: true,
      version: 1,
      hash: 'old-hash',
      lastSyncedHbs: '<p>old</p>',
      lastSyncedHash: 'old-hash',
    }])
    const result = await repo.syncCodeTemplates.call(instance, [
      { channel: 'email', name: 'generic', hbs: '<p>new</p>', hash: 'new-hash' },
    ])
    assertEquals(result, { seeded: 0, resynced: 1 })
    assertEquals(docs[0].hbs, '<p>new</p>')
    assertEquals(docs[0].hash, 'new-hash')
    assertEquals(docs[0].version, 2)
    assertEquals(docs[0].updatedBy, 'system:remote-sync')
  },
)

Deno.test(
  'TemplatesAdminRepository.syncCodeTemplates leaves a manually-edited entry alone — manual edit wins',
  async () => {
    const { instance, docs } = fakeSyncThis([{
      channel: 'email',
      name: 'generic',
      hbs: '<p>manually edited</p>',
      source: 'code',
      active: true,
      version: 2,
      hash: 'manual-hash',
      lastSyncedHbs: '<p>old</p>',
      lastSyncedHash: 'old-hash',
    }])
    const result = await repo.syncCodeTemplates.call(instance, [
      { channel: 'email', name: 'generic', hbs: '<p>new code content</p>', hash: 'new-hash' },
    ])
    assertEquals(result, { seeded: 0, resynced: 0 })
    assertEquals(docs[0].hbs, '<p>manually edited</p>')
    assertEquals(docs[0].version, 2)
  },
)

Deno.test(
  'TemplatesAdminRepository.syncCodeTemplates leaves a never-synced legacy row alone (no lastSyncedHbs)',
  async () => {
    const { instance, docs } = fakeSyncThis([{
      channel: 'email',
      name: 'generic',
      hbs: '<p>legacy</p>',
      source: 'code',
      active: true,
      version: 1,
      hash: 'legacy-hash',
    }])
    const result = await repo.syncCodeTemplates.call(instance, [
      { channel: 'email', name: 'generic', hbs: '<p>new code content</p>', hash: 'new-hash' },
    ])
    assertEquals(result, { seeded: 0, resynced: 0 })
    assertEquals(docs[0].hbs, '<p>legacy</p>')
  },
)

Deno.test(
  'TemplatesAdminRepository.syncCodeTemplates orphans a code entry no longer in the given set',
  async () => {
    const { instance, docs } = fakeSyncThis([{
      channel: 'sms',
      name: 'retired',
      hbs: '<p>retired</p>',
      source: 'code',
      active: true,
      version: 1,
      hash: 'retired-hash',
      lastSyncedHbs: '<p>retired</p>',
      lastSyncedHash: 'retired-hash',
    }])
    const result = await repo.syncCodeTemplates.call(instance, [])
    assertEquals(result, { seeded: 0, resynced: 0 })
    assertEquals(docs[0].source, 'database')
  },
)

Deno.test(
  'TemplatesAdminRepository.syncCodeTemplates: two near-simultaneous seed calls for the same new entry settle as exactly one row, not a crash',
  async () => {
    const { instance, docs } = fakeSyncThis([])
    const entries: SyncCodeTemplateEntry[] = [
      { channel: 'whatsapp', name: 'generic', hbs: '<p>{{content}}</p>', hash: 'hash-1' },
    ]

    const [first, second] = await Promise.all([
      repo.syncCodeTemplates.call(instance, entries),
      repo.syncCodeTemplates.call(instance, entries),
    ])

    assertEquals(first.seeded + second.seeded, 1)
    assertEquals(docs.length, 1)
    assertEquals(docs[0].channel, 'whatsapp')
    assertEquals(docs[0].name, 'generic')
  },
)
