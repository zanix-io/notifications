# Templates

Zanix Notifications renders message content with [Handlebars](https://handlebarsjs.com/), compiled
ahead of time into plain JS modules — no template parsing happens at runtime. This guide covers the
template system itself; see [Notifier Provider](./notifier-provider.md) for how `zanixTemplate`
selects one of these by name when sending a message.

## SEE ALSO

- [Notifier Provider](./notifier-provider.md) — sending a message with `zanixTemplate`/`data`.
- [Connectors](./connectors.md) — WhatsApp's own, unrelated native provider-template mechanism.

---

## Built-in templates

Each channel has its own template registry, exported from the root entrypoint:

| Channel  | Registry export          | Templates                                                                  |
| -------- | ------------------------ | -------------------------------------------------------------------------- |
| Email    | `transactionalTemplates` | `welcome`, `generic`, `password-changed`, `password-recovery`, `login-otp` |
| SMS      | `smsTemplates`           | `generic`, `otp`                                                           |
| WhatsApp | `whatsappTemplates`      | `generic`, `otp`                                                           |

A template name (e.g. `'welcome'`) passed as `zanixTemplate` is looked up in the registry matching
the channel the message is sent through — SMS and WhatsApp each have their own `generic`/`otp`,
independent of email's.

`generic` (all three channels) takes at minimum a `content: string`; email's also accepts `title`,
`buttonText`, `buttonLink`, `message`, `footer`, and an `html`/`styles` override for the wrapping
layout. `otp` (SMS/WhatsApp) takes `code: string`, `ttl: number` (minutes), and an optional `app`
name, and renders a canned verification-code message — there's no email `otp`; use `login-otp` or
`password-recovery` instead, which take the same `code`/`ttl` shape plus the full `generic` email
fields.

## Rendering a template directly

Each registry's functions can be called directly — useful outside of `NotifierProvider` (e.g. to
preview rendered content, or embed it somewhere other than a notification send):

```ts
import { transactionalTemplates } from '@zanix/notifications'

const html = await transactionalTemplates.welcome({ buttonText: 'Click here' })
```

Or the lower-level `execTemplate(name, data)`, which loads a compiled template by its physical path
(`{channel}/{name}`) directly, bypassing the transactional registry layer entirely:

```ts
import { execTemplate } from '@zanix/notifications'

const html = await execTemplate('email/generic', { title: 'Hi', content: 'Welcome aboard!' })
```

## Database-backed templates

By default, every template above is rendered purely from code — nothing is read from a database.
Setting the `TEMPLATES_MODEL_NAME` environment variable (see
[Environment Variables](./environment-variables.md#database-backed-templates)) switches
`TemplateProvider` (used internally by `NotifierProvider`) to a hybrid mode instead. If you don't
need a custom model name, `DATABASE_TEMPLATES=true` enables the same hybrid mode under the default
name (`zanix-templates`) without setting `TEMPLATES_MODEL_NAME` yourself. `DATABASE_TEMPLATES=false`
is the opposite: a kill switch that disables database-backed templates entirely, even if
`TEMPLATES_MODEL_NAME` is explicitly set — the same convention as `@zanix/datamaster`'s
`DATABASE_SEEDERS`.

- On first use, every code template (the ones listed under
  [Built-in templates](#built-in-templates)) is seeded into a `ZanixTemplate` collection, one
  document per `{channel, name}`, with `source: 'code'`.
- From then on, a `{channel, name}` with a database record renders from that record's live `hbs`
  content instead of the compiled code version — so editing it directly in the database (e.g.
  through an admin CRUD API) takes effect on the very next send, no redeploy needed.
- A later code change to the same template only re-syncs into the database if nobody has edited it
  there since the last sync — a manual database edit always wins over a subsequent code change, with
  no exception.
- A template removed from code is never deleted from the database — it's flipped to
  `source: 'database'` and keeps rendering exactly as last synced.
- Any failure on the database path (connector not configured, a sync error, an invalid record) falls
  back to the code version with a logged warning — enabling this is meant to be strictly additive,
  never a new way for a send to fail.

This requires [`@zanix/datamaster`](https://jsr.io/@zanix/datamaster) — a real dependency of this
package, the same way `@zanix/server` is — specifically its `ZanixMongoConnector`, registered under
the `'database'` core-provider key (the same zero-config mechanism `@zanix/datamaster/core`
provides). `TemplateProvider` is typed directly against `ZanixMongoConnector`; there's no other
backend to be storage-agnostic about.

The `ZanixTemplate` model itself is registered once, at boot, via `@zanix/datamaster`'s
`registerModel()` (the same DSL any other Zanix repository provider uses — see `@zanix/datamaster`'s
own docs). An admin feature editing templates directly is just another provider in your app reusing
the same, already-registered `'database'` connector — a plain `this.database.getModel(name)` lookup,
no schema/definition needed:

```ts
import type { ZanixMongoConnector } from '@zanix/datamaster'

import { Provider, ZanixProvider } from '@zanix/server'
import { generateUUID } from 'jsr:@zanix/utils/helpers'

@Provider()
export class TemplatesAdminProvider extends ZanixProvider<{ database: ZanixMongoConnector }> {
  public async editGenericEmail(hbs: string) {
    await this.database.isReady
    const Model = this.database.getModel('zanix-templates')
    await Model.updateOne(
      { channel: 'email', name: 'generic' },
      { $set: { hbs, hash: generateUUID() } },
    )
  }
}
```

> ⚠️ `hash` must be updated alongside `hbs` — `TemplateProvider` caches compiled renders keyed by
> `hash`, so a content edit that doesn't also bump `hash` won't be picked up.

### `name` vs `hash`

These are easy to conflate but serve entirely different purposes:

- **`name`** identifies the template within its `channel` — together they form the record's unique
  key (a compound unique index on `{channel, name}`). It's exactly the string passed as
  `zanixTemplate` when sending (`provider.email({ zanixTemplate: 'generic', ... })`). There's no
  automatic derivation — you choose it, and it must match on both sides: the persisted record and
  every call site that references it.

- **`hash`** is purely a cache-invalidation key for `TemplateProvider`'s in-memory compiled-render
  cache (see `#compile()` in `provider.ts`) — it has nothing to do with the code↔database sync
  decision itself, which compares the real `hbs` content directly (`planTemplateSync`), never
  `hash`. It can be **any string** — nothing validates it as a real hash of anything — the only
  requirement is that it **changes** whenever `hbs` changes; otherwise `TemplateProvider` keeps
  serving the previously compiled version from cache, silently ignoring the edit.
  - For `source: 'code'` records, a real SHA-256 of `hbs` is computed automatically on every
    code→database sync — you never set this yourself.
  - For a manual edit or a new `source: 'database'` template, you must set `hash` yourself alongside
    `hbs` — any distinct string works (a timestamp, an incrementing counter, a real hash of `hbs`,
    or plain `crypto.randomUUID()`). `@zanix/utils`' `generateUUID()` (`jsr:@zanix/utils/helpers`)
    is a convenient, guaranteed-distinct choice, used exactly this way in the example above.

### Behavior across multiple instances

The sync memo and compiled-render cache are per-process, not shared across replicas — each instance
syncs and compiles independently. This is safe: a manual edit's `hbs`/`hash` is read fresh from the
database on every `resolve()` call (never cached), so it's picked up on the next request in every
instance, with no coordination needed. The only edge case is two replicas seeding the same new
template at nearly the same moment — the second hits the `{channel, name}` unique-index conflict,
falls back to code once for that call, and self-heals on the next.

### Per-service vs. shared template storage

`TemplateProvider` always reuses the app's own `'database'` core connector — there's no dedicated
connection for templates. This has a direct consequence in a multi-service application:

- **Mode A — per-service (the default)**: if each microservice has its own `MONGO_URI` (the usual
  database-per-service pattern), each one that enables DB-backed templates ends up with its own,
  independent `zanix-templates` collection. Editing `welcome` in service A has no effect on service
  B's copy — there is no synchronization between them. This is the right choice whenever a template
  genuinely belongs to that one service's own domain.
- **Mode B — shared**: `@zanix/datamaster`'s `registerModel()` (which `TemplateProvider` uses
  internally) supports a `'db:name'` model-name format — see its own docs' "Multi-database support"
  section — that targets a different database on the **same** Mongo cluster/connection via
  `connection.useDb(db)`. Setting `TEMPLATES_MODEL_NAME` to the **same**
  `'sharedDb:zanix-templates'` value across every service that should share one catalog makes them
  all read/write the same collection, regardless of each service's own default database — no new
  code required. Note `@zanix/datamaster`'s own docs flag this pattern as _"not recommended for
  microservices — prefer one independent database per service... this convention exists for
  monoliths/shared-database scenarios"_ — Mode B is a deliberate, conscious exception to that
  general guidance, not the default path, and requires that every participating service actually
  share the same underlying Mongo cluster.

Choosing between them is an infrastructure decision (which `MONGO_URI`/`TEMPLATES_MODEL_NAME` each
service is configured with), not something this package enforces either way. A third mode — no local
database connection to templates at all — is covered separately below.

### Mode C: remote-only templates

Modes A and B both assume the app holds a real `ZanixMongoConnector`. A service with **no local
Mongo access to templates whatsoever** — only an HTTP call to a dedicated, central
Notification/Template Service — sets `TEMPLATES_SERVICE_URL` instead of `TEMPLATES_MODEL_NAME`:

```ts
Deno.env.set('TEMPLATES_SERVICE_URL', 'https://templates.internal.example')
Deno.env.set('TEMPLATES_SERVICE_TOKEN', myPreIssuedApiToken)
```

- **`TEMPLATES_SERVICE_URL`** — the central service's own _internal admin_ base URL (today, per
  `@zanix/core`'s `isInternal: true` wiring, a second listener on its own port — not the service's
  public port). Do not include the `/admin/templates` suffix; `TemplateProvider` appends it per
  call. **Mutually exclusive with `TEMPLATES_MODEL_NAME`** — setting both throws immediately, at
  boot (importing `@zanix/notifications/core`) and on every `resolve()` call, rather than silently
  picking one.
- **`TEMPLATES_SERVICE_TOKEN`** — a pre-issued machine credential, sent as
  `X-Znx-Authorization: Bearer <token>` (`@zanix/auth`'s `type: 'api'` contract — RS256, verified
  against `JWK_PUB`). This package never mints this token itself; issuing and rotating it is the
  deploying operator's/central service's responsibility.
- **`TEMPLATES_SERVICE_CACHE_TTL_MS`** — optional, overrides the default 45-second local cache TTL
  on top of the remote fetch (separate from the compiled-render cache described above, which is
  unaffected). A remote outage or latency spike doesn't turn every `resolve()` call into a blocking
  network round-trip; a stale-but-recent copy is an acceptable trade for availability, the same way
  DNS or config caches work.

No local `ZanixTemplate` model is registered against in this mode — `resolve()` calls the central
service's `GET /admin/templates/:channel/:name` read endpoint instead of `Model.findOne(...)`.
Everything else about the runtime contract is identical to Modes A/B: a `404` (no such template)
falls through to the code registry silently, same as a missing local record; any other failure
(network error, timeout, non-2xx) falls back to the code version with a logged warning, exactly the
same "strictly additive, never a new way for a send to fail" guarantee.

**Remote sync IS supported.** `RemoteTemplateBackend` has no local database of its own to sync
against, but on the first `resolve()` call for the whole process it fires a single batch
`POST admin/templates/sync` — sending this package's `CODE_TEMPLATES` (`email/generic`,
`sms/generic`, `whatsapp/generic`, each as `{channel, name, hbs, hash}`) to the central service. The
central service reconciles that batch against its own database using the exact same
seed/resync/orphan/manual-edit-always-wins rules `LocalTemplateBackend` applies locally (see
[Database-backed templates](#database-backed-templates) above and `@zanix/admin`'s
`TemplatesAdminRepository.syncCodeTemplates`), so a service running in this mode gets its
code-defined templates seeded into the central database exactly like a local-Mongo service does,
without ever touching Mongo itself.

This trigger fires **at most once per process**, not once per `resolve()` call — and, unlike
`LocalTemplateBackend`'s own bootstrap sync, it is never retried after a failure within the same
process (mirrors the "once per process" framing exactly). It is strictly best-effort: any failure
(network error, non-2xx, or an older central service that doesn't yet expose this route) is caught
and logged as a warning, never rethrown — seeding the central database is an enhancement on top of
the read path above, never a new hard dependency for `resolve()` to keep working off the code
registry fallback. Requires a central service built on a `@zanix/admin` version that exposes
`POST /admin/templates/sync` (check its own changelog); against an older central service, the sync
POST simply fails once (logged) and the read path above continues to work exactly as before.

**Composes automatically with conditional-`GET` support in `@zanix/server`'s `RestClient`.** On top
of `RemoteTemplateBackend`'s own TTL cache above, every remote fetch it makes already goes through
`RestClient`'s `ETag`/`If-None-Match` handling — no code in this package needs to change for that:
once the central service starts returning an `ETag` header on this read endpoint (the natural value
is `ZanixTemplateAttrs.hash`, already computed server-side), any call made after
`TEMPLATES_SERVICE_CACHE_TTL_MS` expires gets a cheap `304` instead of a full body whenever nothing
actually changed. Requires a `@zanix/server` version that ships this (check its own changelog).

### Reusing the admin CRUD layer

`@zanix/core` ships a `/admin/templates` CRUD API (internal-only, role-gated) on top of this same
collection — see its own README. Rather than duplicating that CRUD logic, a consuming app that needs
a custom templates API (different endpoints, extra fields, its own auth scheme) can import and
extend `@zanix/core`'s exported `TemplatesAdminService`/`TemplatesAdminRepository` directly:

```ts
import { TemplatesAdminRepository } from 'jsr:@zanix/core'

class MyCustomTemplatesRepository extends TemplatesAdminRepository {
  // add/override methods as needed — the base CRUD (list/get/create/update/remove) is already
  // correct with respect to `source`, `version`, `hash`, and soft-delete semantics.
}
```

## Adding a custom template

> Maintainers only: The following steps are only required when adding or modifying a template
> implementation. If you're just using the library to render templates, you can ignore this section.

Templates live under `handlebars/{channel}/{name}/`, each with a `main.hbs`, a `schema.ts` (a Zod
schema describing the data the template accepts — also the source of that template's exported
`*TemplateSchema` type), and a `styles.css` (used by the wrapping HTML layout for email; still
required, even if empty, for plain-text SMS/WhatsApp templates, since the build pipeline always
injects `data.styles.css`). Run `deno task build-handlebars` to compile every `main.hbs` into a
`main.js` module — this is what `execTemplate()` actually imports at runtime, so a new `.hbs` isn't
usable until it's been compiled. A transactional wrapper function (see
`src/modules/templates/transactional/`) then calls `execTemplate('{channel}/{name}', data)` with any
default field values, and gets added to that channel's registry object.
