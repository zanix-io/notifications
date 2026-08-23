/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

import { SmtpClient } from './connector.ts'
import { Connector } from '@zanix/server'

/** Env var naming the SMTP server hostname — one of the four required together for `registerSmtpConnector()` to wire up the default `SmtpClient` (see that function's own doc). */
export const SMTP_HOST_ENV = 'SMTP_HOST'
/** Env var naming the SMTP server port — required alongside `SMTP_HOST_ENV`/`SMTP_USER_ENV`/`SMTP_PASSWORD_ENV`. */
export const SMTP_PORT_ENV = 'SMTP_PORT'
/** Env var naming the SMTP auth username — required alongside `SMTP_HOST_ENV`/`SMTP_PORT_ENV`/`SMTP_PASSWORD_ENV`. */
export const SMTP_USER_ENV = 'SMTP_USER'
/** Env var naming the SMTP auth password — required alongside `SMTP_HOST_ENV`/`SMTP_PORT_ENV`/`SMTP_USER_ENV`. */
export const SMTP_PASSWORD_ENV = 'SMTP_PASSWORD'

/**
 * Connector DSL definition — exported (not just auto-run below) so a caller can re-register after
 * clearing the `'type:connector'` registry (`closeAllConnections()`/
 * `ProgramModule.targets.resetContainer(['type:connector'])`, both in `@zanix/server`), without
 * needing a fresh module evaluation of this file. Re-reads `Deno.env` each call, so a config-reload
 * in a long-running process — or a test simulating a different env state between cases — gets a
 * genuinely current registration, not a stale decision baked in at first import. Same pattern
 * `@zanix/datamaster`'s own `storage/core.ts` (`registerSeaweedFSConnector`) already uses.
 */
export const registerSmtpConnector = (): void => {
  if (
    !Deno.env.has(SMTP_PORT_ENV) || !Deno.env.has(SMTP_HOST_ENV) ||
    !Deno.env.has(SMTP_USER_ENV) ||
    !Deno.env.has(SMTP_PASSWORD_ENV)
  ) return

  SmtpClient.config = {
    port: Number(Deno.env.get(SMTP_PORT_ENV)),
    hostname: Deno.env.get(SMTP_HOST_ENV) as string,
    password: Deno.env.get(SMTP_PASSWORD_ENV) as string,
    username: Deno.env.get(SMTP_USER_ENV) as string,
  }

  Connector({ startMode: 'lazy', lifetime: 'SCOPED' })(SmtpClient)
}

/**
 * Core SMTP connector loader for Zanix.
 *
 * This module automatically registers the default SMTP connector
 * (`SmtpClient`) if the `SMTP` environment variables are set.
 * It uses the `@Connector()` decorator to register the connector with the Zanix framework.
 *
 * This behavior ensures that, when a SMTP configuration is provided,
 * a default SMTP connector is available without requiring manual setup.
 *
 * `SCOPED` here means the framework gives every request its own `SmtpClient` instance — see
 * `email/connector.ts` for why a shared instance would be unsafe under concurrent requests, and
 * how a shared connection pool (`SMTP_POOL_SIZE`) still avoids paying a fresh handshake on every
 * request despite that.
 *
 * @requires Deno.env
 * @requires SmtpClient
 * @decorator Connector
 *
 * @module
 */
const zanixSmtpConnectorCore: void = registerSmtpConnector()

export default zanixSmtpConnectorCore
