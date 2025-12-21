import type { ServerConfig, SmtpResponseCode } from 'typings/email.ts'
import type { NotifyMessage } from 'typings/general.ts'
import type { ConnectorOptions } from '@zanix/server'

import { smtpResponseCode } from 'utils/constants.ts'
import { ZanixNotifierConnector } from '../base.ts'
import { decoder, encoder } from '@zanix/helpers'

/**
 * SMTP client for sending emails.
 *
 * The `SmtpClient` class is part of the Zanix notifications ecosystem, responsible for
 * handling email delivery via the Simple Mail Transfer Protocol (SMTP). It extends the
 * `ZanixNotifierConnector` class and provides functionality for connecting to an SMTP
 * server, sending email messages, and managing SMTP-specific configurations such as
 * authentication and connection settings.
 *
 * This client supports dynamic email templating and ensures reliable message delivery.
 * It uses data passed through the `sendMessage()` method and supports Handlebars-based
 * templates for rendering personalized email content.
 *
 * @extends ZanixNotifierConnector
 */
export class SmtpClient extends ZanixNotifierConnector {
  #config: ServerConfig
  #connected: boolean = false
  #connection: Deno.Conn | undefined
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  #writer: WritableStreamDefaultWriter<Uint8Array> | undefined
  public static config: ServerConfig

  constructor({ contextId, autoInitialize, ...config }: ServerConfig & ConnectorOptions) {
    super({ contextId, autoInitialize })

    this.#config = { ...config, ...SmtpClient.config }
  }

  /**
   * Connects to the SMTP server and authenticates
   * @param config Server configuration
   */
  protected async initialize(): Promise<void> {
    this.#connection = await Deno.connectTls({
      hostname: this.#config.hostname,
      port: this.#config.port,
    })
    this.#reader = this.#connection.readable.getReader()
    this.#writer = this.#connection.writable.getWriter()

    await this.#sendCommandAndAssert(undefined, smtpResponseCode.READY)
    await this.#sendCommandAndAssert(`EHLO ${this.#config.hostname}`, smtpResponseCode.OK)
    await this.#sendCommandAndAssert('AUTH LOGIN', smtpResponseCode.AUTH_NEXT)
    await this.#sendCommandAndAssert(btoa(this.#config.username), smtpResponseCode.AUTH_NEXT)
    await this.#sendCommandAndAssert(btoa(this.#config.password), smtpResponseCode.AUTH_SUCCESS)
  }

  /**
   * Closes the SMTP connection
   */
  public async close() {
    await this.#sendCommandAndAssert('QUIT', smtpResponseCode.BYE)
    await this.#writer?.close()
  }

  /**
   * Sends an email
   * @param email Email to send
   */
  public async send(email: NotifyMessage) {
    const [fromAddr, fromFull] = this.#parseEmail(email.from ?? this.#config.username)
    const [toAddr, toFull] = this.#parseEmail(email.to)
    const date = email.date ?? new Date().toString()

    await this.#sendCommandAndAssert(`MAIL FROM: ${fromAddr}`, smtpResponseCode.OK)
    await this.#sendCommandAndAssert(`RCPT TO: ${toAddr}`, smtpResponseCode.OK)
    await this.#sendCommandAndAssert('DATA', smtpResponseCode.BEGIN_DATA)

    await this.#sendCommandAndAssert(`Subject: ${email.subject}`)
    await this.#sendCommandAndAssert(`From: ${fromFull}`)
    await this.#sendCommandAndAssert(`To: ${toFull}`)
    await this.#sendCommandAndAssert(`Date: ${date}`)
    await this.#sendCommandAndAssert('MIME-Version: 1.0')
    await this.#sendCommandAndAssert('Content-Type: text/html;charset=utf-8\r\n')
    await this.#sendCommandAndAssert(email.body)
    await this.#sendCommandAndAssert('.', smtpResponseCode.OK)

    this.#connected = true
  }

  public override isHealthy(): boolean {
    return this.#connected
  }

  /**
   * Parses an email address into SMTP format
   * @param email Email string
   * @returns Tuple of [SMTP format, full string]
   */
  #parseEmail(email: string): [string, string] {
    const match = email.toString().match(/(.*)\s*<(.*)>/)
    return match?.length === 3 ? [`<${match[2]}>`, email] : [`<${email}>`, `<${email}>`]
  }

  /**
   * Writes a command to the server and optionally checks the response code
   * @param command Command line to send
   * @param expectedCode Expected SMTP response code
   */
  async #sendCommandAndAssert(command?: string, expectedCode?: SmtpResponseCode) {
    if (command) {
      if (!this.#writer) throw new Error('Connection not ready!')
      await this.#writer.ready
      await this.#writer.write(encoder.encode(`${command}\r\n`))
    }
    if (expectedCode) {
      if (!this.#reader) throw new Error('Connection not ready!')
      const result = await this.#reader.read()
      const response = decoder.decode(result.value).trim()
      if (!response) throw new Error('Invalid response from server')
      const lines = response.split('\r\n')
      // deno-lint-ignore no-non-null-assertion
      const code = parseInt(lines.at(-1)!.slice(0, 3).trim())
      if (code !== expectedCode) throw new Error(`Expected code: ${expectedCode}, got: ${code}`)
    }
  }
}
