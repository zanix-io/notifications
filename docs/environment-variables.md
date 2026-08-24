# Environment Variables

Setting a channel's required variables and importing `@zanix/notifications/core` registers that
channel's connector automatically — see [Connectors](./connectors.md). Each channel registers
independently: e.g. only `SMTP_*` set still registers `SmtpClient`, with
`SmsClient`/`WhatsappClient` simply skipped.

## SEE ALSO

- [Connectors](./connectors.md) — what each variable configures, and the equivalent manual
  `*.config = {...}` setup.
- [Templates](./templates.md#database-backed-templates) — what `TEMPLATES_BACKEND` actually selects.

---

## Email (SMTP)

| Variable         | Required | Description                                                 | Example              |
| ---------------- | -------- | ----------------------------------------------------------- | -------------------- |
| `SMTP_HOST`      | Yes      | SMTP server hostname                                        | `smtp.gmail.com`     |
| `SMTP_PORT`      | Yes      | SMTP server port                                            | `587`                |
| `SMTP_USER`      | Yes      | SMTP username                                               | `user@example.com`   |
| `SMTP_PASSWORD`  | Yes      | SMTP password                                               | `your-smtp-password` |
| `SMTP_POOL_SIZE` | No       | Shared connection pool size. `1` (default) disables pooling | `5`                  |

## SMS

`SMS_PROVIDER` (`'twilio'` | `'vonage'`) only needs to be set when BOTH Twilio's and Vonage's own
required variables below are present at once — `registerSmsConnector()` throws rather than silently
preferring one. With only one provider's variables set (the common case), auto-detection still works
with zero extra config. See [Connectors](./connectors.md#smsclient-sms).

| Variable       | Required | Description                                                                                               | Example  |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------- | -------- |
| `SMS_PROVIDER` | No¹      | Disambiguates `'twilio'` vs `'vonage'` when both providers' vars are set at once. Any other value throws. | `twilio` |

¹ **Required if, and only if, both Twilio's and Vonage's own vars below are set at once.**

### SMS (Twilio)

| Variable             | Required | Description                                                                                                       | Example                             |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `TWILIO_ACCOUNT_SID` | Yes      | Twilio account SID                                                                                                | `AC...`                             |
| `TWILIO_AUTH_TOKEN`  | Yes      | Twilio auth token                                                                                                 | `...`                               |
| `TWILIO_FROM_NUMBER` | Yes      | Default SMS sender number                                                                                         | `+15551234567`                      |
| `TWILIO_API_BASE`    | No       | Overrides Twilio's REST API base URL (proxy, mock, alternate API version) — shared with WhatsApp's Twilio adapter | `https://api.twilio.com/2010-04-01` |

### SMS (Vonage)

| Variable            | Required | Description                                              | Example                  |
| ------------------- | -------- | -------------------------------------------------------- | ------------------------ |
| `VONAGE_API_KEY`    | Yes      | Vonage API key                                           | `abcd1234`               |
| `VONAGE_API_SECRET` | Yes      | Vonage API secret                                        | `...`                    |
| `VONAGE_FROM`       | Yes      | Default sender number or alphanumeric sender ID          | `AcmeInc`                |
| `VONAGE_API_BASE`   | No       | Overrides Vonage's SMS API base URL (proxy, mock server) | `https://rest.nexmo.com` |

## WhatsApp

`WHATSAPP_PROVIDER` (`'meta'` | `'twilio'`) only needs to be set when BOTH Meta's and Twilio's own
required variables below are present at once — `registerWhatsappConnector()` throws rather than
silently preferring one. With only one provider's variables set (the common case), auto-detection
still works with zero extra config. See [Connectors](./connectors.md#whatsappclient-whatsapp).

| Variable            | Required | Description                                                                                             | Example |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------- | ------- |
| `WHATSAPP_PROVIDER` | No¹      | Disambiguates `'meta'` vs `'twilio'` when both providers' vars are set at once. Any other value throws. | `meta`  |

¹ **Required if, and only if, both Meta's and Twilio's own vars below are set at once.**

### WhatsApp (Meta Cloud API)

| Variable               | Required | Description                                              | Example                      |
| ---------------------- | -------- | -------------------------------------------------------- | ---------------------------- |
| `META_PHONE_NUMBER_ID` | Yes      | WhatsApp Business phone number ID                        | `1234567890`                 |
| `META_ACCESS_TOKEN`    | Yes      | Meta Graph API access token                              | `EAAG...`                    |
| `META_API_VERSION`     | No       | Graph API version                                        | `v25.0`                      |
| `META_API_BASE`        | No       | Overrides Meta's Graph API base URL (proxy, mock server) | `https://graph.facebook.com` |

### WhatsApp (Twilio)

| Variable               | Required | Description                                                                                                               | Example                             |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `TWILIO_ACCOUNT_SID`   | Yes      | Twilio account SID (shared with the SMS variable above)                                                                   | `AC...`                             |
| `TWILIO_AUTH_TOKEN`    | Yes      | Twilio auth token (shared with the SMS variable above)                                                                    | `...`                               |
| `TWILIO_WHATSAPP_FROM` | Yes      | WhatsApp-enabled sender number — deliberately separate from `TWILIO_FROM_NUMBER`, since it's typically a different number | `+14155238886`                      |
| `TWILIO_API_BASE`      | No       | Same variable as SMS's — shared across both Twilio adapters                                                               | `https://api.twilio.com/2010-04-01` |

## Database-backed templates

`TEMPLATES_BACKEND` is the single selector between Modes A/B (`'local'`) and Mode C (`'remote'`) —
**breaking change**: replaces the earlier `DATABASE_TEMPLATES`/bare-`TEMPLATES_MODEL_NAME`
mode-inference design, removed entirely with no dual-read. See
[Templates](./templates.md#database-backed-templates) and `CHANGELOG.md`.

| Variable               | Required | Description                                                                                                                                                                                                                                                                                                            | Example           |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `TEMPLATES_BACKEND`    | No       | Selects the persisted-backend mode: `'local'` (Modes A/B, a `@zanix/datamaster`-backed collection) or `'remote'` (Mode C, over HTTP). **Unset (default): fully disabled** — pure code rendering, no database access at all. Any other value throws at boot. See [Templates](./templates.md#database-backed-templates). | `local`           |
| `TEMPLATES_MODEL_NAME` | No       | Names the `ZanixTemplate` model — only consulted when `TEMPLATES_BACKEND=local`; optional even then, defaulting to `zanix-templates`. Requires a registered `@zanix/datamaster` `ZanixMongoConnector` (`MONGO_URI`). Setting this without `TEMPLATES_BACKEND=local` has no effect.                                     | `zanix-templates` |

## Remote-only templates (Mode C)

Only consulted when `TEMPLATES_BACKEND=remote` (see above) — setting any of these without also
selecting that mode has no effect.

| Variable                         | Required                                   | Description                                                                                                                                                                                                                                                                                                                    | Example                              |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `TEMPLATES_SERVICE_URL`          | **Yes, if `TEMPLATES_BACKEND=remote`**     | Resolves templates over HTTP against a central Notification/Template Service's _internal admin_ base URL, instead of a local database — see [Templates](./templates.md#mode-c-remote-only-templates).                                                                                                                          | `https://templates.internal.example` |
| `TEMPLATES_SERVICE_ID`           | **Yes, if `TEMPLATES_SERVICE_URL` is set** | This service's own identity, as registered in the central service's `ServiceRegistry` (`@zanix/admin`'s `ZANIX_ADMIN_SERVICES`), mapped to a base URL reachable for this process's own `/.well-known/zanix/code-templates` Discovery endpoint (see [Templates](./templates.md#mode-c-remote-only-templates)).                  | `billing`                            |
| `TEMPLATES_SERVICE_TOKEN`        | No                                         | Pre-issued `type: 'api'` machine credential (RS256), sent as `X-Znx-Authorization: Bearer <token>` on every call to `TEMPLATES_SERVICE_URL`. Only meaningful alongside `TEMPLATES_SERVICE_URL`.                                                                                                                                | `eyJhbGciOi...`                      |
| `TEMPLATES_SERVICE_AUTH_ID`      | No                                         | Alternative to `TEMPLATES_SERVICE_TOKEN` for a Zanix-based central service: this service's own signing identity for a dynamic, short-lived credential exchange (`JWK_PRI_<id>[_<keyId>]`/`JWK_ID_<id>`). Ignored entirely when `TEMPLATES_SERVICE_TOKEN` is set. See [Templates](./templates.md#mode-c-remote-only-templates). | `billing-service`                    |
| `TEMPLATES_SERVICE_CACHE_TTL_MS` | No                                         | Overrides the default 45-second local fetch-cache TTL for the remote `{hbs,hash}` lookup. Only meaningful alongside `TEMPLATES_SERVICE_URL`.                                                                                                                                                                                   | `30000`                              |
