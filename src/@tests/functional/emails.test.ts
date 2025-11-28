import { NotifierProvider } from 'modules/providers/notifier.ts'

console.error = () => {}

// Make sure to configure the environment variables correctly before running this test.
// Be careful not to commit them accidentally to the repository, as they contain sensitive information (SMTP credentials).
// These variables include the SMTP port, host, user, and password.
Deno.test({
  ignore: true,
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'Send an email using NotifierProvider',
  fn: async () => {
    Deno.env.set('SMTP_PORT', 'your port')
    Deno.env.set('SMTP_HOST', 'your host')
    Deno.env.set('SMTP_USER', 'your user')
    Deno.env.set('SMTP_PASSWORD', 'your smtp password')

    await import('../../modules/email/defs.ts')

    const provider = new NotifierProvider()

    const subject = 'pepito@email.com' // Set a valid email

    await new Promise((resolve) => {
      provider.sendMessage('email', {
        from: 'noreply@aeratech.io',
        to: subject,
        subject: 'Welcome to Zanix',
        body: { template: 'welcome', data: { buttonText: 'Click here' } },
      }, {
        useWorker: {
          callback: () => {
            resolve(true)
          },
        },
      })
      provider.sendMessage('email', {
        from: 'noreply@aeratech.io',
        to: subject,
        subject: 'Login to Zanix',
        body: { template: 'login-otp' },
      }, {
        useWorker: true,
      })

      provider['onDestroy']() // this execute queues
    })

    try {
      await provider.use('email')['close']()
    } catch { /** */ }
  },
})
