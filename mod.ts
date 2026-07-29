/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 *
 * Zanix Notifications — connectors, providers, and Handlebars-based transactional templates for
 * sending notifications via email ({@linkcode SmtpClient}), SMS ({@linkcode SmsClient}), or
 * WhatsApp ({@linkcode WhatsappClient}) within the Zanix ecosystem.
 *
 * Import `@zanix/notifications/core` instead (or alongside this one) to register the default
 * connectors and notifier provider with zero app-side setup — see that entrypoint's own docs.
 *
 * @module
 */

export { SmtpClient } from 'modules/email/connector.ts'
export { SmsClient } from 'modules/sms/connector.ts'
export { WhatsappClient } from 'modules/whatsapp/connector.ts'
export { NotifierProvider } from 'modules/providers/notifier.ts'
export { TemplateProvider } from 'modules/templates/provider.ts'
export { ZanixNotifierConnector } from 'modules/base.ts'

export type { AnyNotifyMessageWithTemplate } from 'modules/providers/notifier.ts'

// Provider adapters
export { TwilioSmsAdapter } from 'modules/sms/twilio.ts'
export { MetaCloudWhatsappAdapter } from 'modules/whatsapp/meta.ts'
export { TwilioWhatsappAdapter } from 'modules/whatsapp/twilio.ts'

// Utils
export { execTemplate } from 'modules/templates/mod.ts'
export { default as transactionalTemplates } from 'modules/templates/transactional/email/mod.ts'
export { default as smsTemplates } from 'modules/templates/transactional/sms.ts'
export { default as whatsappTemplates } from 'modules/templates/transactional/whatsapp.ts'
/**
 * Every {@link Notifiers} value as a runtime array — the single source of truth for validating/
 * enumerating channels at runtime, so a consumer building its own admin-style API against this
 * package's templates (e.g. `@zanix/admin`'s `CreateTemplateRTO`) doesn't hand-copy the same three
 * strings independently.
 */
export { NOTIFIER_CHANNELS } from 'utils/constants.ts'

/**
 * Validates `hbs` compiles as syntactically valid Handlebars — see its own JSDoc for exactly what
 * it does and doesn't check.
 */
export { assertValidHandlebarsSyntax } from 'modules/templates/hbs-validation.ts'

// Typings
export type {
  DefaultTemplates,
  MessageContent,
  MessageContentOf,
  Notifiers,
  NotifyMessage,
  NotifyMessageWithTemplate,
  SmsMessageContent,
  SmsNotifyMessageWithTemplate,
  SmsTemplateData,
  SmsTemplates,
  TemplateData,
  TemplateDataOf,
  WhatsappMessageContent,
  WhatsappNotifyMessageWithTemplate,
  WhatsappTemplateData,
  WhatsappTemplates,
  WithWorker,
} from 'typings/general.ts'

export type {
  GenericTemplateSchema,
  LoginWithOTPTemplateSchema,
  OTPTemplateSchema,
  PasswordChangedTemplateSchema,
  PasswordRecoveryTemplateSchema,
  SmsGenericTemplateSchema,
  WelcomeTemplateSchema,
  WhatsappGenericTemplateSchema,
} from 'typings/templates.ts'

export type { SmsClientConfig, SmsMessage, SmsProviderAdapter, TwilioConfig } from 'typings/sms.ts'

export type {
  MetaCloudConfig,
  WhatsappClientConfig,
  WhatsappMessage,
  WhatsappProviderAdapter,
  WhatsappTemplateMessage,
} from 'typings/whatsapp.ts'

export {
  DATABASE_TEMPLATES_ENV,
  DEFAULT_TEMPLATES_MODEL_NAME,
  isDatabaseTemplatesDisabled,
  TEMPLATES_MODEL_ENV,
  TEMPLATES_SERVICE_CACHE_TTL_ENV,
  TEMPLATES_SERVICE_TOKEN_ENV,
  TEMPLATES_SERVICE_URL_ENV,
  templatesModelName,
} from 'modules/templates/provider.ts'

export type { TemplateSource, ZanixTemplateAttrs } from 'typings/templates-db.ts'

// Mode C: remote-only templates (see docs/templates.md#mode-c-remote-only-templates)
export { RemoteTemplateBackend } from 'modules/templates/db/remote-backend.ts'
export type { RemoteTemplateBackendConfig } from 'modules/templates/db/remote-backend.ts'
export type { TemplateBackend } from 'modules/templates/db/backend.ts'
