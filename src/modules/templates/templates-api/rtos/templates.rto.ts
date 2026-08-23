import type { CreateTemplateInput, UpdateTemplateInput } from 'typings/templates-db.ts'
import type { Notifiers } from 'typings/general.ts'

import { BaseRTO, IsArray, IsBoolean, IsEnum, IsString } from '@zanix/validator'
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
