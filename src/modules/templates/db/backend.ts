import type { Notifiers } from 'typings/general.ts'
import type { ZanixTemplateAttrs } from 'typings/templates-db.ts'

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
  resolve(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs | undefined>
}
