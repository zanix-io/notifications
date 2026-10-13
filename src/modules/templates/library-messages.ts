import type { Notifiers } from 'typings/general.ts'

import { createTranslator, langChain, type MessageCatalog, type Translator } from './i18n.ts'

/**
 * The words of the library's own transactional templates (`welcome`, `login-otp`, the SMS `otp`...),
 * as a message catalog: the same `{lang, key}` texts a consumer's templates read with `{{t}}`. The
 * derived templates build their data from these keys, so a language is a set of texts and not a
 * copy of the template.
 *
 * Keys follow the template: `<name>.title`, `<name>.content`, `<name>.message` and, for an email,
 * `<name>.subject`; an SMS or WhatsApp message is `<channel>.<name>.content`. `footer.rights` is the
 * line every email ends with. A consumer overrides any of them by registering the same key
 * (`registerTemplateSeeds({ messages })`): the library's texts are registered first.
 *
 * Both languages ship here; any other language falls back to `NOTIFICATIONS_DEFAULT_LANG`.
 */
export const LIBRARY_MESSAGES: MessageCatalog = {
  en: {
    'lang.code': 'en',
    'footer.rights': '© {year} {app}. All rights reserved.',

    'welcome.subject': 'Welcome',
    'welcome.title': 'Welcome, Astronaut!',
    'welcome.content':
      'Greetings, Space Explorer!<br><br>We’re thrilled to have you aboard {app}, your mission control for an out-of-this-world experience. 🚀<br>Prepare to explore new features, discover exciting tools, and launch your journey to the stars with us.<br>Your adventure starts now - we promise it will be stellar!',

    'password-changed.subject': 'Your password was changed',
    'password-changed.title': 'Password Successfully Changed',
    'password-changed.content':
      "<p>We wanted to let you know that your password has been successfully changed.</p><p>If you didn't make this change, please contact support immediately.</p><p>For security reasons, please do not share your password with anyone. If you need assistance, feel free to reach out to us.</p>",

    'new-login.subject': 'New login detected',
    'new-login.title': 'New Login Detected',
    'new-login.content':
      '<p>We noticed a login to your account from a new device.</p><p><strong>Device:</strong> {device}</p><p><strong>Time:</strong> {time}</p>',
    'new-login.location': '<p><strong>Location:</strong> {location}</p>',
    'new-login.outro':
      "<p>If this was you, no action is needed. If you don't recognize this activity, please secure your account immediately.</p>",

    'login-otp.subject': 'Your code for login',
    'login-otp.title': 'Your code for Login',
    'login-otp.content':
      '<p>We received a login request for your account. To complete your login, please use the One-Time Password (OTP) below:</p>',
    'login-otp.message':
      'This OTP is valid for {ttl} minutes. If you did not request this login, please disregard this email.\nFor additional security, please do not share this OTP with anyone.',

    'password-recovery.subject': 'Password recovery',
    'password-recovery.title': 'Password Recovery Request',
    'password-recovery.content':
      '<p>We have received a request to reset your password. Use the following code to proceed:</p>',
    'password-recovery.message':
      'This OTP is valid for {ttl} minutes. If you did not request this change, please ignore this email.\nFor additional security, please do not share this OTP with anyone.',

    'sms.otp.content':
      "Your {app}verification code is {code}. It expires in {ttl} minutes. Don't share this code with anyone.",
    'sms.new-login.content':
      "{app}New login detected on your account from {device} at {time}{location}. If this wasn't you, secure your account immediately.",
    'sms.new-login.location': ' ({location})',

    'whatsapp.otp.content':
      "Your {app}verification code is {code}. It expires in {ttl} minutes. Don't share this code with anyone.",
  },
  es: {
    'lang.code': 'es',
    'footer.rights': '© {year} {app}. Todos los derechos reservados.',

    'welcome.subject': 'Te damos la bienvenida',
    'welcome.title': '¡Te damos la bienvenida!',
    'welcome.content':
      '¡Hola!<br><br>Nos alegra tenerte en {app}.<br>Empieza a explorar las novedades y las herramientas que tenemos para ti.<br>Tu experiencia comienza ahora.',

    'password-changed.subject': 'Cambiaste tu contraseña',
    'password-changed.title': 'Contraseña cambiada',
    'password-changed.content':
      '<p>Te avisamos que tu contraseña se cambió correctamente.</p><p>Si no hiciste este cambio, contacta a soporte de inmediato.</p><p>Por seguridad, no compartas tu contraseña con nadie. Si necesitas ayuda, escríbenos.</p>',

    'new-login.subject': 'Nuevo inicio de sesión',
    'new-login.title': 'Nuevo inicio de sesión',
    'new-login.content':
      '<p>Detectamos un inicio de sesión en tu cuenta desde un dispositivo nuevo.</p><p><strong>Dispositivo:</strong> {device}</p><p><strong>Hora:</strong> {time}</p>',
    'new-login.location': '<p><strong>Ubicación:</strong> {location}</p>',
    'new-login.outro':
      '<p>Si fuiste tú, no tienes que hacer nada. Si no reconoces esta actividad, protege tu cuenta de inmediato.</p>',

    'login-otp.subject': 'Tu código de acceso',
    'login-otp.title': 'Tu código de acceso',
    'login-otp.content':
      '<p>Recibimos una solicitud para iniciar sesión en tu cuenta. Para completarla, usa este código de un solo uso:</p>',
    'login-otp.message':
      'Este código es válido por {ttl} minutos. Si no solicitaste este acceso, ignora este correo.\nPor seguridad, no compartas este código con nadie.',

    'password-recovery.subject': 'Recupera tu contraseña',
    'password-recovery.title': 'Recuperación de contraseña',
    'password-recovery.content':
      '<p>Recibimos una solicitud para restablecer tu contraseña. Usa este código para continuar:</p>',
    'password-recovery.message':
      'Este código es válido por {ttl} minutos. Si no solicitaste este cambio, ignora este correo.\nPor seguridad, no compartas este código con nadie.',

    'sms.otp.content':
      'Tu código de verificación de {app}es {code}. Vence en {ttl} minutos. No lo compartas con nadie.',
    'sms.new-login.content':
      '{app}Nuevo acceso a tu cuenta desde {device} el {time}{location}. Si no fuiste tú, protege tu cuenta de inmediato.',
    'sms.new-login.location': ' ({location})',

    'whatsapp.otp.content':
      'Tu código de verificación de {app}es {code}. Vence en {ttl} minutos. No lo compartas con nadie.',
  },
}

/**
 * The translator the library's own templates build their data with when no database catalog is in
 * play (the code registry): the texts of {@linkcode LIBRARY_MESSAGES} in the language of the message.
 *
 * @param channel The channel the message goes to; an email escapes the values it fills in.
 * @param lang The language of the message, as a BCP 47 tag.
 */
export function libraryTranslator(channel: Notifiers, lang?: string): Translator {
  return createTranslator(LIBRARY_MESSAGES, langChain(lang), channel === 'email')
}

/**
 * A database catalog with the library's own texts beneath it, per language: what the library's derived
 * templates build their data from, so a text an operator deleted, or a catalog that does not have the
 * library's texts yet (a central service on an older version), never shows as a bare key.
 *
 * @param catalog The catalog loaded from the backend.
 */
export function withLibraryTexts(catalog: MessageCatalog): MessageCatalog {
  const merged: MessageCatalog = {}
  for (const lang of new Set([...Object.keys(LIBRARY_MESSAGES), ...Object.keys(catalog)])) {
    merged[lang] = { ...LIBRARY_MESSAGES[lang], ...catalog[lang] }
  }
  return merged
}
