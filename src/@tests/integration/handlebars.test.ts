import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@^1.0.15'
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

Deno.test(
  'Handlebars runtime strips a <script> injected through caller-supplied content',
  async () => {
    const output = await emailTemplates.generic({
      content: '<p>hi</p><script>alert(document.cookie)</script>',
    })
    assertStringIncludes(output, '<p>hi</p>')
    assertEquals(output.includes('<script>'), false)
  },
)

Deno.test(
  'Handlebars runtime strips a javascript: buttonLink instead of rendering it',
  async () => {
    const output = await emailTemplates.generic({
      buttonText: 'Click me',
      buttonLink: 'javascript:alert(1)',
    })
    assertEquals(output.includes('javascript:'), false)
  },
)

Deno.test('Handlebars runtime should return correct sms generic template content', async (t) => {
  await withFakeTime(async () => {
    const output = await smsTemplates.generic({
      content: `Your code is 123456. Don't share it.`,
    })
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
  const output = await smsTemplates.otp({
    code: '123456',
    ttl: 5,
    app: 'Zanix',
  })
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
  const output = await whatsappTemplates.otp({
    code: '123456',
    ttl: 15,
    app: 'Zanix',
  })
  assertStringIncludes(output, 'Your Zanix verification code is 123456')
})

Deno.test(
  'Handlebars runtime should return correct email new-login template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates['new-login']({
        device: 'Chrome on Windows',
        time: 'Aug 19, 2026, 10:32 AM',
        location: 'Bogotá, Colombia',
      })
      await assertSnapshot(t, output)
    })
  },
)

Deno.test('email new-login template includes device/time/location when provided', async () => {
  const output = await emailTemplates['new-login']({
    device: 'Chrome on Windows',
    time: 'Aug 19, 2026, 10:32 AM',
    location: 'Bogotá, Colombia',
  })
  assertStringIncludes(output, 'Chrome on Windows')
  assertStringIncludes(output, 'Aug 19, 2026, 10:32 AM')
  assertStringIncludes(output, 'Bogotá, Colombia')
})

Deno.test('email new-login template omits the location line when not provided', async () => {
  const output = await emailTemplates['new-login']({
    device: 'Safari on iPhone',
    time: 'Aug 19, 2026, 11:00 AM',
  })
  assertEquals(output.includes('Location:'), false)
})

Deno.test(
  'Handlebars runtime should return correct sms new-login template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await smsTemplates['new-login']({
        device: 'Chrome on Windows',
        time: 'Aug 19, 2026, 10:32 AM',
        app: 'Zanix',
      })
      await assertSnapshot(t, output)
    })
  },
)

Deno.test('sms new-login template includes the app name in the message when provided', async () => {
  const output = await smsTemplates['new-login']({
    device: 'Chrome on Windows',
    time: 'Aug 19, 2026, 10:32 AM',
    app: 'Zanix',
  })
  assertStringIncludes(output, 'Zanix New login detected')
})

Deno.test('sms new-login template includes the location when provided', async () => {
  const output = await smsTemplates['new-login']({
    device: 'Safari on iPhone',
    time: 'Aug 19, 2026, 11:00 AM',
    location: 'Bogotá',
  })
  assertStringIncludes(output, '(Bogotá)')
})

Deno.test(
  'Handlebars runtime should return correct data-table template content',
  async (t) => {
    await withFakeTime(async () => {
      const output = await emailTemplates['data-table']({
        title: 'Invoice',
        referenceNumber: 'INV-0001',
        date: 'Aug 19, 2026',
        dueDate: 'Sep 2, 2026',
        senderName: 'Acme Corp',
        recipient: 'Jane Doe',
        items: [
          { description: 'Widget', quantity: 2, unitPrice: 9.99 },
          { description: 'Gadget', quantity: 1, unitPrice: 19.99 },
        ],
        currency: 'USD',
        subtotal: 39.97,
        tax: 3.2,
        total: 43.17,
        notes: 'Thank you for your business.',
      })
      await assertSnapshot(t, output)
    })
  },
)

Deno.test('data-table template renders line items and computed line totals', async () => {
  const output = await emailTemplates['data-table']({
    referenceNumber: 'INV-0002',
    date: 'Aug 19, 2026',
    items: [{ description: 'Consulting', quantity: 3, unitPrice: 100 }],
    subtotal: 300,
    total: 300,
  })
  assertStringIncludes(output, 'INV-0002')
  assertStringIncludes(output, 'Consulting')
  // quantity (3) * unitPrice (100) — computed by the schema, never caller-supplied
  assertStringIncludes(output, '300')
})

Deno.test('data-table template throws when required fields are missing', async () => {
  await assertRejects(() =>
    // deno-lint-ignore no-explicit-any
    emailTemplates['data-table']({ items: [] } as any)
  )
})

Deno.test('data-table template strips an unsafe senderLogo URL', async () => {
  const output = await emailTemplates['data-table']({
    referenceNumber: 'INV-0003',
    date: 'Aug 19, 2026',
    senderLogo: 'javascript:alert(1)',
    items: [{ description: 'Item', quantity: 1, unitPrice: 1 }],
    subtotal: 1,
    total: 1,
  })
  assertEquals(output.includes('javascript:'), false)
})

Deno.test('data-table template defaults every label to English, overridable per call', async () => {
  const defaultOutput = await emailTemplates['data-table']({
    items: [{ description: 'Item', quantity: 1, unitPrice: 1 }],
    subtotal: 1,
    total: 1,
  })
  assertStringIncludes(defaultOutput, 'Description')
  assertStringIncludes(defaultOutput, 'Subtotal')
  assertStringIncludes(defaultOutput, 'Total')

  const spanishOutput = await emailTemplates['data-table']({
    items: [{ description: 'Producto', quantity: 1, unitPrice: 1 }],
    subtotal: 1,
    total: 1,
    labels: {
      description: 'Descripción',
      quantity: 'Cant.',
      unitPrice: 'Precio unitario',
      amount: 'Importe',
      subtotal: 'Subtotal',
      tax: 'Impuesto',
      total: 'Total',
    },
  })
  assertStringIncludes(spanishOutput, 'Descripción')
  assertStringIncludes(spanishOutput, 'Precio unitario')
  assertEquals(spanishOutput.includes('Unit price'), false)
})
