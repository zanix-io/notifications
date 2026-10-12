import { assert } from 'jsr:@std/assert@^1.0.15'

/**
 * Structural guard rail: `modules/i18n.ts` (the `@zanix/notifications/i18n` subpath, the pure
 * translation primitives) must stay free of Handlebars, Zod, Mongoose, `@zanix/server`,
 * `@zanix/datamaster`, `@zanix/auth`, `@zanix/logger` and every connector, as either a code or a type
 * dependency, so a console or a browser can import it cheaply. Uses `deno info --json` for
 * transitive reachability, like `env-types-dependency-boundary.test.ts`.
 *
 * @module
 */

const ENTRY = 'src/modules/i18n.ts'

const FORBIDDEN = [
  'handlebars',
  'zod',
  'mongoose',
  '@zanix/server',
  '@zanix/datamaster',
  '@zanix/auth',
  '@zanix/logger',
  '@std/path',
  '@std/fmt',
  'modules/connectors',
  'modules/providers',
  'modules/templates/provider',
]

Deno.test(`${ENTRY}: the module graph stays free of the heavy dependencies`, async () => {
  const { stdout, stderr, success } = await new Deno.Command(Deno.execPath(), {
    args: ['info', '--json', ENTRY],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!success) {
    throw new Error(`'deno info --json ${ENTRY}' failed: ${new TextDecoder().decode(stderr)}`)
  }
  // deno-lint-ignore no-explicit-any -- `deno info --json`'s own output shape, not this package's.
  const parsed: any = JSON.parse(new TextDecoder().decode(stdout))
  const specifiers: string[] = []
  for (const module of parsed.modules ?? []) {
    if (typeof module.specifier === 'string') specifiers.push(module.specifier)
    for (const dep of module.dependencies ?? []) {
      if (dep.code?.specifier) specifiers.push(dep.code.specifier)
      if (dep.type?.specifier) specifiers.push(dep.type.specifier)
    }
  }
  for (const segment of FORBIDDEN) {
    const hit = specifiers.find((specifier) => specifier.includes(segment))
    assert(!hit, `${ENTRY} must never resolve ${segment} (reached ${hit})`)
  }
})
