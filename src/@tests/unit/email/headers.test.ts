import { assertEquals, assertThrows } from 'jsr:@std/assert@0.224'
import { serializeExtraHeaders } from 'modules/email/headers.ts'

Deno.test('serializeExtraHeaders: nothing to write without headers', () => {
  assertEquals(serializeExtraHeaders(undefined), [])
  assertEquals(serializeExtraHeaders({}), [])
})

Deno.test('serializeExtraHeaders: one Name: value line per header, in order', () => {
  assertEquals(
    serializeExtraHeaders({
      'List-Unsubscribe': '<https://x.test/u?t=1>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    }),
    [
      'List-Unsubscribe: <https://x.test/u?t=1>',
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    ],
  )
})

Deno.test('serializeExtraHeaders: refuses a header the connector sets itself, in any casing', () => {
  for (const name of ['Subject', 'from', 'TO', 'Date', 'MIME-Version', 'Content-Type']) {
    assertThrows(() => serializeExtraHeaders({ [name]: 'x' }), Error, 'not allowed')
  }
})

Deno.test('serializeExtraHeaders: refuses a name that is not a plain header name', () => {
  for (const name of ['', 'A B', 'X:Y', '1Bad', 'X\r\nBcc']) {
    assertThrows(() => serializeExtraHeaders({ [name]: 'x' }), Error, 'not allowed')
  }
})

Deno.test('serializeExtraHeaders: refuses a value with a line break', () => {
  assertThrows(() => serializeExtraHeaders({ 'X-A': 'a\r\nBcc: b@c.d' }))
  assertThrows(() => serializeExtraHeaders({ 'X-A': 'a\nb' }))
})
