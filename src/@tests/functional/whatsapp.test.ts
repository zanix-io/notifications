import { assert } from 'jsr:@std/assert@^1.0.15'
import { NotifierProvider } from 'modules/providers/notifier.ts'
import { loadTestEnv, missingEnv } from './env.ts'

import '../fixtures.ts'
import '../../../src/modules/templates/core.ts'

console.error = () => {}

await loadTestEnv()

const REQUIRED_META_ENV = [
  'META_PHONE_NUMBER_ID',
  'META_ACCESS_TOKEN',
  'TEST_WHATSAPP_TO',
]
const TEST_META_NAME = 'Send a whatsapp using Meta NotifierProvider'

// Functional test — hits the real WhatsApp Cloud API. Copy .env.test.example to .env.test
// (gitignored) at the project root and fill in real credentials to run it; otherwise it's
// skipped with a warning (see env.ts).
Deno.test({
  name: TEST_META_NAME,
  ignore: missingEnv(REQUIRED_META_ENV, TEST_META_NAME),
  fn: async () => {
    await import('../../modules/whatsapp/defs.ts')

    const provider = new NotifierProvider()

    const response = await new Promise((resolve) => {
      provider.whatsapp({
        to: Deno.env.get('TEST_WHATSAPP_TO') as string,
        zanixTemplate: 'otp',
        data: { code: '654321', ttl: 10 },
        /*templateName: 'hello_world', //'jaspers_market_order_confirmation_v1',
        templateLanguage: 'en_US',
        templateParams: ['Pepito', '123', 'tomorrow'],*/
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
      await provider.use('whatsapp')['close']()
    } catch { /** */ }
  },
})

const REQUIRED_TW_ENV = [
  'TWILIO_WHATSAPP_FROM',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
]
const TEST_TW_NAME = 'Send a whatsapp using Twilio NotifierProvider'

// Functional test — hits the real WhatsApp Cloud API. Copy .env.test.example to .env.test
// (gitignored) at the project root and fill in real credentials to run it; otherwise it's
// skipped with a warning (see env.ts).
Deno.test({
  name: TEST_TW_NAME,
  ignore: missingEnv(REQUIRED_TW_ENV, TEST_TW_NAME),
  fn: async () => {
    Deno.env.delete('META_PHONE_NUMBER_ID')
    await import('../../modules/whatsapp/defs.ts')

    const provider = new NotifierProvider()
    const response = await new Promise((resolve) => {
      provider.whatsapp({
        to: Deno.env.get('TWILIO_WHATSAPP_TO') as string,
        zanixTemplate: 'otp',
        data: { code: '654321', ttl: 10 },
        /*contentSid: 'HXb5b62575e6e4ff6129ad7c8efe1f983e',
        templateParams: ['12/1', '3pm'],*/
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
      await provider.use('whatsapp')['close']()
    } catch { /** */ }
  },
})
