import type { AdaptedModel } from '@zanix/database'
import type { ZanixTemplateMessageAttrs } from 'typings/templates-db.ts'

import { planCodeSync } from '@zanix/helpers'
import { type RegisteredMessage, registeredMessages } from './seeds.ts'
import { LIBRARY_MESSAGES } from '../library-messages.ts'

/** A synced text as read back from the collection. */
type StoredMessage =
  & Pick<ZanixTemplateMessageAttrs, 'lang' | 'key' | 'text' | 'version' | 'lastSyncedText'>
  & { _id: unknown }

/** The actor stamped on every text written by a sync. */
const SYNC_ACTOR = 'system:bootstrap-sync'

/**
 * Module-level, once-per-process sync memo, like `local-backend.ts`'s for the templates: concurrent
 * first callers wait for the same sync. Reset only in tests.
 */
let syncPromise: Promise<AdaptedModel<ZanixTemplateMessageAttrs>> | undefined

/** Resets the module-level sync memo — test-only. */
export function resetMessagesSyncState(): void {
  syncPromise = undefined
}

/**
 * Brings the message collection up to date with the texts consumers registered
 * (`registerTemplateSeeds({ messages })`), with the reconciliation the library already uses for its code
 * templates (`planCodeSync`, shared with the templates' own sync and the datamaster's trigger sync):
 *
 * - A `{lang, key}` with no record is added, `source: 'code'`.
 * - A text changed in the consumer replaces the record's while nobody has edited it (its `text` still
 *   equals `lastSyncedText`); an edit is never overwritten.
 * - A text the consumer stopped registering becomes `source: 'database'` and stays, never deleted.
 *
 * A text created through the admin API (`source: 'database'`) is never read by this, so it is never
 * touched, and a registered text with the same `{lang, key}` does not replace it.
 *
 * @param Model The message collection.
 */
export async function syncMessages(
  Model: AdaptedModel<ZanixTemplateMessageAttrs>,
): Promise<void> {
  // The library's own texts first, so a consumer registering the same `{lang, key}` replaces them.
  const library = Object.entries(LIBRARY_MESSAGES).flatMap(([lang, texts]) =>
    Object.entries(texts).map(([key, text]) => ({ lang, key, text }))
  )
  const registered = [
    ...new Map(
      [...library, ...await registeredMessages()].map((message) => [
        `${message.lang}:${message.key}`,
        message,
      ]),
    ).values(),
  ]
  const existing = await Model.find({ source: 'code' }).lean() as unknown as StoredMessage[]

  const plan = planCodeSync<RegisteredMessage>(
    registered.map((message) => ({ key: `${message.lang}:${message.key}`, value: message })),
    existing.map((doc) => ({
      _id: doc._id,
      key: `${doc.lang}:${doc.key}`,
      value: { lang: doc.lang, key: doc.key, text: doc.text },
      lastSyncedValue: doc.lastSyncedText === undefined
        ? undefined
        : { lang: doc.lang, key: doc.key, text: doc.lastSyncedText },
    })),
    (a, b) => a.text === b.text,
  )
  const versionById = new Map(existing.map((doc) => [doc._id, doc.version]))

  await Promise.all([
    ...plan.toOrphan.map(({ _id }) => Model.updateOne({ _id }, { $set: { source: 'database' } })),
    ...plan.toResync.map(({ _id, value }) =>
      Model.updateOne({ _id }, {
        $set: {
          text: value.text,
          lastSyncedText: value.text,
          version: (versionById.get(_id) ?? 0) + 1,
          updatedBy: SYNC_ACTOR,
        },
      })
    ),
    // Atomic, so two replicas starting together add it once, and a text already there (created through
    // the admin API) is left as it is.
    ...plan.toSeed.map(({ value }) =>
      Model.updateOne({ lang: value.lang, key: value.key }, {
        $setOnInsert: {
          text: value.text,
          lastSyncedText: value.text,
          source: 'code',
          version: 1,
          updatedBy: SYNC_ACTOR,
        },
      }, { upsert: true })
    ),
  ])
}

/**
 * Runs {@linkcode syncMessages} once per process — the model's seeder runs it when the collection is
 * ready, and the first read of the texts runs it if that seeder did not.
 *
 * @param Model The message collection.
 */
export function ensureMessagesSynced(
  Model: AdaptedModel<ZanixTemplateMessageAttrs>,
): Promise<AdaptedModel<ZanixTemplateMessageAttrs>> {
  if (!syncPromise) {
    syncPromise = syncMessages(Model).then(() => Model).catch((error) => {
      syncPromise = undefined
      throw error
    })
  }
  return syncPromise
}
