import type { OTPTemplateSchema, SmsGenericTemplateSchema } from 'typings/templates.ts'

import { execTemplate } from '../mod.ts'

/** Renders a generic SMS message. */
export const generic = (data: SmsGenericTemplateSchema): Promise<string> => {
  return execTemplate('sms/generic', data)
}

/** Renders OTP SMS message */
export const otp = (data: OTPTemplateSchema): Promise<string> => {
  return execTemplate('sms/generic', {
    content: `Your ${data.app ? data.app + ' ' : ''}verification code is ${data.code}. 
It expires in ${data.ttl} minutes. Don't share this code with anyone.`,
  })
}

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
