import { assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
import { assertSnapshot } from '@std/testing/snapshot'
import { FakeTime } from '@std/testing/time'
import emailTemplates from '../../modules/templates/transactional/email/mod.ts'
import smsTemplates from '../../modules/templates/transactional/sms.ts'
import whatsappTemplates from '../../modules/templates/transactional/whatsapp.ts'

// Freezes the clock so the dynamic footer year stays stable across snapshots regardless of the current year
async function withFakeTime(fn: () => void | Promise<void>) {
  using _time = new FakeTime('2025-06-15T12:00:00.000Z')
  await fn()
}

Deno.test('Handlebars runtime should return correct welcome template content', async (t) => {
  await withFakeTime(async () => {
    const output = await emailTemplates.welcome()
    await assertSnapshot(t, output)
  })
})

Deno.test(
  'Handlebars runtime should return correct password changed template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates['password-changed']()
      await assertSnapshot(t, output)
    })
  },
)

Deno.test(
  'Handlebars runtime should return correct generic template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates.generic()
      await assertSnapshot(t, output)
    })
  },
)

Deno.test(
  'Handlebars runtime should return correct password recovery template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates['password-recovery']()
      await assertSnapshot(t, output)
    })
  },
)

Deno.test(
  'Handlebars runtime should return correct login-otp template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates['login-otp']()
      await assertSnapshot(t, output)
    })
  },
)

Deno.test(
  'Handlebars runtime should return correct styles',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates['login-otp']({
        styles: {
          css: `.container {
  background-color: #000;
}`,
        },
        html: {
          lang: 'es',
        },
        code: '',
        ttl: 0,
      })
      await assertSnapshot(t, output)
    })
  },
)

Deno.test(
  'Handlebars runtime should render a link button when buttonLink is provided',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates.generic({
        buttonText: 'Visit us',
        buttonLink: 'https://zanix.dev',
      })
      await assertSnapshot(t, output)
    })
  },
)

Deno.test(
  'Handlebars runtime should throw when template data fails schema validation',
  async () => {
    await assertRejects(() => emailTemplates.generic({ content: undefined }))
  },
)

Deno.test('Handlebars runtime should return correct sms generic template content', async (t) => {
  await withFakeTime(async () => {
    const output = await smsTemplates.generic({ content: `Your code is 123456. Don't share it.` })
    await assertSnapshot(t, output)
  })
})

Deno.test('Handlebars runtime should return correct sms otp template content', async (t) => {
  await withFakeTime(async () => {
    const output = await smsTemplates.otp({ code: '123456', ttl: 5 })
    await assertSnapshot(t, output)
  })
})

Deno.test('sms otp template includes the app name in the message when provided', async () => {
  const output = await smsTemplates.otp({ code: '123456', ttl: 5, app: 'Zanix' })
  assertStringIncludes(output, 'Your Zanix verification code is 123456')
})

Deno.test(
  'Handlebars runtime should return correct whatsapp generic template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await whatsappTemplates.generic({
        content: `Your code is 123456. Don't share it.`,
      })
      await assertSnapshot(t, output)
    })
  },
)

Deno.test('Handlebars runtime should return correct whatsapp otp template content', async (t) => {
  await withFakeTime(async () => {
    const output = await whatsappTemplates.otp({ code: '123456', ttl: 15 })
    await assertSnapshot(t, output)
  })
})

Deno.test('whatsapp otp template includes the app name in the message when provided', async () => {
  const output = await whatsappTemplates.otp({ code: '123456', ttl: 15, app: 'Zanix' })
  assertStringIncludes(output, 'Your Zanix verification code is 123456')
})
