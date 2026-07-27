import { assertEquals, assertStrictEquals } from 'jsr:@std/assert@^1.0.15'
import { getSmtpPool, SmtpConnectionPool } from 'modules/email/pool.ts'

Deno.test(
  'getSmtpPool(): returns a shared SmtpConnectionPool when SMTP_POOL_SIZE > 1, resolved once',
  () => {
    Deno.env.set('SMTP_POOL_SIZE', '3')

    try {
      const first = getSmtpPool()
      const second = getSmtpPool()

      assertEquals(first instanceof SmtpConnectionPool, true)
      assertStrictEquals(first, second) // same pool instance across calls, not one per call
    } finally {
      Deno.env.delete('SMTP_POOL_SIZE')
    }
  },
)
