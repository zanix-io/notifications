# Notifier Provider

`NotifierProvider` is the high-level API for sending notifications — the recommended entrypoint for
most apps, instead of reaching a [connector](./connectors.md) directly. Importing
`@zanix/notifications/core` registers a default instance under the `'notifications'` core-provider
key, so `this.providers.get('notifications')` works with zero app-side setup inside the Zanix
ecosystem; standalone, just `new NotifierProvider()`.

## SEE ALSO

- [Connectors](./connectors.md) — the per-channel clients
  (`SmtpClient`/`SmsClient`/`WhatsappClient`) this provider dispatches to.
- [Templates](./templates.md) — the Handlebars-based `zanixTemplate` mechanism used by
  `sendMessage()`.

---

## Sending a message

`.email()`, `.sms()`, and `.whatsapp()` are convenience wrappers over the generic
`sendMessage(notifier, message, options)` — prefer them when the channel is known statically, since
each is typed against that channel's own template registry:

```ts
import { NotifierProvider } from '@zanix/notifications'

const provider = new NotifierProvider()

await provider.email({
  to: 'recipient@example.com',
  subject: 'Welcome to Zanix',
  zanixTemplate: 'welcome',
  data: { buttonText: 'Click here' },
})

await provider.sms({
  to: '+15551234567',
  zanixTemplate: 'otp',
  data: { code: '123456', ttl: 5 },
})

await provider.whatsapp({
  to: '+15551234567',
  zanixTemplate: 'otp',
  data: { code: '123456', ttl: 5 },
})
```

A message's content is either plain `content` text, or a local template name via `zanixTemplate`
plus its `data` — mutually exclusive (setting both is a type error). See [Templates](./templates.md)
for the full list of built-in templates and their data shape per channel.

```ts
await provider.email({
  to: 'recipient@example.com',
  subject: 'Heads up',
  content: '<p>Plain HTML content, no template.</p>',
})
```

`subject` only applies to (and is required for) `email`; SMS/WhatsApp ignore it, along with `from`
and `date`.

## Native WhatsApp provider templates

WhatsApp has its own, separate template concept — a pre-approved Business template required to start
a conversation outside the 24h customer-service window (Meta's `templateName`/ `templateLanguage`,
or Twilio's `contentSid`) — distinct from this package's own `zanixTemplate`. `.whatsapp()` accepts
either shape and dispatches automatically:

```ts
// Renders `otp` via Handlebars and sends as freeform text -> sendMessage()
await provider.whatsapp({
  to: '+15551234567',
  zanixTemplate: 'otp',
  data: { code: '123456', ttl: 5 },
})

// Native provider template (Twilio) -> sendTemplate()
await provider.whatsapp({
  to: '+15551234567',
  contentSid: 'HX229f5a04fd0510ce1b071852155d3e75',
  contentVariables: { '1': '123456' },
})

// Native provider template (Meta) -> sendTemplate()
await provider.whatsapp({
  to: '+15551234567',
  templateName: 'hello_world',
  templateLanguage: 'en_US',
})
```

`sendTemplate()` can also be called directly, with the same `useOneTimeWorker`/error-wrapping
behavior as `sendMessage()` (see below). See
[Connectors](./connectors.md#freeform-text-vs-native-provider-templates) for the full
native-template shapes.

## Queuing with a background worker

Pass `useOneTimeWorker` to defer the actual send to a one-time Web Worker instead of sending inline
— useful to avoid blocking a request on notification delivery:

```ts
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
```

`useOneTimeWorker: true` works the same way without a callback. Queued messages are flushed by
`onDestroy()` — inside the Zanix ecosystem this runs automatically when the provider instance is
torn down at the end of a request; standalone, call it yourself once you're done queuing:

```ts
provider['onDestroy']()
```

All queued messages (potentially spanning several channels) are sent from a single background worker
invocation (`sendBackgroundMessage`), each one re-resolving its own channel's connector before
sending. A send failure — inline or from the background worker — is always re-thrown as
`Deno.errors.Interrupted`, with the original error attached as `.cause`.
