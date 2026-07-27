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

/** Connector DSL definition */
const registerConnector = () => {
  if (
    !Deno.env.has('TWILIO_ACCOUNT_SID') || !Deno.env.has('TWILIO_AUTH_TOKEN') ||
    !Deno.env.has('TWILIO_FROM_NUMBER')
  ) return

  SmsClient.config = {
    accountSid: Deno.env.get('TWILIO_ACCOUNT_SID') as string,
    authToken: Deno.env.get('TWILIO_AUTH_TOKEN') as string,
    from: Deno.env.get('TWILIO_FROM_NUMBER') as string,
    apiBase: Deno.env.get('TWILIO_API_BASE'),
  }

  Connector({ startMode: 'lazy', lifetime: 'SCOPED' })(SmsClient)
}

/**
 * Core SMS connector loader for Zanix.
 *
 * This module automatically registers the default SMS connector (`SmsClient`, backed by
 * `TwilioSmsAdapter`) if the `TWILIO_*` environment variables are set. It uses the `@Connector()`
 * decorator to register the connector with the Zanix framework.
 *
 * This behavior ensures that, when Twilio configuration is provided, a default SMS connector is
 * available without requiring manual setup. A different SMS provider can still be wired up
 * manually at any time by setting `SmsClient.config = { adapter: myAdapter }` before this module
 * would otherwise register Twilio.
 *
 * @requires Deno.env
 * @requires SmsClient
 * @decorator Connector
 *
 * @module
 */
const zanixSmsConnectorCore: void = registerConnector()

export default zanixSmsConnectorCore
