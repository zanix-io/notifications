import type { Notifiers } from 'typings/general.ts'
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from 'typings/templates-db.ts'
import type { SyncCodeTemplateEntry, SyncCodeTemplatesResult } from './templates.repository.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { TemplatesAdminRepository } from './templates.repository.ts'

/**
 * Business logic behind `@zanix/admin`'s `/admin/templates`/`/templates` — see its own
 * `templates.handler.ts`.
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
  public remove(channel: Notifiers, name: string, updatedBy: string): Promise<void> {
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
}
