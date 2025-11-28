import type { GenericTemplateSchema } from 'typings/templates.ts'

import { execTemplate } from '../mod.ts'

export const generic = (data?: GenericTemplateSchema): Promise<string> => {
  return execTemplate('generic', {
    title: 'Zanix Notifications Library',
    content: `<p>We are excited to introduce the <strong>Zanix Notifications</strong> 
    library, a powerful tool for sending pre-defined messages and notifications 
    across your Zanix ecosystem.</p>
    <p>This library simplifies communication across your platform, 
    ensuring your messages are delivered effectively and efficiently.</p>
    <p>Get started with the Zanix Notifications library today and 
    streamline your notification workflow.</p>
`,
    ...data,
  })
}
