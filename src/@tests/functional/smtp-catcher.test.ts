import { assert, assertEquals } from 'jsr:@std/assert@^1.0.15'
import { generateUUID } from '@zanix/helpers'
import { SmtpClient } from 'modules/email/connector.ts'
import { loadTestEnv, missingEnv } from './env.ts'

console.error = () => {}

await loadTestEnv()

const REQUIRED_ENV = ['SMTP_CATCHER_HOST', 'SMTP_CATCHER_PORT']
const TEST_NAME =
  'SmtpClient + real open SMTP catcher: connects, authenticates (or not) and delivers over a real socket'

/**
 * Functional test — hits a REAL, unauthenticated SMTP catcher over a REAL TCP socket (a local
 * Mailpit instance by default; CI points these env vars at a service container — see
 * `.github/workflows/publish.yml`), not a mocked `Deno.Conn`.
 *
 * This is the exact shape of the two bugs fixed in `pool.ts`'s `SmtpConnection.open()`:
 * - Every connection used to be wrapped in implicit TLS (`Deno.connectTls`) unconditionally, so a
 *   plaintext catcher's `220` greeting was rejected as a corrupt TLS record before the handshake
 *   ever began (fixed in 1.2.2).
 * - `AUTH LOGIN` used to be sent unconditionally even when the server's `EHLO` reply never
 *   advertised `AUTH` support — exactly what a catcher like Mailpit/MailDev does, since they accept
 *   unauthenticated mail by design — getting back a `502` instead of the expected `334` prompt.
 *
 * Neither failure mode reproduces against the mocked `Deno.Conn` used by `smtp-client*.test.ts`:
 * those tests fully control both which `Deno.*` dial function gets called AND what the fake stream
 * replies, so they can only verify the CLIENT's own logic given a canned response — never that a
 * real target server's real behavior (a real TLS record rejection, a real `502`) actually round-
 * trips through a real socket the way this test's `SmtpClient` expects. This test sends one real
 * message through a real `SmtpConnection` and confirms it actually arrives.
 *
 * Skipped with a warning (see `env.ts`) unless `SMTP_CATCHER_HOST`/`SMTP_CATCHER_PORT` are set —
 * point them at any local, unauthenticated SMTP catcher (Mailpit, MailDev, MailHog, smtp4dev, ...)
 * to run this locally, e.g.:
 * ```sh
 * docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit
 * SMTP_CATCHER_HOST=localhost SMTP_CATCHER_PORT=1025 SMTP_CATCHER_API=http://localhost:8025 \
 *   deno test -A src/@tests/functional/smtp-catcher.test.ts
 * ```
 * `SMTP_CATCHER_API` (Mailpit's own HTTP API base URL) is optional — when set, this test also
 * confirms delivery by reading the message back from the catcher instead of only trusting that
 * `send()` didn't throw.
 */
Deno.test({
  name: TEST_NAME,
  ignore: missingEnv(REQUIRED_ENV, TEST_NAME),
  fn: async () => {
    const host = Deno.env.get('SMTP_CATCHER_HOST') as string
    const port = Number(Deno.env.get('SMTP_CATCHER_PORT'))
    const apiUrl = Deno.env.get('SMTP_CATCHER_API')

    // A unique subject per run so a leftover message from a previous run (the catcher's own
    // mailbox isn't reset between test runs) can never produce a false positive.
    const subject = `Zanix notifications SMTP catcher test ${generateUUID()}`

    const client = new SmtpClient({
      hostname: host,
      port,
      // A real catcher like Mailpit/MailDev never advertises AUTH, so these are never actually
      // used to authenticate (see pool.ts's AUTH-gating doc) — only present because `ServerConfig`
      // requires them. Shaped like a real address since `SmtpClient#deliver` also falls back to
      // `username` as the message's own `from` when none is given below.
      username: 'zanix-ci@example.com',
      password: 'zanix-ci',
      autoInitialize: false,
    })

    await client['initialize']()
    try {
      await client.send({
        to: 'zanix-ci@example.com',
        subject,
        content: '<p>Delivered by the real-socket CI functional test.</p>',
      })
      assertEquals(client.isHealthy(), true)
    } finally {
      await client.close()
    }

    if (!apiUrl) return // send() not throwing is already the core assertion — see doc above

    // Confirms actual delivery, not just that the client-side protocol calls succeeded, by
    // reading the message back from the catcher's own HTTP API (Mailpit's shape: `GET
    // /api/v1/messages` returns `{ messages: [{ Subject, ... }, ...] }`, newest first).
    const response = await fetch(`${apiUrl}/api/v1/messages`)
    assert(response.ok, `catcher API responded ${response.status}`)
    const { messages } = await response.json() as { messages: Array<{ Subject: string }> }
    assert(
      messages.some((message) => message.Subject === subject),
      `expected a delivered message with subject "${subject}"`,
    )
  },
})
