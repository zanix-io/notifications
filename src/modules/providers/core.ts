/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Provider, registerCoreProviderSlot } from '@zanix/server'

import { NotifierProvider, ZanixCoreNotificationsProvider } from './notifier.ts'

/**
 * Provider DSL definition — applies the decorator directly to `NotifierProvider` (calling it as a
 * plain function, not `@Provider(...)` syntax) rather than wrapping it in a throwaway anonymous
 * subclass, so `this.providers.get(NotifierProvider)` — the class every consumer actually imports
 * — resolves correctly. See `@zanix/auth`'s identical `providers/core.ts` for the full rationale.
 */
const registerProvider = () => {
  Provider({ slot: 'notifications', lifetime: 'SCOPED' })(NotifierProvider)
}

// `@zanix/notifications` owns the `'notifications'` core-provider slot: it registers it here,
// mirroring `@zanix/auth`'s own `'auth'` slot registration (`providers/core.ts` there) — same
// reasoning, same idempotency guarantee against `@zanix/server`'s historical registration of the
// same slot.
registerCoreProviderSlot('notifications', ZanixCoreNotificationsProvider, {
  sourcePackage: '@zanix/notifications/core',
})

/**
 * Core Notifier provider loader for Zanix.
 *
 * This module automatically registers the default notifier provider (`_NotifierProvider`) under
 * the `'notifications'` core-provider key — the same zero-config pattern AsyncMQ already uses for
 * its `'worker'` provider — so it's available via `this.providers.get('notifications')` without
 * any app-side setup.
 *
 * `SCOPED` lifetime here isn't just a style choice mirroring the connector — it's what makes the
 * connector's own `SCOPED` lifetime (see `email/connector.ts`) actually take effect. In
 * `@zanix/server`, resolving a connector via `this.use()`/`this.connectors.get()` is keyed by the
 * *resolving provider's own* `contextId`, not a fresh one per call. A `SINGLETON` provider is
 * constructed once with a fixed, non-request context, so every connector it resolves gets cached
 * under that same fixed context too — regardless of what lifetime the connector itself declares.
 * Concretely: a singleton `NotifierProvider` would silently turn `SmtpClient` into a leaked
 * de-facto singleton — borrowed once from the pool, cached forever under that fixed context, and
 * never released, since a connector's `close()`/`onDestroy()` only run for instances cached under
 * a real per-request context.
 *
 * @requires NotifierProvider
 * @decorator Provider
 *
 * @module
 */
const zanixNotifierProvider: void = registerProvider()

export default zanixNotifierProvider
