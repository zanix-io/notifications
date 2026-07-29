# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
