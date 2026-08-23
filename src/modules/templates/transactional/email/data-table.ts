import type { DataTableTemplateSchema } from 'typings/templates.ts'

import { execTemplate } from '../../mod.ts'

/** Renders an itemized-table document — an invoice, receipt, order confirmation, or quote. */
export const dataTable = (data: DataTableTemplateSchema): Promise<string> => {
  return execTemplate('email/data-table', data)
}
