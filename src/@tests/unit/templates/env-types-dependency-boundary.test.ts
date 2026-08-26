import { assert } from 'jsr:@std/assert@^1.0.15'

/**
 * Structural guard rail: `modules/templates-env.ts` (the `@zanix/notifications/templates-env`
 * subpath — `TEMPLATES_BACKEND`/`TEMPLATES_MODEL_NAME`/`TEMPLATES_SERVICE_*` selection) and
 * `modules/templates-types.ts` (the `@zanix/notifications/templates-types` subpath — the pure
 * `ZanixTemplateAttrs`/`CreateTemplateInput`/`TemplatesControllerOptions`-shaped data types) must
 * never materialize `npm:handlebars`/`npm:zod`/`npm:mongoose`, as either a code or a type
 * dependency. `TemplateProvider` (`templates/provider.ts`) value-imports every channel's compiled
 * Handlebars template registry (and each one's own Zod schema); `TemplatesAdminRepository`
 * (`templates/db/templates.repository.ts`) additionally needs a real Mongo model. Both subpaths
 * exist specifically so a consumer that only needs the env-var selection or the pure data shapes
 * never pays for either — see each subpath's own module doc.
 *
 * Mirrors `unit/connectors/dependency-boundary.test.ts`'s own `deno info --json`-based approach —
 * transitive reachability, not a grep over `deno.json`'s own `imports` map. Unlike that test, this
 * one does NOT assert "never resolves modules/templates/" — both subpaths deliberately live
 * alongside (`templates-env.ts` re-exports `templates/env.ts`) or describe
 * (`templates-types.ts` describes `templates/db/templates.repository.ts`'s own input/output shapes)
 * real files under that directory; the boundary that matters here is the heavy npm dependency, not
 * the directory.
 *
 * @module
 */

const ENTRIES = [
  'src/modules/templates-env.ts',
  'src/modules/templates-types.ts',
]

interface ModuleGraph {
  code: Set<string>
  type: Set<string>
}

async function moduleGraph(entry: string): Promise<ModuleGraph> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', entry],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { stdout, stderr, success } = await command.output()
  if (!success) {
    throw new Error(`'deno info --json ${entry}' failed: ${new TextDecoder().decode(stderr)}`)
  }

  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const code = new Set<string>()
  const type = new Set<string>()
  for (const module of parsed.modules ?? []) {
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) code.add(dep.code.specifier)
      if (dep.type?.specifier) type.add(dep.type.specifier)
    }
    if (typeof module.specifier === 'string') code.add(module.specifier)
  }
  return { code, type }
}

function includesSegment(specifiers: Set<string>, segment: string): boolean {
  return [...specifiers].some((specifier) => specifier.includes(segment))
}

for (const entry of ENTRIES) {
  Deno.test(
    `${entry}: never materializes npm:handlebars, npm:zod, or npm:mongoose`,
    async () => {
      const graph = await moduleGraph(entry)
      const allSpecifiers = new Set([...graph.code, ...graph.type])
      assert(
        !includesSegment(allSpecifiers, 'npm:/handlebars') &&
          !includesSegment(allSpecifiers, 'npm:handlebars'),
        `${entry} must never resolve npm:handlebars`,
      )
      assert(
        !includesSegment(allSpecifiers, 'npm:/zod') && !includesSegment(allSpecifiers, 'npm:zod'),
        `${entry} must never resolve npm:zod`,
      )
      assert(
        !includesSegment(allSpecifiers, 'npm:/mongoose') &&
          !includesSegment(allSpecifiers, 'npm:mongoose'),
        `${entry} must never resolve npm:mongoose`,
      )
    },
  )
}
