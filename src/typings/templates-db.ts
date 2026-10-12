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

  /**
   * Only meaningful for `source: 'code'` — the `DERIVED_FIELDS_VERSION` (`db/sync.ts`) that was
   * current when `availableVariables`/`styles` were last computed for this record. Tracked
   * independently of `hbs`/`lastSyncedHbs`: a package upgrade that only changes HOW those fields
   * are derived (not the `.hbs` text itself) still needs already-tracked, untouched entries to
   * recompute them, which a plain `hbs` equality check can never trigger on its own — see
   * `planUntouchedTemplateUpdates`'s own JSDoc for the full rationale.
   */
  derivedVersion?: number

  /** Free-text actor id — `'system:bootstrap-sync'` for automated syncs, an admin identifier for manual edits. */
  updatedBy?: string
}

/**
 * One template a consumer provides to the templates collection, through {@link registerTemplateSeeds}:
 * the same fields {@link CreateTemplateInput} takes.
 */
export type TemplateSeed =
  & Pick<ZanixTemplateAttrs, 'channel' | 'name'>
  & Required<Pick<ZanixTemplateAttrs, 'hbs'>>
  & Partial<Pick<ZanixTemplateAttrs, 'description' | 'availableVariables'>>

/** What a consumer registers with `registerTemplateSeeds`. */
export interface TemplateSeedOptions {
  /**
   * The consumer's own templates, kept in the collection the way the library keeps its built-in ones
   * (`source: 'code'`): added when missing, brought up to date when they change while nobody has edited
   * the record, never over an edit. A name the library already has replaces the library's words, so a
   * consumer can brand a built-in. A later registration of the same `{channel, name}` replaces an
   * earlier one.
   */
  templates?: readonly TemplateSeed[]

  /**
   * Texts of the message catalog (`{{t 'key'}}`), by language and then by key, kept by the same rule as
   * {@link templates}. The text `<template>.subject` is the subject of an email sent from that template
   * with no `subject` of its own.
   */
  messages?: Readonly<Record<string, Readonly<Record<string, string>>>>

  /**
   * A folder with the same texts as files, `<folder>/<lang>/*.json`, each file a flat object
   * `{ "key": "text" }` (`messages/es/mail.json`). Relative paths resolve from the working directory; a
   * `URL` (`new URL('./messages', import.meta.url)`) from the file that wrote it. Read when the texts
   * sync, not when registered, and merged with {@link messages} (which wins on the same key).
   */
  messagesDir?: string | URL

  /**
   * Hands over to the code the records this consumer wrote before the code owned them: one created
   * through the admin API or by an older seeder (`source: 'database'`), and one the code already owns
   * but an older seeder rewrote (its `hbs` no longer equals what was last synced in, so the sync would
   * take it for an operator's edit and never update it). Called with the `hbs` of each such record that
   * has the `{channel, name}` of a registered template; when it answers `true`, the record becomes
   * `source: 'code'` with its current words as the last synced ones, and the sync then brings it up to
   * date like any other (an edit still wins, because only a record the predicate recognizes as the
   * consumer's own, e.g. by a marker it wrote in the `hbs`, is handed over). Without it, such a record
   * is never touched.
   */
  adopt?: (hbs: string) => boolean
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

/**
 * One text of the message catalog a template reads with `{{t 'key'}}`: the words for a key in one
 * language, kept apart from the templates so a new language is a set of texts and no new template.
 * The text may carry `{name}` placeholders, filled from the arguments of the `t` call, and HTML when
 * the template is an email. A key with plural forms has one text per form (`key.one`, `key.other`).
 */
export interface ZanixTemplateMessageAttrs {
  /** The language of the text, a BCP 47 tag (`es`, `en`, `es-MX`). */
  lang: string

  /** The key the template asks for. */
  key: string

  /** The words, with `{name}` placeholders. */
  text: string

  /** Bumped on each edit. */
  version: number

  /** Free-text actor id of the last edit. */
  updatedBy?: string

  /**
   * `'code'` if the text is provided by a consumer's registered seed and kept in sync with it,
   * `'database'` if it was created through the admin API — see {@link ZanixTemplateAttrs.source}.
   */
  source: TemplateSource

  /** Only meaningful for `source: 'code'` — the text last synced in; a `text` that differs was edited since. */
  lastSyncedText?: string
}

/** Fields accepted to set the text of a key in a language. */
export type SetTemplateMessageInput = Pick<ZanixTemplateMessageAttrs, 'lang' | 'key' | 'text'>

/**
 * One text of the message catalog as the admin API lists it, with what a screen needs to edit it:
 * where it comes from, whether an operator changed it, and the text to go back to.
 */
export interface MessageEntry {
  lang: string
  key: string
  text: string
  /** `'code'`: the library or the consumer's code owns it; `'database'`: it was created here. */
  source: 'code' | 'database'
  /** The text of a code text was changed after it was last synced in: the sync leaves it alone. */
  edited: boolean
  /** The text the code last synced in; what a reset goes back to. Absent for a `'database'` text. */
  defaultText?: string
  version: number
  updatedBy?: string
}

/** What a template renders to for a given data and language, as the preview answers it. */
export interface TemplatePreview {
  body: string
  /** An email's subject (`<template>.subject` of the catalog); absent when there is none. */
  subject?: string
}
