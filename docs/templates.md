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
