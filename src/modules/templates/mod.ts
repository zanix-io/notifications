/**
 * Executes a Handlebars template and returns the rendered result.
 *
 * This function dynamically imports the specified template file from the `handlebars` directory,
 * then compiles and executes it using the provided data. It is typically used to render HTML or
 * other content dynamically based on template files and data passed to it.
 *
 * The template should be stored as a JavaScript module in the `handlebars/{name}/main.js` path,
 * where `{name}` corresponds to the template name passed to the function.
 *
 * @param {string} name - The name of the template to execute (without file extension).
 *    The function will load the template from the `handlebars/{name}/main.js` file.
 *
 * @param {Record<string, unknown>} data - An object containing the data to be injected
 *    into the template. Each key in this object corresponds to a placeholder variable in
 *    the Handlebars template.
 *
 * @returns {Promise<string>} A promise that resolves to the rendered template as a string.
 *    This string will contain the result of the template rendering with the provided data.
 *
 * @example
 * // Example usage to render a "welcome" email template
 * const result = await execTemplate('welcome', { username: 'John Doe', email: 'john@example.com' })
 * console.log(result) // The rendered template with the provided data
 */

export const execTemplate = async (
  name: string,
  data: Record<string, unknown>,
): Promise<string> => {
  const { default: template } = await import(`./handlebars/${name}/main.js`)

  return template(data)
}
