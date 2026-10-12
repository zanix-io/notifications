import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { AdaptedModel, MongoModelDefinition } from '@zanix/database'

import { NOTIFIER_CHANNELS } from 'utils/constants.ts'
import { ensureTemplatesSynced } from './local-backend.ts'

/**
 * Builds the model definition backing the `ZanixTemplate` model — see `typings/templates-db.ts`
 * for the field-by-field type and `docs/templates.md` for the design rationale. Field markers
 * (`String`, `Boolean`, `[String]`) are plain JS globals.
 *
 * Internal only — not exported from `mod.ts`. `templates/core.ts` passes this to
 * `registerModel()` once at boot (conditionally on `TEMPLATES_MODEL_NAME`), so
 * `TemplateProvider` itself only ever needs the name-only `getModel(modelName)` lookup, the same
 * way any other Zanix repository provider does. Only re-used directly by tests that construct a
 * second, standalone `ZanixMongoConnector` — `registerModel`'s registry is drained by whichever
 * connector initializes first, so a later, separate connector needs re-registering before it boots.
 */
export function templateModelDefinition(): MongoModelDefinition<
  ZanixTemplateAttrs
> {
  return {
    definition: {
      channel: { type: String, required: true, enum: NOTIFIER_CHANNELS },
      name: { type: String, required: true },
      hbs: { type: String },
      parent: { type: String },
      source: { type: String, required: true, enum: ['code', 'database'] },
      active: { type: Boolean, default: true },
      version: { type: Number, default: 1 },
      description: { type: String },
      availableVariables: { type: [String] },
      styles: { type: Object },
      hash: { type: String, required: true },
      lastSyncedHbs: { type: String },
      lastSyncedHash: { type: String },
      lastSyncedAt: { type: Date },
      derivedVersion: { type: Number },
      updatedBy: { type: String },
    },
    options: { timestamps: true },
    // Brings the collection up to date the moment it is ready, at every connector start, with no call
    // from the consumer: the code templates are synced (the library's own and the consumer's, see
    // `registerTemplateSeeds`). `DATABASE_SEEDERS=false` skips it, and the first resolve syncs instead.
    extensions: {
      seeders: [{
        handler: async (Model) => {
          await ensureTemplatesSynced(Model as AdaptedModel<ZanixTemplateAttrs>)
        },
        options: { name: 'template-sync', verbose: false, runningMode: 'always' },
      }],
    },
    // Compound unique index on {channel, name} — expressed via the schema-instance callback since
    // it isn't part of the plain field definition itself.
    callback: (schema) => {
      schema.index({ channel: 1, name: 1 }, { unique: true })
      return schema
    },
  }
}
