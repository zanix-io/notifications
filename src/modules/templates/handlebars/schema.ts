import { z } from 'zod'

export const baseStylesSchema = z.object({
  css: z.string().default(''),
}).default({ css: '' })

export const defaultHtmlSchema = {
  lang: 'en',
  title: 'Zanix Template',
}

export const baseHtmlSchema = z.object({
  lang: z.string().optional(),
  title: z.string().optional(),
}).default(defaultHtmlSchema)
