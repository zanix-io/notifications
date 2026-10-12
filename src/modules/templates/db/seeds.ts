import type { TemplateSeedOptions } from 'typings/templates-db.ts'
import type { StaticTemplateEntry } from './sync.ts'

import logger from '@zanix/logger'
import { fromFileUrl, join } from '@std/path'
import { hashContent } from './manifest.ts'
import { assertValidHandlebarsSyntax } from '../hbs-validation.ts'
import { deriveAvailableVariables } from '../handlebars/derive-available-variables.ts'

/** What a consumer registered, in the order it was registered. */
const registrations: TemplateSeedOptions[] = []

/**
 * Registers the templates and the message texts a consumer wants in the collections, so its own catalog
 * (its transactional messages, its branded versions of the built-ins) is there from the first boot with
 * no call of its own after start.
 *
 * Nothing new runs for them: they are code templates, one more source of the sync the library already
 * does for its built-in ones (`ensureTemplatesSynced`, and the same for the texts), so they follow the
 * same rule and the same lifecycle. The models' own seeders run that sync when the collection is ready,
 * the first resolve runs it if they did not (`DATABASE_SEEDERS=false`), and a registration made before
 * the sync runs is part of it.
 *
 * - A `{channel, name}` with no record is added with `source: 'code'`.
 * - One whose words changed in the consumer is brought up to date while nobody has edited the record
 *   (the record still equals what was last synced in, `lastSyncedHbs`); an edit is never overwritten.
 * - A name the library already has replaces the library's words, so a built-in can be branded.
 * - One the consumer stops registering becomes `source: 'database'` and keeps its words, never deleted.
 *
 * Registering again with the same `{channel, name}` or `{lang, key}` replaces the earlier one. Only the
 * `local` templates backend has a collection; with any other mode the registration has no effect.
 *
 * @param options The consumer's templates and message texts.
 */
export function registerTemplateSeeds(options: TemplateSeedOptions): void {
  registrations.push(options)
}

/** Forgets every registration — test-only. */
export function resetTemplateSeeds(): void {
  registrations.length = 0
}

/**
 * The library's code templates with the consumer's registered ones in, as `planTemplateSync` takes them:
 * a registered template that names one of the library's replaces it, the rest are added. A template
 * that is not valid Handlebars is skipped and logged, never stops the sync.
 *
 * @param entries The library's own code templates.
 */
export async function withRegisteredTemplates(
  entries: StaticTemplateEntry[],
): Promise<StaticTemplateEntry[]> {
  const merged = new Map(entries.map((entry) => [`${entry.channel}:${entry.name}`, entry]))
  for (const { templates = [] } of registrations) {
    for (const seed of templates) {
      try {
        // Sequential on purpose: a later registration of a name replaces an earlier one.
        // deno-lint-ignore no-await-in-loop
        await assertValidHandlebarsSyntax(seed.hbs)
      } catch (error) {
        logger.warn(
          `[TemplateSeeds] "${seed.channel}/${seed.name}" is not valid Handlebars — skipped: ${
            (error as Error).message
          }`,
        )
        continue
      }
      merged.set(`${seed.channel}:${seed.name}`, {
        channel: seed.channel,
        name: seed.name,
        hbs: seed.hbs,
        // deno-lint-ignore no-await-in-loop
        hash: await hashContent(seed.hbs),
        availableVariables: seed.availableVariables ?? deriveAvailableVariables(seed.hbs),
        styles: { css: '', classDefaults: {} },
      })
    }
  }
  return [...merged.values()]
}

/** One text of the catalog a consumer registered. */
export interface RegisteredMessage {
  lang: string
  key: string
  text: string
}

/** Reads `<dir>/<lang>/*.json`, each file a flat `{ key: text }`, into the shape of `messages`. */
async function readMessagesDir(dir: string | URL): Promise<Record<string, Record<string, string>>> {
  const root = typeof dir === 'string' ? dir : fromFileUrl(dir)
  const catalog: Record<string, Record<string, string>> = {}
  for await (const language of Deno.readDir(root)) {
    if (!language.isDirectory) continue
    const texts: Record<string, string> = catalog[language.name] = {}
    for await (const file of Deno.readDir(join(root, language.name))) {
      if (!file.isFile || !file.name.endsWith('.json')) continue
      Object.assign(
        texts,
        JSON.parse(await Deno.readTextFile(join(root, language.name, file.name))),
      )
    }
  }
  return catalog
}

/** The message texts every registration provides (its folder first, then `messages`), a later one
 * replacing an earlier one. */
export async function registeredMessages(): Promise<RegisteredMessage[]> {
  // Read in registration order, in parallel: a later registration still replaces an earlier one.
  const catalogs = (await Promise.all(
    registrations.map(async ({ messages = {}, messagesDir }) => [
      ...(messagesDir ? [await readMessagesDir(messagesDir)] : []),
      messages,
    ]),
  )).flat()
  const merged = new Map<string, RegisteredMessage>()
  for (const catalog of catalogs) {
    for (const [lang, texts] of Object.entries(catalog)) {
      for (const [key, text] of Object.entries(texts)) {
        merged.set(`${lang}:${key}`, { lang, key, text })
      }
    }
  }
  return [...merged.values()]
}

/** The `adopt` predicates of every registration. */
export function registeredAdopters(): ((hbs: string) => boolean)[] {
  return registrations.flatMap(({ adopt }) => adopt ? [adopt] : [])
}
