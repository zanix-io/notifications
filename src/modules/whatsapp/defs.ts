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

const hasMetaEnv = () => Deno.env.has('META_PHONE_NUMBER_ID') && Deno.env.has('META_ACCESS_TOKEN')

const hasTwilioEnv = () =>
  Deno.env.has('TWILIO_ACCOUNT_SID') && Deno.env.has('TWILIO_AUTH_TOKEN') &&
  Deno.env.has('TWILIO_WHATSAPP_FROM')

/** Connector DSL definition */
const registerConnector = () => {
  if (hasMetaEnv()) {
    WhatsappClient.config = {
      phoneNumberId: Deno.env.get('META_PHONE_NUMBER_ID') as string,
      accessToken: Deno.env.get('META_ACCESS_TOKEN') as string,
      apiVersion: Deno.env.get('META_API_VERSION'),
      apiBase: Deno.env.get('META_API_BASE'),
    }
  } else if (hasTwilioEnv()) {
    WhatsappClient.config = {
      adapter: new TwilioWhatsappAdapter({
        accountSid: Deno.env.get('TWILIO_ACCOUNT_SID') as string,
        authToken: Deno.env.get('TWILIO_AUTH_TOKEN') as string,
        from: Deno.env.get('TWILIO_WHATSAPP_FROM') as string,
        apiBase: Deno.env.get('TWILIO_API_BASE'),
      }),
    }
  } else {
    return
  }

  Connector({ startMode: 'lazy', lifetime: 'SCOPED' })(WhatsappClient)
}

/**
 * Core WhatsApp connector loader for Zanix.
 *
 * This module automatically registers the default WhatsApp connector (`WhatsappClient`) if either
 * provider's environment variables are set:
 * - `META_PHONE_NUMBER_ID` + `META_ACCESS_TOKEN` → backed by `MetaCloudWhatsappAdapter`. Checked
 *   first; wins if both providers' variables are somehow set at once.
 * - `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_WHATSAPP_FROM` → backed by
 *   `TwilioWhatsappAdapter`. Deliberately a separate `TWILIO_WHATSAPP_FROM` from `sms/defs.ts`'s
 *   `TWILIO_FROM_NUMBER`, since a WhatsApp-enabled Twilio sender is typically a different number
 *   than the plain SMS one, even when both channels share the same `TWILIO_ACCOUNT_SID`.
 *
 * It uses the `@Connector()` decorator to register the connector with the Zanix framework. This
 * behavior ensures that, when either provider's configuration is provided, a default WhatsApp
 * connector is available without requiring manual setup. Any other provider can still be wired up
 * manually at any time by setting `WhatsappClient.config = { adapter: myAdapter }` before this
 * module would otherwise register one of the two above.
 *
 * @requires Deno.env
 * @requires WhatsappClient
 * @decorator Connector
 *
 * @module
 */
const zanixWhatsappConnectorCore: void = registerConnector()

export default zanixWhatsappConnectorCore
