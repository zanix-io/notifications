import type GenericSchema from 'modules/templates/handlebars/generic/schema.ts'

import type { z } from 'zod'

export type GenericTemplateSchema = Partial<z.infer<typeof GenericSchema>>

export type WelcomeTemplateSchema = Omit<GenericTemplateSchema, 'message' | 'footer'> & {
  app?: string
}

export type PasswordChangedTemplateSchema =
  & Omit<GenericTemplateSchema, 'message' | 'footer' | 'buttonText' | 'buttonLink'>
  & { app?: string }

export type PasswordRecoveryTemplateSchema =
  & Omit<GenericTemplateSchema, 'message' | 'footer' | 'buttonText' | 'buttonLink'>
  & {
    app?: string
    code: string
    ttl: number
  }

export type LoginWithOTPTemplateSchema = PasswordRecoveryTemplateSchema
