/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { WhatsappClient } from './connector.ts'
import { Connector } from '@zanix/server'
import { TwilioWhatsappAdapter } from './twilio.ts'
import { InternalError } from '@zanix/errors'

/** Env var naming the WhatsApp Business phone number ID — one of the two required for the `'meta'` `WhatsappProvider` (see `resolveWhatsappProvider()`). */
export const META_PHONE_NUMBER_ID_ENV = 'META_PHONE_NUMBER_ID'
/** Env var naming the Meta Graph API access token — required alongside `META_PHONE_NUMBER_ID_ENV`. */
export const META_ACCESS_TOKEN_ENV = 'META_ACCESS_TOKEN'
/** Env var optionally overriding the Graph API version. */
export const META_API_VERSION_ENV = 'META_API_VERSION'
/** Env var optionally overriding Meta's Graph API base URL (proxy, mock server). */
export const META_API_BASE_ENV = 'META_API_BASE'

/**
 * Env var naming Twilio's account SID — one of the three required for the `'twilio'`
 * `WhatsappProvider` (see `resolveWhatsappProvider()`). Names the exact same underlying credential
 * as `sms/defs.ts`'s own exported `TWILIO_ACCOUNT_SID_ENV` (same literal string value, shared by
 * design — see that module's own doc). Deliberately NOT exported from here, even though it's a
 * local constant duplicated by value (not imported from `sms/defs.ts` — no shared abstraction
 * between the two channels' selectors, same as `hasTwilioEnv()` below): `modules/core.ts`'s
 * `export * from './sms/defs.ts'` and `export * from './whatsapp/defs.ts'` both re-export
 * everything public from each module, so two modules independently exporting a same-named binding
 * would be a `TS2308` ambiguous-re-export error at that barrel — `sms/defs.ts` is the one canonical
 * public export for this specific name.
 */
const TWILIO_ACCOUNT_SID_ENV = 'TWILIO_ACCOUNT_SID'
/** Env var naming Twilio's auth token — required alongside `TWILIO_ACCOUNT_SID_ENV`/`TWILIO_WHATSAPP_FROM_ENV`. Same non-export rationale as `TWILIO_ACCOUNT_SID_ENV` above — publicly exported from `sms/defs.ts` instead. */
const TWILIO_AUTH_TOKEN_ENV = 'TWILIO_AUTH_TOKEN'
/** Env var naming the WhatsApp-enabled sender number — required alongside `TWILIO_ACCOUNT_SID_ENV`/`TWILIO_AUTH_TOKEN_ENV`. Deliberately a separate variable from `sms/defs.ts`'s `TWILIO_FROM_NUMBER_ENV`, since a WhatsApp-enabled Twilio sender is typically a different number than the plain SMS one, even under the same account. Unique to this module — exported normally, no collision risk. */
export const TWILIO_WHATSAPP_FROM_ENV = 'TWILIO_WHATSAPP_FROM'
/** Env var optionally overriding Twilio's REST API base URL (proxy, mock server, alternate API version). Same non-export rationale as `TWILIO_ACCOUNT_SID_ENV` above — publicly exported from `sms/defs.ts` instead. */
const TWILIO_API_BASE_ENV = 'TWILIO_API_BASE'

/**
 * Env var explicitly selecting which built-in WhatsApp adapter `registerWhatsappConnector()` wires
 * up when BOTH Meta's and Twilio's own required env vars are set at once — otherwise
 * `resolveWhatsappProvider()` has no unambiguous choice between them and throws (see its own doc).
 * **Only required to disambiguate that specific conflict.** With exactly one provider's own vars
 * set (the common case), `resolveWhatsappProvider()` auto-detects it with zero extra config — this
 * selector doesn't replace that, it only resolves the case where auto-detection would otherwise be
 * ambiguous. Also honored as an explicit override even without a conflict.
 *
 * @throws (via `resolveWhatsappProvider()`) if set to anything other than `'meta'`/`'twilio'`.
 */
export const WHATSAPP_PROVIDER_ENV = 'WHATSAPP_PROVIDER'

/** The two built-in WhatsApp providers `WHATSAPP_PROVIDER_ENV`/`resolveWhatsappProvider()` choose between. */
export type WhatsappProvider = 'meta' | 'twilio'

const hasMetaEnv = () =>
  Deno.env.has(META_PHONE_NUMBER_ID_ENV) && Deno.env.has(META_ACCESS_TOKEN_ENV)

const hasTwilioEnv = () =>
  Deno.env.has(TWILIO_ACCOUNT_SID_ENV) && Deno.env.has(TWILIO_AUTH_TOKEN_ENV) &&
  Deno.env.has(TWILIO_WHATSAPP_FROM_ENV)

/**
 * Resolves which `WhatsappProvider` `registerWhatsappConnector()` should wire up, re-read on every
 * call (not cached) — mirrors `templates/provider.ts`'s `templatesBackendMode()` re-read-on-every-
 * call pattern, for the same reason: no assumption about env vars being set before this module is
 * first evaluated.
 *
 * - `WHATSAPP_PROVIDER_ENV` set: that value wins outright, `'meta'`/`'twilio'` only — see
 *   `assertWhatsappProviderConfigValid()` for whether that provider's own required vars are
 *   actually present.
 * - `WHATSAPP_PROVIDER_ENV` unset, exactly one of Meta's/Twilio's own required vars fully set:
 *   that one, auto-detected.
 * - `WHATSAPP_PROVIDER_ENV` unset, BOTH fully set: throws — the ambiguous case
 *   `WHATSAPP_PROVIDER_ENV` exists to disambiguate.
 * - Neither set, `WHATSAPP_PROVIDER_ENV` unset: `undefined` — no provider configured, registration
 *   is skipped entirely.
 *
 * @returns `'meta'`, `'twilio'`, or `undefined` when nothing is configured.
 * @throws If `WHATSAPP_PROVIDER_ENV` is set to something other than `'meta'`/`'twilio'`, or if it's
 * unset while both providers' own required env vars are set at once.
 */
export function resolveWhatsappProvider(): WhatsappProvider | undefined {
  const raw = Deno.env.get(WHATSAPP_PROVIDER_ENV)
  if (raw) {
    if (raw !== 'meta' && raw !== 'twilio') {
      throw new InternalError(
        `[WhatsappClient] "${WHATSAPP_PROVIDER_ENV}" must be "meta" or "twilio" — got "${raw}".`,
      )
    }
    return raw
  }

  const meta = hasMetaEnv()
  const twilio = hasTwilioEnv()
  if (meta && twilio) {
    throw new InternalError(
      `[WhatsappClient] Both Meta ("${META_PHONE_NUMBER_ID_ENV}"/"${META_ACCESS_TOKEN_ENV}") and ` +
        `Twilio ("${TWILIO_ACCOUNT_SID_ENV}"/"${TWILIO_AUTH_TOKEN_ENV}"/` +
        `"${TWILIO_WHATSAPP_FROM_ENV}") env vars are set with no "${WHATSAPP_PROVIDER_ENV}" ` +
        `selected — set "${WHATSAPP_PROVIDER_ENV}=meta" or "${WHATSAPP_PROVIDER_ENV}=twilio" to ` +
        `disambiguate.`,
    )
  }
  if (meta) return 'meta'
  if (twilio) return 'twilio'
  return undefined
}

/**
 * Validates that `provider`'s own required env vars are actually set — only meaningful when
 * `provider` came from an explicit `WHATSAPP_PROVIDER_ENV` value (`resolveWhatsappProvider()`'s
 * auto-detected return already guarantees this by construction), so an explicit selection with
 * nothing actually configured to back it fails loudly instead of registering a connector with
 * `undefined` credentials.
 *
 * @throws If `provider` is `'meta'` without `META_PHONE_NUMBER_ID_ENV`/`META_ACCESS_TOKEN_ENV` both
 * set, or `'twilio'` without `TWILIO_ACCOUNT_SID_ENV`/`TWILIO_AUTH_TOKEN_ENV`/
 * `TWILIO_WHATSAPP_FROM_ENV` all set.
 */
export function assertWhatsappProviderConfigValid(provider: WhatsappProvider): void {
  if (provider === 'meta' && !hasMetaEnv()) {
    throw new InternalError(
      `[WhatsappClient] "${WHATSAPP_PROVIDER_ENV}=meta" requires "${META_PHONE_NUMBER_ID_ENV}"/` +
        `"${META_ACCESS_TOKEN_ENV}" to both be set.`,
    )
  }
  if (provider === 'twilio' && !hasTwilioEnv()) {
    throw new InternalError(
      `[WhatsappClient] "${WHATSAPP_PROVIDER_ENV}=twilio" requires "${TWILIO_ACCOUNT_SID_ENV}"/` +
        `"${TWILIO_AUTH_TOKEN_ENV}"/"${TWILIO_WHATSAPP_FROM_ENV}" to all be set.`,
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
 * @throws (via `resolveWhatsappProvider()`/`assertWhatsappProviderConfigValid()`) if
 * `WHATSAPP_PROVIDER_ENV` is invalid, if it's unset with both providers' vars set at once, or if
 * an explicit selection lacks its own required vars.
 */
export const registerWhatsappConnector = (): void => {
  const provider = resolveWhatsappProvider()
  if (!provider) return

  assertWhatsappProviderConfigValid(provider)

  if (provider === 'meta') {
    WhatsappClient.config = {
      phoneNumberId: Deno.env.get(META_PHONE_NUMBER_ID_ENV) as string,
      accessToken: Deno.env.get(META_ACCESS_TOKEN_ENV) as string,
      apiVersion: Deno.env.get(META_API_VERSION_ENV),
      apiBase: Deno.env.get(META_API_BASE_ENV),
    }
  } else {
    WhatsappClient.config = {
      adapter: new TwilioWhatsappAdapter({
        accountSid: Deno.env.get(TWILIO_ACCOUNT_SID_ENV) as string,
        authToken: Deno.env.get(TWILIO_AUTH_TOKEN_ENV) as string,
        from: Deno.env.get(TWILIO_WHATSAPP_FROM_ENV) as string,
        apiBase: Deno.env.get(TWILIO_API_BASE_ENV),
      }),
    }
  }

  Connector({ startMode: 'lazy', lifetime: 'SCOPED' })(WhatsappClient)
}

/**
 * Core WhatsApp connector loader for Zanix.
 *
 * This module automatically registers the default WhatsApp connector (`WhatsappClient`) once a
 * `WhatsappProvider` is resolved (see `resolveWhatsappProvider()`):
 * - `META_PHONE_NUMBER_ID_ENV` + `META_ACCESS_TOKEN_ENV` → backed by `MetaCloudWhatsappAdapter`
 *   (the default), auto-detected with zero extra config.
 * - `TWILIO_ACCOUNT_SID_ENV` + `TWILIO_AUTH_TOKEN_ENV` + `TWILIO_WHATSAPP_FROM_ENV` → backed by
 *   `TwilioWhatsappAdapter`, auto-detected with zero extra config.
 * - If BOTH sets above are set at once, `WHATSAPP_PROVIDER_ENV` (`'meta'`|`'twilio'`) must be set
 *   to disambiguate — this throws rather than silently picking one.
 *
 * It uses the `@Connector()` decorator to register the connector with the Zanix framework. This
 * behavior ensures that, when a provider is configured, a default WhatsApp connector is available
 * without requiring manual setup. Any other provider can still be wired up manually at any time by
 * setting `WhatsappClient.config = { adapter: myAdapter }` before this module would otherwise
 * register one of the two above.
 *
 * @requires Deno.env
 * @requires WhatsappClient
 * @decorator Connector
 *
 * @module
 */
const zanixWhatsappConnectorCore: void = registerWhatsappConnector()

export default zanixWhatsappConnectorCore
