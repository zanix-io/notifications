import { assertNoCrlf } from '@zanix/helpers'
import { InternalError } from '@zanix/errors'

/** Headers the connector writes itself; a message cannot override them. */
const RESERVED_HEADERS = new Set([
  'subject',
  'from',
  'to',
  'date',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
])

/** A header field name: letters, digits and hyphens, starting with a letter. */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/

/**
 * The `Name: value` lines of the extra headers of a message, in the order given.
 *
 * @throws {InternalError} `SMTP_INVALID_HEADER` when a name is not a plain header name or is one
 *   the connector sets itself, or when a value holds a line break (header injection).
 */
export function serializeExtraHeaders(headers?: Record<string, string>): string[] {
  if (!headers) return []
  return Object.entries(headers).map(([name, value]) => {
    if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new InternalError(`Email header "${name}" is not allowed.`, {
        code: 'SMTP_INVALID_HEADER',
      })
    }
    assertNoCrlf(`header ${name}`, value)
    return `${name}: ${value}`
  })
}
