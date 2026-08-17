import { assert } from 'jsr:@std/assert@^1.0.15'
import { NotifierProvider } from 'modules/providers/notifier.ts'
import { loadTestEnv, missingEnv } from './env.ts'

import '../fixtures.ts'
import '../../../src/modules/templates/core.ts'

console.error = () => {}

await loadTestEnv()

const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'TEST_SMS_TO',
]
const TEST_NAME = 'Send an sms using NotifierProvider'

// Functional test — hits the real Twilio API. Copy .env.test.example to .env.test (gitignored)
// at the project root and fill in real credentials to run it; otherwise it's skipped with a
// warning (see env.ts).
Deno.test({
  name: TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, TEST_NAME),
  fn: async () => {
    await import('../../modules/sms/defs.ts')

    const provider = new NotifierProvider()

    const response = await new Promise((resolve) => {
      provider.sms({
        to: Deno.env.get('TEST_SMS_TO') as string,
        zanixTemplate: 'otp',
        data: { code: '123456', ttl: 3 },
        // content: 'text'
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
      await provider.use('sms')['close']()
    } catch { /** */ }
  },
})
