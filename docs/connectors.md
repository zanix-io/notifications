# Connectors

Zanix Notifications ships one connector per channel — `SmtpClient` (email), `SmsClient` (SMS), and
`WhatsappClient` (WhatsApp) — all extending the same abstract base, `ZanixNotifierConnector`
(`send(message: NotifyMessage): Promise<void>`, plus the `initialize()`/`close()`/`isHealthy()`
lifecycle every `@zanix/server` connector implements). `NotifierProvider` (see
[Notifier Provider](./notifier-provider.md)) is the high-level API most apps use; this guide covers
each connector directly, for when you need to reach one without going through the provider (e.g.
`provider.use('sms')`), or need to configure a non-default delivery provider.

Every connector delegates actual delivery to a pluggable **provider adapter** rather than being
hardcoded to one vendor — a built-in adapter is used by default, or you can supply your own.

## SEE ALSO

- [Notifier Provider](./notifier-provider.md) — the high-level
  `sendMessage()`/`email()`/`sms()`/`whatsapp()` API most apps use instead of a connector directly.
- [Environment Variables](./environment-variables.md) — every variable referenced below, in one
  table.

---

## SmtpClient (email)

Sends email over SMTP. Configure it directly:

```ts
import { SmtpClient } from '@zanix/notifications'

SmtpClient.config = {
  hostname: 'smtp.example.com',
  port: 587,
  username: 'user@example.com',
  password: 'secret',
}
```

Or set `SMTP_PORT`/`SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` and import `@zanix/notifications/core` —
it registers `SmtpClient` with the Zanix DI container automatically, with zero app-side setup.

### Connection pooling

By default, every request dials a fresh SMTP connection. Setting `SMTP_POOL_SIZE` to a number
greater than `1` switches to a shared pool of that many persistent, authenticated connections,
borrowed per request instead of dialed fresh each time — useful under load, since the SMTP handshake
(`EHLO`/`AUTH LOGIN`) is the expensive part of every send. A connection the remote silently closed
while idle is detected and replaced automatically on next use.

### Registration lifetime

`SmtpClient` is registered `SCOPED` (one instance per request), never `SINGLETON` — SMTP is a
single-socket, one-command-at-a-time protocol, so sharing one instance across concurrent requests
would interleave unrelated commands/responses on the same connection. Pooling (above) is what avoids
paying a fresh handshake per request without needing a shared instance.

---

## SmsClient (SMS)

Sends SMS. Two built-in adapters are available — `TwilioSmsAdapter` (default) and `VonageSmsAdapter`
(alternative):

```ts
import { SmsClient } from '@zanix/notifications'

// Twilio (default adapter)
SmsClient.config = {
  accountSid: 'AC...',
  authToken: '...',
  from: '+15551234567',
}
```

Or set `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` and import
`@zanix/notifications/core` for zero-config registration. `TWILIO_API_BASE` optionally overrides the
API base URL (proxy, mock server, alternate API version). To use Vonage's SMS API instead, set
`VONAGE_API_KEY`/`VONAGE_API_SECRET`/`VONAGE_FROM`. **If both providers' variables are set at once,
`SMS_PROVIDER` (`'twilio'` | `'vonage'`) must be set to disambiguate — `registerSmsConnector()`
throws rather than silently picking one.** With only one provider's variables set, `SMS_PROVIDER` is
unnecessary — auto-detection still works exactly as before.

You can also configure `VonageSmsAdapter` explicitly:

```ts
import { SmsClient, VonageSmsAdapter } from '@zanix/notifications'

SmsClient.config = {
  adapter: new VonageSmsAdapter({
    apiKey: '...',
    apiSecret: '...',
    from: 'AcmeInc', // sender number or alphanumeric sender ID
  }),
}
```

> ⚠️ **Known caveat (`TwilioSmsAdapter`/`TwilioWhatsappAdapter`)**: both extend `@zanix/server`'s
> `RestClient`, which normalizes every request path through `@zanix/helpers`' `cleanRoute()` —
> including lowercasing the dynamic `accountSid` URL segment. Twilio's real endpoint has
> case-sensitive path segments, so verify against a real Twilio account before relying on this in
> production.

> ⚠️ **Known caveat (`VonageSmsAdapter`), distinct from Twilio's**: Vonage's classic SMS API always
> responds `HTTP 200` — even for a rejected/invalid send — and reports success/failure only via the
> JSON body's `messages[].status` field (`"0"` = accepted, non-zero = rejected). `VonageSmsAdapter`
> inspects that field itself and throws on a non-zero status, so `send()`'s "resolves only on real
> acceptance" contract still holds; a plain non-2xx check alone would not have been enough here.

### Using a different SMS provider

Any other vendor (AWS SNS, etc.) can be plugged in by implementing the tiny `SmsProviderAdapter`
contract — just `send(message: SmsMessage): Promise<void>` — and setting it as the adapter:

```ts
import type { SmsProviderAdapter } from '@zanix/notifications'

const myAdapter: SmsProviderAdapter = {
  send: async (message) => {/* call your provider's API */},
}

SmsClient.config = { adapter: myAdapter }
```

---

## WhatsappClient (WhatsApp)

Sends WhatsApp messages. Two built-in adapters are available — `MetaCloudWhatsappAdapter` (default)
and `TwilioWhatsappAdapter` (alternative):

```ts
import { WhatsappClient } from '@zanix/notifications'

// Meta Cloud API (default adapter)
WhatsappClient.config = {
  phoneNumberId: '1234567890',
  accessToken: 'EAAG...',
}
```

Or set `META_PHONE_NUMBER_ID`/`META_ACCESS_TOKEN` (`META_API_VERSION`/`META_API_BASE` optional) and
import `@zanix/notifications/core`. To use Twilio's WhatsApp API instead, set
`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_WHATSAPP_FROM` — deliberately a separate variable
from `SmsClient`'s `TWILIO_FROM_NUMBER`, since a WhatsApp-enabled Twilio sender is typically a
different number than the plain SMS one, even under the same account. **If both providers' variables
are set at once, `WHATSAPP_PROVIDER` (`'meta'` | `'twilio'`) must be set to disambiguate —
`registerWhatsappConnector()` throws rather than silently picking one.** With only one provider's
variables set, `WHATSAPP_PROVIDER` is unnecessary — auto-detection still works exactly as before.

You can also configure `TwilioWhatsappAdapter` explicitly:

```ts
import { TwilioWhatsappAdapter, WhatsappClient } from '@zanix/notifications'

WhatsappClient.config = {
  adapter: new TwilioWhatsappAdapter({
    accountSid: 'AC...',
    authToken: '...',
    from: '+14155238886', // WhatsApp-enabled sender
  }),
}
```

### Freeform text vs. native provider templates

`WhatsappClient.send()` (the `ZanixNotifierConnector` contract) only ever sends freeform text — only
deliverable within WhatsApp's 24h customer-service session window. Starting a conversation outside
that window requires a **pre-approved template message**, a distinct WhatsApp Business capability
exposed via `sendTemplate()` instead:

```ts
// Meta Cloud API's templateName/templateLanguage model
await client.sendTemplate({
  to: '+15551234567',
  templateName: 'otp_code',
  templateLanguage: 'en_US',
  templateParams: ['123456'],
})

// Twilio's Content API model (a pre-registered "Content SID" plus named variables)
await client.sendTemplate({
  to: '+15551234567',
  contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
  contentVariables: { '1': '123456' },
})
```

Use whichever shape matches the adapter actually configured. This is unrelated to this package's own
Handlebars-based `zanixTemplate` mechanism (see [Templates](./templates.md)) — `zanixTemplate`
always means "render locally and send as freeform text," exactly like email/SMS; it's not a WhatsApp
Business template. `NotifierProvider.whatsapp()` accepts both shapes and dispatches to
`sendMessage()`/`sendTemplate()` automatically based on which fields the message carries — see
[Notifier Provider](./notifier-provider.md).

### Using a different WhatsApp provider

Same pattern as `SmsClient` — implement `WhatsappProviderAdapter`'s
`send(message: WhatsappMessage):
Promise<void>` and set it as the adapter.
