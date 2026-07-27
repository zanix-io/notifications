/** Data accepted by the `sms/otp` transactional template. */
export type OTPTemplateSchema = {
  app?: string
  code: string
  ttl: number
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
export type WelcomeTemplateSchema = Omit<GenericTemplateSchema, 'message' | 'footer'> & {
  app?: string
}

/** Data accepted by the `password-changed` transactional template. */
export type PasswordChangedTemplateSchema =
  & Omit<GenericTemplateSchema, 'message' | 'footer' | 'buttonText' | 'buttonLink'>
  & { app?: string }

/** Data accepted by the `password-recovery` transactional template. */
export type PasswordRecoveryTemplateSchema =
  & Omit<GenericTemplateSchema, 'message' | 'footer' | 'buttonText' | 'buttonLink'>
  & OTPTemplateSchema

/** Data accepted by the `login-otp` transactional template. */
export type LoginWithOTPTemplateSchema = PasswordRecoveryTemplateSchema

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
