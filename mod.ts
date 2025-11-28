/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

export { SmtpClient } from 'modules/email/connector.ts'
export { NotifierProvider } from 'modules/providers/notifier.ts'
export { ZanixNotifierConnector } from 'modules/base.ts'

export { createNotifierProvider } from 'modules/providers/defs.ts'

// Utils
export { execTemplate } from 'modules/templates/mod.ts'
export { default as transactionalTemplates } from 'modules/templates/transactional/mod.ts'
