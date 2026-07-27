import { assert } from 'jsr:@std/assert@^1.0.15'
import { NotifierProvider } from 'modules/providers/notifier.ts'
import { loadTestEnv, missingEnv } from './env.ts'

console.error = () => {}

await loadTestEnv()

const REQUIRED_ENV = ['SMTP_PORT', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'TEST_EMAIL_TO']
const TEST_NAME = 'Send an email using NotifierProvider'

// Functional test — hits a real SMTP server. Copy .env.test.example to .env.test (gitignored)
// at the project root and fill in real credentials to run it; otherwise it's skipped with a
// warning (see env.ts).
Deno.test({
  name: TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, TEST_NAME),
  fn: async () => {
    await import('../../modules/email/defs.ts')

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
        useOneTimeWorker: {
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
