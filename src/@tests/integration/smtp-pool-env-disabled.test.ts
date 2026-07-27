import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { getSmtpPool } from 'modules/email/pool.ts'

Deno.test(
  'getSmtpPool(): disabled (returns undefined) when SMTP_POOL_SIZE is unset, and resolves once',
  () => {
    Deno.env.delete('SMTP_POOL_SIZE')

    const first = getSmtpPool()
    const second = getSmtpPool()

    assertEquals(first, undefined)
    assertEquals(second, undefined)
  },
)
