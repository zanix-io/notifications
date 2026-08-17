import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { MongoModelDefinition } from '@zanix/datamaster'

import { NOTIFIER_CHANNELS } from 'utils/constants.ts'

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
      hash: { type: String, required: true },
      lastSyncedHbs: { type: String },
      lastSyncedHash: { type: String },
      lastSyncedAt: { type: Date },
      updatedBy: { type: String },
    },
    options: { timestamps: true },
    // Compound unique index on {channel, name} — expressed via the schema-instance callback since
    // it isn't part of the plain field definition itself.
    callback: (schema) => {
      schema.index({ channel: 1, name: 1 }, { unique: true })
      return schema
    },
  }
}
