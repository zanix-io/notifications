# Zanix – Notifications

[![Version](https://img.shields.io/jsr/v/@zanix/notifications?color=blue\&label=jsr)](https://jsr.io/@zanix/notifications/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/notifications?color=blue\&label=git)](https://github.com/zanix-io/notifications/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

- [🧩 Description](#🧩-description)
- [⚙️ Features](#⚙️-features)
- [📦 Installation](#📦-installation)
- [🚀 Basic Usage](#🚀-basic-usage)
- [🌐 Environment Variables](#🌐-environment-variables)
- [🤝 Contributing](#🤝-contributing)
- [🕒 Changelog](#🕒-changelog)
- [⚖️ License](#⚖️-license)
- [🔗 Resources](#🔗-resources)

---

## 🧩 Description

**Zanix Notifications** is a flexible and extensible notification system designed to handle
notification messages with pre-built templates. It supports **Handlebars-based templates** and
currently allows the use of an **SMTP provider** to send messages. It also provides the option to
**activate a worker** for background processing of messages.

It provides a unified and extensible system for:

- Sending notifications via SMTP
- Support for pre-defined templates (Handlebars-based)
- Optional worker for background processing
- Easy integration with your application

---

## ⚙️ Features

- **SMTP Provider**
  - `NotifierProvider`: the core provider for sending messages through SMTP.
  - Configurable using environment variables for SMTP settings.
  - **SMTP Client**:\
    The `SmtpClient` class is responsible for sending emails using the Simple Mail Transfer Protocol
    (SMTP). It extends the `ZanixNotifierConnector` and provides a straightforward interface to
    configure and send email messages. The client uses the SMTP configuration options (host, port,
    user, and password) provided in the environment variables to connect to the mail server and send
    emails with the specified content and templates. This class supports reliable delivery of
    messages, including handling dynamic template rendering and personalized data injection.

- **Message Sending**
  - `sendMessage()`: sends a message using a specific template (e.g., `welcome`, `generic`).
  - Supports dynamic data injection into templates.

- **Message Queuing & Worker**
  - When using the worker (`useWorker: { callback: ... }`), messages are queued for background
    processing. This helps avoid sending multiple messages at once and ensures a smooth experience
    when dealing with high volumes of notifications.
  - The queued messages are executed via `provider.onDestroy()` once the processing is complete.
  - If you are using the **Zanix Server Library** or are within the **Zanix ecosystem**,
    `onDestroy()` is automatically called when the provider is destroyed, ensuring no extra workers
    are spawned unnecessarily.

- **Handlebars Templates**

  - Built-in templates:
    - `welcome`
    - `generic`
    - `password-changed`
    - `password-recovery`
    - `login-otp`
  - You can add custom data to the templates dynamically.

- **Worker Support (Optional)**

  - Optional worker functionality allows you to send notifications in the background, improving
    performance for large-scale systems.

- **Environment Variables**

  - Configuration for SMTP settings is done via environment variables.

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

---

## 🚀 Basic Usage

Example showing how to:

1. Initialize the `NotifierProvider`
2. Send an email message using a template
3. Optionally use a worker for background processing

```ts
import { NotifierProvider } from 'jsr:@zanix/notifications@latest'

const provider = new NotifierProvider()

provider.sendMessage('email', {
  from: 'noreply@aeratech.io',
  to: 'recipient@example.com',
  subject: 'Welcome to Zanix',
  body: { template: 'welcome', data: { buttonText: 'Click here' } },
  // body: 'HTML custom content',
}, {
  useWorker: {
    callback: () => {
      resolve(true)
    },
  },
})

provider.use('email')['close']() // this close the SMTP client
provider['onDestroy']() // this execute current worker
```

### 🧩 Message Data Example

When sending a notification message, you can customize the content using dynamic data. Here's an
example of the object structure that can be passed to the `sendMessage()` method when using a
template:

#### Example:

```ts
provider.sendMessage('email', {
  from: 'noreply@aeratech.io',
  to: 'recipient@example.com',
  subject: 'Welcome to Zanix',
  body: {
    template: 'welcome', // Specify the template to use
    data: {
      styles: {
        css: `.container {
          ...
        }`,
        html: {
          title: 'Page Title',
        },
      }
      title: 'Welcome to Zanix!',
      content: 'We are thrilled to have you on board.',
      buttonText: 'Get Started',
      buttonLink: 'https://example.com/start',
      message: 'If you need help, feel free to contact us at support@example.com.',
      footer: 'This is an automated message. Please do not reply.'
    }
  }
})
```

## 🌐 Environment Variables

| Variable        | Description                               | Example              |
| --------------- | ----------------------------------------- | -------------------- |
| `SMTP_PORT`     | The SMTP port to use for sending messages | `587`                |
| `SMTP_HOST`     | The SMTP server hostname                  | `smtp.gmail.com`     |
| `SMTP_USER`     | The SMTP username                         | `user@example.com`   |
| `SMTP_PASSWORD` | The SMTP password                         | `your-smtp-password` |

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

## ⚖️ License

Licensed under the **MIT License**. See the [`LICENSE`](./LICENSE) file for details.

---

## 🔗 Resources

- [Zanix Framework](https://github.com/zanix-io)
- [Deno Documentation](https://deno.com)
- Repository: [https://github.com/zanix-io/notifications](https://github.com/zanix-io/notifications)

---

_Developed with ❤️ by Ismael Calle | [@iscam2216](https://github.com/iscam2216)_
