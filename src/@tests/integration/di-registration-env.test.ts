import { SmtpClient } from '../../modules/email/connector.ts'
import { SmsClient } from '../../modules/sms/connector.ts'
import { VonageSmsAdapter } from '../../modules/sms/vonage.ts'
import { WhatsappClient } from '../../modules/whatsapp/connector.ts'
import { TwilioWhatsappAdapter } from '../../modules/whatsapp/twilio.ts'

console.error = () => {}

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

const VONAGE_ENV = {
  VONAGE_API_KEY: 'test_api_key',
  VONAGE_API_SECRET: 'test_api_secret',
  VONAGE_FROM: 'AcmeInc',
}

Deno.test(
  'email/defs.ts registers the SMTP connector and sets SmtpClient.config when SMTP env vars are present',
  async () => {
    for (const [key, value] of Object.entries(SMTP_ENV)) {
      Deno.env.set(key, value)
    }

    try {
      // Cache-busting query: `di-registration.test.ts` and `functional/emails.test.ts` also
      // import this exact specifier — without a unique query each would share Deno's module
      // cache and only the first import across the whole test process would actually run
      // `registerSmtpConnector()`'s top-level side effect.
      await import('../../modules/email/defs.ts?smtp-present')

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
    for (const [key, value] of Object.entries(TWILIO_ENV)) {
      Deno.env.set(key, value)
    }

    try {
      // Cache-busting query: `di-registration.test.ts` also imports this exact specifier — see
      // the same note on the SMTP case above.
      await import('../../modules/sms/defs.ts?twilio-present')

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
    for (const [key, value] of Object.entries(META_ENV)) {
      Deno.env.set(key, value)
    }

    try {
      // Cache-busting query: `di-registration.test.ts` also imports this exact specifier — see
      // the same note on the SMTP case above.
      await import('../../modules/whatsapp/defs.ts?meta-present')

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
    for (const [key, value] of Object.entries(TWILIO_WHATSAPP_ENV)) {
      Deno.env.set(key, value)
    }

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

Deno.test(
  'whatsapp/defs.ts throws at import time when both Meta and Twilio env vars are set with no WHATSAPP_PROVIDER selected',
  async () => {
    for (const [key, value] of Object.entries({ ...META_ENV, ...TWILIO_WHATSAPP_ENV })) {
      Deno.env.set(key, value)
    }

    try {
      let threw = false
      try {
        await import('../../modules/whatsapp/defs.ts?both-providers')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(
          'Expected whatsapp/defs.ts to throw when both providers are configured without WHATSAPP_PROVIDER',
        )
      }
    } finally {
      for (const key of Object.keys({ ...META_ENV, ...TWILIO_WHATSAPP_ENV })) Deno.env.delete(key)
    }
  },
)

Deno.test(
  'whatsapp/defs.ts honors an explicit WHATSAPP_PROVIDER=meta even when both providers env vars are set',
  async () => {
    for (const [key, value] of Object.entries({ ...META_ENV, ...TWILIO_WHATSAPP_ENV })) {
      Deno.env.set(key, value)
    }
    Deno.env.set('WHATSAPP_PROVIDER', 'meta')

    try {
      await import('../../modules/whatsapp/defs.ts?both-providers-explicit-meta')

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
      for (const key of Object.keys({ ...META_ENV, ...TWILIO_WHATSAPP_ENV })) Deno.env.delete(key)
      Deno.env.delete('WHATSAPP_PROVIDER')
    }
  },
)

Deno.test(
  'whatsapp/defs.ts honors an explicit WHATSAPP_PROVIDER=twilio even when both providers env vars are set',
  async () => {
    for (const [key, value] of Object.entries({ ...META_ENV, ...TWILIO_WHATSAPP_ENV })) {
      Deno.env.set(key, value)
    }
    Deno.env.set('WHATSAPP_PROVIDER', 'twilio')

    try {
      await import('../../modules/whatsapp/defs.ts?both-providers-explicit-twilio')

      if (!(WhatsappClient.config.adapter instanceof TwilioWhatsappAdapter)) {
        throw new Error(
          `Expected WhatsappClient.config.adapter to be a TwilioWhatsappAdapter, got: ${
            Deno.inspect(WhatsappClient.config.adapter)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys({ ...META_ENV, ...TWILIO_WHATSAPP_ENV })) Deno.env.delete(key)
      Deno.env.delete('WHATSAPP_PROVIDER')
    }
  },
)

Deno.test(
  'whatsapp/defs.ts throws at import time when WHATSAPP_PROVIDER is set to an invalid value',
  async () => {
    Deno.env.set('WHATSAPP_PROVIDER', 'nope')

    try {
      let threw = false
      try {
        await import('../../modules/whatsapp/defs.ts?invalid-provider')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error('Expected whatsapp/defs.ts to throw on an invalid WHATSAPP_PROVIDER value')
      }
    } finally {
      Deno.env.delete('WHATSAPP_PROVIDER')
    }
  },
)

Deno.test(
  'whatsapp/defs.ts throws at import time when WHATSAPP_PROVIDER=twilio is set without Twilio env vars',
  async () => {
    Deno.env.set('WHATSAPP_PROVIDER', 'twilio')

    try {
      let threw = false
      try {
        await import('../../modules/whatsapp/defs.ts?twilio-missing-config')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(
          'Expected whatsapp/defs.ts to throw when WHATSAPP_PROVIDER=twilio lacks its required env vars',
        )
      }
    } finally {
      Deno.env.delete('WHATSAPP_PROVIDER')
    }
  },
)

Deno.test(
  'whatsapp/defs.ts throws at import time when WHATSAPP_PROVIDER=meta is set without Meta env vars',
  async () => {
    Deno.env.set('WHATSAPP_PROVIDER', 'meta')

    try {
      let threw = false
      try {
        await import('../../modules/whatsapp/defs.ts?meta-missing-config')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(
          'Expected whatsapp/defs.ts to throw when WHATSAPP_PROVIDER=meta lacks its required env vars',
        )
      }
    } finally {
      Deno.env.delete('WHATSAPP_PROVIDER')
    }
  },
)

Deno.test(
  'sms/defs.ts registers via VonageSmsAdapter when only Vonage env vars are present (no Twilio)',
  async () => {
    for (const [key, value] of Object.entries(VONAGE_ENV)) {
      Deno.env.set(key, value)
    }

    try {
      // Cache-busting query: an earlier test already imported this exact specifier (its top-level
      // registerConnector() only ever runs once per cached module), so a plain re-import here would
      // just return that cached module without re-running it.
      await import('../../modules/sms/defs.ts?vonage-fallback')

      if (!(SmsClient.config.adapter instanceof VonageSmsAdapter)) {
        throw new Error(
          `Expected SmsClient.config.adapter to be a VonageSmsAdapter, got: ${
            Deno.inspect(SmsClient.config.adapter)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys(VONAGE_ENV)) Deno.env.delete(key)
    }
  },
)

Deno.test(
  'sms/defs.ts throws at import time when both Twilio and Vonage env vars are set with no SMS_PROVIDER selected',
  async () => {
    for (const [key, value] of Object.entries({ ...TWILIO_ENV, ...VONAGE_ENV })) {
      Deno.env.set(key, value)
    }

    try {
      let threw = false
      try {
        await import('../../modules/sms/defs.ts?both-providers')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(
          'Expected sms/defs.ts to throw when both providers are configured without SMS_PROVIDER',
        )
      }
    } finally {
      for (const key of Object.keys({ ...TWILIO_ENV, ...VONAGE_ENV })) Deno.env.delete(key)
    }
  },
)

Deno.test(
  'sms/defs.ts honors an explicit SMS_PROVIDER=twilio even when both providers env vars are set',
  async () => {
    for (const [key, value] of Object.entries({ ...TWILIO_ENV, ...VONAGE_ENV })) {
      Deno.env.set(key, value)
    }
    Deno.env.set('SMS_PROVIDER', 'twilio')

    try {
      await import('../../modules/sms/defs.ts?both-providers-explicit-twilio')

      if (SmsClient.config.adapter) {
        throw new Error(
          `Expected no custom adapter (Twilio is built from merged config fields), got: ${
            Deno.inspect(SmsClient.config.adapter)
          }`,
        )
      }
      if (SmsClient.config.accountSid !== TWILIO_ENV.TWILIO_ACCOUNT_SID) {
        throw new Error(
          `Expected SmsClient.config.accountSid to be Twilio's, got: ${
            Deno.inspect(SmsClient.config.accountSid)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys({ ...TWILIO_ENV, ...VONAGE_ENV })) Deno.env.delete(key)
      Deno.env.delete('SMS_PROVIDER')
    }
  },
)

Deno.test(
  'sms/defs.ts honors an explicit SMS_PROVIDER=vonage even when both providers env vars are set',
  async () => {
    for (const [key, value] of Object.entries({ ...TWILIO_ENV, ...VONAGE_ENV })) {
      Deno.env.set(key, value)
    }
    Deno.env.set('SMS_PROVIDER', 'vonage')

    try {
      await import('../../modules/sms/defs.ts?both-providers-explicit-vonage')

      if (!(SmsClient.config.adapter instanceof VonageSmsAdapter)) {
        throw new Error(
          `Expected SmsClient.config.adapter to be a VonageSmsAdapter, got: ${
            Deno.inspect(SmsClient.config.adapter)
          }`,
        )
      }
    } finally {
      for (const key of Object.keys({ ...TWILIO_ENV, ...VONAGE_ENV })) Deno.env.delete(key)
      Deno.env.delete('SMS_PROVIDER')
    }
  },
)

Deno.test(
  'sms/defs.ts throws at import time when SMS_PROVIDER is set to an invalid value',
  async () => {
    Deno.env.set('SMS_PROVIDER', 'nope')

    try {
      let threw = false
      try {
        await import('../../modules/sms/defs.ts?invalid-provider')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error('Expected sms/defs.ts to throw on an invalid SMS_PROVIDER value')
      }
    } finally {
      Deno.env.delete('SMS_PROVIDER')
    }
  },
)

Deno.test(
  'sms/defs.ts throws at import time when SMS_PROVIDER=vonage is set without Vonage env vars',
  async () => {
    Deno.env.set('SMS_PROVIDER', 'vonage')

    try {
      let threw = false
      try {
        await import('../../modules/sms/defs.ts?vonage-missing-config')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(
          'Expected sms/defs.ts to throw when SMS_PROVIDER=vonage lacks its required env vars',
        )
      }
    } finally {
      Deno.env.delete('SMS_PROVIDER')
    }
  },
)

Deno.test(
  'sms/defs.ts throws at import time when SMS_PROVIDER=twilio is set without Twilio env vars',
  async () => {
    Deno.env.set('SMS_PROVIDER', 'twilio')

    try {
      let threw = false
      try {
        await import('../../modules/sms/defs.ts?twilio-missing-config')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(
          'Expected sms/defs.ts to throw when SMS_PROVIDER=twilio lacks its required env vars',
        )
      }
    } finally {
      Deno.env.delete('SMS_PROVIDER')
    }
  },
)
