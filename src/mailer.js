import nodemailer from 'nodemailer';
import { config } from './config.js';

// Created lazily so a missing SMTP_URL only matters when we actually send.
let transport = null;

export function setTransportForTests(t) {
  transport = t;
}

export async function sendMail({ to, subject, text, html, attachments }) {
  if (!transport) {
    if (!config.email.smtpUrl) {
      console.log(`[mailer] SMTP_URL not set; not sending "${subject}" to ${to}`);
      return { skipped: true };
    }
    transport = nodemailer.createTransport(config.email.smtpUrl);
  }
  const info = await transport.sendMail({ from: config.email.from, to, subject, text, html, attachments });
  return { messageId: info.messageId };
}
