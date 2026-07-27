import { z } from 'zod'

import { baseStylesSchema } from '../../schema.ts'

/** Zod schema backing the `sms/generic` Handlebars template's data. */
export const genericSchema = z.object({
  // Required by the build pipeline (compiler.ts always injects `data.styles.css`), unused by
  // this plain-text template.
  styles: baseStylesSchema,

  /** Message text */
  content: z.string(),
})

export default genericSchema
