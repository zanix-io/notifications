import { assert, assertEquals } from 'jsr:@std/assert@^1.0.15'
import { fromFileUrl } from '@std/path'

/**
 * Guards the module-evaluation ORDER between `modules/email/{defs,connector,pool}.ts`, not just
 * their import graph's shape: `email/defs.ts`'s top-level `registerSmtpConnector()` call reads
 * `SmtpClient` — a class declared in `connector.ts` — the moment all four `SMTP_HOST`/`SMTP_PORT`/
 * `SMTP_USER`/`SMTP_PASSWORD` env vars are set. If `connector.ts`'s own module evaluation ever
 * starts (via `mod.ts`, its real public entrypoint) before `email/defs.ts` is imported, and
 * anything reached from `connector.ts`'s import chain loops back into `email/defs.ts` before
 * `connector.ts` finishes declaring `SmtpClient`, that read lands in `SmtpClient`'s temporal dead
 * zone — a real `ReferenceError: Cannot access 'SmtpClient' before initialization`, not a type
 * error `deno check` would ever catch. `pool.ts` has no import of `email/defs.ts` today (see its
 * own `SMTP_POOL_SIZE_ENV` doc), so no such loop currently exists — this test is what would catch
 * it coming back, not a check of the current wiring's shape.
 *
 * This needs a genuinely FRESH module graph, spawned as a real subprocess, rather than an
 * in-process `import()`: `deno test`'s module cache is process-wide across every test FILE in one
 * run, not per-file — any earlier test in this same run that already imported anything reaching
 * `connector.ts` (several siblings in this same `integration/` tier do) would leave `SmtpClient`
 * fully initialized in the shared cache before this test's own import ever runs, silently masking
 * an evaluation-order regression regardless of which file happens to run first or last.
 *
 * Dummy `SMTP_*` values are safe here: `registerSmtpConnector()` only assigns
 * `SmtpClient.config = {...}` and calls `Connector({ startMode: 'lazy', ... })(SmtpClient)` — no
 * network connection is attempted at registration time, only at first actual use of an `SmtpClient`
 * instance, which this test never creates.
 */
Deno.test(
  'mod.ts + email/defs.ts: importing the real public entrypoints together, mod.ts first, does not throw when all four SMTP_* env vars are set',
  async () => {
    const fixture = fromFileUrl(
      new URL('./__fixtures__/smtp-fresh-module-graph.fixture.ts', import.meta.url),
    )

    const command = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', fixture],
      env: {
        SMTP_HOST: 'localhost',
        SMTP_PORT: '587',
        SMTP_USER: 'test',
        SMTP_PASSWORD: 'test',
      },
      stdout: 'piped',
      stderr: 'piped',
    })

    const { success, code, stderr } = await command.output()
    const stderrText = new TextDecoder().decode(stderr)

    assert(
      !stderrText.includes('ReferenceError') && !stderrText.includes('Cannot access'),
      `Expected no module-evaluation-order error, got stderr:\n${stderrText}`,
    )
    assertEquals(code, 0, `Expected exit code 0, got ${code}. stderr:\n${stderrText}`)
    assert(success, `Expected the subprocess to exit successfully. stderr:\n${stderrText}`)
  },
)
