import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { defineCodeTemplatesDiscovery } from 'modules/templates/db/code-templates-discovery.provider.ts'
import { CODE_TEMPLATES } from 'modules/templates/db/manifest.ts'

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'defineCodeTemplatesDiscovery serves CODE_TEMPLATES at /.well-known/zanix/code-templates',
  fn: async () => {
    await ProgramModule.defineApplication('main', () => {
      defineCodeTemplatesDiscovery()
    })

    const servers = await bootstrapServers({ rest: { port: 1453 } })
    const info = webServerManager.info(servers[0])

    const res = await fetch(
      `http://${info.addr?.hostname}:${info.addr?.port}/api/.well-known/zanix/code-templates`,
    )
    assertEquals(res.status, 200)

    const body = await res.json()
    assertEquals(body.resourceType, 'code-templates')
    assertEquals(body.items.length, CODE_TEMPLATES.length)

    await webServerManager.stop(servers)
  },
})
