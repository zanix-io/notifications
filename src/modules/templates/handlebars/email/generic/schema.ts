import { z } from 'zod'

import { baseHtmlSchema, baseStylesSchema, defaultHtmlSchema } from '../../schema.ts'
import { sanitizeHtml } from 'utils/sanitize-html.ts'
import { sanitizeUrl } from '@zanix/helpers'

// Ensure default styles are applied if not present
const defaultStyles = {
  containerClass: 'container',
  titleClass: 'title',
  contentClass: 'content',
  buttonClass: 'button',
  messageClass: 'message',
  footerClass: 'footer',
}

const styleSchema = z.object({
  containerClass: z.string().optional(),
  titleClass: z.string().optional(),
  contentClass: z.string().optional(),
  buttonClass: z.string().optional(),
  messageClass: z.string().optional(),
  footerClass: z.string().optional(),
}).default(defaultStyles).and(baseStylesSchema)

/** Zod schema backing the `generic` Handlebars template's data. */
export const genericSchema = z.object({
  html: z.preprocess((val: object) => {
    return { ...defaultHtmlSchema, ...val }
  }, baseHtmlSchema),
  styles: z.preprocess((val: object) => {
    return { ...defaultStyles, ...val }
  }, styleSchema),
  title: z.string(),
  // Rendered unescaped in the template ({{{content}}}/{{{footer}}}) — see `sanitizeHtml`'s own
  // doc for why that's intentional, and what this still strips before either reaches it.
  content: z.string().transform(sanitizeHtml),
  buttonText: z.string().optional(),
  buttonLink: z.string().optional().transform((value) => value && sanitizeUrl(value)),
  message: z.string().optional(),
  footer: z.string().optional().transform((value) => value && sanitizeHtml(value)),
})

export default genericSchema
