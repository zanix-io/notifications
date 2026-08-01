# Environment Variables

Setting a channel's required variables and importing `@zanix/notifications/core` registers that
channel's connector automatically — see [Connectors](./connectors.md). Each channel registers
independently: e.g. only `SMTP_*` set still registers `SmtpClient`, with
`SmsClient`/`WhatsappClient` simply skipped.

## SEE ALSO

- [Connectors](./connectors.md) — what each variable configures, and the equivalent manual
  `*.config = {...}` setup.
- [Templates](./templates.md#database-backed-templates) — what `TEMPLATES_MODEL_NAME` actually
  enables.

---

## Email (SMTP)

| Variable         | Required | Description                                                 | Example              |
| ---------------- | -------- | ----------------------------------------------------------- | -------------------- |
| `SMTP_HOST`      | Yes      | SMTP server hostname                                        | `smtp.gmail.com`     |
| `SMTP_PORT`      | Yes      | SMTP server port                                            | `587`                |
| `SMTP_USER`      | Yes      | SMTP username                                               | `user@example.com`   |
| `SMTP_PASSWORD`  | Yes      | SMTP password                                               | `your-smtp-password` |
| `SMTP_POOL_SIZE` | No       | Shared connection pool size. `1` (default) disables pooling | `5`                  |

## SMS (Twilio)

| Variable             | Required | Description                                                                                                       | Example                             |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `TWILIO_ACCOUNT_SID` | Yes      | Twilio account SID                                                                                                | `AC...`                             |
| `TWILIO_AUTH_TOKEN`  | Yes      | Twilio auth token                                                                                                 | `...`                               |
| `TWILIO_FROM_NUMBER` | Yes      | Default SMS sender number                                                                                         | `+15551234567`                      |
| `TWILIO_API_BASE`    | No       | Overrides Twilio's REST API base URL (proxy, mock, alternate API version) — shared with WhatsApp's Twilio adapter | `https://api.twilio.com/2010-04-01` |

## WhatsApp (Meta Cloud API — checked first)

| Variable               | Required | Description                                              | Example                      |
| ---------------------- | -------- | -------------------------------------------------------- | ---------------------------- |
| `META_PHONE_NUMBER_ID` | Yes      | WhatsApp Business phone number ID                        | `1234567890`                 |
| `META_ACCESS_TOKEN`    | Yes      | Meta Graph API access token                              | `EAAG...`                    |
| `META_API_VERSION`     | No       | Graph API version                                        | `v25.0`                      |
| `META_API_BASE`        | No       | Overrides Meta's Graph API base URL (proxy, mock server) | `https://graph.facebook.com` |

## WhatsApp (Twilio — used only if Meta's variables above aren't set)

| Variable               | Required | Description                                                                                                               | Example                             |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `TWILIO_ACCOUNT_SID`   | Yes      | Twilio account SID (shared with the SMS variable above)                                                                   | `AC...`                             |
| `TWILIO_AUTH_TOKEN`    | Yes      | Twilio auth token (shared with the SMS variable above)                                                                    | `...`                               |
| `TWILIO_WHATSAPP_FROM` | Yes      | WhatsApp-enabled sender number — deliberately separate from `TWILIO_FROM_NUMBER`, since it's typically a different number | `+14155238886`                      |
| `TWILIO_API_BASE`      | No       | Same variable as SMS's — shared across both Twilio adapters                                                               | `https://api.twilio.com/2010-04-01` |

## Database-backed templates

| Variable               | Required | Description                                                                                                                                                                                                                                                                                                                                                          | Example           |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `TEMPLATES_MODEL_NAME` | No       | Enables database-backed templates (Modes A/B) and names the `ZanixTemplate` model. **Unset (default): fully disabled** — pure code rendering, no database access at all. Requires a registered `@zanix/datamaster` `ZanixMongoConnector` (`MONGO_URI`) — see [Templates](./templates.md#database-backed-templates). Mutually exclusive with `TEMPLATES_SERVICE_URL`. | `zanix-templates` |
| `DATABASE_TEMPLATES`   | No       | Set to `true` to enable database-backed templates under the default model name (`zanix-templates`) without naming it explicitly. Set to `false`, it's a kill switch: disables database-backed templates entirely, even if `TEMPLATES_MODEL_NAME` or `TEMPLATES_SERVICE_URL` is explicitly set (same convention as `@zanix/datamaster`'s `DATABASE_SEEDERS`).         | `true`            |

## Remote-only templates (Mode C)

| Variable                         | Required                                   | Description                                                                                                                                                                                                                                                                                                   | Example                              |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `TEMPLATES_SERVICE_URL`          | No                                         | Enables Mode C: resolves templates over HTTP against a central Notification/Template Service's _internal admin_ base URL, instead of a local database. Mutually exclusive with `TEMPLATES_MODEL_NAME` — see [Templates](./templates.md#mode-c-remote-only-templates).                                         | `https://templates.internal.example` |
| `TEMPLATES_SERVICE_ID`           | **Yes, if `TEMPLATES_SERVICE_URL` is set** | This service's own identity, as registered in the central service's `ServiceRegistry` (`@zanix/admin`'s `ZANIX_ADMIN_SERVICES`), mapped to a base URL reachable for this process's own `/.well-known/zanix/code-templates` Discovery endpoint (see [Templates](./templates.md#mode-c-remote-only-templates)). | `billing`                            |
| `TEMPLATES_SERVICE_TOKEN`        | No                                         | Pre-issued `type: 'api'` machine credential (RS256), sent as `X-Znx-Authorization: Bearer <token>` on every call to `TEMPLATES_SERVICE_URL`. Only meaningful alongside `TEMPLATES_SERVICE_URL`.                                                                                                               | `eyJhbGciOi...`                      |
| `TEMPLATES_SERVICE_CACHE_TTL_MS` | No                                         | Overrides the default 45-second local fetch-cache TTL for the remote `{hbs,hash}` lookup. Only meaningful alongside `TEMPLATES_SERVICE_URL`.                                                                                                                                                                  | `30000`                              |
