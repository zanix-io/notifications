import type {
  DerivedTemplateDeclaration,
  GenericTemplateSchema,
  LoginWithOTPTemplateSchema,
  NewLoginEmailTemplateSchema,
  PasswordChangedTemplateSchema,
  PasswordRecoveryTemplateSchema,
  WelcomeTemplateSchema,
} from 'typings/templates.ts'

import type { Translator } from '../../i18n.ts'

import { execTemplate } from '../../mod.ts'
import { libraryTranslator } from '../../library-messages.ts'

const defaultT = libraryTranslator('email')

const rights = (t: Translator, app: string) =>
  t('footer.rights', { year: new Date().getFullYear(), app })

/**
 * Transforms welcome data into the shape `generic` (its parent template — see `db/manifest.ts`'s
 * `DERIVED_TEMPLATES`) expects. Exposed standalone, rather than inlined in `welcome()` below, so
 * `TemplateProvider.resolve()`'s database-backed parent-chain walk can apply the exact same
 * mapping when falling back to a database-edited `generic` instead of the compiled code version.
 */
export const welcomeToGeneric = (
  data: WelcomeTemplateSchema = {},
  t: Translator = defaultT,
): GenericTemplateSchema => {
  const { app = 'Zanix', html = { title: 'Welcome Email' }, ...content } = data
  return {
    title: t('welcome.title'),
    content: t('welcome.content', { app }),
    footer: rights(t, app),
    html,
    ...content,
  }
}

export const welcome = (data?: WelcomeTemplateSchema, lang?: string): Promise<string> => {
  return execTemplate('email/generic', welcomeToGeneric(data, libraryTranslator('email', lang)))
}

/** Transforms password-changed data into `generic`'s shape — see `welcomeToGeneric()` above. */
export const passwordChangedToGeneric = (
  data: PasswordChangedTemplateSchema = {},
  t: Translator = defaultT,
): GenericTemplateSchema => {
  const { app = 'Zanix', html = { title: 'Password Changed' }, ...content } = data
  return {
    title: t('password-changed.title'),
    content: t('password-changed.content'),
    footer: rights(t, app),
    html,
    ...content,
  }
}

export const passwordChanged = (
  data?: PasswordChangedTemplateSchema,
  lang?: string,
): Promise<string> => {
  return execTemplate(
    'email/generic',
    passwordChangedToGeneric(data, libraryTranslator('email', lang)),
  )
}

/** Transforms new-login data into `generic`'s shape — see `welcomeToGeneric()` above. */
export const newLoginToGeneric = (
  data: NewLoginEmailTemplateSchema,
  t: Translator = defaultT,
): GenericTemplateSchema => {
  const {
    app = 'Zanix',
    html = { title: 'New Login Detected' },
    device,
    time,
    location,
    ...content
  } = data
  return {
    title: t('new-login.title'),
    // Three texts joined, not one with the location nested in it: a value is escaped in an email,
    // and the location line is markup.
    content: [
      t('new-login.content', { device, time }),
      location ? t('new-login.location', { location }) : '',
      t('new-login.outro'),
    ].join(''),
    footer: rights(t, app),
    html,
    ...content,
  }
}

export const newLogin = (
  data: NewLoginEmailTemplateSchema,
  lang?: string,
): Promise<string> => {
  return execTemplate('email/generic', newLoginToGeneric(data, libraryTranslator('email', lang)))
}

/** Transforms login-OTP data into `generic`'s shape — see `welcomeToGeneric()` above. */
export const loginWithOTPToGeneric = (
  data: LoginWithOTPTemplateSchema = { code: '123456', ttl: 5 },
  t: Translator = defaultT,
): GenericTemplateSchema => {
  const { app = 'Zanix', html = { title: 'Login OTP' }, ...content } = data
  return {
    title: t('login-otp.title'),
    content: t('login-otp.content'),
    buttonText: data.code,
    message: t('login-otp.message', { ttl: data.ttl }),
    footer: rights(t, app),
    html,
    ...content,
  }
}

export const loginWithOTP = (
  data?: LoginWithOTPTemplateSchema,
  lang?: string,
): Promise<string> => {
  return execTemplate(
    'email/generic',
    loginWithOTPToGeneric(data, libraryTranslator('email', lang)),
  )
}

/** Transforms password-recovery data into `generic`'s shape — see `welcomeToGeneric()` above. */
export const passwordRecoveryToGeneric = (
  data: PasswordRecoveryTemplateSchema = { code: '123456', ttl: 5 },
  t: Translator = defaultT,
): GenericTemplateSchema => {
  const { app = 'Zanix', html = { title: 'Password Recovery' }, ...content } = data
  return {
    title: t('password-recovery.title'),
    content: t('password-recovery.content'),
    buttonText: data.code,
    message: t('password-recovery.message', { ttl: data.ttl }),
    footer: rights(t, app),
    html,
    ...content,
  }
}

export const passwordRecovery = (
  data?: PasswordRecoveryTemplateSchema,
  lang?: string,
): Promise<string> => {
  return execTemplate(
    'email/generic',
    passwordRecoveryToGeneric(data, libraryTranslator('email', lang)),
  )
}

/** This channel's derived templates — see `transactional/sms.ts`'s `derivedTemplates` for the full rationale. */
export const derivedTemplates: DerivedTemplateDeclaration[] = [
  {
    channel: 'email',
    name: 'welcome',
    parent: 'generic',
    transform: welcomeToGeneric,
  },
  {
    channel: 'email',
    name: 'password-changed',
    parent: 'generic',
    transform: passwordChangedToGeneric,
  },
  {
    channel: 'email',
    name: 'password-recovery',
    parent: 'generic',
    transform: passwordRecoveryToGeneric,
  },
  {
    channel: 'email',
    name: 'login-otp',
    parent: 'generic',
    transform: loginWithOTPToGeneric,
  },
  {
    channel: 'email',
    name: 'new-login',
    parent: 'generic',
    transform: newLoginToGeneric,
  },
]
