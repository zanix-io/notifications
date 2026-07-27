import { assertEquals } from 'jsr:@std/assert@^1.0.15'
import { defaultTemplatesModelName } from 'modules/templates/core.ts'
import { DATABASE_TEMPLATES_ENV, TEMPLATES_MODEL_ENV } from 'modules/templates/provider.ts'

console.error = () => {}

/** Always deletes both env vars after the test, pass or fail — see `database-templates.test.ts`'s own comment on why this matters across test files. */
function envTest(name: string, fn: () => void): void {
  Deno.test(name, () => {
    try {
      fn()
    } finally {
      Deno.env.delete(DATABASE_TEMPLATES_ENV)
      Deno.env.delete(TEMPLATES_MODEL_ENV)
    }
  })
}

envTest(
  'defaultTemplatesModelName: sets TEMPLATES_MODEL_NAME to "zanix-templates" when DATABASE_TEMPLATES=true and nothing else is set',
  () => {
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'true')

    defaultTemplatesModelName()

    assertEquals(Deno.env.get(TEMPLATES_MODEL_ENV), 'zanix-templates')
  },
)

envTest(
  'defaultTemplatesModelName: does nothing when DATABASE_TEMPLATES is unset',
  () => {
    defaultTemplatesModelName()

    assertEquals(Deno.env.get(TEMPLATES_MODEL_ENV), undefined)
  },
)

envTest(
  'defaultTemplatesModelName: does nothing when DATABASE_TEMPLATES is set to anything other than "true"',
  () => {
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'yes')

    defaultTemplatesModelName()

    assertEquals(Deno.env.get(TEMPLATES_MODEL_ENV), undefined)
  },
)

envTest(
  'defaultTemplatesModelName: never overrides an already-set TEMPLATES_MODEL_NAME, even with DATABASE_TEMPLATES=true',
  () => {
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'true')
    Deno.env.set(TEMPLATES_MODEL_ENV, 'my-custom-model')

    defaultTemplatesModelName()

    assertEquals(Deno.env.get(TEMPLATES_MODEL_ENV), 'my-custom-model')
  },
)

envTest(
  'defaultTemplatesModelName: never overrides an explicit empty-string opt-out, even with DATABASE_TEMPLATES=true',
  () => {
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'true')
    Deno.env.set(TEMPLATES_MODEL_ENV, '')

    defaultTemplatesModelName()

    assertEquals(Deno.env.get(TEMPLATES_MODEL_ENV), '')
  },
)
