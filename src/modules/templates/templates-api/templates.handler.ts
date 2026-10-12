import type { HandlerContext, MiddlewareGuard } from '@zanix/server'
import type {
  MessageEntry,
  TemplatePreview,
  ZanixTemplateAttrs,
  ZanixTemplateMessageAttrs,
} from 'typings/templates-db.ts'
import type { MessageCatalog } from '../i18n.ts'
import type { TemplatesControllerOptions } from 'typings/templates-api.ts'

import { Controller, Delete, Get, Guard, Post, Put, ZanixController } from '@zanix/server'
import { TemplatesAdminService } from '../db/templates.service.ts'
import {
  CreateTemplateRTO,
  MessageEntriesSearchRTO,
  MessageParamsRTO,
  MessagesSearchRTO,
  PreviewTemplateRTO,
  SetMessageRTO,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from './rtos/templates.rto.ts'

// Re-exported for backward compatibility — `TemplatesControllerOptions` used to be declared
// directly in this file; it now lives in `typings/templates-api.ts`, which only references
// `@zanix/server`'s own `MiddlewareGuard`/`VersionProtocolOption` types, so a narrow subpath can
// expose it without also reaching this file's real `TemplatesAdminService`/Handlebars dependency
// (see `@zanix/notifications/templates-types`). No import path (internal or via the root barrel or
// `@zanix/notifications/templates-api`) breaks.
export type { TemplatesControllerOptions } from 'typings/templates-api.ts'

/** The instance shape {@link createTemplatesController} builds — see its own docs. */
export interface TemplatesControllerInstance extends ZanixController<TemplatesAdminService> {
  /** `GET /` — lists every registered template. */
  list(): Promise<ZanixTemplateAttrs[]>
  /** `GET /:channel/:name` — gets a single template by channel and name. */
  get(
    ctx: HandlerContext<{ params: TemplateParamsRTO }>,
  ): Promise<ZanixTemplateAttrs & Record<string, unknown>>
  /** `POST /` — creates a new template entry. */
  create(
    ctx: HandlerContext<{ body: CreateTemplateRTO }>,
  ): Promise<ZanixTemplateAttrs & Record<string, unknown>>
  /** `PUT /:channel/:name` — updates a template's `hbs`/`active`/other fields. */
  update(
    ctx: HandlerContext<{ body: UpdateTemplateRTO; params: TemplateParamsRTO }>,
  ): Promise<ZanixTemplateAttrs & Record<string, unknown>>
  /** `DELETE /:channel/:name` — deactivates a template entry (soft delete). */
  remove(
    ctx: HandlerContext<{ params: TemplateParamsRTO }>,
  ): Promise<{ deactivated: string }>
  /** `GET /messages?langs=es,en` — the message catalog, by language and then by key. */
  messages(
    ctx: HandlerContext<{ search: MessagesSearchRTO }>,
  ): Promise<MessageCatalog>
  /** `PUT /messages/:lang/:key` — sets the text of a key in a language. */
  setMessage(
    ctx: HandlerContext<{ params: MessageParamsRTO; body: SetMessageRTO }>,
  ): Promise<ZanixTemplateMessageAttrs & Record<string, unknown>>
  /** `DELETE /messages/:lang/:key` — removes the text of a key in a language. */
  removeMessage(
    ctx: HandlerContext<{ params: MessageParamsRTO }>,
  ): Promise<{ removed: string }>
  /** `GET /message-entries?langs=&q=` — the texts with their source, default and edit state. */
  messageEntries(
    ctx: HandlerContext<{ search: MessageEntriesSearchRTO }>,
  ): Promise<{ entries: MessageEntry[] }>
  /** `POST /messages/:lang/:key/reset` — puts a code text back to its default. */
  resetMessage(
    ctx: HandlerContext<{ params: MessageParamsRTO }>,
  ): Promise<ZanixTemplateMessageAttrs & Record<string, unknown>>
  /** `POST /:channel/:name/preview` — renders a template with the data, language and draft texts given. */
  preview(
    ctx: HandlerContext<{ params: TemplateParamsRTO; body: PreviewTemplateRTO }>,
  ): Promise<TemplatePreview & Record<string, unknown>>
}

/** Combines a guard list into ONE guard: runs each in order, short-circuiting on the first
 * denial. An empty/omitted list resolves to an always-allow guard — see
 * {@link TemplatesControllerOptions.guards}'s own doc for why that's the honest default here.
 * Exported (test-only reason): `@Guard` is pure route metadata (see `@zanix/server`'s own `Guard`
 * decorator doc) — it's never baked into a handler's own method body, and the public
 * `ProgramModule` surface this package can see doesn't expose the internal middlewares registry
 * `@Guard` registers into. This is the only way to exercise the real combine/short-circuit/ordering
 * logic directly — see `templates.handler.test.ts`'s own `combineGuards` tests. */
export function combineGuards(guards: MiddlewareGuard[] | undefined): MiddlewareGuard {
  const list = guards ?? []
  return async (context, ...args) => {
    for (const guard of list) {
      // deno-lint-ignore no-await-in-loop
      const result = await guard(context, ...args)
      if (result.response) return result
    }
    return {}
  }
}

/**
 * Builds this package's own local `/templates` CRUD API — this package is the actual **owner** of
 * the templates collection, via its own {@link TemplatesAdminService} (data layer) and RTOs
 * (validation contract). Cross-service concerns (pulling a registered service's own code templates
 * via Discovery, `POST /templates/sync`) are NOT part of this controller — that's genuinely
 * aggregator-shaped (it needs a `ServiceRegistry`, a concept this package doesn't and shouldn't
 * know about), and stays composed separately by whichever package owns cross-service orchestration
 * (`@zanix/admin`'s own `TemplatesSyncController`), mounted alongside this one under the same route
 * prefix — see the "Local API vs Aggregator API" rule in the `zanix-libraries-architecture` skill
 * for why a single resource can have both a local-api half and an aggregator-composed half.
 *
 * A factory rather than a plain class because `@Controller`'s `prefix` is decorator-time (static)
 * config, and `guards`/`versionProtocol` are real runtime values this factory closes over — same
 * reasoning `@zanix/space`'s `createAssetsController` already establishes for its own local API.
 * Which Application (see `@zanix/server`'s `docs/applications.md`) this route belongs to is decided
 * by whichever `defineApplication(...)` scope is active when this call runs, not by an option here.
 */
export function createTemplatesController(
  options: TemplatesControllerOptions = {},
): new (context: HandlerContext) => TemplatesControllerInstance {
  const { prefix = 'templates' } = options
  const guard = combineGuards(options.guards)

  @Controller({
    prefix,
    Interactor: TemplatesAdminService,
    versionProtocol: options.versionProtocol,
  })
  class _TemplatesController extends ZanixController<TemplatesAdminService> {
    @Get()
    @Guard(guard)
    public list(): Promise<ZanixTemplateAttrs[]> {
      return this.interactor.list()
    }

    // `& Record<string, unknown>` below: `ZanixTemplateAttrs` is a plain `interface` with no index
    // signature of its own, which `deno check` won't accept as-is for a method's return type here —
    // `ZanixController`'s handler-prototype constraint requires assignability to `HandlerResponse`
    // (itself `Record<string, unknown> | ...`), and an `interface` (unlike an object type literal)
    // isn't structurally compatible with an indexed type without one. The intersection satisfies
    // that check without losing `ZanixTemplateAttrs`'s own field types for callers.
    @Get(':channel/:name', { Params: TemplateParamsRTO })
    @Guard(guard)
    public async get(
      ctx: HandlerContext<{ params: TemplateParamsRTO }>,
    ): Promise<ZanixTemplateAttrs & Record<string, unknown>> {
      const { channel, name } = ctx.payload.params
      return { ...(await this.interactor.get(channel, name)) }
    }

    @Post('', { Body: CreateTemplateRTO })
    @Guard(guard)
    public async create(
      ctx: HandlerContext<{ body: CreateTemplateRTO }>,
    ): Promise<ZanixTemplateAttrs & Record<string, unknown>> {
      return {
        ...(await this.interactor.create(
          ctx.payload.body,
          ctx.session?.id ?? 'unknown',
        )),
      }
    }

    @Put(':channel/:name', {
      Body: UpdateTemplateRTO,
      Params: TemplateParamsRTO,
    })
    @Guard(guard)
    public async update(
      ctx: HandlerContext<
        { body: UpdateTemplateRTO; params: TemplateParamsRTO }
      >,
    ): Promise<ZanixTemplateAttrs & Record<string, unknown>> {
      const { channel, name } = ctx.payload.params
      return {
        ...(await this.interactor.update(
          channel,
          name,
          ctx.payload.body,
          ctx.session?.id ?? 'unknown',
        )),
      }
    }

    @Delete(':channel/:name', { Params: TemplateParamsRTO })
    @Guard(guard)
    public async remove(
      ctx: HandlerContext<{ params: TemplateParamsRTO }>,
    ): Promise<{ deactivated: string }> {
      const { channel, name } = ctx.payload.params
      await this.interactor.remove(channel, name, ctx.session?.id ?? 'unknown')
      return { deactivated: name }
    }

    // The message catalog (`{{t 'key'}}`): the texts by language, so a new language is a set of texts
    // and no new template. A path of three segments (`messages/:lang/:key`) never meets
    // `:channel/:name`, and the plain `messages` is the one a remote backend reads.
    @Get('messages', { Search: MessagesSearchRTO })
    @Guard(guard)
    public messages(
      ctx: HandlerContext<{ search: MessagesSearchRTO }>,
    ): Promise<MessageCatalog> {
      const langs = ctx.payload.search.langs?.split(',').map((lang) => lang.trim()).filter(Boolean)
      return this.interactor.listMessages(langs)
    }

    @Put('messages/:lang/:key', { Params: MessageParamsRTO, Body: SetMessageRTO })
    @Guard(guard)
    public async setMessage(
      ctx: HandlerContext<{ params: MessageParamsRTO; body: SetMessageRTO }>,
    ): Promise<ZanixTemplateMessageAttrs & Record<string, unknown>> {
      const { lang, key } = ctx.payload.params
      return {
        ...(await this.interactor.setMessage(
          lang,
          key,
          ctx.payload.body.text,
          ctx.session?.id ?? 'unknown',
        )),
      }
    }

    @Delete('messages/:lang/:key', { Params: MessageParamsRTO })
    @Guard(guard)
    public async removeMessage(
      ctx: HandlerContext<{ params: MessageParamsRTO }>,
    ): Promise<{ removed: string }> {
      const { lang, key } = ctx.payload.params
      await this.interactor.removeMessage(lang, key)
      return { removed: `${lang}/${key}` }
    }

    // For a screen that edits the catalog. One segment on purpose: `message-entries` cannot meet
    // `:channel/:name`. The plain `messages` stays what a remote backend reads.
    @Get('message-entries', { Search: MessageEntriesSearchRTO })
    @Guard(guard)
    public async messageEntries(
      ctx: HandlerContext<{ search: MessageEntriesSearchRTO }>,
    ): Promise<{ entries: MessageEntry[] }> {
      const { langs, q } = ctx.payload.search
      return {
        entries: await this.interactor.listMessageEntries({
          langs: langs?.split(',').map((lang) => lang.trim()).filter(Boolean),
          search: q,
        }),
      }
    }

    @Post('messages/:lang/:key/reset', { Params: MessageParamsRTO })
    @Guard(guard)
    public async resetMessage(
      ctx: HandlerContext<{ params: MessageParamsRTO }>,
    ): Promise<ZanixTemplateMessageAttrs & Record<string, unknown>> {
      const { lang, key } = ctx.payload.params
      return { ...(await this.interactor.resetMessage(lang, key, ctx.session?.id ?? 'unknown')) }
    }

    @Post(':channel/:name/preview', { Params: TemplateParamsRTO, Body: PreviewTemplateRTO })
    @Guard(guard)
    public async preview(
      ctx: HandlerContext<{ params: TemplateParamsRTO; body: PreviewTemplateRTO }>,
    ): Promise<TemplatePreview & Record<string, unknown>> {
      const { channel, name } = ctx.payload.params
      const { data, lang, texts } = ctx.payload.body
      return { ...(await this.interactor.preview(channel, name, data ?? {}, lang, texts)) }
    }
  }

  return _TemplatesController
}
