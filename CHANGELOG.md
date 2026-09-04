# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-04

### Added

- **`ZanixTemplateAttrs.styles` / `SyncCodeTemplateEntry.styles`**: `{ css, classDefaults }` — a
  `source: 'code'` template's compiled CSS and default style-class names (`schema.ts`'s own
  `defaultStyles`), kept in sync alongside `availableVariables` on every code→database sync (local
  Modes A/B, and Mode C via `/.well-known/zanix/code-templates`). Lets external tooling (e.g. a live
  preview) reproduce the same styling `compiler.ts`/`provider.ts#renderCodeBacked` already inject
  automatically at render time, instead of guessing. Absent for a `source: 'database'` record —
  there's no compiled CSS/schema behind a hand-created one to expose. See `docs/templates.md`'s
  "`availableVariables` and `styles`" section.

### Fixed

- **`availableVariables` is now actually populated for every `source: 'code'` template.** The field
  existed on `ZanixTemplateAttrs`/`CreateTemplateRTO`/`UpdateTemplateRTO` and was accepted as manual
  input, but no write path ever set it for a code-seeded template — it came back `undefined` for
  every code template in every consumer service (seeded or resynced through
  `LocalTemplateBackend#sync()` or `TemplatesAdminRepository.syncCodeTemplates`), unless an admin
  typed it in by hand into a `source: 'database'` record. Now derived automatically at build time
  (`deno task build-handlebars`) from the template's own `.hbs` — an AST walk collecting every
  root-context variable it references, excluding `styles.*` — and kept in sync on every
  code→database sync, the same way `styles` (above) is.

## [1.1.0] - 2026-09-01

### Added

- **`TEMPLATES_SERVICE_PATH_PREFIX` env var / `RemoteTemplateBackendConfig.pathPrefix`**: overrides
  the route prefix Mode C's `RemoteTemplateBackend` calls at `TEMPLATES_SERVICE_URL`. Defaults to
  `'admin/templates'`, matching a plain `@zanix/core`-based service's own local admin API — but
  `TEMPLATES_SERVICE_URL` can also point at a `ZanixAdminHub` instance, which mounts the equivalent
  CRUD/`sync` routes at a bare `'templates'` prefix instead (no `admin/` segment). Pointing Mode C
  at a hub without this override produces a silent 404 on every `resolve()` call, indistinguishable
  from a missing template rather than surfaced as a misconfiguration. Purely additive — the default
  preserves the existing hardcoded behavior for every current Mode C deployment.

## [1.0.0] - 2026-08-31

### Added

- **New `@zanix/notifications/templates-api/rtos` subpath**: `CreateTemplateRTO`,
  `TemplateParamsRTO`, `UpdateTemplateRTO` — the pure validation-only layer of the local templates
  API's RTOs, with no data-access dependency at all, for a consumer that only needs these wire
  shapes without also resolving `TemplatesAdminRepository`/`TemplatesAdminService` (the root
  `./templates-api` subpath re-exports both from the same file). Every symbol is also still exported
  from `./templates-api` — purely additive, not a replacement.

### Changed

- `@zanix/auth` floor raised to `^1.0.0` (from `^0.8.1`) and `@zanix/database`
  (`@zanix/datamaster`'s `/database` subpath) floor raised to `^1.9.0` (from `^1.8.0`), matching the
  `./src/@tests/` scope's own `@zanix/datamaster/core` override.

## [0.7.0] - 2026-08-26

### Added

- **`@zanix/notifications/templates-api` now also exports `TemplatesAdminRepository`,
  `TemplatesAdminService`, `toSyncCodeTemplateEntries`, `SyncCodeTemplateEntry`, and
  `SyncCodeTemplatesResult`** — previously only available from the root `@zanix/notifications`
  barrel, which also bundles unrelated connectors/providers. A consumer that composes its own
  extension on this local API (e.g. a cross-service sync endpoint calling
  `TemplatesAdminRepository.syncCodeTemplates` directly) can now reach the CRUD data-access layer
  without resolving anything outside `/templates-api`'s own reachable graph — this subpath already
  imports `TemplatesAdminService` internally to build its own controller, so the new exports add
  nothing to what it already resolves.
- **`@zanix/notifications/templates-types` now also exports `Notifiers`** — a plain string-union
  type with no imports of its own, matching every other type this subpath already re-exports.

## [0.6.0] - 2026-08-26

### Added

- **New `@zanix/notifications/connectors` subpath**: `SmtpClient`, `SmsClient`, `WhatsappClient`,
  `ZanixNotifierConnector`, every built-in provider adapter (`TwilioSmsAdapter`, `VonageSmsAdapter`,
  `MetaCloudWhatsappAdapter`, `TwilioWhatsappAdapter`), and the connector-level types
  (`NotifyMessage`, `Notifiers`, `SmsClientConfig`, `WhatsappClientConfig`, etc.) — everything a
  consumer needs to send a plain `{ content }` message through a connector directly, without
  `NotifierProvider`'s template-based dispatch. Every symbol is also still exported from the root
  `@zanix/notifications` barrel — this is purely an additive, narrower alternative, not a
  replacement.
- **New `@zanix/notifications/templates-env` subpath**: `TEMPLATES_BACKEND_ENV`,
  `TEMPLATES_MODEL_ENV`, `TEMPLATES_SERVICE_URL_ENV`, `TEMPLATES_SERVICE_ID_ENV`,
  `TEMPLATES_SERVICE_TOKEN_ENV`, `TEMPLATES_SERVICE_AUTH_ID_ENV`, `TEMPLATES_SERVICE_CACHE_TTL_ENV`,
  `templatesBackendMode`, `isTemplatesResourceEnabled`, `templatesModelName`,
  `assertTemplatesBackendConfigValid`, and `TemplatesBackendMode`/`DEFAULT_TEMPLATES_MODEL_NAME` —
  everything `modules/templates/env.ts` exports, for a consumer that only needs to know which
  templates backend mode is selected (e.g. gating whether to expose a `/templates` resource at all),
  without `TemplateProvider` and, through it, every channel's compiled Handlebars template registry
  and each one's own Zod schema. The root `.`, `./core`, and `./templates-api` entrypoints all reach
  `TemplateProvider` today, so none of them let a consumer get `isTemplatesResourceEnabled()` alone.
  Every symbol here is also still exported from the root `@zanix/notifications` barrel (via
  `templates/provider.ts`'s existing re-export of `templates/env.ts`) — purely additive, not a
  replacement.
- **New `@zanix/notifications/connectors-env` subpath**: everything `email/defs.ts`, `sms/defs.ts`,
  and `whatsapp/defs.ts` export — `SMTP_HOST_ENV`/`SMTP_PORT_ENV`/`SMTP_USER_ENV`/
  `SMTP_PASSWORD_ENV`, `TWILIO_*_ENV`/`VONAGE_*_ENV`/`SMS_PROVIDER_ENV`/`resolveSmsProvider`/
  `SmsProvider`, `META_*_ENV`/`TWILIO_WHATSAPP_FROM_ENV`/`WHATSAPP_PROVIDER_ENV`/
  `resolveWhatsappProvider`/`WhatsappProvider`, and each channel's `register*Connector` — for a
  consumer that only needs to inspect or trigger the built-in SMTP/SMS/WhatsApp provider
  auto-registration, without `TemplateProvider`/Handlebars. `sms/defs.ts` and `whatsapp/defs.ts`
  were already isolated in their own lightweight files for this exact reason, but the only subpath
  that previously reached them — `./core` — also unconditionally re-exports `templates/core.ts`,
  which registers `TemplateProvider`. Every symbol here is also still exported from `./core` and the
  root `@zanix/notifications` barrel — purely additive, not a replacement.
- **New `@zanix/notifications/templates-types` subpath**: the pure data-shape types behind this
  package's own persisted templates collection — `ZanixTemplateAttrs`, `CreateTemplateInput`,
  `UpdateTemplateInput`, `TemplateSource`, `SyncCodeTemplateEntry`, `SyncCodeTemplatesResult`
  (`typings/templates-db.ts`), and `TemplatesControllerOptions` (`typings/templates-api.ts`,
  extracted from `templates-api/templates.handler.ts` — see below) — without
  `TemplatesAdminService`/`TemplatesAdminRepository`/`createTemplatesController` or anything else
  that actually touches Handlebars/Mongo. Useful for a caller (an admin UI, a remote sync client)
  that only needs to type a template payload it reads or writes. Every symbol here is also still
  exported from the root `@zanix/notifications` barrel (the six `templates-db.ts` types) or
  `./templates-api` (`TemplatesControllerOptions`) — purely additive, not a replacement.

### Changed

- `templates.repository.ts`'s `SyncCodeTemplateEntry`/`SyncCodeTemplatesResult` interfaces now live
  in `typings/templates-db.ts`, alongside `ZanixTemplateAttrs`/`CreateTemplateInput`/
  `UpdateTemplateInput` (the other pure data shapes this repository's own methods accept/return) —
  `templates.repository.ts` re-exports them unchanged, so no import path (internal or via the root
  barrel) breaks. Enables the new `./templates-types` subpath above.
- `templates-api/templates.handler.ts`'s `TemplatesControllerOptions` interface now lives in
  `typings/templates-api.ts` — it only ever referenced `@zanix/server`'s own `MiddlewareGuard`/
  `VersionProtocolOption` types, with no dependency of its own on `TemplatesAdminService` or
  Handlebars. `templates.handler.ts` re-exports it unchanged, so no import path (internal or via
  `./templates-api`) breaks. Enables the new `./templates-types` subpath above.

### Fixed

- **A plain connector-only consumer (`SmtpClient`/`SmsClient`/`WhatsappClient`, no template
  rendering) used to materialize `handlebars`/`zod` regardless**, even via the new
  `@zanix/notifications/connectors` subpath, because `typings/general.ts` defined `NotifyMessage` in
  the same file as `DefaultTemplates = keyof typeof emailTemplates`-style types — resolving either
  type forced Deno to resolve the whole file's module graph, including a `typeof` reference into the
  compiled template registries, which reach `execTemplate`'s Handlebars compiler and each template's
  own Zod schema. Those types now live in `typings/template-registry.ts` instead;
  `typings/general.ts` stays free of any reference to the template registries. Confirmed via
  `deno info --json`: `modules/connectors.ts` (and each channel's own `connector.ts`) no longer
  resolves `npm:handlebars`/`npm:zod`, while the root `.`/`./core`/`./templates-api` entrypoints are
  unaffected (they still need the full template system).
- `modules/templates/provider.ts`'s `TEMPLATES_BACKEND`/`TEMPLATES_MODEL_NAME`/
  `TEMPLATES_SERVICE_*` env var selection and validation now live in their own file
  (`modules/templates/env.ts`), mirroring `sms/defs.ts`'s/`whatsapp/defs.ts`'s own provider-selector
  isolation — `provider.ts` re-exports them unchanged, so no import path (internal or via the root
  barrel) breaks.
- Bumped `@zanix/server` to `^4.0.0` and `@zanix/datamaster` to `^1.7.0`. The prior pairing
  (`@zanix/server@^3.3.0` with `@zanix/datamaster@^1.0.0`) could not move to `@zanix/server@^4.0.0`
  alone: `@zanix/datamaster@^1.0.0` was itself built against `@zanix/server@3.*`, so its own
  `ZanixMongoConnector` extended a different module instance of `ZanixDatabaseConnector` than the
  one `@zanix/server@^4.0.0` exports, a `#private`-field class-identity mismatch `deno check`
  reported as a real type error. `@zanix/datamaster@1.7.0` now depends on `@zanix/server@^4.0.0`
  itself, so both packages resolve the same `ZanixDatabaseConnector`. Verified via
  `deno check --min-dep-age 0` on every entrypoint, `deno lint`, `deno fmt --check`, and the full
  test suite.

## [0.5.0] - 2026-08-23

### Fixed

- **Email's `content`/`footer` (`GenericTemplateSchema`) are now run through a denylist HTML
  sanitizer before they reach the rendered email; `buttonLink` gets an equivalent URL-scheme
  check.** Both `content` and `footer` are rendered unescaped in the Handlebars template
  (`{{{content}}}`/`{{{footer}}}`) by design — a caller may supply real rich-HTML formatting, and
  every built-in template's own default content already is one — but that same field is just as
  reachable by a calling app that naively forwards user-influenced text (a comment, a support-ticket
  body) into it. `sanitizeHtml` (`utils/sanitize-html.ts`) now strips
  `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` elements, every `on*` event-handler
  attribute, and a `javascript:`/`vbscript:`/non-image `data:` URI in an
  `href`/`src`/`action`/`formaction` attribute, applied via the schema's own `.transform()` —
  ordinary formatting markup passes through untouched. `buttonLink` is a URL, not HTML, so it goes
  through `sanitizeUrl`'s scheme check instead — not the HTML denylist above — even though
  Handlebars already HTML-escapes it, since escaping alone doesn't stop a `javascript:`/`vbscript:`
  link from running when clicked. SMS/WhatsApp's `content` is unaffected — it's plain text with no
  HTML involved.
- `deno lint`'s own `@zanix/utils` plugin (`deno-zanix-plugin`) is now version-pinned (`^2.6.1`),
  matching every other `@zanix/utils` import in `deno.jsonc` — it used to resolve unpinned, so a
  lint run could silently pick up a newer, unreviewed plugin version.
- **`SmtpClient` rejects a `subject`/`to`/`from`/`date` that contains a carriage return or line feed
  instead of sending it.** Each SMTP header is written as its own raw line terminated by `\r\n`
  (`SmtpConnection.sendCommand`, `pool.ts`) — an unfiltered `\r`/`\n` in one of those fields let it
  inject arbitrary extra header lines (a silent `Bcc`, a spoofed `From`) into the message. The check
  (`@zanix/helpers`'s `assertNoCrlf`) runs before any SMTP command for the message is sent, so a
  rejected value never reaches the connection at all.

### Changed

- **The `subject`/`to`/`from`/`date` CRLF check and the `buttonLink`/attribute URL-scheme check now
  delegate to `@zanix/helpers`'s `assertNoCrlf`/`sanitizeUrl`** instead of this package's own local
  copies — both had turned up independently re-implemented in another package with the identical
  guarantee, and consolidating means one fix covers every consumer instead of drifting per copy. No
  behavior change for `assertNoCrlf`'s callers or for `sanitizeHtml`'s attribute-stripping;
  `sanitizeHtml`'s own standalone `sanitizeUrl` export is removed (it was never part of this
  package's `mod.ts`).
- **BREAKING: `TEMPLATES_BACKEND` (`'local'` | `'remote'`) replaces the mode-inference design for
  choosing between Modes A/B (local database) and Mode C (remote service).** Previously, the active
  mode was inferred post-hoc from which of `TEMPLATES_MODEL_NAME`/`DATABASE_TEMPLATES`/
  `TEMPLATES_SERVICE_URL` happened to be set, with `assertTemplatesConfigNotConflicting()` throwing
  if an invalid combination was detected only once both were present. `TEMPLATES_BACKEND` is now the
  single, explicit selector — the invalid "both set" state can no longer be represented at all: each
  mode's own vars (`TEMPLATES_MODEL_NAME` for `'local'`; `TEMPLATES_SERVICE_URL`/`_ID`/`_TOKEN`/
  `_AUTH_ID`/`_CACHE_TTL_MS` for `'remote'`) are only ever read once that mode is actually selected.
  **No dual-read, no deprecation warning — a hard rename.** Concretely:
  - `DATABASE_TEMPLATES` is removed entirely. Its `=true` convenience-default role is superseded by
    `TEMPLATES_BACKEND=local` itself (`TEMPLATES_MODEL_NAME` was always optional, defaulting to
    `zanix-templates`); its `=false` kill-switch role is superseded by simply not setting
    `TEMPLATES_BACKEND` to `'local'` — an explicit selector needs no separate override to say "not
    this mode." `templates/core.ts`'s `defaultTemplatesModelName()` (the function that implemented
    the old convenience toggle) is removed along with it.
  - Setting `TEMPLATES_MODEL_NAME` without also setting `TEMPLATES_BACKEND=local` (or
    `TEMPLATES_SERVICE_URL` without `TEMPLATES_BACKEND=remote`) now has no effect at all — it's
    simply never read, not a boot-time error.
  - `assertTemplatesConfigNotConflicting()` is renamed `assertTemplatesBackendConfigValid()`, and
    now validates the config required by whichever mode `TEMPLATES_BACKEND` selects, rather than
    detecting a conflict between two inferred modes. `templatesBackendMode()` is the new exported
    reader/validator for `TEMPLATES_BACKEND` itself.
  - Migration: set `TEMPLATES_BACKEND=local` alongside any existing `TEMPLATES_MODEL_NAME`
    configuration, or `TEMPLATES_BACKEND=remote` alongside any existing `TEMPLATES_SERVICE_URL`
    configuration, and remove any `DATABASE_TEMPLATES` setting. See
    [Templates](./docs/templates.md#database-backed-templates) and
    [Environment Variables](./docs/environment-variables.md#database-backed-templates).
- **BREAKING: `RemoteTemplateBackendConfig.auth` (a `ServiceAuthClientOptions` object) is replaced
  by `authClient` (a pre-built `ServiceAuthClient` function).** Previously this module built its own
  `@zanix/auth` `createServiceAuthClient` instance internally from the `auth` options passed in; now
  the caller injects an already-built client. This moves this package's only
  `notifications ->
  auth` dependency out of `remote-backend.ts` and into the new, isolated
  `remote-backend-auth.ts` (`createRemoteTemplateAuthClient`, wired in by
  `TemplateProvider.#backend()` for Mode C's own env-var-driven path), so `remote-backend.ts` itself
  no longer needs to depend on `@zanix/auth` at all. No behavior change for the default
  env-var-driven path (`TEMPLATES_SERVICE_AUTH_ID`, etc.) — only a direct, manual
  `RemoteTemplateBackendConfig` construction is affected. Migration: replace
  `{ auth: { serviceId, exchangeUrl, ... } }` with
  `{ authClient: createRemoteTemplateAuthClient({ serviceId, exchangeUrl, ... }) }` (new export from
  `templates/db/remote-backend-auth.ts`).
- `realHttpStatus()` (`remote-backend.ts`) now reads the real upstream status off `@zanix/server`'s
  new `RestClientError.realHttpStatus` getter instead of parsing it out of an error message string —
  more robust, and no functional change to callers. **Requires `@zanix/server@3.3.0` or later**
  (bumped from the `^3.2.0` floor `useWorker: 'persisted'` already required).

### Removed

- `DATABASE_TEMPLATES_ENV`, `isDatabaseTemplatesDisabled`, `assertTemplatesConfigNotConflicting`,
  and `templates/core.ts`'s `defaultTemplatesModelName` — see the `TEMPLATES_BACKEND` entry above.

### Added

- **`TEMPLATES_BACKEND_ENV`, `templatesBackendMode()`, `TemplatesBackendMode`,
  `assertTemplatesBackendConfigValid()`** — see the `TEMPLATES_BACKEND` BREAKING entry above.
- **`VonageSmsAdapter`** (`modules/sms/vonage.ts`) — a second built-in `SmsProviderAdapter`,
  alongside the existing default `TwilioSmsAdapter`, for Vonage's classic SMS API
  (`POST /sms/json`). `sms/defs.ts`'s `registerSmsConnector` now also registers `SmsClient` from
  `VONAGE_API_KEY`/`VONAGE_API_SECRET`/`VONAGE_FROM` when Twilio's own `TWILIO_*` variables aren't
  set, mirroring the existing Meta/Twilio precedent already used for `WhatsappClient` — see the
  `SMS_PROVIDER`/`WHATSAPP_PROVIDER` BREAKING entry below for what happens when both are set at once
  (no longer a silent Twilio/Meta win). Unlike Twilio, Vonage's API always responds `HTTP 200` —
  even for a rejected send — so `VonageSmsAdapter` inspects the JSON response body's
  `messages[].status` field itself and throws `HttpError` on a non-zero status.
- **BREAKING: `SMS_PROVIDER` (`'twilio'` | `'vonage'`) and `WHATSAPP_PROVIDER` (`'meta'` |
  `'twilio'`) now disambiguate `registerSmsConnector()`/`registerWhatsappConnector()` when BOTH
  built-in providers' own env vars are set at once.** Previously, `sms/defs.ts`/`whatsapp/defs.ts`
  picked by checking Twilio/Meta first and silently ignoring the other provider's vars if both
  happened to be set — no error, not even a log line, just whichever was checked first winning. With
  exactly one provider's own vars set (the overwhelmingly common case), auto-detection is
  **unchanged** — zero extra config, exactly as before. Only the ambiguous "both configured" case
  changes: it now throws `InternalError` demanding `SMS_PROVIDER`/`WHATSAPP_PROVIDER` be set
  explicitly, rather than resolving silently. Setting either selector is also honored as an explicit
  override even without a conflict. **No dual-read, no deprecation warning — a hard cutover for the
  conflict case only.** Concretely:
  - `resolveSmsProvider()`/`resolveWhatsappProvider()` are the new exported readers — `undefined`
    when nothing's configured, the auto-detected provider when exactly one is, the explicit
    selector's value when set, and a thrown `InternalError` for an invalid selector value OR an
    unresolved conflict.
  - `assertSmsProviderConfigValid()`/`assertWhatsappProviderConfigValid()` validate that an
    explicitly-selected provider's own required vars are actually present, throwing otherwise — an
    explicit selection with nothing configured to back it fails loudly rather than registering a
    connector with `undefined` credentials.
  - Every touched env var now has an exported `_ENV` name constant (`TWILIO_ACCOUNT_SID_ENV`,
    `VONAGE_API_KEY_ENV`, `META_PHONE_NUMBER_ID_ENV`, `TWILIO_WHATSAPP_FROM_ENV`, etc., plus
    `SMS_PROVIDER_ENV`/`WHATSAPP_PROVIDER_ENV` themselves) — a pattern `templates/provider.ts`
    already had and these two modules didn't. `whatsapp/defs.ts`'s own `TWILIO_ACCOUNT_SID_ENV`/
    `TWILIO_AUTH_TOKEN_ENV`/`TWILIO_API_BASE_ENV` are deliberately NOT exported (a local, unexported
    duplicate of `sms/defs.ts`'s own identically-named, identically-valued constants) — both being
    exported would make `modules/core.ts`'s `export * from './sms/defs.ts'` /
    `export * from
    './whatsapp/defs.ts'` an ambiguous re-export; `sms/defs.ts` is the one
    canonical public export for those three shared names.
  - Migration: only services with BOTH Twilio's and Vonage's SMS vars set at once, or BOTH Meta's
    and Twilio's WhatsApp vars set at once, are affected — set `SMS_PROVIDER`/`WHATSAPP_PROVIDER`
    explicitly to restore a working registration. See
    [Connectors](./docs/connectors.md#smsclient-sms) and
    [Environment Variables](./docs/environment-variables.md#sms).

### Added

- **Every conditional `@Connector`/`@Provider` DSL registration function is now exported, not just
  auto-run as a private module-level side effect**: `registerSmsConnector` (`sms/defs.ts`),
  `registerSmtpConnector` (`email/defs.ts`), `registerWhatsappConnector` (`whatsapp/defs.ts`),
  `registerNotifierProvider` (`providers/core.ts`), and `registerMailTriggerJob`
  (`providers/trigger-mail.core.ts`) — all reachable via `@zanix/notifications/core`. Each still
  runs automatically once, at import time, exactly as before; the new export lets a caller
  re-register after clearing the relevant registry (`closeAllConnections()`/
  `ProgramModule.targets.resetContainer(['type:connector'])`, both `@zanix/server`) without needing
  a fresh module evaluation — for a config-reload in a long-running process, or a test simulating a
  different env state between cases. Same pattern adopted across `@zanix/datamaster`, `@zanix/auth`,
  `@zanix/asyncmq`, and `@zanix/app` in the same batch of work. `templates/core.ts` is deliberately
  NOT part of this batch — its own registration isn't a simple conditional `@Connector`/`@Provider`
  DSL call, but a larger boot sequence (signal-listener setup, conditional model registration) that
  needs its own dedicated design, not a mechanical export.

### Added

- **New public subpath `@zanix/notifications/templates-api`** — `createTemplatesController`, the
  CRUD half (`list`/`get`/`create`/`update`/`remove`) of the local `/templates` controller. This
  package owns both the data (`TemplatesAdminRepository`/`Service`) and the CRUD HTTP surface
  fronting it, per the "local API vs aggregator API" rule (see the `zanix-libraries-architecture`
  skill). The cross-service `sync` route (`POST /templates/sync`) is `@zanix/admin`'s own concern,
  as a separate `TemplatesSyncController` mounted under the same prefix — it needs
  `ServiceRegistry`/Discovery, a concept this package deliberately doesn't know about.
  - The controller never assumes an auth mechanism itself — `guards`/`versionProtocol` are accepted
    as factory options, supplied by whoever composes it (e.g. `@zanix/admin`).
  - New dependency: `@zanix/validator` (already published as part of `@zanix/utils`), needed to
    author this package's own RTOs directly now instead of receiving pre-validated input.
  - New `src/@tests/unit/templates/dependency-boundary.test.ts` — enforces, via a real
    `deno info
    --json` module-graph check, that `templates/db/*.ts` never imports back into
    `templates-api/`, the same pattern `@zanix/space`'s `assets-api`/`asset-transform` boundary test
    already establishes.
- **New `data-table` email template** (`transactionalTemplates['data-table']`) — a generic
  itemized-table document (invoice, receipt, order summary) alongside the existing `welcome`/
  `generic`/`password-changed`/`password-recovery`/`login-otp`/`new-login` set. Its `senderLogo`
  field goes through the same `sanitizeUrl` scheme check as `generic`'s `buttonLink`; its column/row
  headings (`Description`/`Qty`/`Unit price`/`Amount`/`Subtotal`/... — fully labels-overridable for
  i18n) render through the standard HTML denylist sanitizer like every other rich-content field. See
  [Templates](./docs/templates.md#built-in-templates).

## [0.4.0] - 2026-08-17

### Added

- `useWorker: 'persisted'` support: `NotifierProvider`'s background-worker dispatch (queued via
  `sendMessage()`/`sendTemplate()`'s `useWorker` option, flushed by `onDestroy()`) can now reuse the
  app's pooled `'worker'` core provider instead of always spinning up a fresh one-time worker per
  flush — via `@zanix/server`'s new `dispatchWorkerTask` helper, falling back to `'one-time'`
  automatically outside a booted Zanix Core application. When a batch mixes both modes across
  several queued messages, `'persisted'` wins for the whole flush if any one of them asked for it.
  See
  [Notifier Provider: Queuing with a background worker](docs/notifier-provider.md#queuing-with-a-background-worker).

### Changed

- **Breaking**: renamed `sendMessage()`/`sendTemplate()`/`.email()`/`.sms()`/`.whatsapp()`'s
  `useOneTimeWorker` option to `useWorker`, and its `WithWorker` type changed shape from
  `boolean | { callback, timeout? }` to `'one-time' | 'persisted' | { mode, callback?, timeout? }` —
  update `useOneTimeWorker: true` to `useWorker: 'one-time'`, and `useOneTimeWorker: { callback }`
  to `useWorker: { mode: 'one-time', callback }`.
- Requires `@zanix/server@3.2.0` or later, for `dispatchWorkerTask`.

### Fixed

- **`assertTemplatesConfigNotConflicting()` now also rejects `DATABASE_TEMPLATES=true` set alongside
  `TEMPLATES_SERVICE_URL`** — previously only `TEMPLATES_MODEL_NAME` set directly together with
  `TEMPLATES_SERVICE_URL` threw a clear error; the equivalent conflict via the `DATABASE_TEMPLATES`
  convenience toggle was a silent no-op instead (no error, no warning —
  `defaultTemplatesModelName()` just skipped setting `TEMPLATES_MODEL_NAME`, leaving database-backed
  templates quietly disabled). Real bug, found via a real deployment where two processes read the
  same `.env` file with opposite needs for these variables (one is a Mode C consumer, the other is
  the central service that itself needs `DATABASE_TEMPLATES=true`) — the silent-no-op side made the
  failure look unrelated to config at all. Both spellings of the conflict now throw the same,
  immediately, at boot.

- `sendBackgroundMessage` (the function `useWorker` dispatches to) now constructs its internal
  `NotifierProvider` with a fresh, random `contextId` instead of none. A `SCOPED` connector (e.g.
  `SmtpClient`) is cached by the DI container under its resolving instance's `contextId`, and an
  omitted one resolves to the same fixed bucket every call. `useWorker: 'one-time'` never surfaced
  this — a fresh worker per flush means a fresh module graph, so that bucket started empty
  regardless — but `useWorker: 'persisted'` reuses the same worker (and its DI container) across
  many flushes: a second flush resolved the _first_ flush's already-`close()`d connector instead of
  a fresh one, surfacing as e.g. `SmtpClient`'s "Connection not ready!" on the second email sent
  through a `'persisted'` worker, even though the first one succeeded.

## [0.3.0] - 2026-08-03

### Added

- **`RemoteTemplateBackend` (Mode C) now supports dynamic sign+exchange auth**, an alternative to
  the existing static `TEMPLATES_SERVICE_TOKEN` for a central service that's itself Zanix-based:
  `TEMPLATES_SERVICE_AUTH_ID` (this service's own signing identity) signs a short-lived assertion
  and exchanges it for a real access token automatically, via `@zanix/auth`'s new
  `createServiceAuthClient` — the same primitive `ZanixAdminHub.start({ auth })` uses. No static
  token to generate/rotate by hand, and no separate private-key or "which key" env vars either: both
  resolve automatically as `JWK_PRI_<TEMPLATES_SERVICE_AUTH_ID>[_<keyId>]` and
  `JWK_ID_<TEMPLATES_SERVICE_AUTH_ID>`, via `@zanix/auth`'s new
  `resolveServiceAssertionPrivateKey`/`resolveServiceAssertionKeyId` — the exact mirror image of the
  `JWK_PUB_<serviceId>`/`JWK_PUB_<serviceId>_<keyId>` convention already used on the verifying side,
  so this package doesn't invent its own env var naming on top of it (no
  `TEMPLATES_SERVICE_AUTH_KEY_ID` needed either — rotation is `JWK_ID_<TEMPLATES_SERVICE_AUTH_ID>`).
  `TEMPLATES_SERVICE_TOKEN` still works exactly as before and **takes priority when set** — the only
  option that works against a central service outside the Zanix ecosystem, since it doesn't require
  exposing `/admin/service-token`. New `@zanix/auth` dependency (previously this package depended
  only on `@zanix/server`/`@zanix/datamaster`) — see `docs/templates.md`'s Mode C section.

### Fixed

- `RemoteTemplateBackend` no longer sends a malformed `X-Znx-Authorization: Bearer` (empty) header
  when neither `TEMPLATES_SERVICE_TOKEN` nor the new auth option is configured — no header is sent
  at all in that case, rather than one a receiving guard would reject anyway, just with a more
  confusing "token missing" error pointing at the wrong header.
- `TemplatesAdminRepository.syncCodeTemplates()` — the method backing a Mode-C central sync (via
  `/.well-known/zanix/code-templates`) — now also seeds any missing `DERIVED_TEMPLATES` fallback
  stub (`welcome`, `password-changed`, `password-recovery`, `login-otp`, ...), not just the base
  templates that own a real `.hbs` file. Previously, a service syncing from a `code-templates`-only
  source ended up with only the base catalog in its own database — every derived template was
  silently missing, since `/.well-known/zanix/code-templates` never carried them (they have no
  `.hbs` of their own to publish) and the sync had no other way to learn about them. Fixed by
  extracting the same seeding logic `LocalTemplateBackend` already used for its own same-process
  sync into a shared `seedMissingDerivedTemplates()` — `DERIVED_TEMPLATES` is a fixed catalog this
  package alone declares, so the syncing service already knows it locally regardless of what the
  remote source's Discovery payload did or didn't include.

## [0.2.3] - 2026-07-28

### Added

- **Mode C: remote-only templates** — `RemoteTemplateBackend`, for a service with no local database
  access to templates at all. Set `TEMPLATES_SERVICE_URL` (the central Notification/ Template
  Service's own internal admin base URL) instead of `TEMPLATES_MODEL_NAME`, and
  `TemplateProvider.resolve()` calls that service's `GET /admin/templates/:channel/:name` instead of
  a local Mongo lookup — everything else (code-fallback on any failure, `404` treated as "no such
  template", etc.) behaves identically to Modes A/B. `TEMPLATES_SERVICE_TOKEN` sends a pre-issued
  `type: 'api'` machine credential (`@zanix/auth`'s `X-Znx-Authorization` contract) on every call;
  `TEMPLATES_SERVICE_CACHE_TTL_MS` overrides the default 45-second local fetch-cache TTL.
  `TEMPLATES_SERVICE_URL` and `TEMPLATES_MODEL_NAME` are mutually exclusive — setting both throws
  immediately via the new `assertTemplatesConfigNotConflicting()`, both at boot and on every
  `resolve()` call, rather than silently picking one. Composes automatically with `@zanix/server`'s
  `RestClient` conditional-`GET` (`ETag`/`If-None-Match`) support once the central service starts
  returning `ETag`. New exports: `RemoteTemplateBackend`, `RemoteTemplateBackendConfig`,
  `TemplateBackend`, `TEMPLATES_SERVICE_URL_ENV`, `TEMPLATES_SERVICE_TOKEN_ENV`,
  `TEMPLATES_SERVICE_CACHE_TTL_ENV`, `DEFAULT_TEMPLATES_MODEL_NAME`, `templatesModelName`. See
  [Templates](./docs/templates.md#mode-c-remote-only-templates).
- Internally, database-backed templates (Modes A/B) were refactored behind the same
  `TemplateBackend` interface as the new `RemoteTemplateBackend` (now `LocalTemplateBackend`) — no
  behavior change for existing `TEMPLATES_MODEL_NAME` configurations.
- `assertValidHandlebarsSyntax(hbs)` — validates that `hbs` is syntactically valid Handlebars,
  throwing otherwise. Exported so a consumer building its own admin-style API against this package's
  templates (e.g. `@zanix/admin`'s `TemplatesAdminRepository`) can reject a malformed `hbs` at
  create/update time, instead of only discovering it the first time `TemplateProvider.resolve()`
  tries to send it (and even then, only as a silently-downgraded fallback to the code registry, not
  a clear error). Note: `Handlebars.compile()` alone doesn't parse eagerly in this build — a syntax
  error only surfaces once the compiled template is actually invoked with data, so this calls it
  with `{}` to force that check now.
- `NOTIFIER_CHANNELS` — every `Notifiers` value as a runtime array, the single source of truth for
  validating/enumerating channels at runtime (e.g. a Mongoose schema `enum`, or `@zanix/validator`'s
  `@IsEnum`). Replaces a hand-copied `['email', 'sms', 'whatsapp']` literal previously duplicated in
  this package's own schema and in `@zanix/admin`'s templates RTOs.

### Changed

- `RemoteTemplateBackend` no longer hardcodes its own local copies of `X-Znx-Admin-Protocol` and
  `X-Znx-Authorization`. It now imports `ADMIN_PROTOCOL_HEADER` and `AUTH_HEADERS` from
  `@zanix/server`, matching the shared source used by `@zanix/core` and `@zanix/auth`. The admin
  protocol version (`'1'`) remains a local literal to avoid coupling `@zanix/server` to
  `@zanix/core` business constants. No behavior change.

### Internal

- Added a direct workspace reference to `@zanix/server` for local development.
- Added the `@zanix/errors` dependency.
- Regenerated the lockfile to reflect dependency updates.

## [0.2.2] - 2026-07-26

### Added

- `DATABASE_TEMPLATES=false` now acts as a kill switch, disabling database-backed templates entirely
  even when `TEMPLATES_MODEL_NAME` is explicitly set — previously it had no effect at all unless
  `TEMPLATES_MODEL_NAME` was already unset. Checked both at boot (`registerModel()`'s gate) and on
  every `resolve()` call. Matches `@zanix/datamaster`'s own `DATABASE_SEEDERS === 'false'`
  convention: a single environment-level override that wins over whatever an individual app
  configured. New export: `isDatabaseTemplatesDisabled()`.

## [0.2.1] - 2026-07-26

### Fixed

- Slow types on documentation.

## [0.2.0] - 2026-07-26

### Added

- SMS channel: `SmsClient` connector, built-in `TwilioSmsAdapter`, `SmsProviderAdapter` contract for
  custom providers, and `sms/generic`/`sms/otp` Handlebars templates.
- WhatsApp channel: `WhatsappClient` connector, `MetaCloudWhatsappAdapter` (default) and
  `TwilioWhatsappAdapter` (alternative, selected via `TWILIO_*`/`META_*` environment variables or
  explicit config), `WhatsappProviderAdapter` contract for custom providers, and
  `whatsapp/generic`/`whatsapp/otp` Handlebars templates.
- `NotifierProvider.sendTemplate()` — sends a native WhatsApp Business template message (Meta's
  `templateName`/`templateLanguage`, or Twilio's `contentSid`/`contentVariables`), with the same
  `useOneTimeWorker` queuing and error-wrapping behavior as `sendMessage()`.
- `NotifierProvider.email()`/`.sms()`/`.whatsapp()` convenience methods over the generic
  `sendMessage(notifier, message)`; `.whatsapp()` dispatches automatically between `sendMessage()`
  and `sendTemplate()` based on the message shape.
- `apiBase` config option (plus `TWILIO_API_BASE`/`META_API_BASE` environment variables) to override
  each built-in provider adapter's API base URL.
- `SMTP_POOL_SIZE` environment variable — optional shared SMTP connection pooling, avoiding a fresh
  handshake per request once enabled.
- `@zanix/notifications/core` now also registers `SmsClient`/`WhatsappClient` from their respective
  environment variables, alongside the existing `SmtpClient` registration.
- Database-backed templates, opt-in via the `TEMPLATES_MODEL_NAME` environment variable: code
  templates seed a `ZanixTemplate` collection on first use (through a registered `@zanix/datamaster`
  `ZanixMongoConnector`), after which a direct database edit takes effect on the very next send — a
  later code change never overwrites a manual edit, and a template removed from code is flipped to
  `source: 'database'` rather than deleted. The `ZanixTemplate` model is registered once at boot via
  `@zanix/datamaster`'s `registerModel()` DSL (the same pattern any other Zanix repository provider
  uses), so `TemplateProvider` only ever needs a plain, name-only `getModel(modelName)` lookup. See
  [Templates](./docs/templates.md#database-backed-templates), including the `name`/`hash` field
  distinction and multi-instance behavior. New exports: `TEMPLATES_MODEL_ENV`, `TemplateSource`,
  `ZanixTemplateAttrs`. Requires `@zanix/datamaster@0.6.0`+.
- `DATABASE_TEMPLATES` environment variable — set to `true` to enable database-backed templates
  under the default model name (`zanix-templates`) without naming it explicitly via
  `TEMPLATES_MODEL_NAME`. Always an explicit opt-in, in a full app or a standalone one. New export:
  `DATABASE_TEMPLATES_ENV`.
- `@zanix/datamaster` added as a real dependency (like `@zanix/server`, no longer avoided via
  structural duck-typing) — `TemplateProvider` is now typed directly against its
  `ZanixMongoConnector`/`AdaptedModel`, since the database-backed templates feature already required
  it in practice.

### Changed

- **Breaking**: Handlebars templates reorganized by channel — `handlebars/generic/` moved to
  `handlebars/email/generic/`, with new sibling `handlebars/sms/generic/` and
  `handlebars/whatsapp/generic/`. Direct callers of `execTemplate('generic', ...)` must update to
  `execTemplate('email/generic', ...)`.
- **Breaking**: message content shape flattened and renamed — `NotifyMessage.body` is now `content`,
  and the templated form went from a nested `{ body: { template, data } }` to top-level
  `zanixTemplate`/`data` fields, mirrored across all three channels
  (`NotifyMessageWithTemplate`/`SmsNotifyMessageWithTemplate`/`WhatsappNotifyMessageWithTemplate`).
  `SmsMessage.body` (the low-level adapter type) is also renamed to `content`, for consistency with
  `WhatsappMessage`.

### Fixed

- `SmtpConnectionPool.discard()` no longer leaves a queued caller stuck waiting forever when the
  connection it discarded wasn't idle and no other `release()` was coming — it now dials a
  replacement immediately for that waiter instead.
- `TemplateProvider.resolve()` no longer touches the database at all when `TEMPLATES_MODEL_NAME` is
  unset, and any failure on the database path (connector not configured, a sync error, an invalid
  record) now falls back to the code registry with a logged warning instead of crashing the send.

## [0.1.2] - 2025-12-21

### Changed

- `NotifierProvider.sendMessage()`'s `useWorker` option renamed to `useOneTimeWorker`, to better
  reflect that it spins up a temporary worker rather than a persistent one.
- Queued-message worker dispatch reverted to a fresh, self-terminating `WorkerManager` instance per
  flush (`autoClose: true`), rather than the shared `this.worker` accessor introduced in 0.1.1.

### Fixed

- `onDestroy()` no longer spawns a background worker at all when nothing was queued.

## [0.1.1] - 2025-12-21

### Changed

- Replaced the local `utils/encoders.ts` (`encoder`/`decoder`) with `@zanix/helpers`'s equivalents.
- Queued-message worker dispatch switched to `this.worker.executeGeneralTask(...)` instead of a
  directly-instantiated `WorkerManager` (superseded in 0.1.2).

## [0.1.0] - 2025-11-27

### Added

- Initial release: `NotifierProvider` and `SmtpClient` for sending email over SMTP.
- Handlebars-based email templates: `welcome`, `generic`, `password-changed`, `password-recovery`,
  `login-otp`.
- Optional one-time background worker for queued message delivery (`useWorker`, later renamed to
  `useOneTimeWorker` in 0.1.2).
- Zero-config `SmtpClient` registration from `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`.
