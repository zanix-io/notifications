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

/** Connector DSL definition */
const registerConnector = () => {
  if (
    !Deno.env.has('SMTP_PORT') || !Deno.env.has('SMTP_HOST') || !Deno.env.has('SMTP_USER') ||
    !Deno.env.has('SMTP_PASSWORD')
  ) return

  SmtpClient.config = {
    port: Number(Deno.env.get('SMTP_PORT')),
    hostname: Deno.env.get('SMTP_HOST') as string,
    password: Deno.env.get('SMTP_PASSWORD') as string,
    username: Deno.env.get('SMTP_USER') as string,
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
 * @requires Deno.env
 * @requires SmtpClient
 * @decorator Connector
 *
 * @module
 */
const zanixSmtpConnectorCore: void = registerConnector()

export default zanixSmtpConnectorCore
