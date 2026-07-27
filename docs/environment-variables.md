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

| Variable               | Required | Description                                                                                                                                                                                                                                                                                             | Example           |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `TEMPLATES_MODEL_NAME` | No       | Enables database-backed templates and names the `ZanixTemplate` model. **Unset (default): fully disabled** — pure code rendering, no database access at all. Requires a registered `@zanix/datamaster` `ZanixMongoConnector` (`MONGO_URI`) — see [Templates](./templates.md#database-backed-templates). | `zanix-templates` |
