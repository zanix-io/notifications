import { SmtpClient } from '../../modules/email/connector.ts'
import { SmsClient } from '../../modules/sms/connector.ts'
import { WhatsappClient } from '../../modules/whatsapp/connector.ts'
import { NotifierProvider } from '../../modules/providers/notifier.ts'
import { TemplateProvider } from '../../modules/templates/provider.ts'

console.error = () => {}

Deno.test(
  'providers/core.ts registers NotifierProvider under the notifications core key without throwing',
  async () => {
    await import('../../modules/providers/core.ts')
  },
)

Deno.test(
  'templates/core.ts registers TemplateProvider under its own class identity, resolvable via this.providers.get(TemplateProvider)',
  async () => {
    await import('../../modules/templates/core.ts')

    // Regression guard: registering a wrapping subclass (`class _TemplateProvider extends
    // TemplateProvider {}`) instead of decorating `TemplateProvider` directly would register a
    // DIFFERENT, unreachable class identity — this.providers.get(TemplateProvider) would throw
    // (see `templates/core.ts`'s own doc comment for why).
    // deno-lint-ignore no-explicit-any
    const instance = (new NotifierProvider() as any).providers.get(TemplateProvider)
    if (!(instance instanceof TemplateProvider)) {
      throw new Error('Expected this.providers.get(TemplateProvider) to resolve a TemplateProvider')
    }
  },
)

Deno.test(
  'templates/core.ts throws at import time when TEMPLATES_SERVICE_URL and TEMPLATES_MODEL_NAME are both set',
  async () => {
    Deno.env.set('TEMPLATES_SERVICE_URL', 'https://templates.internal.example')
    Deno.env.set('TEMPLATES_MODEL_NAME', 'zanix-templates')

    try {
      // A distinct query string forces Deno to re-evaluate this module's top-level code (a fresh
      // module-graph entry) instead of returning the already-cached instance from the earlier
      // "registers TemplateProvider" test above — `./provider.ts`'s own specifier is unaffected,
      // so `TemplateProvider`/env constants still resolve to the SAME cached instances.
      let threw = false
      try {
        await import('../../modules/templates/core.ts?conflict-test')
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error('Expected templates/core.ts to throw when both env vars are set')
      }
    } finally {
      Deno.env.delete('TEMPLATES_SERVICE_URL')
      Deno.env.delete('TEMPLATES_MODEL_NAME')
    }
  },
)

Deno.test(
  'email/defs.ts skips connector registration when SMTP env vars are missing',
  async () => {
    for (const key of ['SMTP_PORT', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) {
      Deno.env.delete(key)
    }

    await import('../../modules/email/defs.ts')

    if (SmtpClient.config !== undefined) {
      throw new Error(
        `Expected SmtpClient.config to remain undefined, got: ${Deno.inspect(SmtpClient.config)}`,
      )
    }
  },
)

Deno.test(
  'sms/defs.ts skips connector registration when Twilio env vars are missing',
  async () => {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']) {
      Deno.env.delete(key)
    }

    await import('../../modules/sms/defs.ts')

    if (SmsClient.config !== undefined) {
      throw new Error(
        `Expected SmsClient.config to remain undefined, got: ${Deno.inspect(SmsClient.config)}`,
      )
    }
  },
)

Deno.test(
  'whatsapp/defs.ts skips connector registration when neither Meta nor Twilio env vars are set',
  async () => {
    for (
      const key of [
        'META_PHONE_NUMBER_ID',
        'META_ACCESS_TOKEN',
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_WHATSAPP_FROM',
      ]
    ) {
      Deno.env.delete(key)
    }

    await import('../../modules/whatsapp/defs.ts')

    if (WhatsappClient.config !== undefined) {
      throw new Error(
        `Expected WhatsappClient.config to remain undefined, got: ${
          Deno.inspect(WhatsappClient.config)
        }`,
      )
    }
  },
)

Deno.test('modules/core.ts re-exports all DI registrations without throwing', async () => {
  await import('../../modules/core.ts')
})
