import type { Notifiers } from 'typings/general.ts'

import { SmtpClient } from './email/connector.ts'

// deno-lint-ignore no-explicit-any
export const notifierConnectors: Record<Notifiers, any> = {
  email: SmtpClient,
}
