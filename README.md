# Zanix – Notifications

[![Version](https://img.shields.io/jsr/v/@zanix/notifications?color=blue\&label=jsr)](https://jsr.io/@zanix/notifications/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/notifications?color=blue\&label=git)](https://github.com/zanix-io/notifications/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

1. [Description](#-description)
2. [Features](#-features)
3. [Installation](#-installation)
4. [Basic Usage](#-basic-usage)
5. [Documentation](#-documentation)
6. [Environment Variables](#-environment-variables)
7. [Contributing](#-contributing)
8. [Changelog](#-changelog)
9. [License](#-license)
10. [Resources](#-resources)

---

## 🧩 Description

**Zanix Notifications** is a flexible and extensible notification system for sending transactional
messages over **email**, **SMS**, and **WhatsApp**, with pre-built **Handlebars-based templates**
for all three. Delivery for each channel is pluggable — built-in adapters cover SMTP (email), Twilio
(SMS/WhatsApp), and Meta's WhatsApp Cloud API, and any other provider can be plugged in without
touching application code. It also provides the option to **activate a background worker** for
queued, non-blocking message delivery.

> 💡 If you're building a full application (not just sending notifications standalone), use
> **[`@zanix/core`](https://jsr.io/@zanix/core)** as your entrypoint via
> `Zanix.start()`/`Zanix.startWorker()`, which wires this package's providers together with
> `@zanix/datamaster`, `@zanix/auth`, and `@zanix/asyncmq`.

It provides a unified and extensible system for:

- Sending notifications via email (SMTP), SMS (Twilio), and WhatsApp (Meta Cloud API or Twilio)
- Support for pre-defined templates (Handlebars-based), per channel
- Native WhatsApp Business template messages (Meta/Twilio), for starting conversations outside the
  24h session window
- Optional worker for background, queued processing
- Zero-config connector registration from environment variables
- Easy integration with your application

---

## ✨ Features

- **Multi-channel connectors**
  - `SmtpClient` — email over SMTP, with optional connection pooling (`SMTP_POOL_SIZE`).
  - `SmsClient` — SMS via the built-in `TwilioSmsAdapter`, or any custom `SmsProviderAdapter`.
  - `WhatsappClient` — WhatsApp via `MetaCloudWhatsappAdapter` (default) or `TwilioWhatsappAdapter`,
    or any custom `WhatsappProviderAdapter`.
  - All three extend the same `ZanixNotifierConnector` base and register with zero app-side setup
    when their environment variables are set and `@zanix/notifications/core` is imported.
  - See [Connectors](./docs/connectors.md).

- **`NotifierProvider`**
  - The core provider for sending messages through any channel — `.email()`, `.sms()`,
    `.whatsapp()`, or the generic `sendMessage(notifier, message)`.
  - A default instance is registered automatically under the `'notifications'` core-provider key
    (importing `@zanix/notifications/core` is enough) — `this.providers.get('notifications')` works
    with zero setup.
  - `sendTemplate()` sends a native WhatsApp Business template message (Meta or Twilio);
    `.whatsapp()` dispatches between it and `sendMessage()` automatically based on the message
    shape.
  - See [Notifier Provider](./docs/notifier-provider.md).

- **Message Queuing & Worker**
  - When using the worker (`useOneTimeWorker: { callback: ... }`), messages are queued for
    background processing instead of sent inline.
  - Queued messages are flushed via `provider.onDestroy()` — inside the Zanix ecosystem this is
    called automatically when the provider is destroyed, so no extra workers are spawned
    unnecessarily.

- **Handlebars Templates**
  - Per-channel registries: email's `welcome`, `generic`, `password-changed`, `password-recovery`,
    `login-otp`; SMS/WhatsApp's own `generic`, `otp`.
  - Dynamic data injection into any template, and support for adding custom ones.
  - Optional database-backed templates (`TEMPLATES_MODEL_NAME`) — code templates seed a
    `ZanixTemplate` collection (via `@zanix/datamaster`), then a direct database edit takes effect
    on the next send, no redeploy needed.
  - Or, with no local database access to templates at all, remote-only templates
    (`TEMPLATES_SERVICE_URL`) — `RemoteTemplateBackend` resolves each template from a central
    Notification/Template Service instead, with a local TTL cache and automatic fallback to the code
    version on any remote failure.
  - See [Templates](./docs/templates.md).

---

## 📦 Installation

Install via **JSR** using **Deno**:

```ts
import * as notifications from 'jsr:@zanix/notifications@[version]'
```

> Replace `[version]` with the latest version:
> [https://jsr.io/@zanix/notifications](https://jsr.io/@zanix/notifications)

Import specific modules:

```ts
import { NotifierProvider } from 'jsr:@zanix/notifications@[version]'
```

Or import `@zanix/notifications/core` (for its side effects) to register the default connectors and
notifier provider from environment variables, with zero app-side setup — see
[Environment Variables](#-environment-variables).

---

## 🚀 Basic Usage

Example showing how to send an email using a built-in template, queued through a background worker:

```ts
import { NotifierProvider } from 'jsr:@zanix/notifications@latest'

const provider = new NotifierProvider()

await provider.email({
  to: 'recipient@example.com',
  subject: 'Welcome to Zanix',
  zanixTemplate: 'welcome',
  data: { buttonText: 'Click here' },
}, {
  useOneTimeWorker: {
    callback: (response) => {
      if (response.error) console.error('Failed to send:', response.error)
    },
  },
})

provider['onDestroy']() // flushes the queued message via a one-time background worker
```

`.sms()` and `.whatsapp()` work the same way, against that channel's own templates:

```ts
await provider.sms({ to: '+15551234567', zanixTemplate: 'otp', data: { code: '123456', ttl: 5 } })

await provider.whatsapp({
  to: '+15551234567',
  zanixTemplate: 'otp',
  data: { code: '123456', ttl: 5 },
})
```

See [Notifier Provider](./docs/notifier-provider.md) for plain (non-templated) content, native
WhatsApp Business template messages, and the full queuing/worker behavior, and
[Templates](./docs/templates.md) for every built-in template's data shape.

---

## 📚 Documentation

- [Connectors](./docs/connectors.md) — `SmtpClient`/`SmsClient`/`WhatsappClient`, built-in and
  custom provider adapters.
- [Notifier Provider](./docs/notifier-provider.md) — `sendMessage()`/`email()`/`sms()`/`whatsapp()`,
  native WhatsApp templates, queuing.
- [Templates](./docs/templates.md) — the Handlebars template system, built-in templates, adding your
  own.
- [Environment Variables](./docs/environment-variables.md) — the full reference table for every
  channel.

---

## 🌐 Environment Variables

Each channel registers automatically from its own environment variables when
`@zanix/notifications/core` is imported — see the full reference in
[Environment Variables](./docs/environment-variables.md). Quick summary:

| Channel  | Provider          | Key variables                                                     |
| -------- | ----------------- | ----------------------------------------------------------------- |
| Email    | SMTP              | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`            |
| SMS      | Twilio            | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`   |
| WhatsApp | Meta Cloud API    | `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`                       |
| WhatsApp | Twilio (fallback) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` |

Setting `TEMPLATES_MODEL_NAME` (with a `@zanix/datamaster` connector registered) additionally
enables [database-backed templates](./docs/templates.md#database-backed-templates). A service with
no local database access to templates at all can set `TEMPLATES_SERVICE_URL` instead, for
[remote-only templates](./docs/templates.md#mode-c-remote-only-templates).

---

## 🤝 Contributing

1. Open an issue for bugs or feature requests.
2. Fork the `zanix-io/notifications` repository and create a feature branch.
3. Implement your changes following project guidelines.
4. Add or update tests when applicable.
5. Submit a pull request with a clear description.

---

## 🕒 Changelog

See [`CHANGELOG`](./CHANGELOG.md) for the version history.

---

## 📜 License

Licensed under the **MIT License**. See the [`LICENSE`](./LICENSE) file for details.

---

## 🔗 Resources

- [Zanix Framework](https://github.com/zanix-io)
- [Deno Documentation](https://deno.com)
- Repository: [https://github.com/zanix-io/notifications](https://github.com/zanix-io/notifications)

---

_Developed with ❤️ by Ismael Calle | [@iscam2216](https://github.com/iscam2216)_
