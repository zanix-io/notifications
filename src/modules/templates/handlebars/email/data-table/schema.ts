import { z } from 'zod'

import { baseHtmlSchema, baseStylesSchema, defaultHtmlSchema } from '../../schema.ts'
import { sanitizeUrl } from '@zanix/helpers'

// Ensure default styles are applied if not present. Exported (not just used locally) so
// `compiler.ts` can embed it into the generated `main.js` (`styleDefaults`) — the default
// style-class names a database-sync's `ZanixTemplateAttrs.styles.classDefaults` reports, for
// external tooling (e.g. a live preview) that has no other way to know them — see
// `docs/templates.md`'s "`availableVariables` and `styles`" section.
export const defaultStyles = {
  containerClass: 'container',
  headerClass: 'header',
  tableClass: 'items-table',
  totalsClass: 'totals',
  notesClass: 'notes',
}

const styleSchema = z.object({
  containerClass: z.string().optional(),
  headerClass: z.string().optional(),
  tableClass: z.string().optional(),
  totalsClass: z.string().optional(),
  notesClass: z.string().optional(),
}).default(defaultStyles).and(baseStylesSchema)

// A single billed line — `lineTotal` is derived (quantity * unitPrice), never accepted as input;
// plain arithmetic, not a currency/locale-formatting decision, so it's safe to compute here rather
// than push onto every caller.
const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
}).transform((item) => ({ ...item, lineTotal: item.quantity * item.unitPrice }))

// Every column/row label rendered as literal English text in `main.hbs` — the one place this
// template used to hardcode language. Each is caller-overridable, defaulting to English, so a
// non-English deployment configures its own copy once (e.g. via a shared `labels` object reused
// across every send) rather than being stuck with fixed text the way this template originally
// shipped.
const defaultLabels = {
  description: 'Description',
  quantity: 'Qty',
  unitPrice: 'Unit price',
  amount: 'Amount',
  subtotal: 'Subtotal',
  tax: 'Tax',
  total: 'Total',
}

const labelsSchema = z.object({
  description: z.string().optional(),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  amount: z.string().optional(),
  subtotal: z.string().optional(),
  tax: z.string().optional(),
  total: z.string().optional(),
}).default(defaultLabels)

/**
 * Zod schema backing the `data-table` Handlebars template's data. Deliberately generic — a
 * header/description block, an itemized table with computed line totals, and a totals/notes
 * footer, with no hardcoded business name, currency, locale-specific number formatting, or
 * (via `labels`) language. Usable for an invoice, a receipt, an order confirmation, a quote, or
 * any other itemized-table document a consuming app wants to send — nothing here assumes which.
 * `subtotal`/`tax`/`total` are always caller-supplied rather than computed here, since tax rules
 * (per-line vs. flat, inclusive vs. exclusive) are a business decision this library has no
 * business making.
 */
export const dataTableSchema = z.object({
  html: z.preprocess((val: object) => {
    return { ...defaultHtmlSchema, ...val }
  }, baseHtmlSchema),
  styles: z.preprocess((val: object) => {
    return { ...defaultStyles, ...val }
  }, styleSchema),

  // A visible heading/description shown above the table — distinct from `html.title` (the
  // `<title>` tag, never rendered in the body). Optional: a caller happy with just the reference
  // number/date header below can omit it.
  title: z.string().optional(),

  // Caller-formatted display strings, not `Date` objects — this library never assumes a
  // locale/timezone to format one in (same convention as `NewLoginTemplateSchema.time`).
  referenceNumber: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string().optional(),

  senderName: z.string().optional(),
  senderLogo: z.string().optional().transform((value) => value && sanitizeUrl(value)),
  recipient: z.string().optional(),

  items: z.array(lineItemSchema).min(1),

  // A caller-supplied label (e.g. `'USD'`, `'$'`, `'€'`) rendered next to each amount, never
  // interpreted or used to pick a symbol/decimal convention — no default is assumed.
  currency: z.string().optional(),
  subtotal: z.number(),
  tax: z.number().optional(),
  total: z.number(),

  notes: z.string().optional(),

  labels: z.preprocess((val: object = {}) => {
    return { ...defaultLabels, ...val }
  }, labelsSchema),
})

export default dataTableSchema
