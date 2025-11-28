/**
 * SMTP response codes used to interpret server replies.
 */
export const smtpResponseCode = {
  /** Server is ready (220) */
  READY: 220,

  /** Server closing connection (221) */
  BYE: 221,

  /** Authentication successful (235) */
  AUTH_SUCCESS: 235,

  /** Command completed successfully (250) */
  OK: 250,

  /** Server is ready for next authentication step (334) */
  AUTH_NEXT: 334,

  /** Server is ready to receive email data (354) */
  BEGIN_DATA: 354,

  /** Command failed or transaction not processed (554) */
  FAIL: 554,
} as const
