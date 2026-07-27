/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { Provider } from '@zanix/server'

import { NotifierProvider } from './notifier.ts'

/** Provider DSL definition */
const registerProvider = () => {
  @Provider({ type: 'notifications', lifetime: 'SCOPED' })
  class _NotifierProvider extends NotifierProvider {}
}

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
