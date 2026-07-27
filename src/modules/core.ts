/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 *
 * Zero-config core wiring for Zanix Notifications: importing this entrypoint (for its side
 * effects) registers the default SMTP, SMS, and WhatsApp connectors plus the notifier and
 * template providers — see `email/defs.ts`, `sms/defs.ts`, `whatsapp/defs.ts`,
 * `providers/core.ts`, and `templates/core.ts` — whenever each channel's own environment
 * variables are set (`SMTP_*`, `TWILIO_*`, `META_*` respectively), without any app-side setup.
 * Each channel registers independently — e.g. only `SMTP_*` set still registers `SmtpClient`,
 * with `SmsClient`/`WhatsappClient` simply skipped. `TemplateProvider` (`templates/core.ts`)
 * registers unconditionally, regardless of any channel's env vars — it's a prerequisite for every
 * `NotifierProvider.sendMessage()` call, not an optional per-channel client (its own
 * database-backed behavior is separately gated by `TEMPLATES_MODEL_NAME`, see
 * `templates/provider.ts`). It exports nothing by value; import it alongside the root
 * `@zanix/notifications` entrypoint.
 *
 * @module
 */

export * from './email/defs.ts'
export * from './sms/defs.ts'
export * from './whatsapp/defs.ts'
export * from './providers/core.ts'
export * from './templates/core.ts'
