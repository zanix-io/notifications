# Template Inheritance

Several built-in templates render through another template's content under different
default/transformed data rather than owning any `.hbs` of their own — email's `welcome`,
`password-changed`, `password-recovery`, `login-otp`, and `new-login` all render through `generic`;
SMS's `otp` and `new-login`, and WhatsApp's `otp`, do too (each channel's own `new-login` is
independently declared — see [Adding a derived template](#adding-a-derived-template)'s note on
registering the same name in more than one channel). This only matters once
[database-backed templates](./templates.md#database-backed-templates) are enabled — in pure code
mode it's invisible: each is a thin wrapper that transforms its own data and calls
`execTemplate('{channel}/generic', ...)` directly.

## SEE ALSO

- [Templates](./templates.md) — the base rendering/database-backed system this builds on
  (`name`/`hash`, sync rules, multi-instance behavior).
- [Notifier Provider](./notifier-provider.md) — sending a message with `zanixTemplate`/`data`.

---

## How it works

Once database-backed templates are enabled, each of these gets a "fallback" record seeded alongside
`generic` itself — `source: 'database'`, no `hbs` of its own, and a `parent: 'generic'` field.
`TemplateProvider.resolve()` walks `parent` (applying that name's registered data transform at each
hop) until it finds a record with real content — so **editing `generic` directly in the database
also changes what `welcome`/`otp`/etc. render**, without having to duplicate `generic`'s content
into every one of them:

```ts
// Editing the shared parent is enough — no need to also edit `welcome`, `login-otp`, etc.
await Model.updateOne(
  { channel: 'email', name: 'generic' },
  { $set: { hbs: '<p>{{content}}</p>', hash: generateUUID() } },
)
```

- **`parent` is only consulted while a record has no `hbs` of its own.** The moment an admin gives
  `welcome` (or any fallback record) real content directly in the database, it renders from that
  content instead — independent from `generic` from then on, `parent` field or not.
- **`parent` can be any template name, not just `generic` or a code-owned template.** There's no
  restriction to `CODE_TEMPLATES`/`DERIVED_TEMPLATES`, and a parent doesn't need any code
  counterpart at all — it's read straight off whatever database record exists (or gets created
  directly, with no `.hbs` in source anywhere). Concretely, an admin can re-point `otp`'s `parent`
  at a brand-new `auth` record (itself `parent: 'generic'`, no code counterpart, no registered
  transform), and `otp → auth → generic` resolves and stays live-editable exactly like the
  single-hop `otp → generic` case — see `template-provider.test.ts`'s "walks a multi-level chain
  through an intermediate parent that isn't a code template at all" for this verified end to end.
- **The chain can be more than one hop**, as above — `resolve()` keeps walking `parent` until it
  finds active content or runs out. A cycle (or a hop pointing at a missing/inactive record) safely
  terminates the walk instead of looping — falling back to the **original** template's code path,
  not whichever hop it stopped at.
- **A data transform only ever applies to a hop that has one registered** (see
  `typings/templates.ts`'s `DerivedTemplateDeclaration`) — an intermediate hop with no code
  counterpart (like `auth` above) just passes the data it received straight through to its own
  `parent` unchanged. Only the _original_ `zanixTemplate` name's registered transform (if any) ever
  runs; nothing re-transforms the data again at each subsequent hop.
- **Only applies once a database record exists to walk from at all.** If the whole chain has no
  content anywhere (e.g. `TEMPLATES_BACKEND` unset/not `'local'`, or every DB record involved is
  inactive), `resolve()` falls back to the compiled code version exactly as it always has.
- **A brand-new template with no code counterpart at all** can declare its own `parent` directly —
  an admin creating `promo-email` with `parent: 'generic'` via a CRUD API gets the same fallback
  behavior with zero code changes, as long as the data it's rendered with already matches the
  parent's shape (there's no code-side transform to apply for a template that was never a code
  wrapper to begin with).

## How to update a derived template

Which one to edit depends on what you're trying to change:

- **To change what it currently inherits** (e.g. make every email that falls back to `generic` look
  different): edit **`generic`'s** (or whichever ancestor's) `hbs`/`hash` together — it propagates
  to every derived template chaining through it automatically, no restart, and no need to touch the
  derived template's own record at all.
- **To give this one template independent content**, breaking it away from its parent: set `hbs`
  (and `hash`) directly on **its own** record instead — the very next `resolve()` call sees real
  content there and stops walking to `parent` entirely, immediately, no restart and no special
  "promotion" step needed (that mechanism only matters for _code_ later adding a `.hbs` for this
  name — see
  [Promoting a derived template to a base template](#promoting-a-derived-template-to-a-base-template)
  below).
- **To start from what the derived template renders today**, read the record through the templates
  API (`GET /templates/:channel/:name`): a built-in derived record with no `hbs` carries a
  `starterHbs` field (see [Starter bodies](#starter-bodies) below), a body to edit and save as the
  record's own `hbs`.
- **Don't bother setting `hash` on a derived template's own record just to "force" a refresh** —
  until it has real `hbs` of its own, its `hash` field is never read for cache invalidation at all
  (see
  [Only the ancestor's own `hash` invalidates the compiled-render cache](#only-the-ancestors-own-hash-invalidates-the-compiled-render-cache)
  below). Only the ancestor's `hash` matters.
- **Deactivating or deleting** a fallback record — see the next section; it's the one case that
  doesn't self-heal automatically.

## Starter bodies

A derived template has no content of its own, so an operator who wants to give it a body cannot
start from the parent's `hbs`: the parent's variables (`title`, `buttonText`, `message`,
`footer`...) are what the data transform produces, not what the send carries. Each built-in derived
template declares a **starter** (`starter` in its `DerivedTemplateDeclaration`): the map of the
parent's variables it assigns, written as Handlebars over the send's raw data. From the map the
**starter body** is generated: the parent's real `main.hbs` and `styles.css` with those variables
replaced, a self-contained source that, rendered as an independent template with the send's **raw**
data, produces the same message as the derived template.

```ts
starter: {
  title: "t 'login-otp.title'", // {{title}} -> {{t 'login-otp.title'}}
  buttonText: 'code', // {{#if buttonText}}/{{buttonText}} -> {{#if code}}/{{code}}
  message: "t 'login-otp.message' ttl=ttl",
}
```

- **How it is generated.** `buildStarterHbs()` (`transactional/starter.ts`) replaces, by name, the
  printed (`{{x}}`, `{{{x}}}`) and conditional (`{{#if x}}`, `{{#unless x}}`, `{{else if x}}`) uses
  of each assigned variable, inlines `styles.css` for `{{styles.css}}` and the default class names
  for `{{styles.xClass}}`, and keeps everything else. The parent's files are read as text, so a
  change in `main.hbs` or `styles.css` reaches the starter without editing any declaration. A
  variable the declaration does not list keeps reading the send's raw data, as the transform's
  pass-through of the rest of the data does. An assignment that one expression cannot express (a
  text present only when the send has a `location`) is written as `{ fragment }`, which replaces the
  whole printed variable.
- **Why the stylesheet is inlined.** An independent database template is compiled and rendered as it
  is; only a `source: 'code'` template gets its `styles.css` and default class names injected at
  render time.
- **Helpers it relies on.** `{{currentYear}}` (the footer's year), `{{defaultTo value 'text'}}` (the
  `app` default `Zanix`, the document defaults) and `{{withSuffix value 'text'}}` (the SMS and
  WhatsApp `app` prefix, present only when `app` is sent) are render helpers next to `t`, available
  to every database template and also inside subexpressions. They are needed because Handlebars has
  no way to read the clock, default a value or build an optional prefix. A mustache with one of
  those names calls the helper; `{{this.currentYear}}` reads a data field of that name. Every render
  of a database template, the templates API's preview included, builds them in
  `createRenderHelpers()`.
- **Where it is exposed.** The `GET /templates/:channel/:name` response includes `starterHbs` for a
  record with no `hbs` of its own whose name is a declared derived template. It is generated on
  every read from the body the parent record holds at that moment (an app's branded `generic`, say),
  so a body started from it keeps that brand; when the parent cannot be read or has no body, from
  the parent's code source. It is never stored, and create, update and sync never write or accept
  it.
- **What saving a body does.** Setting `hbs` on the record makes it independent: `resolve()` stops
  walking to `parent`, the transform is not applied, and the body receives the send's raw data.
  Edits to `generic` no longer reach that template.
- **What a starter does not reproduce.** A partial `html` override keeps the starter's own default
  for the missing half. Values that contain `&`, `<` or quotes are escaped by the parent's template
  (`{{title}}`) and not by `{{t}}`.
- **Equivalence is tested.** `src/@tests/integration/derived-starters.test.ts` renders each derived
  template through its transactional wrapper and its starter as an independent database template, in
  `en` and `es`, with and without the optional fields, and compares the outputs after collapsing
  whitespace runs and dropping whitespace beside tag boundaries.

## Deleting or deactivating a fallback record

The chain only ever starts by reading the requested template's **own** record — if that record
doesn't exist (or isn't `active`), there's no `parent` to read at all, and `resolve()` falls
straight back to the compiled code version, **ignoring any edit made to `generic` (or any other
ancestor) in the meantime**. Concretely, for `login-otp` (email):

- **Delete the record entirely, same process (no restart):** every subsequent send renders the
  code-compiled version until the process restarts — a `generic` edit made in between has no effect
  on `login-otp` until then.
- **Delete the record, then restart:** the next process's boot-time sync sees `login-otp` missing
  entirely and re-seeds it as a fresh fallback stub (`parent: 'generic'`, no `hbs`) — declared in
  `derivedTemplates` — so the chain (and any `generic` edit) resumes working from then on.
- **Deactivate it instead (`active: false`), with or without a restart:** it never self-heals. The
  sync step that seeds a _missing_ stub only checks whether **any** record exists for that
  `{channel, name}` at all — an inactive one still counts as existing, so it's never recreated or
  reactivated automatically. It stays on the compiled code version until an admin reactivates that
  specific record by hand.

In short: the fallback behavior is entirely driven by that template's own database record existing
and being active — there's no "remembers its declared parent even without a record" fallback path.

## Promoting a derived template to a base template

Giving a former derived template (say `login-otp`) real `.hbs`/`schema.ts`/`styles.css` of its own
and adding it to `CODE_TEMPLATES` (see
[Templates' "Adding a custom template"](./templates.md#adding-a-custom-template)) leaves behind
exactly the situation the previous section describes in reverse: a database record for
`{email, login-otp}` already exists (the fallback stub, `source: 'database'`, no `hbs`), and the
next sync now also wants to seed a **code** record under that same `{channel, name}` — which has a
**unique index**. Naively inserting a second document would throw a duplicate-key error and take the
_entire_ sync down with it (confirmed against a real MongoDB instance while building this feature),
breaking database-backed resolution for every template, not just this one.

The sync step handles this by checking for a same-named collision before seeding, and choosing based
on whether that pre-existing record has content of its own:

- **No content of its own (the common case — a `DERIVED_TEMPLATES` fallback stub, `hbs` absent):**
  promoted in place — updated to `source: 'code'` with the real compiled `hbs`/`hash`, not inserted
  as a duplicate. From then on it behaves exactly like any other code-backed template
  (`toResync`/manual-edit-always-wins rules included).
- **Already has real content of its own** (a genuine database-only template that happens to share
  the new code template's name — an unlikely but possible naming collision, not the promotion case
  above): **left untouched** — the code seed is skipped for it, and a warning is logged, rather than
  silently destroying that content. Rename one side (the code template or the existing database
  record) to resolve the collision; nothing here does that automatically, since guessing which one
  should win would be reckless.

Either way, `hash` never has to "correspond" to anything on the `parent` side — `hash` only ever
describes `hbs`'s own content (see [Templates' `name` vs `hash`](./templates.md#name-vs-hash)); a
content-less fallback record's placeholder `hash` is simply replaced along with everything else the
moment it's promoted.

## Only the ancestor's own `hash` invalidates the compiled-render cache

Editing `generic` directly in the database — `hbs` **and** `hash` together, per
[Templates' `name` vs `hash`](./templates.md#name-vs-hash) — takes effect on `welcome`/`otp`/etc.'s
next send immediately, no restart needed, same as editing any other code-backed template.
`TemplateProvider`'s compiled-render cache is keyed by `` `{channel}:{name}` `` of whichever record
actually **owns** the content — the ancestor the chain lands on, not the derived template that
started the walk. Concretely:

- Editing `welcome`'s **own** `hash` field (on its content-less fallback record) has **no effect on
  anything** — it's never read for cache invalidation at all, since `welcome` never reaches the
  `#compile()` step itself (a content-less record's `hbs` branch is skipped entirely; only
  `generic`'s `hbs`/`hash` ever get compiled). There's nothing to keep in sync between the two —
  only `generic`'s own `hash` needs to change when `generic`'s own `hbs` does.
- The one exception: once a fallback record is **promoted** (see above) and owns real `hbs` of its
  own, its _own_ `hash` starts mattering the normal way, exactly like any other code-backed or
  database-only template.

## Adding a derived template

> Maintainers only — see
> [Templates' "Adding a custom template", part A](./templates.md#a-a-base-template-owns-its-own-hbs)
> for adding a _base_ template (one that owns its own `.hbs`) instead.

A derived template has no `.hbs`/`schema.ts`/`styles.css` of its own — it transforms its own input
into an existing template's data shape and renders through that one (see
[How it works](#how-it-works) above for the runtime mechanics). To add one:

1. Write a standalone transform function — `(data: YourSchema, t: Translator) => ParentSchema`,
   taking its words from `t` (keys in `LIBRARY_MESSAGES`, `library-messages.ts`) — in the relevant
   `transactional/*` file, and a thin wrapper calling
   `execTemplate('{channel}/{parent}',
   yourTransform(data))` through it (mirrors `sms.ts`'s
   `otpToGeneric`/`otp`, or `email/auth.ts`'s `welcomeToGeneric`/`welcome`). Keep the transform
   **exported and standalone**, not inlined into the wrapper — the next step needs to reference it
   independently of rendering.
2. Add it to that channel's registry object, same as
   [Templates' "Adding a custom template", part A, step 3](./templates.md#a-a-base-template-owns-its-own-hbs).
3. Add one `{ channel, name, parent, transform, starter }` entry to **that same file's own exported
   `derivedTemplates` array** (see `typings/templates.ts`'s `DerivedTemplateDeclaration`) — this is
   the _only_ registration step; `db/manifest.ts`'s `DERIVED_TEMPLATES` (which
   `LocalTemplateBackend`'s seeding reads) and `provider.ts`'s transform lookup (which `resolve()`'s
   chain walk reads) both aggregate from every `transactional/*` module's `derivedTemplates` array
   automatically — nothing to touch in either of those two files.

   `starter` is optional but expected: list the parent's variables the transform assigns (see
   [Starter bodies](#starter-bodies)) and add the template to the equivalence test.

Skipping step 3 means the database path never learns this template exists at all — a plain code-only
wrapper, `parent` chain and all. There's no "half-registered" state possible: `parent` and
`transform` are declared together in the same array entry, so it's not possible to wire one without
the other.

**The same `name` can be registered independently in more than one channel** — e.g. email's
`new-login` (`transactional/email/auth.ts`'s `derivedTemplates`) and SMS's `new-login`
(`transactional/sms.ts`'s `derivedTemplates`) are two entirely separate declarations, each with its
own transform and its own `parent` (`email/generic` and `sms/generic` respectively). Nothing links
them beyond sharing a string — `{channel, name}` is always the real compound key, so there's no
cross-channel registration step to remember and no risk of one channel's entry colliding with the
other's.
