import type {
  DerivedTemplateDeclaration,
  OTPTemplateSchema,
  SmsGenericTemplateSchema,
} from 'typings/templates.ts'

import { execTemplate } from '../mod.ts'

/** Renders a generic SMS message. */
export const generic = (data: SmsGenericTemplateSchema): Promise<string> => {
  return execTemplate('sms/generic', data)
}

/**
 * Transforms OTP data into the shape `generic` (its parent template — see `derivedTemplates`
 * below) expects. Exposed standalone, rather than inlined in `otp()` below, so
 * `TemplateProvider.resolve()`'s database-backed parent-chain walk can apply the exact same
 * mapping when falling back to a database-edited `generic` instead of the compiled code version.
 */
export const otpToGeneric = (data: OTPTemplateSchema): SmsGenericTemplateSchema => ({
  content: `Your ${data.app ? data.app + ' ' : ''}verification code is ${data.code}. 
It expires in ${data.ttl} minutes. Don't share this code with anyone.`,
})

/** Renders OTP SMS message */
export const otp = (data: OTPTemplateSchema): Promise<string> => {
  return execTemplate('sms/generic', otpToGeneric(data))
}

/**
 * This channel's derived templates (see `typings/templates.ts`'s `DerivedTemplateDeclaration`) —
 * aggregated centrally by `db/manifest.ts`'s `DERIVED_TEMPLATES`, the single source of truth both
 * database-backed seeding and `TemplateProvider.resolve()`'s chain walk read from. Adding a new
 * derived SMS template only ever needs an entry here, not a separate registration elsewhere.
 */
export const derivedTemplates: DerivedTemplateDeclaration[] = [
  { channel: 'sms', name: 'otp', parent: 'generic', transform: otpToGeneric },
]

/**
 * An object containing the available SMS template rendering functions.
 *
 * @property {Function} generic - Renders a generic SMS message. Accepts data that conforms to
 *    the `SmsGenericTemplateSchema`.
 * @property {Function} otp - Renders a OTP SMS message. Accepts data that conforms to
 *    the `OTPTemplateSchema`.
 */
const smsTemplates: {
  generic: (data: SmsGenericTemplateSchema) => Promise<string>
  otp: (data: OTPTemplateSchema) => Promise<string>
} = {
  generic,
  otp,
}

export default smsTemplates
