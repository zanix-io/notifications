import type { Notifiers } from 'typings/general.ts'

import { SmtpClient } from './email/connector.ts'
import { SmsClient } from './sms/connector.ts'
import { WhatsappClient } from './whatsapp/connector.ts'

// deno-lint-ignore no-explicit-any
export const notifierConnectors: Record<Notifiers, any> = {
  email: SmtpClient,
  sms: SmsClient,
  whatsapp: WhatsappClient,
}
