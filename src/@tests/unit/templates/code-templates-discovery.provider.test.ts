import { assert, assertEquals } from 'jsr:@std/assert@^1.0.15'
import { createCodeTemplatesDiscoveryProvider } from 'modules/templates/db/code-templates-discovery.provider.ts'
import { CODE_TEMPLATES } from 'modules/templates/db/manifest.ts'

Deno.test({
  name: 'createCodeTemplatesDiscoveryProvider: snapshot() returns entries with hashes',
  fn: async () => {
    const provider = createCodeTemplatesDiscoveryProvider()
    const entries = await provider.snapshot()

    assertEquals(entries.length, CODE_TEMPLATES.length)
    for (const entry of entries) {
      assert(
        CODE_TEMPLATES.some((t) => t.channel === entry.channel && t.name === entry.name),
      )
      assert(entry.hbs.length > 0)
      assert(/^[0-9a-f]{64}$/.test(entry.hash))
    }
  },
})
