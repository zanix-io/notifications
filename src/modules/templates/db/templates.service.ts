import type { Notifiers } from 'typings/general.ts'
import type { MessageCatalog } from '../i18n.ts'
import type {
  CreateTemplateInput,
  MessageEntry,
  SyncCodeTemplateEntry,
  SyncCodeTemplatesResult,
  TemplatePreview,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
  ZanixTemplateMessageAttrs,
} from 'typings/templates-db.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { TemplateProvider } from '../provider.ts'
import { TemplatesAdminRepository } from './templates.repository.ts'

/** The most draft texts a preview accepts. */
export const PREVIEW_TEXTS_MAX_KEYS = 200
/** The longest key of a draft text in a preview. */
export const PREVIEW_TEXTS_MAX_KEY_LENGTH = 200
/** The longest draft text in a preview. */
export const PREVIEW_TEXTS_MAX_TEXT_LENGTH = 20000

/** Rejects, as a `BAD_REQUEST`, draft texts that are not a map of strings within the preview bounds. */
function assertPreviewTexts(texts: unknown, channel: Notifiers, name: string): void {
  const reject = (message: string): never => {
    throw new HttpError('BAD_REQUEST', {
      message: `Invalid preview texts: ${message}`,
      meta: { source: 'zanix', method: 'TemplatesAdminService', channel, name },
    })
  }
  if (texts === null || typeof texts !== 'object' || Array.isArray(texts)) {
    return reject('texts must be an object of strings.')
  }
  const entries = Object.entries(texts)
  if (entries.length > PREVIEW_TEXTS_MAX_KEYS) {
    return reject(`at most ${PREVIEW_TEXTS_MAX_KEYS} texts.`)
  }
  for (const [key, text] of entries) {
    if (key.length > PREVIEW_TEXTS_MAX_KEY_LENGTH) {
      return reject(`a key is longer than ${PREVIEW_TEXTS_MAX_KEY_LENGTH} characters.`)
    }
    if (typeof text !== 'string') return reject('every text must be a string.')
    if (text.length > PREVIEW_TEXTS_MAX_TEXT_LENGTH) {
      return reject(`a text is longer than ${PREVIEW_TEXTS_MAX_TEXT_LENGTH} characters.`)
    }
  }
}

/**
 * Business logic behind this package's own local `/templates` CRUD API — see
 * `../templates-api/templates.handler.ts`'s `createTemplatesController`. `@zanix/admin` composes a
 * separate, genuinely cross-service concern on top (`POST /templates/sync`, pulling a registered
 * service's own code templates via `ServiceRegistry`/Discovery) — see its own
 * `TemplatesSyncController`.
 *
 * Exported so a consuming app can extend or reuse this as the base for its own custom templates
 * API instead of duplicating the CRUD logic against `TemplatesAdminRepository` directly.
 */
@Interactor()
export class TemplatesAdminService extends ZanixInteractor {
  /** The repository this service delegates every method to. */
  private get repository(): TemplatesAdminRepository {
    return this.providers.get(TemplatesAdminRepository)
  }

  /** See {@link TemplatesAdminRepository.list}. */
  public list(channel?: Notifiers): Promise<ZanixTemplateAttrs[]> {
    return this.repository.list(channel)
  }

  /** See {@link TemplatesAdminRepository.get}. */
  public get(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs> {
    return this.repository.get(channel, name)
  }

  /** See {@link TemplatesAdminRepository.create}. */
  public create(
    input: CreateTemplateInput,
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs> {
    return this.repository.create(input, updatedBy)
  }

  /** See {@link TemplatesAdminRepository.update}. */
  public update(
    channel: Notifiers,
    name: string,
    changes: UpdateTemplateInput,
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs> {
    return this.repository.update(channel, name, changes, updatedBy)
  }

  /** See {@link TemplatesAdminRepository.remove}. */
  public remove(
    channel: Notifiers,
    name: string,
    updatedBy: string,
  ): Promise<void> {
    return this.repository.remove(channel, name, updatedBy)
  }

  /**
   * Batch code→database sync — see {@link TemplatesAdminRepository.syncCodeTemplates}. Given a
   * pre-fetched entry set; resolving WHICH remote service to pull entries from (via a
   * `ServiceRegistry`) is `@zanix/admin`'s own orchestration concern, not this package's — see
   * `@zanix/admin`'s `syncTemplatesFromRegisteredService`.
   */
  public syncCodeTemplates(
    entries: SyncCodeTemplateEntry[],
    updatedBy?: string,
  ): Promise<SyncCodeTemplatesResult> {
    return this.repository.syncCodeTemplates(entries, updatedBy)
  }

  /** See {@link TemplatesAdminRepository.listMessages}. */
  public listMessages(langs?: string[]): Promise<MessageCatalog> {
    return this.repository.listMessages(langs)
  }

  /** See {@link TemplatesAdminRepository.setMessage}. */
  public setMessage(
    lang: string,
    key: string,
    text: string,
    updatedBy: string,
  ): Promise<ZanixTemplateMessageAttrs> {
    return this.repository.setMessage(lang, key, text, updatedBy)
  }

  /** See {@link TemplatesAdminRepository.removeMessage}. */
  public removeMessage(lang: string, key: string): Promise<void> {
    return this.repository.removeMessage(lang, key)
  }

  /** See {@link TemplatesAdminRepository.listMessageEntries}. */
  public listMessageEntries(
    options: { langs?: string[]; search?: string } = {},
  ): Promise<MessageEntry[]> {
    return this.repository.listMessageEntries(options)
  }

  /** See {@link TemplatesAdminRepository.resetMessage}. */
  public resetMessage(
    lang: string,
    key: string,
    updatedBy: string,
  ): Promise<ZanixTemplateMessageAttrs> {
    return this.repository.resetMessage(lang, key, updatedBy)
  }

  /**
   * Renders a template with `data` in `lang` exactly as a send would (the live backend, the code
   * registry as the fallback), without sending anything: what a screen shows next to the text being
   * edited. An email also answers its subject.
   *
   * `texts` are draft message texts (key to text) that replace the catalog's text for that key in
   * the language of this render only, so a screen can show a text before it is saved. Nothing is
   * stored. At most {@linkcode PREVIEW_TEXTS_MAX_KEYS} keys of {@linkcode PREVIEW_TEXTS_MAX_KEY_LENGTH}
   * characters, each text of {@linkcode PREVIEW_TEXTS_MAX_TEXT_LENGTH} characters at most.
   *
   * @throws {HttpError} `BAD_REQUEST` if the template cannot be rendered with that data (a code template
   * validates it), or does not exist, or if `texts` is not a map of strings within those bounds.
   */
  public async preview(
    channel: Notifiers,
    name: string,
    data: Record<string, unknown>,
    lang?: string,
    texts?: Record<string, string>,
  ): Promise<TemplatePreview> {
    if (texts !== undefined) assertPreviewTexts(texts, channel, name)
    try {
      const { body, subject } = await this.providers.get(TemplateProvider).resolveMessage(
        channel,
        name,
        data,
        lang,
        { subject: channel === 'email', ...(texts && { texts }) },
      )
      return { body, ...(subject && { subject }) }
    } catch (error) {
      throw new HttpError('BAD_REQUEST', {
        message: `The template could not be rendered: ${(error as Error).message}`,
        cause: error,
        meta: { source: 'zanix', method: 'TemplatesAdminService', channel, name },
      })
    }
  }
}
