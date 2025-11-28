import { assertSnapshot } from '@std/testing/snapshot'
import templates from '../../modules/templates/transactional/mod.ts'

Deno.test('Handlebars runtime should return correct welcome template content', async (t) => {
  const output = await templates.welcome()
  await assertSnapshot(t, output)
})

Deno.test(
  'Handlebars runtime should return correct password changed template content',
  async (t) => {
    const output = await templates['password-changed']()
    await assertSnapshot(t, output)
  },
)

Deno.test(
  'Handlebars runtime should return correct generic template content',
  async (t) => {
    const output = await templates.generic()
    await assertSnapshot(t, output)
  },
)

Deno.test(
  'Handlebars runtime should return correct password recovery template content',
  async (t) => {
    const output = await templates['password-recovery']()
    await assertSnapshot(t, output)
  },
)

Deno.test(
  'Handlebars runtime should return correct login-otp template content',
  async (t) => {
    const output = await templates['login-otp']()
    await assertSnapshot(t, output)
  },
)

Deno.test(
  'Handlebars runtime should return correct styles',
  async (t) => {
    const output = await templates['login-otp']({
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
  },
)
