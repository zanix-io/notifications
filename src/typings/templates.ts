import type GenericSchema from 'modules/templates/handlebars/email/generic/schema.ts'
import type SmsGenericSchema from 'modules/templates/handlebars/sms/generic/schema.ts'
import type WhatsappGenericSchema from 'modules/templates/handlebars/whatsapp/generic/schema.ts'

import type { z } from 'zod'

/** Data accepted by the `sms/otp` transactional template. */
export type OTPTemplateSchema = {
  app?: string
  code: string
  ttl: number
}

/** Data accepted by the `generic` Handlebars template. */
export type GenericTemplateSchema = Partial<z.infer<typeof GenericSchema>>

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

/** Data accepted by the `sms/generic` transactional template. */
export type SmsGenericTemplateSchema = Omit<z.infer<typeof SmsGenericSchema>, 'styles'>

/** Data accepted by the `whatsapp/generic` transactional template. */
export type WhatsappGenericTemplateSchema = Omit<z.infer<typeof WhatsappGenericSchema>, 'styles'>
