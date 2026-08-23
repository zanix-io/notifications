import { assert } from 'jsr:@std/assert@^1.0.15'
import { NotifierProvider } from 'modules/providers/notifier.ts'
import { loadTestEnv, missingEnv } from './env.ts'
import '../fixtures.ts'
import '../../../src/modules/templates/core.ts'

console.error = () => {}

await loadTestEnv()

const REQUIRED_ENV = [
  'SMTP_PORT',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'TEST_EMAIL_TO',
]
const TEST_NAME = 'Send an email using NotifierProvider'

// Functional test — hits a real SMTP server. Copy .env.test.example to .env.test (gitignored)
// at the project root and fill in real credentials to run it; otherwise it's skipped with a
// warning (see env.ts).
Deno.test({
  name: TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, TEST_NAME),
  fn: async () => {
    // Cache-busting query: `di-registration-env.test.ts` and `di-registration.test.ts` also
    // import this exact specifier — without a unique query each would share Deno's module cache
    // and only the first import across the whole test process would actually run
    // `registerSmtpConnector()`'s top-level side effect.
    await import('../../modules/email/defs.ts?functional-send-email')

    const provider = new NotifierProvider()

    const response = await new Promise((resolve) => {
      provider.sendMessage('email', {
        from: Deno.env.get('TEST_EMAIL_FROM') ?? 'noreply@example.com',
        to: Deno.env.get('TEST_EMAIL_TO') as string,
        subject: 'Welcome to Zanix',
        zanixTemplate: 'welcome',
        data: { buttonText: 'Click here' },
        // content:'text'
      }, {
        useWorker: {
          mode: 'one-time',
          callback: (response) => {
            if (response.error) resolve(false)
            else resolve(true)
          },
        },
      })
      provider['onDestroy']() // this executes queues
    })

    assert(response)

    try {
      await provider.use('email')['close']()
    } catch { /** */ }
  },
})
