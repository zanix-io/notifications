import type { Notifiers } from 'typings/general.ts'

/** A code-defined template's identity plus its compiled artifacts, as read from its `main.js`. */
export interface CodeTemplateEntry {
  channel: Notifiers
  name: string
  hbs: string
  styles: string
}

/**
 * The full list of `{channel, name}` pairs that own a real `.hbs` file in source
 * (`handlebars/{channel}/{name}/`) — the only templates a database sync can seed from or resync
 * against. Transactional wrapper templates that share another template's `.hbs` under different
 * default data (e.g. email's `welcome`/`password-changed`/`password-recovery`/`login-otp`, all of
 * which render `email/generic`) are intentionally NOT listed here — they have no `.hbs` of their
 * own to sync.
 *
 * Maintained by hand, the same way `notifierConnectors` (`modules/mod.ts`) is — it changes only
 * when a new `.hbs` template is added to source.
 */
export const CODE_TEMPLATES: ReadonlyArray<{ channel: Notifiers; name: string }> = [
  { channel: 'email', name: 'generic' },
  { channel: 'sms', name: 'generic' },
  { channel: 'whatsapp', name: 'generic' },
]

/**
 * Loads every entry in {@link CODE_TEMPLATES} from its compiled `main.js` (the `source`/`styles`
 * exports `compiler.ts` embeds at build time — see `handlebars/compiler.ts`).
 */
export async function loadCodeTemplates(): Promise<CodeTemplateEntry[]> {
  return await Promise.all(
    CODE_TEMPLATES.map(async ({ channel, name }) => {
      const { source, styles } = await import(`../handlebars/${channel}/${name}/main.js`)
      return { channel, name, hbs: source as string, styles: styles as string }
    }),
  )
}

/** Hashes `text` (SHA-256, hex-encoded) — used for `ZanixTemplate.hash`/`lastSyncedHash`. */
export async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}
