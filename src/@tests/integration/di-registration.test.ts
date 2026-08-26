import { SmtpClient } from '../../modules/email/connector.ts'
import { SmsClient } from '../../modules/sms/connector.ts'
import { WhatsappClient } from '../../modules/whatsapp/connector.ts'
import { NotifierProvider } from '../../modules/providers/notifier.ts'
import { TemplateProvider } from '../../modules/templates/provider.ts'
import { ProgramModule } from '@zanix/server'
import { DEFAULT_TRIGGER_JOBS, getRegisteredTriggerActionJobs } from '@zanix/database'

console.error = () => {}

Deno.test(
  'providers/core.ts registers NotifierProvider under the notifications core key without throwing',
  async () => {
    await import('../../modules/providers/core.ts')
  },
)

Deno.test(
  'providers/core.ts: the default notifications provider also resolves by class (NotifierProvider)',
  async () => {
    await import('../../modules/providers/core.ts')

    // Regression guard, same reasoning as the `templates/core.ts`/`TemplateProvider` test below:
    // a wrapping subclass (`class _X extends NotifierProvider {}`) instead of decorating
    // `NotifierProvider` directly would register a DIFFERENT, unreachable class identity —
    // this.providers.get(NotifierProvider) would throw.
    const viaClass = ProgramModule.providers.get(NotifierProvider)
    const viaName = ProgramModule.providers.get('notifications')

    if (!(viaClass instanceof NotifierProvider)) {
      throw new Error(
        'Expected this.providers.get(NotifierProvider) to resolve a NotifierProvider',
      )
    }
    if (viaName !== viaClass) {
      throw new Error(
        "Expected get('notifications') and get(NotifierProvider) to be the same instance",
      )
    }
  },
)

Deno.test(
  'providers/trigger-mail.core.ts self-registers the `mail` trigger-action job descriptor with @zanix/datamaster, resolvable via getRegisteredTriggerActionJobs()',
  async () => {
    await import('../../modules/providers/trigger-mail.core.ts')

    // Real registry lookup (no mocking `registerTriggerActionJob`/`getRegisteredTriggerActionJobs`
    // themselves) — same "assert against the real result" shape as the `NotifierProvider`/
    // `TemplateProvider` checks above, adapted to `@zanix/datamaster`'s trigger-action-job
    // registry instead of `@zanix/server`'s provider container.
    const descriptor = getRegisteredTriggerActionJobs().find((d) => d.actionKind === 'mail')

    if (!descriptor) {
      throw new Error(
        "Expected getRegisteredTriggerActionJobs() to contain a descriptor for actionKind 'mail'",
      )
    }
    if (descriptor.name !== DEFAULT_TRIGGER_JOBS.mail) {
      throw new Error(
        `Expected the 'mail' descriptor's name to be DEFAULT_TRIGGER_JOBS.mail (${DEFAULT_TRIGGER_JOBS.mail}), got: ${
          Deno.inspect(descriptor.name)
        }`,
      )
    }
    if (descriptor.processingQueue !== 'soft') {
      throw new Error(
        `Expected the 'mail' descriptor's processingQueue to be 'soft', got: ${
          Deno.inspect(descriptor.processingQueue)
        }`,
      )
    }
    if (typeof descriptor.handler !== 'function') {
      throw new Error(
        `Expected the 'mail' descriptor's handler to be a function, got: ${
          Deno.inspect(descriptor.handler)
        }`,
      )
    }
  },
)

Deno.test(
  "providers/trigger-mail.core.ts: registerMailTriggerJob(), called a second time in the same process, throws — @zanix/datamaster's registerTriggerActionJob is deliberately fail-fast on a duplicate actionKind (its own @throws doc: \"same fail-fast semantics as @zanix/asyncmq's registerJob\"). Locks in the REAL current behavior — see the doc-comment discrepancy this surfaced: `registerMailTriggerJob`'s own doc claims it's \"re-invokable\", citing `registerS3Connector`'s pattern, but unlike a Connector-slot registration, this specific registry has no reset reachable from this package, so a genuine re-invocation isn't actually safe.",
  async () => {
    const { registerMailTriggerJob } = await import('../../modules/providers/trigger-mail.core.ts')

    // A real second call — no container reset (none is reachable from this package for
    // @zanix/datamaster's trigger-action-jobs registry), no mock — the same call this module's
    // own top-level already ran once at first import.
    let threw = false
    try {
      registerMailTriggerJob()
    } catch {
      threw = true
    }
    if (!threw) {
      throw new Error(
        'Expected a second registerMailTriggerJob() call to throw (duplicate "mail" actionKind) ' +
          '— if this now passes, @zanix/datamaster made registerTriggerActionJob idempotent; ' +
          "update this test AND this export's own doc comment together.",
      )
    }

    // Still exactly one descriptor — the failed re-registration must not have corrupted the
    // existing one.
    const descriptors = getRegisteredTriggerActionJobs().filter((d) => d.actionKind === 'mail')
    if (descriptors.length !== 1) {
      throw new Error(
        `Expected exactly one 'mail' descriptor after the failed re-registration, got: ${descriptors.length}`,
      )
    }
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
    const instance = (new NotifierProvider() as any).providers.get(
      TemplateProvider,
    )
    if (!(instance instanceof TemplateProvider)) {
      throw new Error(
        'Expected this.providers.get(TemplateProvider) to resolve a TemplateProvider',
      )
    }
  },
)

Deno.test(
  'templates/core.ts throws at import time when TEMPLATES_BACKEND=remote is selected without TEMPLATES_SERVICE_URL',
  async () => {
    Deno.env.set('TEMPLATES_BACKEND', 'remote')

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
        throw new Error(
          'Expected templates/core.ts to throw when TEMPLATES_BACKEND=remote has no TEMPLATES_SERVICE_URL',
        )
      }
    } finally {
      Deno.env.delete('TEMPLATES_BACKEND')
    }
  },
)

Deno.test(
  'templates/core.ts does NOT throw at import time when TEMPLATES_SERVICE_URL and TEMPLATES_MODEL_NAME are both set but TEMPLATES_BACKEND is unset — the pre-TEMPLATES_BACKEND conflict can no longer be represented, both vars are simply unread',
  async () => {
    Deno.env.set('TEMPLATES_SERVICE_URL', 'https://templates.internal.example')
    Deno.env.set('TEMPLATES_MODEL_NAME', 'zanix-templates')

    try {
      await import('../../modules/templates/core.ts?no-conflict-test')
    } finally {
      Deno.env.delete('TEMPLATES_SERVICE_URL')
      Deno.env.delete('TEMPLATES_MODEL_NAME')
    }
  },
)

Deno.test(
  'email/defs.ts skips connector registration when SMTP env vars are missing',
  async () => {
    for (
      const key of ['SMTP_PORT', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']
    ) {
      Deno.env.delete(key)
    }

    // Cache-busting query: `di-registration-env.test.ts` and `functional/emails.test.ts` also
    // import this exact specifier — without a unique query each would share Deno's module cache
    // and only the first import across the whole test process would actually run
    // `registerSmtpConnector()`'s top-level side effect.
    await import('../../modules/email/defs.ts?smtp-missing')

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
    for (
      const key of [
        'TWILIO_ACCOUNT_SID',
        'TWILIO_AUTH_TOKEN',
        'TWILIO_FROM_NUMBER',
      ]
    ) {
      Deno.env.delete(key)
    }

    // Cache-busting query: `di-registration-env.test.ts` also imports this exact specifier — see
    // the same note on the SMTP case above.
    await import('../../modules/sms/defs.ts?twilio-missing')

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

    // Cache-busting query: `di-registration-env.test.ts` also imports this exact specifier — see
    // the same note on the SMTP case above.
    await import('../../modules/whatsapp/defs.ts?whatsapp-missing')

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
