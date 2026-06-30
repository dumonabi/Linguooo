import crypto from 'crypto';
import { getSuperUserRecord } from './bootstrap-user.js';

const SESSION_TTL_SEC = 365 * 24 * 60 * 60;

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET?.trim()
    || process.env.OPENAI_API_KEY?.trim();
  if (!secret) return 'lingu-dev-session-secret';
  return secret;
}

function sign(body) {
  return crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
}

export function createSessionToken(user) {
  if (!user?.id) return null;

  const payload = {
    sub: user.id,
    name: user.name || 'User',
    nlang: user.nativeLanguage || 'en',
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body);

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.sub || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    if (payload.sub === getSuperUserRecord().id) {
      return getSuperUserRecord();
    }

    return {
      id: payload.sub,
      name: payload.name || 'User',
      nativeLanguage: payload.nlang || 'en',
      elevenlabsVoiceId: null,
    };
  } catch {
    return null;
  }
}
