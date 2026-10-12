import type {
  DerivedTemplateDeclaration,
  OTPTemplateSchema,
  WhatsappGenericTemplateSchema,
} from 'typings/templates.ts'

import type { Translator } from '../i18n.ts'

import { execTemplate } from '../mod.ts'
import { libraryTranslator } from '../library-messages.ts'

const defaultT = libraryTranslator('whatsapp')

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
  t: Translator = defaultT,
): WhatsappGenericTemplateSchema => ({
  content: t('whatsapp.otp.content', {
    app: data.app ? data.app + ' ' : '',
    code: data.code,
    ttl: data.ttl,
  }),
})

export const otp = (data: OTPTemplateSchema, lang?: string): Promise<string> => {
  return execTemplate('whatsapp/generic', otpToGeneric(data, libraryTranslator('whatsapp', lang)))
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
  otp: (data: OTPTemplateSchema, lang?: string) => Promise<string>
} = {
  generic,
  otp,
}

export default whatsappTemplates
