import type { ZanixTemplateMessageAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel, MongoModelDefinition } from '@zanix/database'

import { ensureMessagesSynced } from './messages-sync.ts'

/**
 * Builds the model definition backing the message catalog (`ZanixTemplateMessage`): one document per
 * `{lang, key}`, holding the words a template reads with `{{t 'key'}}`. See
 * `typings/templates-db.ts` for the field-by-field type and `docs/templates.md` for the design.
 *
 * Internal only — not exported from `mod.ts`. `templates/core.ts` passes it to `registerModel()`
 * next to the templates model, under `templatesMessagesModelName()`, on `TEMPLATES_BACKEND=local`.
 */
export function templateMessageModelDefinition(): MongoModelDefinition<
  ZanixTemplateMessageAttrs
> {
  return {
    definition: {
      lang: { type: String, required: true },
      key: { type: String, required: true },
      text: { type: String, required: true },
      version: { type: Number, default: 1 },
      updatedBy: { type: String },
      source: { type: String, required: true, enum: ['code', 'database'], default: 'database' },
      lastSyncedText: { type: String },
    },
    options: { timestamps: true },
    // Brings the texts up to date when the collection is ready, at every connector start, like the
    // templates: the texts a consumer registered with `registerTemplateSeeds` are synced in.
    extensions: {
      seeders: [{
        handler: async (Model) => {
          await ensureMessagesSynced(Model as AdaptedModel<ZanixTemplateMessageAttrs>)
        },
        options: { name: 'template-message-sync', verbose: false, runningMode: 'always' },
      }],
    },
    callback: (schema) => {
      schema.index({ lang: 1, key: 1 }, { unique: true })
      return schema
    },
  }
}
