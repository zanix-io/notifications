import type { Notifiers } from 'typings/general.ts'
import type { ZanixMongoConnector } from '@zanix/database'
import type { TemplateBackend } from './db/backend.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

import { ZanixProvider } from '@zanix/server'
import logger from '@zanix/logger'

import emailTemplates from 'modules/templates/transactional/email/mod.ts'
import smsTemplates from 'modules/templates/transactional/sms.ts'
import whatsappTemplates from 'modules/templates/transactional/whatsapp.ts'

import { CODE_TEMPLATES, DERIVED_TEMPLATES } from './db/manifest.ts'
import { CODE_SOURCE } from './db/sync.ts'
import { LIBRARY_MESSAGES, withLibraryTexts } from './library-messages.ts'
import { createTranslator, findText, langChain, type MessageCatalog } from './i18n.ts'
import { LocalTemplateBackend, resetLocalTemplateBackendState } from './db/local-backend.ts'
import {
  RemoteTemplateBackend,
  resetRemoteTemplateBackendCache,
  resetRemoteTemplateBackendSyncState,
} from './db/remote-backend.ts'
import {
  createRemoteTemplateAuthClient,
  resetRemoteTemplateAuthClient,
} from './db/remote-backend-auth.ts'
import { ApplicationError } from '@zanix/errors'

import {
  assertTemplatesBackendConfigValid,
  isTemplatesResourceEnabled,
  TEMPLATES_SERVICE_AUTH_ID_ENV,
  TEMPLATES_SERVICE_CACHE_TTL_ENV,
  TEMPLATES_SERVICE_ID_ENV,
  TEMPLATES_SERVICE_PATH_PREFIX_ENV,
  TEMPLATES_SERVICE_SYNC_ENV,
  TEMPLATES_SERVICE_TOKEN_ENV,
  TEMPLATES_SERVICE_URL_ENV,
  templatesBackendMode,
  templatesMessagesModelName,
  templatesModelName,
} from './env.ts'

// Re-exported here so existing internal/external imports of these symbols from `provider.ts`
// (and, transitively, the root `@zanix/notifications` barrel) keep working unchanged — the real
// definitions live in `env.ts` (see that file's own doc for why they're split out).
export {
  assertTemplatesBackendConfigValid,
  DEFAULT_TEMPLATES_MODEL_NAME,
  isTemplatesResourceEnabled,
  TEMPLATES_BACKEND_ENV,
  TEMPLATES_MODEL_ENV,
  TEMPLATES_SERVICE_AUTH_ID_ENV,
  TEMPLATES_SERVICE_CACHE_TTL_ENV,
  TEMPLATES_SERVICE_ID_ENV,
  TEMPLATES_SERVICE_PATH_PREFIX_ENV,
  TEMPLATES_SERVICE_SYNC_ENV,
  TEMPLATES_SERVICE_TOKEN_ENV,
  TEMPLATES_SERVICE_URL_ENV,
  templatesBackendMode,
  templatesMessagesModelName,
  templatesModelName,
} from './env.ts'
export type { TemplatesBackendMode } from './env.ts'

type TemplateRegistry = Record<string, (data: never, lang?: string) => Promise<string>>

/** Picks the in-memory template registry that matches a given notifier channel. */
function templatesFor(channel: Notifiers): TemplateRegistry {
  if (channel === 'email') return emailTemplates as TemplateRegistry
  if (channel === 'sms') return smsTemplates as TemplateRegistry
  return whatsappTemplates as TemplateRegistry
}

/** Compiled-render cache, keyed by `{channel}:{name}`, invalidated when the DB `hash` changes — module-level so it's shared across every `SCOPED` `TemplateProvider` instance, the same way `getSmtpPool()`'s pool is. */
const renderCache = new Map<
  string,
  { hash: string; render: CompiledRender }
>()

/** The helpers one message renders with, as Handlebars takes them. */
type RenderOptions = { helpers?: Record<string, (...args: never[]) => unknown> }

/** A compiled Handlebars template: renders `data`, with the helpers (`t`) of one message. */
type CompiledRender = (
  data: unknown,
  options?: RenderOptions,
) => string

/** What a template resolves to: the body to send and, for an email that asked for it, its subject. */
export interface ResolvedTemplate {
  body: string
  subject?: string
}

/** Whether a Handlebars source reads message texts: `{{t 'key'}}` or `{{{t 'key'}}}`. */
const USES_MESSAGES = /\{\{\{?\s*t\s/

/**
 * What one resolution renders with: the language chain of the message and a way to build its `{{t}}`
 * helper. The catalog is loaded the first time a template that reads texts asks for it, never for one
 * that does not.
 */
interface RenderContext {
  /** The languages of the message, most specific first. */
  chain: string[]
  /** The catalog of those languages, loaded the first time it is asked for. */
  catalog(): Promise<MessageCatalog>
  helpers(): Promise<NonNullable<RenderOptions['helpers']>>
}

/**
 * A copy of `catalog` with `texts` laid over the texts of `lang`. The catalog itself is never changed,
 * since a backend may hand out a shared one. Without `texts` it is returned as it is.
 */
function overlayTexts(
  catalog: MessageCatalog,
  lang: string,
  texts: Record<string, string> | undefined,
): MessageCatalog {
  if (!texts || Object.keys(texts).length === 0) return catalog
  return { ...catalog, [lang]: { ...catalog[lang], ...texts } }
}

/** Text Handlebars must not escape again (it asks an object for `toHTML()`): what `{{t}}` returns. */
class SafeText {
  constructor(private readonly text: string) {}
  public toString(): string {
    return this.text
  }
  public toHTML(): string {
    return this.text
  }
}

/**
 * Data transform applied by `resolve()`'s database-backed parent-chain walk (`#resolveChain()`)
 * when a `DERIVED_TEMPLATES` entry has no content of its own — the exact same mapping each
 * `transactional/*` wrapper applies before calling `execTemplate()` directly, so a database-edited
 * ancestor (e.g. `generic`) renders with equivalent data regardless of whether the send took the
 * pure code path or fell through to the database. Built directly from `DERIVED_TEMPLATES` — a new
 * derived template only ever needs declaring once, in its own `transactional/*` module (see
 * `typings/templates.ts`'s `DerivedTemplateDeclaration`), never registered separately here too.
 */
const derivedTemplateTransforms = new Map(
  DERIVED_TEMPLATES.map((
    entry,
  ) => [`${entry.channel}:${entry.name}`, entry.transform]),
)

/** Resets every module-level template cache (sync memo, remote fetch cache, compiled-render cache) — test-only. */
export function resetTemplateProviderState(): void {
  resetLocalTemplateBackendState()
  resetRemoteTemplateBackendCache()
  resetRemoteTemplateBackendSyncState()
  resetRemoteTemplateAuthClient()
  renderCache.clear()
}

/**
 * Resolves a channel's `zanixTemplate` name to its rendered content, on behalf of
 * `NotifierProvider.#dispatch()` — the one place in the package that knows about both the
 * in-memory code registries (`transactional/{email,sms,whatsapp}`) and, when enabled, the
 * database-persisted `ZanixTemplate` collection.
 *
 * With `TEMPLATES_BACKEND` unset, `resolve()` is a pure in-memory registry lookup, no database
 * access at all. Set to `'local'` or `'remote'` (see
 * `templatesBackendMode()`), the selected backend becomes the priority source at runtime for any
 * `{channel, name}` it holds — code is seed data and fallback only, never re-read once a database
 * record exists (see `docs/templates.md`).
 *
 * Registered `SCOPED` (see `templates/core.ts`), for the same reason `NotifierProvider` is: a
 * `SINGLETON` provider would pin `this.database`'s resolution to a fixed, non-request context
 * forever (see `providers/core.ts`'s own comment on this).
 *
 * @extends ZanixProvider
 */
export class TemplateProvider extends ZanixProvider<{ database: ZanixMongoConnector }> {
  /**
   * Picks the `TemplateBackend` to resolve `{channel, name}` against, fresh on every call (not
   * cached on the instance) — mirrors `resolve()`'s own pattern of re-reading `Deno.env.get(...)`
   * on every call rather than once at construction, which also sidesteps any
   * assumption about env vars being set before a DI-constructed `TemplateProvider` exists.
   *
   * `undefined` when `TEMPLATES_BACKEND` is unset — the pure code-registry path. Which concrete
   * backend gets built for `'local'`/`'remote'` is entirely `templatesBackendMode()`'s call; this
   * method only ever reads that one selector to decide, never infers it from which of the
   * mode-specific vars happen to be set.
   */
  #backend(): TemplateBackend | undefined {
    if (!templatesBackendMode()) return undefined

    assertTemplatesBackendConfigValid()

    if (isTemplatesResourceEnabled('remote')) {
      const token = Deno.env.get(TEMPLATES_SERVICE_TOKEN_ENV)
      const authServiceId = Deno.env.get(TEMPLATES_SERVICE_AUTH_ID_ENV)
      return new RemoteTemplateBackend({
        url: Deno.env.get(TEMPLATES_SERVICE_URL_ENV) as string,
        serviceId: Deno.env.get(TEMPLATES_SERVICE_ID_ENV) as string,
        pathPrefix: Deno.env.get(TEMPLATES_SERVICE_PATH_PREFIX_ENV) || undefined,
        token,
        // Only built when there's no static `token` — see `RemoteTemplateBackendConfig.authClient`'s
        // own doc on the priority between the two. Built via `remote-backend-auth.ts`'s
        // `createRemoteTemplateAuthClient` (this package's one real `@zanix/auth` import site, see
        // its own doc) rather than passing raw options into `RemoteTemplateBackend` itself — it never
        // imports `@zanix/auth`, see `remote-backend.ts`'s own `ServiceAuthClient` doc on why.
        // `privateKey`/`keyId` deliberately omitted: their resolvability
        // (`JWK_ID_<authServiceId>`/`JWK_PRI_<authServiceId>[_<keyId>]`) was already checked above by
        // `assertTemplatesBackendConfigValid()` — `createServiceAssertion` resolves both again,
        // lazily, at actual sign time, so neither has to pass through here.
        authClient: !token && authServiceId
          ? createRemoteTemplateAuthClient({ serviceId: authServiceId })
          : undefined,
        cacheTtlMs: Number(Deno.env.get(TEMPLATES_SERVICE_CACHE_TTL_ENV)) ||
          undefined,
        syncCodeTemplates: Deno.env.get(TEMPLATES_SERVICE_SYNC_ENV) !== 'false',
      })
    }

    return new LocalTemplateBackend(
      () => this.database,
      templatesModelName(),
      templatesMessagesModelName(),
    )
  }

  /** Whether `{channel, name}` owns a real `.hbs` in code (see `db/manifest.ts`). */
  #isCodeTemplate(channel: Notifiers, name: string): boolean {
    return CODE_TEMPLATES.some((entry) => entry.channel === channel && entry.name === name)
  }

  /**
   * Renders a `source:'code'` database record with the same validation/styling its compiled
   * code counterpart applies (`schema.ts`'s Zod parse + the embedded `styles.css`), so an online
   * edit stays visually consistent with its code-defined layout — see `compiler.ts`.
   */
  async #renderCodeBacked(
    channel: Notifiers,
    name: string,
    compile: CompiledRender,
    data: Record<string, unknown>,
    options: RenderOptions,
  ): Promise<string> {
    const [{ default: dataSchema }, { styles }] = await Promise.all([
      import(`./handlebars/${channel}/${name}/schema.ts`),
      import(`./handlebars/${channel}/${name}/main.js`),
    ])
    // deno-lint-ignore no-explicit-any
    const validated = dataSchema.parse(data) as any
    validated.styles.css = `\n${styles}\n${validated.styles.css}`
    return compile(validated, options)
  }

  /** Compiles (or reuses the cached compile of) a database record's live `hbs`. */
  async #compile(channel: Notifiers, name: string, hbs: string, hash: string) {
    const cacheKey = `${channel}:${name}`
    const cached = renderCache.get(cacheKey)
    if (cached && cached.hash === hash) return cached.render

    // A literal specifier, not the ecosystem's lazy-dependency pattern — deliberately, not an
    // oversight. This class already value-imports `emailTemplates`/`smsTemplates`/
    // `whatsappTemplates` above, each of which unconditionally reaches `npm:handlebars` through
    // its own compiled template registry, so `npm:handlebars` is already a hard dependency the
    // moment `TemplateProvider` itself is reachable — a non-literal specifier here would add
    // ceremony without removing any real materialization.
    const { default: Handlebars } = await import('handlebars')
    const render = Handlebars.compile(hbs)
    renderCache.set(cacheKey, { hash, render })
    return render
  }

  /**
   * Fetches `zanixTemplate` for `channel` against the configured backend (mirrors `resolve()`'s
   * backend lookup, without the code-registry fallback), so a caller can build its own
   * request-scoped cache ahead of time — see `NotifierProvider.onDestroy()`.
   *
   * `undefined` if no persisted backend is configured (see `#backend()`) — a no-op in that case.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to preload.
   */
  public preload(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined> | undefined {
    return this.#backend()?.preload(channel, name)
  }

  /**
   * Preloads `{channel, name}` AND every ancestor in its `parent` chain (see `#resolveChain()`'s
   * own chain walk, and `db/manifest.ts`'s `DERIVED_TEMPLATES`) into `cache`, keyed the same way
   * `LocalTemplateBackend`'s own cache is (`` `znx:${channel}:${name}` ``) — so a one-time worker's
   * `resolve()` call can satisfy every hop from the passed-in cache alone, without opening its own
   * database connection for any of them. A no-op (nothing added to `cache`) if no persisted
   * backend is configured — see `preload()`.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name whose whole chain should be preloaded.
   * @param cache The map to populate — see `NotifierProvider.onDestroy()`.
   */
  public async preloadChain(
    channel: Notifiers,
    name: string,
    cache: Map<`znx:${Notifiers}:${string}`, ZanixTemplateAttrs | undefined>,
  ): Promise<void> {
    const backend = this.#backend()
    if (!backend) return

    const visited = new Set<string>()
    let current: string | undefined = name

    while (current && !visited.has(current)) {
      visited.add(current)
      // Each hop's name is only known after the previous one resolves — genuinely sequential,
      // not a batch of independent lookups `Promise.all` could parallelize.
      // deno-lint-ignore no-await-in-loop
      const record = await backend.preload(channel, current)
      cache.set(`znx:${channel}:${current}`, record)
      current = (!record?.hbs && record?.parent) ? record.parent : undefined
    }
  }

  /**
   * Resolves `zanixTemplate` for `channel` against a persisted backend (Modes A/B via
   * `TEMPLATES_BACKEND=local`, or Mode C via `TEMPLATES_BACKEND=remote` — see `#backend()`) if that
   * mode is selected and a matching, active record exists anywhere in `name`'s `parent` chain (see
   * `#resolveChain()`) — falling back to the in-memory code registry, for the original `name`/
   * `data`, otherwise.
   *
   * Any failure on the backend path — the connector not actually being configured, a sync error,
   * a network error calling the remote service, an invalid `hbs` record, etc. — is caught and
   * logged as a warning, falling back to the code registry rather than failing the send; enabling
   * either mode is meant to be a safe, additive enhancement over the code path, never a new way for
   * a send to break.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to resolve.
   * @param data The data to render the template with.
   * @throws If `TEMPLATES_BACKEND` is set to an invalid value, or `'remote'` is selected without
   * its required config (see `assertTemplatesBackendConfigValid()`), or if `name` doesn't exist in
   * either the configured backend (nor anywhere in its `parent` chain) or the code registry for
   * `channel`.
   */
  public async resolve(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
    lang?: string,
  ): Promise<string> {
    return (await this.resolveMessage(channel, name, data, lang)).body
  }

  /**
   * Like {@linkcode resolve}, and with `options.subject` also resolves the subject of an email: the text
   * `<name>.subject` of the message catalog, in `lang`, filled with `data`. `NotifierProvider` asks for it
   * when a template-based email sets no subject of its own. A template of the code registry has no
   * subject.
   *
   * The texts a template reads with `{{t 'key'}}` come from the backend's message catalog, for the
   * languages of `lang` (the language, its base, then `NOTIFICATIONS_DEFAULT_LANG`). The catalog is
   * loaded only when the template reads texts, and a failure loading it falls back to the code
   * registry like any other failure of the backend.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to resolve.
   * @param data The data to render the template with.
   * @param lang The language of the message, as a BCP 47 tag.
   * @param options `subject`: also resolve the subject of an email. `texts`: draft message texts (key to
   * text) that replace the catalog's text for that key in the first language of the chain (`lang`, or
   * the default language when none), for this render only: the body, the derived built-ins and the
   * `<name>.subject` lookup read them. Nothing is stored or cached, and no other language is touched.
   * @throws As {@linkcode resolve}.
   */
  public async resolveMessage(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
    lang?: string,
    options: { subject?: boolean; texts?: Record<string, string> } = {},
  ): Promise<ResolvedTemplate> {
    assertTemplatesBackendConfigValid()

    const backend = this.#backend()
    if (backend) {
      try {
        const context = this.#renderContext(backend, channel, lang, options.texts)
        const body = await this.#resolveChain(channel, name, data, backend, new Set(), context)
        if (body !== undefined) {
          // The subject is the text `<template>.subject` of the catalog, in the message's language.
          const subject = options.subject
            ? findText(
              withLibraryTexts(await context.catalog()),
              context.chain,
              `${name}.subject`,
              data,
            )
            : undefined
          return { body, subject }
        }
      } catch (error) {
        logger.warn(
          `[TemplateProvider] Database-backed template resolution failed for "${channel}/${name}"` +
            ` — falling back to code. ${(error as Error).message}`,
        )
      }
    }

    const registry = templatesFor(channel)
    const render = registry[name]
    // The caller asked for a `channel`/`name` pair that doesn't exist in either backend — a
    // caller-supplied-bad-identifier, not an internal fault (see `@zanix/errors`' docs, "Choosing
    // a class").
    if (!render) {
      throw new ApplicationError(`Template not found: ${channel}/${name}`, {
        code: 'TEMPLATE_NOT_FOUND',
        meta: { channel, name },
      })
    }
    // The code registry has no database catalog, so the subject is the library's own text.
    const subject = options.subject
      ? findText(
        overlayTexts(LIBRARY_MESSAGES, langChain(lang)[0], options.texts),
        langChain(lang),
        `${name}.subject`,
        data,
        true,
      )
      : undefined
    return { body: await render(data as never, lang), subject }
  }

  /**
   * Builds the context one resolution renders with: how to get the `{{t}}` helper for the message's
   * language. The catalog of the language chain is fetched once, the first time a template asks.
   * `texts` are draft texts laid over the first language of the chain, in a copy of the catalog.
   */
  #renderContext(
    backend: TemplateBackend,
    channel: Notifiers,
    lang?: string,
    texts?: Record<string, string>,
  ): RenderContext {
    const chain = langChain(lang)
    let loaded: Promise<MessageCatalog> | undefined
    const catalog = () =>
      loaded ??= backend.messages(chain).then((loadedCatalog) =>
        overlayTexts(loadedCatalog, chain[0], texts)
      )
    return {
      chain,
      catalog,
      helpers: async () => {
        const t = createTranslator(await catalog(), chain, channel === 'email')
        return {
          // Handlebars passes the call's `key=value` arguments as `options.hash`, and its own
          // `options` object last. The text is trusted markup (an operator wrote it) and the
          // values were escaped when it was filled, so the result is not escaped a second time.
          t: function (key: string, options?: { hash?: Record<string, unknown> }) {
            return new SafeText(t(key, options?.hash))
          },
        }
      },
    }
  }

  /**
   * Preloads the message texts of `langs` into `cache`, on the main thread, for a background worker
   * that cannot reach the catalog itself — see `NotifierProvider.onDestroy()`. A no-op if no
   * persisted backend is configured, or one a worker reaches on its own (a remote service).
   *
   * @param langs The languages the queued messages use, as `langChain()` of each.
   * @param cache The map to populate — keyed `znx:msg:<lang>`.
   */
  public async preloadMessages(
    langs: string[],
    cache: Map<`znx:msg:${string}`, Record<string, string>>,
  ): Promise<void> {
    const backend = this.#backend()
    if (!backend) return
    const catalog = await backend.preloadMessages(langs)
    if (!catalog) return
    for (const lang of langs) cache.set(`znx:msg:${lang}`, catalog[lang] ?? {})
  }

  /**
   * Walks `record.parent` (see `db/manifest.ts`'s `DERIVED_TEMPLATES`) starting at `{channel,
   * name}`, applying each hop's registered data transform (`derivedTemplateTransforms`, if any),
   * until it finds a record with active content of its own — returning that render — or the chain
   * runs out: no `parent`, a missing/inactive record, or a cycle back to an already-visited name.
   * Returns `undefined` in that case so `resolve()` falls back to the code registry for the
   * ORIGINAL `name`/`data` it was called with, not whatever hop this walk stopped at.
   */
  async #resolveChain(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
    backend: TemplateBackend,
    visited: Set<string>,
    context: RenderContext,
  ): Promise<string | undefined> {
    if (visited.has(name)) return undefined
    visited.add(name)

    const record = await backend.resolve(channel, name)
    if (!record) return undefined

    if (record.hbs) {
      const compile = await this.#compile(
        channel,
        name,
        record.hbs,
        record.hash,
      )
      // The helpers (and so the catalog) are built only for a template that reads texts.
      const options: RenderOptions = USES_MESSAGES.test(record.hbs)
        ? { helpers: await context.helpers() }
        : {}

      return record.source === CODE_SOURCE && this.#isCodeTemplate(channel, name)
        ? await this.#renderCodeBacked(channel, name, compile, data, options)
        : compile(data, options)
    }

    if (!record.parent) return undefined

    const transform = derivedTemplateTransforms.get(`${channel}:${name}`)
    const parentData = transform
      ? transform(
        data as never,
        createTranslator(
          withLibraryTexts(await context.catalog()),
          context.chain,
          channel === 'email',
        ),
      )
      : data
    return await this.#resolveChain(
      channel,
      record.parent,
      parentData,
      backend,
      visited,
      context,
    )
  }
}
