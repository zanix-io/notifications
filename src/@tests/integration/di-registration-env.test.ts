import { SmtpClient } from '../../modules/email/connector.ts'
import { SmsClient } from '../../modules/sms/connector.ts'
import { WhatsappClient } from '../../modules/whatsapp/connector.ts'
import { TwilioWhatsappAdapter } from '../../modules/whatsapp/twilio.ts'

const SMTP_ENV = {
  SMTP_PORT: '465',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'noreply@example.com',
  SMTP_PASSWORD: 'super-secret',
}

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: 'AC_test_sid',
  TWILIO_AUTH_TOKEN: 'test_auth_token',
  TWILIO_FROM_NUMBER: '+15005550006',
}

const META_ENV = {
  META_PHONE_NUMBER_ID: '123456789',
  META_ACCESS_TOKEN: 'test_access_token',
}

const TWILIO_WHATSAPP_ENV = {
  TWILIO_ACCOUNT_SID: 'AC_test_sid',
  TWILIO_AUTH_TOKEN: 'test_auth_token',
  TWILIO_WHATSAPP_FROM: '+14155238886',
}

Deno.test(
  'email/defs.ts registers the SMTP connector and sets SmtpClient.config when SMTP env vars are present',
  async () => {
    for (const [key, value] of Object.entries(SMTP_ENV)) Deno.env.set(key, value)

    try {
      await import('../../modules/email/defs.ts')

      const expected = {
        port: 465,
        hostname: SMTP_ENV.SMTP_HOST,
        password: SMTP_ENV.SMTP_PASSWORD,
        username: SMTP_ENV.SMTP_USER,
      }

      if (Deno.inspect(SmtpClient.config) !== Deno.inspect(expected)) {
        throw new Error(
          `Expected SmtpClient.config to equal ${Deno.inspect(expected)}, got: ${
            Deno.inspect(SmtpClient.config)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys(SMTP_ENV)) Deno.env.delete(key)
    }
  },
)

Deno.test(
  'sms/defs.ts registers the SMS connector and sets SmsClient.config when Twilio env vars are present',
  async () => {
    for (const [key, value] of Object.entries(TWILIO_ENV)) Deno.env.set(key, value)

    try {
      await import('../../modules/sms/defs.ts')

      const expected = {
        accountSid: TWILIO_ENV.TWILIO_ACCOUNT_SID,
        authToken: TWILIO_ENV.TWILIO_AUTH_TOKEN,
        from: TWILIO_ENV.TWILIO_FROM_NUMBER,
      }

      delete SmsClient.config.apiBase

      if (Deno.inspect(SmsClient.config) !== Deno.inspect(expected)) {
        throw new Error(
          `Expected SmsClient.config to equal ${Deno.inspect(expected)}, got: ${
            Deno.inspect(SmsClient.config)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys(TWILIO_ENV)) Deno.env.delete(key)
    }
  },
)

Deno.test(
  'whatsapp/defs.ts registers the WhatsApp connector and sets WhatsappClient.config when Meta env vars are present',
  async () => {
    for (const [key, value] of Object.entries(META_ENV)) Deno.env.set(key, value)

    try {
      await import('../../modules/whatsapp/defs.ts')

      const expected = {
        phoneNumberId: META_ENV.META_PHONE_NUMBER_ID,
        accessToken: META_ENV.META_ACCESS_TOKEN,
      }

      delete WhatsappClient.config.apiBase
      delete WhatsappClient.config.apiVersion

      if (Deno.inspect(WhatsappClient.config) !== Deno.inspect(expected)) {
        throw new Error(
          `Expected WhatsappClient.config to equal ${Deno.inspect(expected)}, got: ${
            Deno.inspect(WhatsappClient.config)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys(META_ENV)) Deno.env.delete(key)
    }
  },
)

Deno.test(
  'whatsapp/defs.ts registers via TwilioWhatsappAdapter when only Twilio env vars are present (no Meta)',
  async () => {
    for (const [key, value] of Object.entries(TWILIO_WHATSAPP_ENV)) Deno.env.set(key, value)

    try {
      // Cache-busting query: the preceding test already imported this exact specifier (its
      // top-level registerConnector() only ever runs once per cached module), so a plain
      // re-import here would just return that cached module without re-running it.
      await import('../../modules/whatsapp/defs.ts?twilio-fallback')

      if (!(WhatsappClient.config.adapter instanceof TwilioWhatsappAdapter)) {
        throw new Error(
          `Expected WhatsappClient.config.adapter to be a TwilioWhatsappAdapter, got: ${
            Deno.inspect(WhatsappClient.config.adapter)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys(TWILIO_WHATSAPP_ENV)) Deno.env.delete(key)
    }
  },
)
