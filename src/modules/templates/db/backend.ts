import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'
import type { MessageCatalog } from '../i18n.ts'

/**
 * A source `TemplateProvider.resolve()` can fetch a persisted `ZanixTemplate` record from — a
 * local `ZanixMongoConnector` collection (`LocalTemplateBackend`, `db/local-backend.ts`) or a
 * central Notification/Template Service over HTTP (`RemoteTemplateBackend`, `db/remote-backend.ts`
 * — see `docs/templates.md#mode-c-remote-only-templates`). Not to be confused with
 * `TemplateSource` (`typings/templates-db.ts`), the `'code' | 'database'` *ownership* union stamped
 * on a record itself — a `TemplateBackend` is about *where* the record physically lives, not who
 * owns its content.
 */
export interface TemplateBackend {
  /**
   * Resolves the live `{ hbs, hash, ... }` record for `{channel, name}`.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to resolve.
   * @returns The matching, active record, or `undefined` if none exists — a normal, silent "not
   * found," mirroring `Model.findOne({...}).lean()` returning `null`. Any other failure (network,
   * auth, 5xx, sync error) must `throw` instead — `TemplateProvider.resolve()` is the sole place
   * that catches, warns, and falls back to the code registry.
   */
  resolve(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined>

  /**
   * Fetches the live `{ hbs, hash, ... }` record for `{channel, name}` — the same lookup as
   * `resolve()`, without the code-registry fallback — so a caller can build its own
   * request-scoped cache ahead of time (see `NotifierProvider.onDestroy()`, which resolves this on
   * the main thread before handing a batch off to a one-time worker, so that worker's own
   * `resolve()` call can hit the cache instead of opening its own connection). Has no caching
   * side effect of its own; the caller owns whatever cache it builds from the result.
   *
   * @param channel The notifier channel `name` belongs to.
   * @param name The `zanixTemplate` name to preload.
   * @returns The matching, active record, or `undefined` if none exists.
   */
  preload(
    channel: Notifiers,
    name: string,
  ): Promise<ZanixTemplateAttrs | undefined>

  /**
   * Loads the message catalog (the texts a template reads with `{{t 'key'}}`) for `langs`.
   *
   * @param langs The languages to load, as a message's `langChain()`.
   * @returns The texts by language and then by key; a language with none is absent. Any failure
   * (network, auth, 5xx) must `throw`: `TemplateProvider` catches it and renders without texts.
   */
  messages(langs: string[]): Promise<MessageCatalog>

  /**
   * Loads the message catalog for `langs` on the main thread, for a background worker that cannot
   * reach the source itself (see `preload()`).
   *
   * @param langs The languages to load.
   * @returns The catalog, or `undefined` when the worker can reach the source on its own (a remote
   * service) and there is nothing to hand over.
   */
  preloadMessages(langs: string[]): Promise<MessageCatalog | undefined>
}
