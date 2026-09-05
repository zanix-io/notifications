# Templates

Zanix Notifications renders message content with [Handlebars](https://handlebarsjs.com/), compiled
ahead of time into plain JS modules — no template parsing happens at runtime. This guide covers the
template system itself; see [Notifier Provider](./notifier-provider.md) for how `zanixTemplate`
selects one of these by name when sending a message.

## SEE ALSO

- [Notifier Provider](./notifier-provider.md) — sending a message with `zanixTemplate`/`data`.
- [Connectors](./connectors.md) — WhatsApp's own, unrelated native provider-template mechanism.
- [Template Inheritance](./template-inheritance.md) — templates that render through another
  template's content (`parent`) instead of owning their own `.hbs`, and how to update/add them.

---

## Built-in templates

Each channel has its own template registry, exported from the root entrypoint:

| Channel  | Registry export          | Templates                                                                                             |
| -------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Email    | `transactionalTemplates` | `welcome`, `generic`, `password-changed`, `password-recovery`, `login-otp`, `new-login`, `data-table` |
| SMS      | `smsTemplates`           | `generic`, `otp`, `new-login`                                                                         |
| WhatsApp | `whatsappTemplates`      | `generic`, `otp`                                                                                      |

A template name (e.g. `'welcome'`) passed as `zanixTemplate` is looked up in the registry matching
the channel the message is sent through — SMS and WhatsApp each have their own `generic`/`otp`,
independent of email's.

`generic` (all three channels) takes at minimum a `content: string`; email's also accepts `title`,
`buttonText`, `buttonLink`, `message`, `footer`, and an `html`/`styles` override for the wrapping
layout. `otp` (SMS/WhatsApp) takes `code: string`, `ttl: number` (minutes), and an optional `app`
name, and renders a canned verification-code message — there's no email `otp`; use `login-otp` or
`password-recovery` instead, which take the same `code`/`ttl` shape plus the full `generic` email
fields.

`new-login` (email and SMS — each channel's own, unrelated to one another, same as `generic`/`otp`)
renders a "login from a new device" security notification: `device: string` and `time: string` are
required, `location`/`app` are optional. Like `otp`'s `ttl`, `time` is a caller-formatted display
string, not a `Date` — this package never assumes a locale/timezone to format one in. There's no
call-to-action button, same shape as `password-changed`.

`data-table` (email only) renders a generic itemized-table document — an invoice, receipt, order
confirmation, or quote; the schema makes no assumption which. `items`
(`description`/`quantity`/`unitPrice`), `subtotal`, and `total` are the only required fields;
`title` (a heading/description shown above the table), `referenceNumber`, `date`, `dueDate`,
`senderName`, `senderLogo`, `recipient`, `currency`, `tax`, and `notes` are all optional.
Deliberately generic: no hardcoded business name, no assumed currency symbol or decimal-place
convention — `currency` is an opaque label rendered next to each amount, never interpreted, and
`subtotal`/`tax`/`total` are always caller-supplied since tax rules (per-line vs. flat, inclusive
vs. exclusive) are a business decision this library doesn't make. Each line item's
`quantity * unitPrice` is computed for display — plain arithmetic, not a formatting decision.

**The one template in this package where the column/row headings aren't caller-supplied by
default.** Every other template (`welcome`, `generic`, `otp`, etc.) renders 100% caller-supplied
copy; `data-table`'s column/row headings (`Description`/`Qty`/`Unit price`/`Amount`/`Subtotal`/
`Tax`/`Total`) default to English but are overridable via `labels` (all optional). Setting `labels`
lets a non-English deployment configure its own copy once instead of relying on the English default:

```ts
await transactionalTemplates['data-table']({
  items: [{ description: 'Producto', quantity: 1, unitPrice: 10 }],
  subtotal: 10,
  total: 10,
  labels: { description: 'Descripción', quantity: 'Cant.', subtotal: 'Subtotal', total: 'Total' },
})
```

Email's `content`/`footer` accept real HTML and are never escaped — they're meant to carry rich
formatting, including from a value your own app passes through unmodified. Before either reaches the
rendered email, both are run through a denylist sanitizer (`<script>`/`<style>`/`<iframe>`/
`<object>`/`<embed>` elements, `on*` event-handler attributes, and a `javascript:`/`vbscript:`/
non-image `data:` URI in `href`/`src`/`action`/`formaction` are all stripped) — ordinary formatting
markup passes through untouched. `buttonLink` is a URL, not HTML — it goes through the same
`sanitizeUrl` scheme check (`@zanix/helpers`) as `data-table`'s `senderLogo`, not the HTML denylist
sanitizer above. SMS/WhatsApp's `content` is plain text with no HTML involved, so nothing is
stripped there.

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

const html = await execTemplate('email/generic', {
  title: 'Hi',
  content: 'Welcome aboard!',
})
```

## Database-backed templates

By default, every template above is rendered purely from code — nothing is read from a database.
Setting `TEMPLATES_BACKEND=local` (see
[Environment Variables](./environment-variables.md#database-backed-templates)) switches
`TemplateProvider` (used internally by `NotifierProvider`) to a hybrid mode instead, against a
`ZanixTemplate` collection named by `TEMPLATES_MODEL_NAME` — optional even then, defaulting to
`zanix-templates` when unset.

> **`TEMPLATES_BACKEND` (`'local'` or `'remote'`) is the single, explicit selector** for this mode —
> see [Environment Variables](./environment-variables.md#database-backed-templates) (migrating from
> `DATABASE_TEMPLATES`/bare `TEMPLATES_MODEL_NAME`: see `CHANGELOG.md`). Setting
> `TEMPLATES_MODEL_NAME`/`TEMPLATES_SERVICE_URL` without also setting `TEMPLATES_BACKEND` to the
> matching mode has no effect — it's simply never read, not a conflict.

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

### `availableVariables` and `styles`

Two fields exist purely for external tooling (a live preview, a "which variables does this template
take" admin view) — neither is read by `TemplateProvider.resolve()` itself:

- **`availableVariables`** — the operator-facing variable names a template's `.hbs` actually
  references (`title`, `content`, `buttonText`, ... for `email/generic`).
- **`styles`** — `{ css, classDefaults }`: the template's compiled `styles.css` content, and its
  `schema.ts`'s own default style-class names (`{containerClass: 'container', ...}`).

For a `source: 'code'` record, both are derived automatically at build time
(`deno task build-handlebars`, see `handlebars/derive-available-variables.ts`/`compiler.ts`) and
kept in sync with an internal `derivedVersion` stamp (`db/sync.ts`'s `DERIVED_FIELDS_VERSION`) — you
never set either by hand for one of these. That stamp exists because `hbs` equality alone can't
detect every case that should refresh these fields: an already-tracked, untouched entry whose `.hbs`
text hasn't changed at all still gets `availableVariables`/`styles` recomputed on the next sync
after a package upgrade changes HOW they're derived (e.g. a new `styles` sub-field, or a different
variable-extraction algorithm) — it isn't limited to entries whose content also changed. A
`source: 'database'` record has neither: `availableVariables` is optional input on
`CreateTemplateRTO`/`UpdateTemplateRTO` for an admin who wants to document it manually, and `styles`
isn't accepted at all — there's no compiled CSS/schema behind a hand-created record to expose.

> ℹ️ A `source: 'code'` record with no `lastSyncedHbs` on record at all (predates that field, or
> arrived through some path other than a normal seed/resync) has no baseline to prove it's still
> untouched, so it's excluded from every future resync — content and derived fields alike — until
> the next sync backfills that baseline from the record's own current content. That backfill pass
> doesn't retroactively resync content itself (there's no way to know whether a manual edit already
> happened before tracking existed); it only unblocks normal reconciliation from the NEXT code
> change onward.

### How to update a database template

- **A code-backed template that owns its own `.hbs`** (e.g. `generic`) or a **database-only template
  with no code counterpart** (e.g. a custom `invoice-created`) — update `hbs` and `hash` together,
  exactly like [the example above](#database-backed-templates). Takes effect on the next send, no
  restart, in every replica independently (see
  [Behavior across multiple instances](#behavior-across-multiple-instances) below).
- **A derived template** (`welcome`, `otp`, etc. — one that renders through another template's
  content instead of owning its own) — see
  [Template Inheritance's "How to update a derived template"](./template-inheritance.md#how-to-update-a-derived-template),
  since which record to edit depends on whether you want to change what it inherits or give it
  independent content.

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
Notification/Template Service — sets `TEMPLATES_BACKEND=remote` instead of
`TEMPLATES_BACKEND=local`:

```ts
Deno.env.set('TEMPLATES_BACKEND', 'remote')
Deno.env.set('TEMPLATES_SERVICE_URL', 'https://templates.internal.example')
Deno.env.set('TEMPLATES_SERVICE_ID', 'billing')
Deno.env.set('TEMPLATES_SERVICE_TOKEN', myPreIssuedApiToken)
```

- **`TEMPLATES_SERVICE_URL`** — the central service's own base URL. Two real shapes exist, each with
  its own route layout (see `TEMPLATES_SERVICE_PATH_PREFIX` below for the matching prefix):
  - A plain `@zanix/core`-based service running its `admin` option (an `'admin'`-Application
    listener on its own port — anchored/id-prefixed whenever that service's own `ADMIN_SERVER_ID` is
    set, not the service's default-Application port), exposing CRUD/`sync` at `/admin/templates`.
  - A `ZanixAdminHub` instance, exposing the same CRUD/`sync` pair at `/templates` instead (no
    `admin/` segment — see `@zanix/admin`'s own `docs/templates-api.md`).

  Do not include either prefix in this value; `TEMPLATES_SERVICE_PATH_PREFIX` supplies it, appended
  per call. **Required whenever `TEMPLATES_BACKEND=remote` is selected** — omitting it throws
  immediately, at boot (importing `@zanix/notifications/core`) and on every `resolve()` call.
  Setting it without also selecting `TEMPLATES_BACKEND=remote` has no effect — it's simply never
  read. This matters in practice for a deployment where two processes read the SAME `.env` file with
  opposite needs (one is a Mode C consumer, the other is the central service that itself needs
  `TEMPLATES_BACKEND=local`) — set
  `TEMPLATES_BACKEND`/`TEMPLATES_MODEL_NAME`/`TEMPLATES_SERVICE_URL` explicitly in the process that
  needs them (e.g. `Deno.env.set(...)` at that process's own entrypoint) rather than relying on one
  shared file to serve both.
- **`TEMPLATES_SERVICE_PATH_PREFIX`** — the route prefix appended to `TEMPLATES_SERVICE_URL` on
  every call. Optional, defaults to `'admin/templates'` (the plain `@zanix/core`-service shape
  above). **Set this to `'templates'` when `TEMPLATES_SERVICE_URL` instead points at a
  `ZanixAdminHub` instance** — pointing Mode C at a hub with the default prefix produces a 404 on
  every `resolve()` call, since the hub mounts its aggregated routes without the `admin/` segment.
- **`TEMPLATES_SERVICE_ID`** — this service's own identity, as registered in the central service's
  `ServiceRegistry` (see `@zanix/admin`'s `setServiceRegistry`/`ZANIX_ADMIN_SERVICES`) mapped to a
  base URL reachable for this process's own `/.well-known/zanix/code-templates` Discovery endpoint
  (see "Remote sync" below). **Required alongside `TEMPLATES_SERVICE_URL`** — omitting it throws the
  same way the missing-`TEMPLATES_SERVICE_URL` check does.
- **`TEMPLATES_SERVICE_TOKEN`** — a pre-issued machine credential, sent as
  `X-Znx-Authorization: Bearer <token>` (`@zanix/auth`'s `type: 'api'` contract — RS256, verified
  against `JWK_PUB`). This package never mints this token itself; issuing and rotating it is the
  deploying operator's/central service's responsibility. **Takes priority when set** — the dynamic
  exchange below is never even attempted. This is the only option that works against a central
  service outside the Zanix ecosystem.
- **`TEMPLATES_SERVICE_AUTH_ID`** — alternative to `TEMPLATES_SERVICE_TOKEN`, for a central service
  that IS itself Zanix-based (exposes `/admin/service-token`): signs a short-lived assertion and
  exchanges it for a real access token automatically, via `@zanix/auth`'s `createServiceAuthClient`
  — the same primitive `ZanixAdminHub.start({ auth })` uses. No static token to generate/rotate by
  hand. This is **this service's own signing identity (`iss`/`sub`)** — distinct from
  `TEMPLATES_SERVICE_ID` above, which is a routing/lookup key the central service's own registry
  uses. They're independent concepts that don't need to match, even though nothing stops you from
  choosing the same string for both.

  **There is no separate private-key (or "which key") env var to remember** — both resolve
  automatically via `@zanix/auth`'s own conventions: the private key as
  `JWK_PRI_<TEMPLATES_SERVICE_AUTH_ID>` (or `JWK_PRI_<TEMPLATES_SERVICE_AUTH_ID>_<keyId>`), and
  which key to use as `JWK_ID_<TEMPLATES_SERVICE_AUTH_ID>` (for rotation — see below), defaulting to
  the bare form when unset. This is the exact mirror image of `@zanix/auth`'s own
  `JWK_PUB_<serviceId>`/`JWK_PUB_<serviceId>_<keyId>` convention already used on the _verifying_
  side (see `docs/service-credential.md`'s `resolveServiceAssertionKey`): one naming scheme for "the
  key I sign with as X" and "the key I trust for X", handled automatically by
  `createServiceAssertion` itself (see its own doc on `resolveServiceAssertionPrivateKey`/
  `resolveServiceAssertionKeyId`) — not package-specific variables this package invents on top of
  it. **Base64-encoded, PKCS#8 only** (same convention as `JWK_PRI`/`JWK_PUB_<serviceId>`) —
  generate with `generateRSAKeys()` (from `@zanix/helpers`) and store `btoa(privateKey)`, not the
  raw PEM.

  The central service needs `JWK_PUB_<TEMPLATES_SERVICE_AUTH_ID>` and
  `SERVICE_PERMISSIONS_<TEMPLATES_SERVICE_AUTH_ID>` set to trust this identity — see
  `@zanix/admin`'s `docs/service-authentication.md`. To rotate, register
  `JWK_PRI_<TEMPLATES_SERVICE_AUTH_ID>_<newId>`/`JWK_PUB_<TEMPLATES_SERVICE_AUTH_ID>_<newId>`
  alongside the current ones, then flip `JWK_ID_<TEMPLATES_SERVICE_AUTH_ID>` to `<newId>` — a config
  change, not a code change, with a real overlap window (see `@zanix/auth`'s
  `docs/service-credential.md#-rotating-a-services-key`).

  ```ts
  Deno.env.set('TEMPLATES_BACKEND', 'remote')
  Deno.env.set('TEMPLATES_SERVICE_URL', 'https://templates.internal.example')
  Deno.env.set('TEMPLATES_SERVICE_ID', 'billing')
  Deno.env.set('TEMPLATES_SERVICE_AUTH_ID', 'billing-service')
  Deno.env.set('JWK_PRI_billing-service', btoa(privateKey)) // from generateRSAKeys()
  ```
- **`TEMPLATES_SERVICE_CACHE_TTL_MS`** — optional, overrides the default 45-second local cache TTL
  on top of the remote fetch (separate from the compiled-render cache described above, which is
  unaffected). A remote outage or latency spike doesn't turn every `resolve()` call into a blocking
  network round-trip; a stale-but-recent copy is an acceptable trade for availability, the same way
  DNS or config caches work.

No local `ZanixTemplate` model is registered against in this mode — `resolve()` calls the central
service's `GET <pathPrefix>/:channel/:name` read endpoint (`admin/templates/:channel/:name` by
default) instead of `Model.findOne(...)`. Everything else about the runtime contract is identical to
Modes A/B: a `404` (no such template) falls through to the code registry silently, same as a missing
local record; any other failure (network error, timeout, non-2xx) falls back to the code version
with a logged warning, exactly the same "strictly additive, never a new way for a send to fail"
guarantee.

**Validating the env vars together, before traffic.** `RemoteTemplateBackend`'s own self-check
(`#ensureSynced()`/`#sync()`) already catches and logs every failure without ever throwing — the
only gap is it fires lazily, on this process's first `resolve()` call, rather than at boot. For a
deploy-pipeline smoke test that catches a misconfiguration before it reaches real traffic, script
against the same sync endpoint directly (`admin/templates/sync` by default; `templates/sync` when
`TEMPLATES_SERVICE_PATH_PREFIX=templates` targets a `ZanixAdminHub`):

```sh
curl -X POST "$TEMPLATES_SERVICE_URL/${TEMPLATES_SERVICE_PATH_PREFIX:-admin/templates}/sync" \
  -H "X-Znx-Authorization: Bearer $TEMPLATES_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"serviceId\":\"$TEMPLATES_SERVICE_ID\"}"
# expect a 2xx — validates TEMPLATES_SERVICE_URL/_ID/_TOKEN/_PATH_PREFIX together, with zero new code
```

**Remote sync IS supported, pull-based.** `RemoteTemplateBackend` has no local database of its own
to sync against, but on the first `resolve()` call for the whole process it fires a single
`POST <pathPrefix>/sync` (`admin/templates/sync` by default), telling the central service _which
registered service to pull from_ (`{ serviceId: config.serviceId }`) — the template contents
themselves are never sent as a request body. This requires this process to expose its own
`CODE_TEMPLATES` for the central service to pull from, via `defineCodeTemplatesDiscovery()`
(exported by this package):

```ts
import { defineCodeTemplatesDiscovery } from 'jsr:@zanix/notifications@[version]'
import { ProgramModule } from 'jsr:@zanix/server@[version]'

// Inside your own bootstrap's Application scope:
await ProgramModule.defineApplication('main', () => {
  defineCodeTemplatesDiscovery() // serves /.well-known/zanix/code-templates
})
```

`defineCodeTemplatesDiscovery` accepts an optional `{ guards }` — this package has no dependency on
`@zanix/auth`, so it never assumes an auth scheme; pass a guard from your own bootstrap if this
endpoint should require one (see `@zanix/server`'s `docs/handlers.md`'s "Discovery" section on why
omitting it is a deliberate, honest "unauthenticated," not a silently-broken "looks protected but
isn't").

Once the central service receives the sync POST, it resolves `serviceId` in its own
`ServiceRegistry`, fetches this process's `/.well-known/zanix/code-templates` snapshot (every entry
in [Built-in templates](#built-in-templates) that owns its own `.hbs` — `email/generic`,
`email/data-table`, `sms/generic`, `whatsapp/generic` — each as `{channel, name, hbs, hash}`) —
cross- service orchestration owned by `@zanix/admin` itself (`syncTemplatesFromRegisteredService`) —
and reconciles it against its own database via this package's own
`TemplatesAdminRepository.syncCodeTemplates`, using the exact same
seed/resync/orphan/manual-edit-always-wins rules `LocalTemplateBackend` applies locally (see
[Database-backed templates](#database-backed-templates) above), so a service running in this mode
gets its code-defined templates seeded into the central database exactly like a local-Mongo service
does, without ever touching Mongo itself.

This trigger fires **at most once per process**, not once per `resolve()` call — and, unlike
`LocalTemplateBackend`'s own bootstrap sync, it is never retried after a failure within the same
process (mirrors the "once per process" framing exactly). It is strictly best-effort: any failure
(network error, non-2xx, an unregistered `serviceId`, or an older central service that doesn't yet
expose this route) is caught and logged as a warning, never rethrown — seeding the central database
is an enhancement on top of the read path above, never a new hard dependency for `resolve()` to keep
working off the code registry fallback. Requires a central service built on a `@zanix/admin` version
that pulls via Discovery (check its own changelog); against an older, push-expecting central
service, the sync POST simply fails once (logged, wrong body shape) and the read path above
continues to work exactly as before.

**Composes automatically with conditional-`GET` support in `@zanix/server`'s `RestClient`.** On top
of `RemoteTemplateBackend`'s own TTL cache above, every remote fetch it makes already goes through
`RestClient`'s `ETag`/`If-None-Match` handling — no code in this package needs to change for that:
once the central service starts returning an `ETag` header on this read endpoint (the natural value
is `ZanixTemplateAttrs.hash`, already computed server-side), any call made after
`TEMPLATES_SERVICE_CACHE_TTL_MS` expires gets a cheap `304` instead of a full body whenever nothing
actually changed. Requires a `@zanix/server` version that ships this (check its own changelog).

### Reusing the templates CRUD layer

This package owns the full local `/templates` CRUD API — data access, business logic
(`TemplatesAdminRepository`/`TemplatesAdminService`), and the HTTP surface fronting them
(`@zanix/notifications/templates-api`'s `createTemplatesController`), the same "local API lives with
its domain" shape `@zanix/datamaster` follows for its own triggers, and `@zanix/space` establishes
for its own assets — see the "Local API vs Aggregator API" rule in the
`zanix-libraries-architecture` skill. `@zanix/admin` separately composes a genuinely cross-service
extension on top — `POST /templates/sync`, pulling a registered service's own code templates via
`ServiceRegistry`/Discovery — mounted under the same `/templates` prefix but owned and authored by
`@zanix/admin` itself, since that's the part that actually needs cross-service concerns this package
deliberately knows nothing about. Rather than duplicating the CRUD logic, a consuming app that needs
a custom templates API (different endpoints, extra fields, its own auth scheme) can import and
extend it directly:

```ts
import { TemplatesAdminRepository } from 'jsr:@zanix/notifications'
import { createTemplatesController } from 'jsr:@zanix/notifications/templates-api'
import { jwtValidationGuard } from 'jsr:@zanix/auth'

class MyCustomTemplatesRepository extends TemplatesAdminRepository {
  // add/override methods as needed — the base CRUD (list/get/create/update/remove) is already
  // correct with respect to `source`, `version`, `hash`, and soft-delete semantics.
}

// createTemplatesController never assumes an auth mechanism — pass real guards explicitly.
createTemplatesController({
  guards: [jwtValidationGuard({ permissions: ['my-app:templates'], type: ['user'] })],
})
```

`@zanix/admin` composes this same controller into its own `/templates` CRUD API — see its own
`docs/templates-api.md`.

## Adding a custom template

> Maintainers only: The following steps are only required when adding or modifying a template
> implementation. If you're just using the library to render templates, you can ignore this section.

This covers a **base template** — one that owns its own `.hbs`. For a **derived template** (one that
renders through another template's content instead, like `welcome` → `generic`), see
[Template Inheritance's "Adding a derived template"](./template-inheritance.md#adding-a-derived-template)
instead — picking the wrong guide is the easiest way to end up with a template that renders fine in
code but is invisible to (or breaks) database-backed mode.

### A. A base template (owns its own `.hbs`)

1. Create `handlebars/{channel}/{name}/main.hbs`, `schema.ts` (a Zod schema describing the data the
   template accepts — also the source of that template's exported `*TemplateSchema` type), and
   `styles.css` (used by the wrapping HTML layout for email; still required, even if empty, for
   plain-text SMS/WhatsApp templates, since the build pipeline always injects `data.styles.css`).
2. Run `deno task build-handlebars` to compile every `main.hbs` into a `main.js` module — this is
   what `execTemplate()` actually imports at runtime, so a new `.hbs` isn't usable until compiled.
   This same task also **regenerates `db/code-templates.generated.ts`'s `CODE_TEMPLATES`** directly
   from which `main.hbs` files it just found and compiled — nothing to register by hand here
   anymore; commit the regenerated file alongside your new `.hbs`/`schema.ts`/`styles.css`, the same
   way the compiled `main.js` is already committed.
3. Add a transactional wrapper function (see `src/modules/templates/transactional/`) that calls
   `execTemplate('{channel}/{name}', data)`, and add it to that channel's registry object
   (`transactional/sms.ts`, `whatsapp.ts`, or `email/mod.ts`'s `templates` object) — the registry
   key is the real `zanixTemplate` string a caller passes.
