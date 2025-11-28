import type { smtpResponseCode } from 'utils/constants.ts'

/**
 * Configuration for connecting to an SMTP server.
 */
export interface ServerConfig {
  /** Port number of the SMTP server (e.g., 465 for SMTPS or 587 for STARTTLS) */
  port: number

  /** Hostname or IP address of the SMTP server */
  hostname: string

  /** Username for SMTP authentication */
  username: string

  /** Password for SMTP authentication */
  password: string
}

/**
 * SMTP response codes used to interpret server replies.
 */
export type SmtpResponseCode = (typeof smtpResponseCode)[keyof typeof smtpResponseCode]
