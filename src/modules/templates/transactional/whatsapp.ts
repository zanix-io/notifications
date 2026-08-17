import type {
  DerivedTemplateDeclaration,
  OTPTemplateSchema,
  WhatsappGenericTemplateSchema,
} from 'typings/templates.ts'

import { execTemplate } from '../mod.ts'

/** Renders a generic WhatsApp message. */
export const generic = (
  data: WhatsappGenericTemplateSchema,
): Promise<string> => {
  return execTemplate('whatsapp/generic', data)
}

/**
 * Transforms OTP data into the shape `generic` (its parent template — see `derivedTemplates`
 * below) expects. Exposed standalone, rather than inlined in `otp()` below, so
 * `TemplateProvider.resolve()`'s database-backed parent-chain walk can apply the exact same
 * mapping when falling back to a database-edited `generic` instead of the compiled code version.
 */
export const otpToGeneric = (
  data: OTPTemplateSchema,
): WhatsappGenericTemplateSchema => ({
  content: `Your ${data.app ? data.app + ' ' : ''}verification code is ${data.code}.
It expires in ${data.ttl} minutes. Don't share this code with anyone.`,
})

/** Renders an OTP WhatsApp message */
export const otp = (data: OTPTemplateSchema): Promise<string> => {
  return execTemplate('whatsapp/generic', otpToGeneric(data))
}

/** This channel's derived templates — see `transactional/sms.ts`'s `derivedTemplates` for the full rationale. */
export const derivedTemplates: DerivedTemplateDeclaration[] = [
  {
    channel: 'whatsapp',
    name: 'otp',
    parent: 'generic',
    transform: otpToGeneric,
  },
]

/**
 * An object containing the available WhatsApp template rendering functions.
 *
 * @property {Function} generic - Renders a generic WhatsApp message. Accepts data that conforms
 *    to the `WhatsappGenericTemplateSchema`.
 * @property {Function} otp - Renders an OTP WhatsApp message. Accepts data that conforms to
 *    the `OTPTemplateSchema`.
 */
const whatsappTemplates: {
  generic: (data: WhatsappGenericTemplateSchema) => Promise<string>
  otp: (data: OTPTemplateSchema) => Promise<string>
} = {
  generic,
  otp,
}

export default whatsappTemplates
