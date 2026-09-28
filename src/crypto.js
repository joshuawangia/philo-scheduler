import crypto from 'node:crypto';
import { config } from './config.js';

const key = () => crypto.createHash('sha256').update(`enc:${config.secret}`).digest();

// AES-256-GCM so Google refresh tokens are not stored in plaintext.
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, data] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// Signed, expiring values (used for the Google OAuth `state` param).
export function sign(payload, ttlSeconds = 900) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  const mac = crypto.createHmac('sha256', config.secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(crypto.createHmac('sha256', config.secret).update(body).digest('base64url'));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export const randomToken = () => crypto.randomBytes(24).toString('base64url');
