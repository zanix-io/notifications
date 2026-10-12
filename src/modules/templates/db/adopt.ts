import type { AdaptedModel } from '@zanix/database'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import { CODE_SOURCE, type StaticTemplateEntry } from './sync.ts'

import { registeredAdopters } from './seeds.ts'
import { hashContent } from './manifest.ts'

/**
 * Hands over to the code the records a consumer wrote before the code owned them (see
 * `TemplateSeedOptions.adopt`): a `source: 'database'` record with the `{channel, name}` of a
 * registered template whose `hbs` the consumer's predicate recognizes becomes `source: 'code'`, its
 * current words being the last synced ones. Nothing else changes: the sync that follows brings it up
 * to date with `planTemplateSync`, the same as any code template nobody has edited.
 *
 * @param Model The templates collection.
 * @param entries The templates the sync is about to apply, the registered ones included.
 */
export async function adoptRegisteredRecords(
  Model: AdaptedModel<ZanixTemplateAttrs>,
  entries: StaticTemplateEntry[],
): Promise<void> {
  const adopters = registeredAdopters()
  if (!adopters.length || !entries.length) return

  // Two kinds of record are the consumer's own and not yet in the code's hands: one created before the
  // code owned it (`source: 'database'`), and one the code already owns but that was rewritten by an
  // earlier seeder, so its `hbs` no longer equals what was last synced in and the sync would take it
  // for an operator's edit, never updating it.
  const candidates = await Model.find({
    $or: entries.map(({ channel, name }) => ({ channel, name })),
    $and: [{
      $or: [
        { source: 'database' },
        { source: CODE_SOURCE, $expr: { $ne: ['$hbs', '$lastSyncedHbs'] } },
      ],
    }],
  }).lean()

  await Promise.all(
    candidates
      .filter(({ hbs }) => hbs && adopters.some((adopts) => adopts(hbs)))
      .map(async ({ _id, hbs }) => {
        const hash = await hashContent(hbs as string)
        return await Model.updateOne({ _id }, {
          $set: {
            source: CODE_SOURCE,
            lastSyncedHbs: hbs,
            hash,
            lastSyncedHash: hash,
            lastSyncedAt: new Date(),
            updatedBy: 'system:bootstrap-sync',
          },
        })
      }),
  )
}
