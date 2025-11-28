import { z } from 'zod'

import { baseHtmlSchema, baseStylesSchema, defaultHtmlSchema } from '../schema.ts'

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

const genericSchema = z.object({
  html: z.preprocess((val: object) => {
    return { ...defaultHtmlSchema, ...val }
  }, baseHtmlSchema),
  styles: z.preprocess((val: object) => {
    return { ...defaultStyles, ...val }
  }, styleSchema),
  title: z.string(),
  content: z.string(),
  buttonText: z.string().optional(),
  buttonLink: z.string().optional(),
  message: z.string().optional(),
  footer: z.string().optional(),
})

export default genericSchema
