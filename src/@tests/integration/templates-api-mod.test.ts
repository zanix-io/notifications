import { assertEquals, assertExists } from 'jsr:@std/assert@^1.0.15'
import { classValidation } from '@zanix/validator'
import { ProgramModule } from '@zanix/server'
import {
  CreateTemplateRTO,
  createTemplatesController,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from '../../modules/templates/templates-api/mod.ts'

/** Real, un-mocked route metadata — `handler` (a live function reference) is deliberately not
 * part of `RestRouteEntry`'s public, serializable subset (see `@zanix/server`'s own doc on it), so
 * this only asserts against what `ProgramModule.routes.getRoutes()`'s real public contract exposes:
 * `path`/`httpMethod`. */

/**
 * `modules/templates/templates-api/mod.ts` is the ONLY file this package's own `deno.jsonc`
 * `exports` map points `./templates-api` at (`@zanix/notifications/templates-api`, the real public
 * subpath a consumer imports) — yet nothing in this suite ever imports it: `templates.handler.test.ts`
 * and `templates.rto.test.ts` both import straight from `./templates.handler.ts`/
 * `./rtos/templates.rto.ts`, bypassing the re-export entirely. A typo'd export name, a missing
 * symbol, or a broken re-export chain in `mod.ts` itself would go completely unnoticed by every
 * other test in this package while still breaking every real consumer.
 *
 * Mirrors `di-registration.test.ts`'s own "real entrypoint, real registry, no throw" shape
 * (`modules/core.ts re-exports all DI registrations without throwing`) — importing the actual
 * public entrypoint and asserting against the REAL `ProgramModule.routes` registry, not a mock.
 * Deliberately uses a prefix distinct from `templates.handler.test.ts`'s own default (`'templates'`)
 * — `ProgramModule`'s route registry is a real, process-wide singleton (shared across every test
 * FILE in one `deno test` run, not just within this file), so reusing that same prefix here would
 * collide with the class already decorated there.
 */
Deno.test(
  'templates-api/mod.ts: createTemplatesController(), imported from the real public entrypoint, registers real routes in ProgramModule.routes',
  () => {
    const prefix = 'templates-api-mod-test'
    createTemplatesController({ prefix })

    const routes = ProgramModule.routes.getRoutes('rest') ?? {}
    const registered = Object.values(routes).filter((route) => route.path.startsWith(`/${prefix}`))

    // list (GET), get (GET :channel/:name), create (POST), update (PUT :channel/:name), remove
    // (DELETE :channel/:name) — every route `templates.handler.ts` declares.
    assertEquals(registered.length, 5)
    assertEquals(
      registered.map((route) => route.httpMethod).sort(),
      ['DELETE', 'GET', 'GET', 'POST', 'PUT'],
    )
  },
)

Deno.test(
  'templates-api/mod.ts: the RTOs re-exported here validate the same as their own module (TemplateParamsRTO)',
  async () => {
    const rto = await classValidation(TemplateParamsRTO, {
      channel: 'email',
      name: 'welcome',
    })
    assertEquals(rto.channel, 'email')
    assertEquals(rto.name, 'welcome')
  },
)

Deno.test(
  'templates-api/mod.ts: the RTOs re-exported here validate the same as their own module (CreateTemplateRTO/UpdateTemplateRTO)',
  async () => {
    const created = await classValidation(CreateTemplateRTO, {
      channel: 'sms',
      name: 'welcome',
      hbs: '<p>hi</p>',
    })
    assertExists(created)

    const updated = await classValidation(UpdateTemplateRTO, {})
    assertEquals(updated.active, undefined)
  },
)
