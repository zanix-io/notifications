import type { OTPTemplateSchema, WhatsappGenericTemplateSchema } from 'typings/templates.ts'

import { execTemplate } from '../mod.ts'

/** Renders a generic WhatsApp message. */
export const generic = (data: WhatsappGenericTemplateSchema): Promise<string> => {
  return execTemplate('whatsapp/generic', data)
}

/** Renders an OTP WhatsApp message */
export const otp = (data: OTPTemplateSchema): Promise<string> => {
  return execTemplate('whatsapp/generic', {
    content: `Your ${data.app ? data.app + ' ' : ''}verification code is ${data.code}.
It expires in ${data.ttl} minutes. Don't share this code with anyone.`,
  })
}

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
