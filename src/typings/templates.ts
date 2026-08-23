import type { Notifiers } from 'typings/general.ts'

/**
 * A single "derived" template declaration — one that renders through `parent`'s content/parent
 * chain instead of owning any `.hbs` of its own (see `docs/templates.md#template-inheritance`).
 * Declared once, exported as a `derivedTemplates` array right next to its transactional wrapper
 * (e.g. `transactional/sms.ts`, `transactional/email/auth.ts`), and aggregated centrally by
 * `db/manifest.ts`'s `DERIVED_TEMPLATES` — the single source of truth both
 * `LocalTemplateBackend`'s seeding and `TemplateProvider.resolve()`'s chain walk read from, so a
 * new derived template only ever needs this one declaration, not a separate registration in
 * `db/manifest.ts` and `provider.ts` too.
 */
export interface DerivedTemplateDeclaration {
  channel: Notifiers
  name: string
  parent: string
  transform: (data: never) => Record<string, unknown>
}

/** Data accepted by the `sms/otp` transactional template. */
export type OTPTemplateSchema = {
  app?: string
  code: string
  ttl: number
}

/**
 * Data accepted by the `sms/new-login` transactional template — also the core fields composed
 * into `email/new-login`'s own schema (see {@link NewLoginEmailTemplateSchema}), same relationship
 * {@link OTPTemplateSchema} has to {@link LoginWithOTPTemplateSchema}. `time` is a caller-formatted
 * display string (e.g. `'Aug 19, 2026, 10:32 AM'`), not a `Date`/timestamp — this package never
 * assumes a locale/timezone to format one in.
 */
export type NewLoginTemplateSchema = {
  app?: string
  device: string
  time: string
  location?: string
}

/**
 * Data accepted by the `generic` Handlebars template.
 *
 * Hand-written to mirror `handlebars/email/generic/schema.ts`'s real Zod shape exactly, rather
 * than derived via `z.infer<typeof genericSchema>` — a public type deriving from an internal,
 * un-annotated Zod schema forces JSR's publish check to fully infer that schema's type to resolve
 * this one, which triggers a "slow type" (`missing-explicit-type`) error. Keeping the Zod schema
 * itself unexported and internal (used only for runtime validation in `provider.ts`'s
 * `#renderCodeBacked()`) while hand-maintaining this public-facing equivalent keeps the schema
 * free to use any Zod feature without ever affecting the published package's type-check score.
 */
export type GenericTemplateSchema = Partial<{
  html: { lang?: string; title?: string }
  styles: {
    containerClass?: string
    titleClass?: string
    contentClass?: string
    buttonClass?: string
    messageClass?: string
    footerClass?: string
    css: string
  }
  title: string
  content: string
  buttonText?: string
  buttonLink?: string
  message?: string
  footer?: string
}>

/** Data accepted by the `welcome` transactional template. */
export type WelcomeTemplateSchema =
  & Omit<GenericTemplateSchema, 'message' | 'footer'>
  & {
    app?: string
  }

/** Data accepted by the `password-changed` transactional template. */
export type PasswordChangedTemplateSchema =
  & Omit<
    GenericTemplateSchema,
    'message' | 'footer' | 'buttonText' | 'buttonLink'
  >
  & { app?: string }

/** Data accepted by the `new-login` transactional template. */
export type NewLoginEmailTemplateSchema =
  & Omit<
    GenericTemplateSchema,
    'message' | 'footer' | 'buttonText' | 'buttonLink'
  >
  & NewLoginTemplateSchema

/** Data accepted by the `password-recovery` transactional template. */
export type PasswordRecoveryTemplateSchema =
  & Omit<
    GenericTemplateSchema,
    'message' | 'footer' | 'buttonText' | 'buttonLink'
  >
  & OTPTemplateSchema

/** Data accepted by the `login-otp` transactional template. */
export type LoginWithOTPTemplateSchema = PasswordRecoveryTemplateSchema

/** A single billed line accepted by the `data-table` Handlebars template. */
export type DataTableLineItemSchema = {
  description: string
  quantity: number
  unitPrice: number
}

/** Every column/row label the `data-table` Handlebars template renders — see its own `schema.ts` doc for why these exist (the one template in this package with literal English text baked into its `.hbs`, until this). All optional, defaulting to English. */
export type DataTableLabelsSchema = {
  description?: string
  quantity?: string
  unitPrice?: string
  amount?: string
  subtotal?: string
  tax?: string
  total?: string
}

/**
 * Data accepted by the `data-table` Handlebars template — hand-written to mirror
 * `handlebars/email/data-table/schema.ts`'s real Zod shape exactly; see
 * {@link GenericTemplateSchema}'s own doc comment for why this isn't derived via `z.infer`
 * directly. Deliberately generic — a header/description block, an itemized table with computed
 * line totals, and a totals/notes footer, with no hardcoded business name, currency, locale-specific
 * number formatting, or (via `labels`) language; usable for an invoice, a receipt, an order
 * confirmation, a quote, or any other itemized-table document, nothing here assumes which.
 * `date`/`dueDate` are caller-formatted display strings (same convention as
 * {@link NewLoginTemplateSchema.time}), `currency` is an opaque label rendered next to each amount
 * rather than interpreted, and `subtotal`/`tax`/`total` are always caller-supplied since tax rules
 * are a business decision this library doesn't make.
 */
export type DataTableTemplateSchema = {
  html?: { lang?: string; title?: string }
  styles?: {
    containerClass?: string
    headerClass?: string
    tableClass?: string
    totalsClass?: string
    notesClass?: string
    css?: string
  }
  title?: string
  referenceNumber?: string
  date?: string
  dueDate?: string
  senderName?: string
  senderLogo?: string
  recipient?: string
  items: DataTableLineItemSchema[]
  currency?: string
  subtotal: number
  tax?: number
  total: number
  notes?: string
  labels?: DataTableLabelsSchema
}

/**
 * Data accepted by the `sms/generic` transactional template — hand-written to mirror
 * `handlebars/sms/generic/schema.ts`'s real Zod shape (minus `styles`, injected separately by the
 * build pipeline); see {@link GenericTemplateSchema}'s own doc comment for why this isn't derived
 * via `z.infer` directly.
 */
export type SmsGenericTemplateSchema = {
  content: string
}

/**
 * Data accepted by the `whatsapp/generic` transactional template — same shape and rationale as
 * {@link SmsGenericTemplateSchema}.
 */
export type WhatsappGenericTemplateSchema = {
  content: string
}
