import type { CreateTemplateInput, UpdateTemplateInput } from 'typings/templates-db.ts'
import type { Notifiers } from 'typings/general.ts'

import { BaseRTO, IsArray, IsBoolean, IsEnum, IsObject, IsString } from '@zanix/validator'
import { NOTIFIER_CHANNELS } from 'utils/constants.ts'

/** Route params for a single template entry (`GET`/`PUT`/`DELETE /admin/templates/:channel/:name`). */
export class TemplateParamsRTO extends BaseRTO {
  @IsEnum(NOTIFIER_CHANNELS, { expose: true })
  accessor channel!: Notifiers

  @IsString({ expose: true })
  accessor name!: string
}

/** Body validation for `POST /admin/templates`. */
export class CreateTemplateRTO extends BaseRTO implements CreateTemplateInput {
  @IsEnum(NOTIFIER_CHANNELS, { expose: true })
  accessor channel!: Notifiers

  @IsString({ expose: true })
  accessor name!: string

  @IsString({ expose: true })
  accessor hbs!: string

  @IsString({ optional: true, expose: true })
  accessor description: string | undefined

  @IsArray({ optional: true, expose: true })
  accessor availableVariables: string[] | undefined
}

/** Body validation for `PUT /admin/templates/:channel/:name` — see {@link CreateTemplateRTO}. */
export class UpdateTemplateRTO extends BaseRTO implements UpdateTemplateInput {
  @IsString({ optional: true, expose: true })
  accessor hbs: string | undefined

  @IsBoolean({ optional: true, expose: true })
  accessor active: boolean | undefined

  @IsString({ optional: true, expose: true })
  accessor description: string | undefined

  @IsArray({ optional: true, expose: true })
  accessor availableVariables: string[] | undefined
}

/** Query of `GET /templates/messages`: the languages to return, comma-separated; all when omitted. */
export class MessagesSearchRTO extends BaseRTO {
  @IsString({ optional: true, expose: true })
  accessor langs: string | undefined
}

/** Route params of one text of the message catalog (`PUT`/`DELETE /templates/messages/:lang/:key`). */
export class MessageParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor lang!: string

  @IsString({ expose: true })
  accessor key!: string
}

/** Body of `PUT /templates/messages/:lang/:key`: the words, with `{name}` placeholders. */
export class SetMessageRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor text!: string
}

/** Query of `GET /templates/message-entries`: the languages (comma-separated) and a text to search for. */
export class MessageEntriesSearchRTO extends BaseRTO {
  @IsString({ optional: true, expose: true })
  accessor langs: string | undefined

  @IsString({ optional: true, expose: true })
  accessor q: string | undefined
}

/** Body of `POST /templates/:channel/:name/preview`: the data to render with, and the language. */
export class PreviewTemplateRTO extends BaseRTO {
  @IsObject({ optional: true, expose: true })
  accessor data: Record<string, unknown> | undefined

  @IsString({ optional: true, expose: true })
  accessor lang: string | undefined
}
