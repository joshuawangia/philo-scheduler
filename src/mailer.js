import nodemailer from 'nodemailer';
import { config } from './config.js';

// Created lazily so missing email settings only matter when we actually send.
let transport = null;

// SMTP_URL wins; else GMAIL_ADDRESS + GMAIL_APP_PASSWORD => Gmail SMTP; else null (log only).
export function transportOptions(email = config.email) {
  if (email.smtpUrl) return email.smtpUrl;
  if (email.gmailAddress && email.gmailAppPassword)
    return { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: email.gmailAddress.trim(), pass: email.gmailAppPassword.replace(/\s+/g, '') } };
  return null;
}

export function setTransportForTests(t) {
  transport = t;
}

export async function sendMail({ to, subject, text, html, attachments }) {
  if (!transport) {
    const opts = transportOptions();
    if (!opts) {
      console.log(`[mailer] email not set up (SMTP_URL or GMAIL_ADDRESS + GMAIL_APP_PASSWORD); not sending "${subject}" to ${to}`);
      return { skipped: true };
    }
    transport = nodemailer.createTransport(opts);
  }
  const info = await transport.sendMail({ from: config.email.from, to, subject, text, html, attachments });
  return { messageId: info.messageId };
}
