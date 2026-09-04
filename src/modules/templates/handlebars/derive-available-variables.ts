import Handlebars from 'handlebars'

/**
 * Built-in Handlebars block helpers that shift the active data context for their own block body
 * (their first param becomes `this` inside it) — `if`/`unless`/`else` never do. This package
 * never registers a custom Handlebars helper (`grep -rn registerHelper` finds none), so
 * {@link deriveAvailableVariables} only ever needs to special-case these two.
 */
const CONTEXT_SHIFTING_HELPERS = new Set(['each', 'with'])
/** Built-in block helpers whose own `path` (e.g. `if` in `{{#if title}}`) is the helper's name, never a data reference — unlike an implicit/custom block (`{{#items}}...{{/items}}`), whose `path` IS the data reference. */
const NON_DATA_HELPERS = new Set(['if', 'unless', 'else'])

// deno-lint-ignore no-explicit-any
type HbsNode = any

/**
 * Walks `hbs`'s AST (`Handlebars.parse`) to collect every root-context variable it actually
 * references — the "documented variable names" `ZanixTemplateAttrs.availableVariables` exists
 * for, derived automatically here instead of left for an admin to type by hand (see
 * `db/manifest.ts`'s own doc on why every code template needs this populated). Called from
 * `compiler.ts`'s own build step — split into its own side-effect-free module so it (and its
 * real edge cases — `{{../x}}`, `{{#each}}`, `{{this.x}}`) can be unit-tested directly, without
 * importing `compiler.ts` itself and running its top-level build.
 *
 * - `styles.*` is deliberately excluded — it's always Zod-defaulted (`schema.ts`) and its real
 *   content is injected at render time by `compiler.ts` (`data.styles.css = ...`), never
 *   something an operator fills in by hand.
 * - A path nested inside `{{#each}}`/`{{#with}}` (e.g. `{{this.description}}` inside
 *   `{{#each items}}`) is item-relative, not a root field, so it's excluded too — only the
 *   block's own param (`items`) and a `../`-prefixed path that walks back out to the root are
 *   collected (confirmed against `email/data-table/main.hbs`'s real `{{#each items}}` block,
 *   including its own `{{../currency}}` parent-context reference).
 * - `@index`/`@key`/etc. (Handlebars' own private data variables) are excluded.
 */
export function deriveAvailableVariables(hbs: string): string[] {
  const found = new Set<string>()

  const collect = (path: HbsNode, contextDepth: number): void => {
    if (!path || path.type !== 'PathExpression' || path.data) return
    const parts: string[] = path.parts ?? []
    if (!parts.length) return // bare `{{this}}`/`{{.}}` — no field name to report
    if (contextDepth - (path.depth ?? 0) > 0) return // still relative to a nested item, not root
    const resolved = parts.join('.')
    if (resolved === 'styles' || resolved.startsWith('styles.')) return
    found.add(resolved)
  }

  const visitParam = (node: HbsNode, contextDepth: number): void => {
    if (node?.type === 'PathExpression') collect(node, contextDepth)
    else if (node?.type === 'SubExpression') visitStatement(node, contextDepth)
  }

  const visitProgram = (program: HbsNode, contextDepth: number): void => {
    for (const statement of program?.body ?? []) visitStatement(statement, contextDepth)
  }

  function visitStatement(node: HbsNode, contextDepth: number): void {
    switch (node.type) {
      case 'MustacheStatement':
      case 'SubExpression':
        collect(node.path, contextDepth)
        for (const param of node.params ?? []) visitParam(param, contextDepth)
        break
      case 'BlockStatement': {
        const helperName = node.path?.original
        for (const param of node.params ?? []) visitParam(param, contextDepth)
        if (!NON_DATA_HELPERS.has(helperName) && !CONTEXT_SHIFTING_HELPERS.has(helperName)) {
          // An unrecognized (custom) block helper, or an implicit block (`{{#items}}...{{/items}}`)
          // — treat the block's own path as a possible data reference too (see this file's own
          // `NON_DATA_HELPERS` doc).
          collect(node.path, contextDepth)
        }
        const innerDepth = CONTEXT_SHIFTING_HELPERS.has(helperName)
          ? contextDepth + 1
          : contextDepth
        visitProgram(node.program, innerDepth)
        visitProgram(node.inverse, contextDepth) // `{{else}}` always runs in the OUTER context
        break
      }
      case 'PartialStatement':
        for (const param of node.params ?? []) visitParam(param, contextDepth)
        break
      default:
        break // ContentStatement/CommentStatement/etc. — no data reference
    }
  }

  visitProgram(Handlebars.parse(hbs), 0)
  return [...found].sort()
}
