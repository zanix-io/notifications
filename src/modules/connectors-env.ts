/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 *
 * `SMTP_*`/`TWILIO_*`/`VONAGE_*`/`META_*`/`SMS_PROVIDER`/`WHATSAPP_PROVIDER` env var selection,
 * validation, and auto-registration for the built-in SMTP/SMS/WhatsApp connectors — `email/defs.ts`,
 * `sms/defs.ts`, `whatsapp/defs.ts` — deliberately without `NotifierProvider`/`TemplateProvider`/
 * `execTemplate` or anything else under `modules/templates/`. Each of these three files is already
 * lightweight on its own (see `sms/defs.ts`'s/`whatsapp/defs.ts`'s own module docs), but the only
 * currently-exposed subpath that reaches them — `@zanix/notifications/core` (`modules/core.ts`'s
 * `export * from './sms/defs.ts'` etc.) — ALSO unconditionally re-exports `templates/core.ts`, which
 * value-imports `TemplateProvider` and, through it, every channel's compiled Handlebars template
 * registry (and each one's own Zod schema). A consumer that only needs to inspect which SMS/WhatsApp/
 * SMTP provider is configured (`resolveSmsProvider()`, `resolveWhatsappProvider()`,
 * `SMS_PROVIDER_ENV`, `SMTP_HOST_ENV`, ...) — without also registering `TemplateProvider` or paying
 * for Handlebars — never needs any of that, and importing this subpath instead of
 * `@zanix/notifications/core` or the root `@zanix/notifications` barrel keeps it that way.
 *
 * Every symbol here is also re-exported from `@zanix/notifications/core` and the root
 * `@zanix/notifications` barrel, so switching between any of the three is never a breaking change in
 * any direction.
 *
 * @module
 */

export * from './email/defs.ts'
export * from './sms/defs.ts'
export * from './whatsapp/defs.ts'
