import type { Notifiers } from 'typings/general.ts'

/** Ownership of a persisted template: seeded from and kept in sync with source code, or created directly in the database. */
export type TemplateSource = 'code' | 'database'

/** Persisted attributes of a `ZanixTemplate` record — see `docs/templates.md` for the full field-by-field rationale. */
export interface ZanixTemplateAttrs {
  /** The notification channel this template belongs to. */
  channel: Notifiers

  /** Template name, unique per `channel` (e.g. `'welcome'`, `'generic'`, or a database-only name like `'invoice-created'`). */
  name: string

  /**
   * The live Handlebars source actually used to render — may have been edited directly in the
   * database. Absent (or empty) on a "fallback" record — one that renders through `parent`'s
   * content instead of owning any of its own (see `parent` below).
   */
  hbs?: string

  /**
   * The `name` (same `channel`) this record falls back to when it has no `hbs` of its own —
   * `TemplateProvider.resolve()` walks this chain (`parent`'s `parent`, and so on) until it finds
   * a record with real content, applying that name's registered data transform (if any — see
   * `db/manifest.ts`'s `DERIVED_TEMPLATES`) at each hop. Ignored once `hbs` is set directly — an
   * admin giving a fallback record real content of its own makes it independent from then on,
   * `parent` or not.
   */
  parent?: string

  /** `'code'` if seeded from and kept in sync with a source-code template; `'database'` if created directly here (including a `parent`-only fallback record — see `parent` above). */
  source: TemplateSource

  /** Soft on/off switch — an inactive template is treated as not found by `TemplateProvider.resolve()`. */
  active: boolean

  /** Bumped by 1 on every real content change, whether from a code resync or a manual edit. */
  version: number

  /** Optional human-readable description, for admin/dashboard use. */
  description?: string

  /** Optional documented variable names, for preview/validation tooling — informational only, not enforced. */
  availableVariables?: string[]

  /** Hash of the live `hbs` content. */
  hash: string

  /** Only meaningful for `source: 'code'` — mirrors the code content last synced into `hbs`; used to detect a manual edit since. */
  lastSyncedHbs?: string

  /** Hash of `lastSyncedHbs`. */
  lastSyncedHash?: string

  /** Timestamp of the last successful code-to-database sync. */
  lastSyncedAt?: Date

  /** Free-text actor id — `'system:bootstrap-sync'` for automated syncs, an admin identifier for manual edits. */
  updatedBy?: string
}

/**
 * Fields accepted to create a new {@link ZanixTemplateAttrs} entry — derived from it so a caller
 * (`TemplatesAdminRepository.create`, `@zanix/admin`'s `TemplatesAdminClient`/`CreateTemplateRTO`)
 * never hand-re-declares this field list independently of the schema it targets.
 */
export type CreateTemplateInput =
  & Pick<ZanixTemplateAttrs, 'channel' | 'name'>
  & Required<Pick<ZanixTemplateAttrs, 'hbs'>>
  & Partial<Pick<ZanixTemplateAttrs, 'description' | 'availableVariables'>>

/**
 * Fields accepted to update an existing {@link ZanixTemplateAttrs} entry — see
 * {@link CreateTemplateInput} for why this is derived rather than hand-declared.
 */
export type UpdateTemplateInput = Partial<
  Pick<ZanixTemplateAttrs, 'hbs' | 'active' | 'description' | 'availableVariables'>
>
