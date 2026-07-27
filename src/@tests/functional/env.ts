// deno-coverage-ignore-file

import { dirname, fromFileUrl, join } from '@std/path'
import logger from 'jsr:@zanix/utils@2.*/logger'

const ENV_TEST_PATH = join(dirname(fromFileUrl(import.meta.url)), '..', '.env.test')

/**
 * Loads `src/@tests/.env.test` (gitignored, real credentials — see the sibling
 * `.env.test.example`) into `Deno.env`, if that file exists. A no-op otherwise: functional tests
 * fall back to warning and skipping (see `missingEnv`) when the required variables are still
 * missing.
 *
 * Real process env vars always win over the file — matches standard dotenv precedence.
 */
export async function loadTestEnv(): Promise<void> {
  let content: string
  try {
    content = await Deno.readTextFile(ENV_TEST_PATH)
  } catch {
    return
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eq = trimmed.indexOf('=')
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && !Deno.env.has(key)) Deno.env.set(key, value)
  }
}

/**
 * Checks whether any of `vars` are missing (unset or empty) in `Deno.env`, warning with a clear
 * explanation if so.
 *
 * @param vars Required environment variable names.
 * @param testName The functional test's own name, echoed in the warning.
 * @returns `true` if any are missing — pass this directly as a `Deno.test(...)`'s `ignore` option.
 */
export function missingEnv(vars: string[], testName: string): boolean {
  const missing = vars.filter((key) => !Deno.env.get(key))
  if (missing.length) {
    logger.warn(
      `[functional test skipped] "${testName}" — missing env vars: ${missing.join(', ')}. ` +
        `Copy src/@tests/.env.test.example to src/@tests/.env.test and fill in real credentials ` +
        `to run it.`,
    )
  }
  return missing.length > 0
}
