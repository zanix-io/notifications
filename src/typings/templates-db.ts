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

  /**
   * Optional documented variable names, for preview/validation tooling — informational only, not
   * enforced. For a `source: 'code'` record, this is derived automatically (`compiler.ts`'s own
   * AST walk over the template's `.hbs`, excluding `styles.*`) and kept in sync on every
   * code→database sync; an admin only ever needs to set this by hand for a `source: 'database'`
   * record.
   */
  availableVariables?: string[]

  /**
   * For a `source: 'code'` record only — the template's compiled CSS and default style-class
   * names, kept in sync on every code→database sync. Absent for a `source: 'database'` record —
   * there's no code-side CSS/defaults to expose for one. Exists so external tooling (e.g. a live
   * preview) can reproduce the same styling `compiler.ts`/`provider.ts#renderCodeBacked` already
   * inject automatically at render time, instead of guessing — see `docs/templates.md`'s
   * "`availableVariables` and `styles`" section.
   */
  styles?: {
    /** The template's compiled `styles.css` content, verbatim. */
    css: string
    /** Default style-class names (`schema.ts`'s own `defaultStyles`) referenced as `styles.*` in the template's `.hbs` — `{}` for a template with none. */
    classDefaults: Record<string, string>
  }

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
  Pick<
    ZanixTemplateAttrs,
    'hbs' | 'active' | 'description' | 'availableVariables'
  >
>

/** A single code-defined template entry submitted to `TemplatesAdminRepository.syncCodeTemplates`. */
export interface SyncCodeTemplateEntry {
  /** The notifier channel this template belongs to. */
  channel: Notifiers
  /** The template's name within its `channel`. */
  name: string
  /** The template's raw Handlebars source. */
  hbs: string
  /** Cache-invalidation key for this entry's compiled render — see `docs/templates.md#name-vs-hash`. */
  hash: string
  /** See {@link ZanixTemplateAttrs.availableVariables}. Optional — a caller on an older `@zanix/notifications` version may not send it. */
  availableVariables?: string[]
  /** See {@link ZanixTemplateAttrs.styles}. Optional — a caller on an older `@zanix/notifications` version may not send it. */
  styles?: ZanixTemplateAttrs['styles']
}

/**
 * Summary of what a `TemplatesAdminRepository.syncCodeTemplates` call actually wrote. A `type`
 * alias, not an `interface` — `@zanix/admin`'s own sync route returns this directly, and only an
 * object type literal (not an `interface`) is structurally compatible with `HandlerResponse`'s
 * implicit index signature.
 */
export type SyncCodeTemplatesResult = {
  seeded: number
  resynced: number
}
