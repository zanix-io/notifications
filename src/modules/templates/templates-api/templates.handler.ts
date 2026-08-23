import type { HandlerContext, MiddlewareGuard, VersionProtocolOption } from '@zanix/server'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

import { Controller, Delete, Get, Guard, Post, Put, ZanixController } from '@zanix/server'
import { TemplatesAdminService } from '../db/templates.service.ts'
import { CreateTemplateRTO, TemplateParamsRTO, UpdateTemplateRTO } from './rtos/templates.rto.ts'

/** Options accepted by {@link createTemplatesController}. */
export interface TemplatesControllerOptions {
  /** The route prefix, e.g. `'templates'` (default) for `/templates`. */
  prefix?: string
  /**
   * Guards applied to every route on this controller, run in order, short-circuiting on the first
   * denial. Omitted/empty means no guard at all — this package never assumes an auth mechanism (it
   * doesn't depend on `@zanix/auth`) and never invents its own `permissions`/`roles` concept; the
   * composer (typically `@zanix/admin`) is the one that knows what "admin" means and builds the
   * real guard, e.g. from `@zanix/auth`'s `jwtValidationGuard`. See the "Local API vs Aggregator
   * API" rule in the `zanix-libraries-architecture` skill for why the auth mechanism is always
   * supplied by the composer, never assumed here.
   */
  guards?: MiddlewareGuard[]
  /**
   * Protocol-version negotiation for this controller, passed straight to `@Controller`. Defaults to
   * `@zanix/server`'s own generic default when omitted — a composer preserving an existing wire
   * contract (e.g. `@zanix/admin`'s own protocol config) should pass it explicitly here instead of
   * this package hardcoding a value with "admin" in its name.
   */
  versionProtocol?: VersionProtocolOption
}

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
  }

  return _TemplatesController
}
