import type {
  DerivedTemplateDeclaration,
  NewLoginTemplateSchema,
  OTPTemplateSchema,
  SmsGenericTemplateSchema,
} from 'typings/templates.ts'

import type { Translator } from '../i18n.ts'

import { execTemplate } from '../mod.ts'
import { libraryTranslator } from '../library-messages.ts'

const defaultT = libraryTranslator('sms')

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
export const otpToGeneric = (
  data: OTPTemplateSchema,
  t: Translator = defaultT,
): SmsGenericTemplateSchema => ({
  content: t('sms.otp.content', {
    app: data.app ? data.app + ' ' : '',
    code: data.code,
    ttl: data.ttl,
  }),
})

/** Renders OTP SMS message */
export const otp = (data: OTPTemplateSchema, lang?: string): Promise<string> => {
  return execTemplate('sms/generic', otpToGeneric(data, libraryTranslator('sms', lang)))
}

/**
 * Transforms new-login data into the shape `generic` (its parent template — see `derivedTemplates`
 * below) expects. Exposed standalone, rather than inlined in `newLogin()` below, so
 * `TemplateProvider.resolve()`'s database-backed parent-chain walk can apply the exact same
 * mapping when falling back to a database-edited `generic` instead of the compiled code version.
 */
export const newLoginToGeneric = (
  data: NewLoginTemplateSchema,
  t: Translator = defaultT,
): SmsGenericTemplateSchema => ({
  content: t('sms.new-login.content', {
    app: data.app ? data.app + ' ' : '',
    device: data.device,
    time: data.time,
    location: data.location ? t('sms.new-login.location', { location: data.location }) : '',
  }),
})

/** Renders new-login (unrecognized device) security notification SMS message */
export const newLogin = (data: NewLoginTemplateSchema, lang?: string): Promise<string> => {
  return execTemplate('sms/generic', newLoginToGeneric(data, libraryTranslator('sms', lang)))
}

/**
 * This channel's derived templates (see `typings/templates.ts`'s `DerivedTemplateDeclaration`) —
 * aggregated centrally by `db/manifest.ts`'s `DERIVED_TEMPLATES`, the single source of truth both
 * database-backed seeding and `TemplateProvider.resolve()`'s chain walk read from. Adding a new
 * derived SMS template only ever needs an entry here, not a separate registration elsewhere.
 */
export const derivedTemplates: DerivedTemplateDeclaration[] = [
  {
    channel: 'sms',
    name: 'otp',
    parent: 'generic',
    transform: otpToGeneric,
    starter: {
      content: "t 'sms.otp.content' app=(withSuffix app ' ') code=code ttl=ttl",
    },
  },
  {
    channel: 'sms',
    name: 'new-login',
    parent: 'generic',
    transform: newLoginToGeneric,
    starter: {
      // The transform fills `location` with a second text, present only when the send has one.
      content: {
        fragment: '{{#if location}}' +
          "{{{t 'sms.new-login.content' app=(withSuffix app ' ') device=device time=time " +
          "location=(t 'sms.new-login.location' location=location)}}}" +
          '{{else}}' +
          "{{{t 'sms.new-login.content' app=(withSuffix app ' ') device=device time=time location=''}}}" +
          '{{/if}}',
      },
    },
  },
]

/**
 * An object containing the available SMS template rendering functions.
 *
 * @property {Function} generic - Renders a generic SMS message. Accepts data that conforms to
 *    the `SmsGenericTemplateSchema`.
 * @property {Function} otp - Renders a OTP SMS message. Accepts data that conforms to
 *    the `OTPTemplateSchema`.
 * @property {Function} 'new-login' - Renders a new-login (unrecognized device) security
 *    notification SMS message. Accepts data that conforms to the `NewLoginTemplateSchema`.
 */
const smsTemplates: {
  generic: (data: SmsGenericTemplateSchema) => Promise<string>
  otp: (data: OTPTemplateSchema, lang?: string) => Promise<string>
  'new-login': (data: NewLoginTemplateSchema, lang?: string) => Promise<string>
} = {
  generic,
  otp,
  'new-login': newLogin,
}

export default smsTemplates
