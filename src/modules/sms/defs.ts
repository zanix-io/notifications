/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { SmsClient } from './connector.ts'
import { Connector } from '@zanix/server'
import { VonageSmsAdapter } from './vonage.ts'
import { InternalError } from '@zanix/errors'

/** Env var naming Twilio's account SID — one of the three required for the `'twilio'` `SmsProvider` (see `resolveSmsProvider()`); shared, by design, with `whatsapp/defs.ts`'s own Twilio credentials. */
export const TWILIO_ACCOUNT_SID_ENV = 'TWILIO_ACCOUNT_SID'
/** Env var naming Twilio's auth token — required alongside `TWILIO_ACCOUNT_SID_ENV`/`TWILIO_FROM_NUMBER_ENV`; shared, by design, with `whatsapp/defs.ts`'s own Twilio credentials. */
export const TWILIO_AUTH_TOKEN_ENV = 'TWILIO_AUTH_TOKEN'
/** Env var naming the default SMS sender number — required alongside `TWILIO_ACCOUNT_SID_ENV`/`TWILIO_AUTH_TOKEN_ENV`. Deliberately separate from `whatsapp/defs.ts`'s `TWILIO_WHATSAPP_FROM_ENV`, since a WhatsApp-enabled sender is typically a different number than the plain SMS one, even under the same account. */
export const TWILIO_FROM_NUMBER_ENV = 'TWILIO_FROM_NUMBER'
/** Env var optionally overriding Twilio's REST API base URL (proxy, mock server, alternate API version) — shared, by design, with `whatsapp/defs.ts`'s own Twilio API base. */
export const TWILIO_API_BASE_ENV = 'TWILIO_API_BASE'

/** Env var naming Vonage's API key — one of the three required for the `'vonage'` `SmsProvider` (see `resolveSmsProvider()`). */
export const VONAGE_API_KEY_ENV = 'VONAGE_API_KEY'
/** Env var naming Vonage's API secret — required alongside `VONAGE_API_KEY_ENV`/`VONAGE_FROM_ENV`. */
export const VONAGE_API_SECRET_ENV = 'VONAGE_API_SECRET'
/** Env var naming the default sender number or alphanumeric sender ID — required alongside `VONAGE_API_KEY_ENV`/`VONAGE_API_SECRET_ENV`. */
export const VONAGE_FROM_ENV = 'VONAGE_FROM'
/** Env var optionally overriding Vonage's SMS API base URL (proxy, mock server). */
export const VONAGE_API_BASE_ENV = 'VONAGE_API_BASE'

/**
 * Env var explicitly selecting which built-in SMS adapter `registerSmsConnector()` wires up when
 * BOTH Twilio's and Vonage's own required env vars are set at once — the ambiguous case
 * `resolveSmsProvider()` used to resolve by silently preferring Twilio (checked first, no error),
 * before this selector existed. **Only required to disambiguate that specific conflict.** With
 * exactly one provider's own vars set (the common case), `resolveSmsProvider()` still auto-detects
 * it with zero extra config, exactly as before — this selector doesn't replace that, it only
 * removes the silent-priority behavior for the case where auto-detection would otherwise be
 * ambiguous. Also honored as an explicit override even without a conflict (e.g. forcing `'vonage'`
 * while Twilio's vars happen to also be set, without unsetting them).
 *
 * @throws (via `resolveSmsProvider()`) if set to anything other than `'twilio'`/`'vonage'`.
 */
export const SMS_PROVIDER_ENV = 'SMS_PROVIDER'

/** The two built-in SMS providers `SMS_PROVIDER_ENV`/`resolveSmsProvider()` choose between. */
export type SmsProvider = 'twilio' | 'vonage'

const hasTwilioEnv = () =>
  Deno.env.has(TWILIO_ACCOUNT_SID_ENV) && Deno.env.has(TWILIO_AUTH_TOKEN_ENV) &&
  Deno.env.has(TWILIO_FROM_NUMBER_ENV)

const hasVonageEnv = () =>
  Deno.env.has(VONAGE_API_KEY_ENV) && Deno.env.has(VONAGE_API_SECRET_ENV) &&
  Deno.env.has(VONAGE_FROM_ENV)

/**
 * Resolves which `SmsProvider` `registerSmsConnector()` should wire up, re-read on every call (not
 * cached) — mirrors `templates/provider.ts`'s `templatesBackendMode()` re-read-on-every-call
 * pattern, for the same reason: no assumption about env vars being set before this module is first
 * evaluated.
 *
 * - `SMS_PROVIDER_ENV` set: that value wins outright, `'twilio'`/`'vonage'` only — see
 *   `assertSmsProviderConfigValid()` for whether that provider's own required vars are actually
 *   present.
 * - `SMS_PROVIDER_ENV` unset, exactly one of Twilio's/Vonage's own required vars fully set: that
 *   one, auto-detected — the pre-existing zero-config behavior, unchanged.
 * - `SMS_PROVIDER_ENV` unset, BOTH fully set: throws. This is the actual bug this selector fixes —
 *   previously Twilio silently won here with no error at all.
 * - Neither set, `SMS_PROVIDER_ENV` unset: `undefined` — no provider configured, registration is
 *   skipped entirely (unchanged from before).
 *
 * @returns `'twilio'`, `'vonage'`, or `undefined` when nothing is configured.
 * @throws If `SMS_PROVIDER_ENV` is set to something other than `'twilio'`/`'vonage'`, or if it's
 * unset while both providers' own required env vars are set at once.
 */
export function resolveSmsProvider(): SmsProvider | undefined {
  const raw = Deno.env.get(SMS_PROVIDER_ENV)
  if (raw) {
    if (raw !== 'twilio' && raw !== 'vonage') {
      throw new InternalError(
        `[SmsClient] "${SMS_PROVIDER_ENV}" must be "twilio" or "vonage" — got "${raw}".`,
      )
    }
    return raw
  }

  const twilio = hasTwilioEnv()
  const vonage = hasVonageEnv()
  if (twilio && vonage) {
    throw new InternalError(
      `[SmsClient] Both Twilio ("${TWILIO_ACCOUNT_SID_ENV}"/"${TWILIO_AUTH_TOKEN_ENV}"/` +
        `"${TWILIO_FROM_NUMBER_ENV}") and Vonage ("${VONAGE_API_KEY_ENV}"/"${VONAGE_API_SECRET_ENV}"/` +
        `"${VONAGE_FROM_ENV}") env vars are set with no "${SMS_PROVIDER_ENV}" selected — set ` +
        `"${SMS_PROVIDER_ENV}=twilio" or "${SMS_PROVIDER_ENV}=vonage" to disambiguate.`,
    )
  }
  if (twilio) return 'twilio'
  if (vonage) return 'vonage'
  return undefined
}

/**
 * Validates that `provider`'s own required env vars are actually set — only meaningful when
 * `provider` came from an explicit `SMS_PROVIDER_ENV` value (`resolveSmsProvider()`'s
 * auto-detected return already guarantees this by construction), so an explicit selection with
 * nothing actually configured to back it fails loudly instead of registering a connector with
 * `undefined` credentials.
 *
 * @throws If `provider` is `'twilio'` without `TWILIO_ACCOUNT_SID_ENV`/`TWILIO_AUTH_TOKEN_ENV`/
 * `TWILIO_FROM_NUMBER_ENV` all set, or `'vonage'` without `VONAGE_API_KEY_ENV`/
 * `VONAGE_API_SECRET_ENV`/`VONAGE_FROM_ENV` all set.
 */
export function assertSmsProviderConfigValid(provider: SmsProvider): void {
  if (provider === 'twilio' && !hasTwilioEnv()) {
    throw new InternalError(
      `[SmsClient] "${SMS_PROVIDER_ENV}=twilio" requires "${TWILIO_ACCOUNT_SID_ENV}"/` +
        `"${TWILIO_AUTH_TOKEN_ENV}"/"${TWILIO_FROM_NUMBER_ENV}" to all be set.`,
    )
  }
  if (provider === 'vonage' && !hasVonageEnv()) {
    throw new InternalError(
      `[SmsClient] "${SMS_PROVIDER_ENV}=vonage" requires "${VONAGE_API_KEY_ENV}"/` +
        `"${VONAGE_API_SECRET_ENV}"/"${VONAGE_FROM_ENV}" to all be set.`,
    )
  }
}

/**
 * Connector DSL definition — exported (not just auto-run below) so a caller can re-register after
 * clearing the `'type:connector'` registry (`closeAllConnections()`/
 * `ProgramModule.targets.resetContainer(['type:connector'])`, both in `@zanix/server`), without
 * needing a fresh module evaluation of this file. Re-reads `Deno.env` each call, so a config-reload
 * in a long-running process — or a test simulating a different env state between cases — gets a
 * genuinely current registration, not a stale decision baked in at first import. Same pattern
 * `@zanix/datamaster`'s own `storage/core.ts` (`registerSeaweedFSConnector`) already uses.
 *
 * @throws (via `resolveSmsProvider()`/`assertSmsProviderConfigValid()`) if `SMS_PROVIDER_ENV` is
 * invalid, if it's unset with both providers' vars set at once, or if an explicit selection lacks
 * its own required vars.
 */
export const registerSmsConnector = (): void => {
  const provider = resolveSmsProvider()
  if (!provider) return

  assertSmsProviderConfigValid(provider)

  if (provider === 'twilio') {
    SmsClient.config = {
      accountSid: Deno.env.get(TWILIO_ACCOUNT_SID_ENV) as string,
      authToken: Deno.env.get(TWILIO_AUTH_TOKEN_ENV) as string,
      from: Deno.env.get(TWILIO_FROM_NUMBER_ENV) as string,
      apiBase: Deno.env.get(TWILIO_API_BASE_ENV),
    }
  } else {
    SmsClient.config = {
      adapter: new VonageSmsAdapter({
        apiKey: Deno.env.get(VONAGE_API_KEY_ENV) as string,
        apiSecret: Deno.env.get(VONAGE_API_SECRET_ENV) as string,
        from: Deno.env.get(VONAGE_FROM_ENV) as string,
        apiBase: Deno.env.get(VONAGE_API_BASE_ENV),
      }),
    }
  }

  Connector({ startMode: 'lazy', lifetime: 'SCOPED' })(SmsClient)
}

/**
 * Core SMS connector loader for Zanix.
 *
 * This module automatically registers the default SMS connector (`SmsClient`) once a `SmsProvider`
 * is resolved (see `resolveSmsProvider()`):
 * - `TWILIO_ACCOUNT_SID_ENV` + `TWILIO_AUTH_TOKEN_ENV` + `TWILIO_FROM_NUMBER_ENV` → backed by
 *   `TwilioSmsAdapter` (the default), auto-detected with zero extra config.
 * - `VONAGE_API_KEY_ENV` + `VONAGE_API_SECRET_ENV` + `VONAGE_FROM_ENV` → backed by
 *   `VonageSmsAdapter`, auto-detected with zero extra config.
 * - If BOTH sets above are set at once, `SMS_PROVIDER_ENV` (`'twilio'`|`'vonage'`) must be set to
 *   disambiguate — this throws rather than silently picking one.
 *
 * It uses the `@Connector()` decorator to register the connector with the Zanix framework. This
 * behavior ensures that, when a provider is configured, a default SMS connector is available
 * without requiring manual setup. Any other provider can still be wired up manually at any time by
 * setting `SmsClient.config = { adapter: myAdapter }` before this module would otherwise register
 * one of the two above.
 *
 * @requires Deno.env
 * @requires SmsClient
 * @decorator Connector
 *
 * @module
 */
const zanixSmsConnectorCore: void = registerSmsConnector()

export default zanixSmsConnectorCore
