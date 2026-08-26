/**
 * Throws if `hbs` isn't syntactically valid Handlebars. Does not validate variable/data shape —
 * only that the template string itself parses.
 *
 * `Handlebars.compile()` alone does **not** parse eagerly in this build — it only builds a
 * template function, and any syntax (parse) error is deferred until that function is actually
 * invoked with data. So this calls the compiled function with an empty object to force parsing
 * now, at validation time, rather than silently deferring a broken template to send time (the same
 * point `TemplateProvider` would otherwise first discover it — see its own `#compile()`). A
 * genuinely malformed template throws regardless of what data it's called with, so `{}` is enough
 * to surface a real syntax error without needing the template's real render data.
 *
 * Exported so a consumer building its own admin-style API against this package's templates (e.g.
 * `@zanix/admin`'s `TemplatesAdminRepository`) can reject a malformed `hbs` at create/update time,
 * instead of only discovering it the first time `TemplateProvider.resolve()` tries to send it.
 */
export async function assertValidHandlebarsSyntax(hbs: string): Promise<void> {
  // A literal specifier, not the ecosystem's lazy-dependency pattern (`lazyFunction`/etc. from
  // `@zanix/utils/helpers`) — deliberately, not an oversight. This function's only caller
  // (`templates.repository.ts`) already value-imports `templatesModelName` from `provider.ts`,
  // whose module graph unconditionally imports every channel's compiled Handlebars template
  // registry — `npm:handlebars` is already a hard dependency of any reachable path to this
  // function today, so a non-literal specifier here would add ceremony without removing any real
  // materialization. Revisit if `templates.repository.ts` (or this function) is ever exposed from
  // a narrow subpath that doesn't already reach `provider.ts`'s template registries.
  const { default: Handlebars } = await import('handlebars')
  Handlebars.compile(hbs)({})
}
