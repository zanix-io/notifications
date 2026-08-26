import { assert } from 'jsr:@std/assert@^1.0.15'

/**
 * Structural guard rail: the raw multi-channel connectors (`modules/{email,sms,whatsapp}/
 * connector.ts`, and `modules/connectors.ts`'s own narrow subpath entry) must never reach
 * `modules/templates/` — nor, transitively, `npm:handlebars`/`npm:zod` — as either a code or a
 * type dependency. `NotifierProvider`'s template-based dispatch genuinely needs `TemplateProvider`
 * (and, through it, every channel's compiled Handlebars template plus its own Zod schema); a plain
 * connector sending `{ content }` directly does not, and importing `@zanix/notifications/
 * connectors` instead of the root barrel is the whole point of that subpath (see its own doc).
 *
 * `modules/connectors-env.ts` (the `@zanix/notifications/connectors-env` subpath — SMTP/SMS/
 * WhatsApp provider env-var selection, `email/defs.ts`/`sms/defs.ts`/`whatsapp/defs.ts`) is held to
 * the exact same boundary: none of the three `defs.ts` files import anything under
 * `modules/templates/`, so this subpath must never pick it up either.
 *
 * `typings/general.ts` previously broke this boundary by itself: `NotifyMessage`'s own file also
 * defined `DefaultTemplates = keyof typeof emailTemplates`-style types, and resolving even a type
 * that lived NEXT TO `NotifyMessage` in the same file forced Deno to resolve that file's whole
 * module graph — including the `typeof emailTemplates` reference, which reaches `execTemplate`'s
 * template-literal dynamic import (glob-expanded by `deno_graph` to every compiled `main.js` under
 * `modules/templates/handlebars/`), each of which statically imports its own `schema.ts` (Zod).
 * `typings/template-registry.ts` now owns those template-registry-derived types instead — this
 * test guards against a future regression re-introducing that co-location, in either file.
 *
 * Verified via `deno info --json`'s actual resolved module graph — transitive reachability, not a
 * grep over `deno.json`'s own `imports` map — mirroring `unit/templates/dependency-boundary.test.ts`.
 *
 * @module
 */

const ENTRIES = [
  'src/modules/connectors.ts',
  'src/modules/connectors-env.ts',
  'src/modules/email/connector.ts',
  'src/modules/sms/connector.ts',
  'src/modules/whatsapp/connector.ts',
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
    `${entry}: never resolves modules/templates/ (code or type)`,
    async () => {
      const graph = await moduleGraph(entry)
      assert(
        !includesSegment(graph.code, '/modules/templates/'),
        `${entry} must never resolve a module under modules/templates/ as code`,
      )
      assert(
        !includesSegment(graph.type, '/modules/templates/'),
        `${entry} must never resolve a module under modules/templates/ as a type`,
      )
    },
  )

  Deno.test(
    `${entry}: never materializes npm:handlebars or npm:zod`,
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
    },
  )
}
