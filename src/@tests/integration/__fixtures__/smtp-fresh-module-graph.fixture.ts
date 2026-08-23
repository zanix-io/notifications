/**
 * Fixture entry point for `smtp-lazy-registration-fresh-module-graph.test.ts` — deliberately a
 * plain script, not a `Deno.test()` file itself, run via `Deno.Command` as its own fresh
 * subprocess (see that test's own doc for why a fresh process is required at all).
 *
 * Imports the two real public entrypoints together, in the exact order `modules/core.ts`'s own
 * docs describe using them ("import it alongside the root `@zanix/notifications` entrypoint"):
 * `mod.ts` first, `modules/email/defs.ts` second. `mod.ts` re-exports `SmtpClient` from
 * `modules/email/connector.ts`, so importing it starts `connector.ts`'s module evaluation before
 * anything has touched `email/defs.ts` — the exact ordering that matters for the invariant this
 * guards (see the test file). `email/defs.ts`'s own top-level `registerSmtpConnector()` call is
 * what actually reads `SmtpClient` from `connector.ts` and would surface a module-evaluation-order
 * violation, if one ever existed.
 *
 * A clean exit (no thrown error) IS the assertion — this file has none of its own; the parent
 * test asserts on the subprocess's exit code and stderr instead.
 */
import '../../../../mod.ts'
import '../../../modules/email/defs.ts'
