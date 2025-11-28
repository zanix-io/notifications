import type {
  LoginWithOTPTemplateSchema,
  PasswordChangedTemplateSchema,
  PasswordRecoveryTemplateSchema,
  WelcomeTemplateSchema,
} from 'typings/templates.ts'

import { execTemplate } from '../mod.ts'

export const welcome = (data: WelcomeTemplateSchema = {}): Promise<string> => {
  const { app = 'Zanix', html = { title: 'Welcome Email' }, ...content } = data
  return execTemplate('generic', {
    title: 'Welcome, Astronaut!',
    content: `Greetings, Space Explorer!<br><br>
    We’re thrilled to have you aboard Zanix, your mission control 
    for an out-of-this-world experience. 🚀<br>
    Prepare to explore new features, discover exciting tools, 
    and launch your journey to the stars with us.<br>
    Your adventure starts now - we promise it will be stellar!`,
    footer: `© ${new Date().getFullYear()} ${app}. All rights reserved.`,
    html,
    ...content,
  })
}

export const passwordChanged = (data: PasswordChangedTemplateSchema = {}): Promise<string> => {
  const { app = 'Zanix', html = { title: 'Password Changed' }, ...content } = data
  return execTemplate('generic', {
    title: 'Password Successfully Changed',
    content: `<p>We wanted to let you know that your password has been successfully changed.</p>
    <p>If you didn't make this change, please contact support immediately.</p>
    <p>For security reasons, please do not share your password with anyone. 
    If you need assistance, feel free to reach out to us.</p>`,
    footer: `© ${new Date().getFullYear()} ${app}. All rights reserved.`,
    html,
    ...content,
  })
}

export const loginWithOTP = (
  data: LoginWithOTPTemplateSchema = { code: '123456', ttl: 5 },
): Promise<string> => {
  const { app = 'Zanix', html = { title: 'Login OTP' }, ...content } = data
  return execTemplate('generic', {
    title: 'Your code for Login',
    content:
      ` <p>We received a login request for your account. To complete your login, please use the One-Time Password (OTP) below:</p>`,
    buttonText: data.code,
    message:
      `This OTP is valid for ${data.ttl} minutes. If you did not request this login, please disregard this email.\n
      For additional security, please do not share this OTP with anyone.`,
    footer: `© ${new Date().getFullYear()} ${app}. All rights reserved.`,
    html,
    ...content,
  })
}

export const passwordRecovery = (
  data: PasswordRecoveryTemplateSchema = { code: '123456', ttl: 5 },
): Promise<string> => {
  const { app = 'Zanix', html = { title: 'Password Recovery' }, ...content } = data
  return execTemplate('generic', {
    title: 'Password Recovery Request',
    content:
      `<p>We have received a request to reset your password. Use the following code to proceed:</p>`,
    buttonText: data.code,
    message:
      `This OTP is valid for ${data.ttl} minutes. If you did not request this change, please ignore this email.\n
      For additional security, please do not share this OTP with anyone.`,
    footer: `© ${new Date().getFullYear()} ${app}. All rights reserved.`,
    html,
    ...content,
  })
}
