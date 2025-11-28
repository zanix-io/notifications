import type {
  GenericTemplateSchema,
  LoginWithOTPTemplateSchema,
  PasswordChangedTemplateSchema,
  PasswordRecoveryTemplateSchema,
  WelcomeTemplateSchema,
} from 'typings/templates.ts'

import { loginWithOTP, passwordChanged, passwordRecovery, welcome } from './auth.ts'
import { generic } from './generic.ts'

/**
 * An object containing different template rendering functions for various types of notifications.
 *
 * Each template corresponds to a specific type of notification (e.g., welcome email, password
 * change notification, etc.). These functions accept an optional data object that conforms to a
 * specific schema for each template type. The function returns a promise that resolves to the
 * rendered HTML or content based on the provided data and template.
 *
 * @property {Function} generic - Renders a generic notification template. Optionally accepts
 *    data that conforms to the `GenericTemplateSchema`.
 * @property {Function} welcome - Renders a welcome notification template. Optionally accepts
 *    data that conforms to the `WelcomeTemplateSchema`.
 * @property {Function} 'password-changed' - Renders a password change notification template.
 *    Optionally accepts data that conforms to the `PasswordChangedTemplateSchema`.
 * @property {Function} 'password-recovery' - Renders a password recovery notification template.
 *    Optionally accepts data that conforms to the `PasswordRecoveryTemplateSchema`.
 * @property {Function} 'login-otp' - Renders a login OTP (One-Time Password) notification template.
 *    Optionally accepts data that conforms to the `LoginWithOTPTemplateSchema`.
 *
 * @example
 * // Example usage to render a "welcome" template
 * const result = await templates.welcome({ username: 'John Doe' })
 * console.log(result) // Rendered HTML for the "welcome" template with provided data
 *
 * @example
 * // Example usage to render a "password-changed" template
 * const result = await templates['password-changed']({ username: 'Jane Doe', date: '2023-11-25' })
 * console.log(result) // Rendered HTML for the "password-changed" template
 */
const templates: {
  /**
   * Renders a generic notification template.
   *
   * @param {GenericTemplateSchema} [data] - Optional data to be injected into the template.
   *
   * @returns {Promise<string>} A promise that resolves to the rendered template as a string.
   */
  generic: (data?: GenericTemplateSchema) => Promise<string>

  /**
   * Renders a welcome notification template.
   *
   * @param {WelcomeTemplateSchema} [data] - Optional data to be injected into the template.
   *
   * @returns {Promise<string>} A promise that resolves to the rendered template as a string.
   */
  welcome: (data?: WelcomeTemplateSchema) => Promise<string>

  /**
   * Renders a password changed notification template.
   *
   * @param {PasswordChangedTemplateSchema} [data] - Optional data to be injected into the template.
   *
   * @returns {Promise<string>} A promise that resolves to the rendered template as a string.
   */
  'password-changed': (data?: PasswordChangedTemplateSchema) => Promise<string>

  /**
   * Renders a password recovery notification template.
   *
   * @param {PasswordRecoveryTemplateSchema} [data] - Optional data to be injected into the template.
   *
   * @returns {Promise<string>} A promise that resolves to the rendered template as a string.
   */
  'password-recovery': (data?: PasswordRecoveryTemplateSchema) => Promise<string>

  /**
   * Renders a login OTP notification template.
   *
   * @param {LoginWithOTPTemplateSchema} [data] - Optional data to be injected into the template.
   *
   * @returns {Promise<string>} A promise that resolves to the rendered template as a string.
   */
  'login-otp': (data?: LoginWithOTPTemplateSchema) => Promise<string>
} = {
  welcome,
  generic,
  'password-changed': passwordChanged,
  'password-recovery': passwordRecovery,
  'login-otp': loginWithOTP,
}

export default templates
