import type { Notifiers } from 'typings/general.ts'
import type { DerivedTemplateDeclaration, StarterVariable } from 'typings/templates.ts'

import emailGenericHbs from '../handlebars/email/generic/main.hbs' with { type: 'text' }
import emailGenericCss from '../handlebars/email/generic/styles.css' with { type: 'text' }
import smsGenericHbs from '../handlebars/sms/generic/main.hbs' with { type: 'text' }
import smsGenericCss from '../handlebars/sms/generic/styles.css' with { type: 'text' }
import whatsappGenericHbs from '../handlebars/whatsapp/generic/main.hbs' with { type: 'text' }
import whatsappGenericCss from '../handlebars/whatsapp/generic/styles.css' with { type: 'text' }

/** What a starter body is generated from: the real source of the parent template. */
export interface StarterParent {
  /** The parent's `main.hbs`. */
  hbs: string
  /** The parent's `styles.css`, which an independent database template does not get injected. */
  css: string
  /** The parent's default style-class names (`styleDefaults`), for its `{{styles.xClass}}` references. */
  classDefaults: Record<string, string>
}

/**
 * Matches a mustache that reads one variable: `{{name}}`, `{{{name}}}`, and the condition of
 * `{{#if name}}`, `{{#unless name}}` and `{{else if name}}`. Anything else (`{{else}}`, `{{/if}}`,
 * a helper call with arguments) does not match, so it is never touched.
 */
const VARIABLE_MUSTACHE =
  /\{\{(\{?)\s*((?:#(?:if|unless)|else if)\s+)?([A-Za-z_][\w.]*)\s*\}\}(\}?)/g

/** Wraps `expression` in parentheses when it is a helper call, so it can be a block's condition. */
const asArgument = (expression: string): string =>
  /\s/.test(expression) ? `(${expression})` : expression

/**
 * Generates the starter body of a derived template from its parent's real source. The variables
 * the transform assigns are replaced by what it assigns (`variables`), the stylesheet and the
 * default class names are inlined, and everything else in the parent is kept as it is, so a change
 * in the parent's `main.hbs` reaches the starter without editing it. A variable the transform does
 * not assign keeps reading the send's raw data, as the transform's pass-through of the rest of the
 * data does.
 *
 * - `{{name}}` and `{{{name}}}` become `{{expression}}` and `{{{expression}}}` (a `{ fragment }`
 *   replaces the whole mustache instead).
 * - `{{#if name}}`, `{{#unless name}}` and `{{else if name}}` take the expression as their
 *   condition (a helper call is parenthesized).
 * - `{{styles.css}}` becomes the stylesheet and `{{styles.xClass}}` the default class name.
 *
 * @param parent The parent's source, stylesheet and default class names.
 * @param variables The parent's variables the derived template assigns, by name.
 * @returns A self-contained Handlebars source, without the parent file's surrounding whitespace (a
 * text message body must not end in a line break).
 * @throws If a `{ fragment }` variable is used as a condition, which a fragment cannot express.
 */
export function buildStarterHbs(
  parent: StarterParent,
  variables: Record<string, StarterVariable>,
): string {
  return parent.hbs.trim().replace(
    VARIABLE_MUSTACHE,
    (match, open: string, block: string | undefined, name: string) => {
      if (name === 'styles.css') return parent.css.trim()
      const classDefault = /^styles\.(\w+)$/.exec(name)?.[1]
      if (classDefault && classDefault in parent.classDefaults) {
        return parent.classDefaults[classDefault]
      }
      const variable = variables[name]
      if (variable === undefined) return match

      if (typeof variable !== 'string') {
        if (block) {
          throw new Error(`The variable "${name}" is a fragment and cannot be a condition.`)
        }
        return variable.fragment
      }
      const braces = open ? '{{{' : '{{'
      const closing = open ? '}}}' : '}}'
      return block ? `{{${block}${asArgument(variable)}}}` : `${braces}${variable}${closing}`
    },
  )
}

const PARENT_SOURCES: Record<Notifiers, { hbs: string; css: string }> = {
  email: { hbs: emailGenericHbs, css: emailGenericCss },
  sms: { hbs: smsGenericHbs, css: smsGenericCss },
  whatsapp: { hbs: whatsappGenericHbs, css: whatsappGenericCss },
}

/**
 * The starter body of a declared derived template (`DerivedTemplateDeclaration.starter`), generated
 * from its parent's source on each call; never stored.
 *
 * @param declaration The derived template's declaration.
 * @param parentHbs The body the parent record holds now (an app's branded `generic`, say). The
 * starter is generated from it so it reproduces what the template renders today; without it, from
 * the parent's code source.
 * @returns The starter, or `undefined` when the declaration has no `starter` map or its parent is
 * not one of the code templates this module reads.
 */
export async function starterFor(
  declaration: DerivedTemplateDeclaration,
  parentHbs?: string,
): Promise<string | undefined> {
  if (!declaration.starter || declaration.parent !== 'generic') return undefined
  const { channel, parent } = declaration
  const source = PARENT_SOURCES[channel]
  const { styleDefaults } = await import(`../handlebars/${channel}/${parent}/main.js`) as {
    styleDefaults: Record<string, string>
  }
  return buildStarterHbs(
    { ...source, hbs: parentHbs?.trim() ? parentHbs : source.hbs, classDefaults: styleDefaults },
    declaration.starter,
  )
}
