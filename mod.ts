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
export { NotifierProvider, ZanixCoreNotificationsProvider } from 'modules/providers/notifier.ts'
export { TemplateProvider } from 'modules/templates/provider.ts'
export { ZanixNotifierConnector } from 'modules/base.ts'

export type { AnyNotifyMessageWithTemplate } from 'modules/providers/notifier.ts'

/**
 * Owns the `mail` trigger action's concrete payload contract — the counterpart of
 * `@zanix/database`'s generic `TriggerActions['mail']` (a `Record<string, unknown>` catch-all
 * beyond its own `to`/`subject` fields). `@zanix/core` is the composer that bridges the two: it
 * registers the job that calls {@link sendMailTriggerNotification} for `@zanix/datamaster`'s
 * built-in `mail` trigger action.
 */
export {
  type MailTriggerActionData,
  sendMailTriggerNotification,
} from 'modules/providers/trigger-mail.ts'

// Provider adapters
export { TwilioSmsAdapter } from 'modules/sms/twilio.ts'
export { VonageSmsAdapter } from 'modules/sms/vonage.ts'
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
  MessageContentOf,
  Notifiers,
  NotifyMessage,
  TemplateDataOf,
  WithWorker,
} from 'typings/general.ts'

/**
 * Types derived from each channel's own compiled template registry — split into their own file
 * (`typings/template-registry.ts`) so a consumer that only needs {@link NotifyMessage}/
 * {@link Notifiers} (e.g. to use `SmtpClient`/`SmsClient`/`WhatsappClient` directly, without
 * `NotifierProvider`'s template-based dispatch) never resolves the registries' own reachable graph
 * (Handlebars, Zod) just by importing a type from this barrel.
 */
export type {
  DefaultTemplates,
  MessageContent,
  NotifyMessageWithTemplate,
  SmsMessageContent,
  SmsNotifyMessageWithTemplate,
  SmsTemplateData,
  SmsTemplates,
  TemplateData,
  WhatsappMessageContent,
  WhatsappNotifyMessageWithTemplate,
  WhatsappTemplateData,
  WhatsappTemplates,
} from 'typings/template-registry.ts'

export type {
  DataTableLabelsSchema,
  DataTableLineItemSchema,
  DataTableTemplateSchema,
  GenericTemplateSchema,
  LoginWithOTPTemplateSchema,
  NewLoginEmailTemplateSchema,
  NewLoginTemplateSchema,
  OTPTemplateSchema,
  PasswordChangedTemplateSchema,
  PasswordRecoveryTemplateSchema,
  SmsGenericTemplateSchema,
  WelcomeTemplateSchema,
  WhatsappGenericTemplateSchema,
} from 'typings/templates.ts'

export type {
  SmsClientConfig,
  SmsMessage,
  SmsProviderAdapter,
  TwilioConfig,
  VonageConfig,
} from 'typings/sms.ts'

export type {
  MetaCloudConfig,
  WhatsappClientConfig,
  WhatsappMessage,
  WhatsappProviderAdapter,
  WhatsappTemplateMessage,
} from 'typings/whatsapp.ts'

export {
  DEFAULT_TEMPLATES_MODEL_NAME,
  isTemplatesResourceEnabled,
  TEMPLATES_BACKEND_ENV,
  TEMPLATES_MODEL_ENV,
  TEMPLATES_SERVICE_CACHE_TTL_ENV,
  TEMPLATES_SERVICE_ID_ENV,
  TEMPLATES_SERVICE_TOKEN_ENV,
  TEMPLATES_SERVICE_URL_ENV,
  templatesBackendMode,
  templatesModelName,
} from 'modules/templates/provider.ts'

export type { TemplatesBackendMode } from 'modules/templates/provider.ts'

export type {
  CreateTemplateInput,
  TemplateSource,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from 'typings/templates-db.ts'

/**
 * Data access and business logic for this package's own templates collection — the actual owner
 * of both the schema/collection and the local HTTP surface fronting it (`@zanix/notifications/
 * templates-api`'s `createTemplatesController`). `@zanix/admin` composes a genuinely cross-service
 * extension (`POST /templates/sync`) on top — see the "Local API vs Aggregator API" rule in the
 * `zanix-libraries-architecture` skill. Exported here too so a consuming app can extend or reuse
 * them to build its own custom templates API instead of duplicating the CRUD logic.
 */
export {
  type SyncCodeTemplateEntry,
  type SyncCodeTemplatesResult,
  TemplatesAdminRepository,
  toSyncCodeTemplateEntries,
} from 'modules/templates/db/templates.repository.ts'
export { TemplatesAdminService } from 'modules/templates/db/templates.service.ts'
/**
 * Builds the `DiscoveryProvider` for `/.well-known/zanix/templates`, backed by
 * {@link TemplatesAdminRepository}. `@zanix/admin` composes this into an HTTP surface via
 * `ProgramModule.defineDiscovery`; it does not author the provider itself.
 */
export {
  createTemplatesDiscoveryProvider,
} from 'modules/templates/db/templates-discovery.provider.ts'

// Mode C: remote-only templates (see docs/templates.md#mode-c-remote-only-templates)
export { RemoteTemplateBackend } from 'modules/templates/db/remote-backend.ts'
export type {
  RemoteTemplateBackendConfig,
  ServiceAuthClient,
} from 'modules/templates/db/remote-backend.ts'
export type { TemplateBackend } from 'modules/templates/db/backend.ts'

/**
 * Registers this service's code-defined templates under `/.well-known/zanix/code-templates` — the
 * pull-side counterpart of {@link RemoteTemplateBackend}'s sync. Call from your own bootstrap; see
 * this function's own doc for the full example.
 */
export {
  type CodeTemplateDiscoveryEntry,
  createCodeTemplatesDiscoveryProvider,
  defineCodeTemplatesDiscovery,
} from 'modules/templates/db/code-templates-discovery.provider.ts'
/** Re-exported so `createCodeTemplatesDiscoveryProvider`'s own return type is nameable. */
export type { DiscoveryProvider } from '@zanix/server'
/** Re-exported so `defineCodeTemplatesDiscovery`'s own `options.guards` type is nameable. */
export type { MiddlewareGuard } from '@zanix/server'
