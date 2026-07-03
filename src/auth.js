import {
  initAuthStorage,
  persistKey,
  readPersistedValue,
  removeKey,
} from './auth-storage.js';
import { voiceApiPath } from './profile-active-slot.js';

export { initAuthStorage, persistKey, readPersistedValue };

const AUTH_KEY = 'lingo-access';
const USER_KEY = 'lingo-user';
const RECOVERY_PREFIX = 'lingo-recovery:';

let unauthorizedPending = false;

export function normalizeClientPassphrase(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function isSessionToken(value) {
  if (typeof value !== 'string' || !value.includes('.')) return false;
  if (value.includes(' ')) return false;
  const dot = value.lastIndexOf('.');
  return dot > 0 && dot < value.length - 1;
}

export function isSessionTokenValid(token) {
  if (!isSessionToken(token)) return false;
  try {
    const body = token.slice(0, token.lastIndexOf('.'));
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const payload = JSON.parse(atob(base64));
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function saveRecoveryPhrase(userId, phrase) {
  if (!userId || !phrase) return;
  const normalized = normalizeClientPassphrase(phrase);
  void persistKey(`${RECOVERY_PREFIX}${userId}`, normalized);
}

export function getRecoveryPhrase(userId) {
  if (!userId) return '';
  return readPersistedValue(`${RECOVERY_PREFIX}${userId}`)?.trim() || '';
}

export function clearRecoveryPhrase(userId) {
  if (!userId) return;
  void removeKey(`${RECOVERY_PREFIX}${userId}`);
}

export function getAuthToken() {
  return readPersistedValue(AUTH_KEY);
}

export function setAuthToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    clearAuthToken();
    return;
  }
  void persistKey(AUTH_KEY, normalized);
}

export function clearAuthToken() {
  void removeKey(AUTH_KEY);
}

export function getStoredUser() {
  try {
    const raw = readPersistedValue(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (!user) {
    clearStoredUser();
    return;
  }
  void persistKey(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  void removeKey(USER_KEY);
}

export function clearAuthSession(userId = null, { keepRecovery = false } = {}) {
  clearAuthToken();
  clearStoredUser();
  if (userId && !keepRecovery) clearRecoveryPhrase(userId);
}

function getReauthPassphrase() {
  const token = getAuthToken();
  if (token && !isSessionToken(token)) {
    return normalizeClientPassphrase(token);
  }

  const user = getStoredUser();
  if (user?.id) {
    const saved = getRecoveryPhrase(user.id);
    if (saved) return saved;
  }

  return '';
}

export async function revalidateSession() {
  const attempt = getReauthPassphrase();
  if (!attempt) return false;

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: attempt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.user) return false;

    if (data.sessionToken) {
      setAuthToken(data.sessionToken);
    } else {
      setAuthToken(attempt);
    }
    setStoredUser(data.user);
    if (!isSessionToken(attempt)) {
      saveRecoveryPhrase(data.user.id, attempt);
    }
    return true;
  } catch {
    return false;
  }
}

function dispatchUnauthorizedOnce() {
  if (unauthorizedPending) return;
  unauthorizedPending = true;
  window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
  window.setTimeout(() => {
    unauthorizedPending = false;
  }, 500);
}

export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function cloneFetchBody(body) {
  if (!(body instanceof FormData)) return body;
  const copy = new FormData();
  for (const [key, value] of body.entries()) {
    copy.append(key, value);
  }
  return copy;
}

function buildFetchInit(options = {}) {
  const headers = authHeaders(options.headers || {});
  const body = options.body instanceof FormData ? cloneFetchBody(options.body) : options.body;
  return { ...options, headers, body };
}

export async function apiFetch(url, options = {}) {
  let res = await fetch(url, buildFetchInit(options));

  if (res.status === 401 && getAuthToken()) {
    const recovered = await revalidateSession();
    if (recovered) {
      res = await fetch(url, buildFetchInit(options));
    }
  }

  if (res.status === 401) {
    const token = getAuthToken();
    const hasValidSessionToken = token && isSessionToken(token) && isSessionTokenValid(token);
    if (!hasValidSessionToken) {
      const user = getStoredUser();
      clearAuthSession(user?.id, { keepRecovery: true });
      dispatchUnauthorizedOnce();
    }
  }

  return res;
}

export async function fetchCurrentUser(slotNumber = null) {
  const path = slotNumber ? voiceApiPath('/api/me', slotNumber) : '/api/me';
  const res = await apiFetch(path);
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.user) return null;
  setStoredUser(data.user);
  return data;
}

export async function restoreSessionIfPossible() {
  await initAuthStorage();

  const token = getAuthToken();
  const cachedUser = getStoredUser();

  if (token && isSessionToken(token) && isSessionTokenValid(token) && cachedUser) {
    return cachedUser;
  }

  if (token && (isSessionToken(token) ? isSessionTokenValid(token) : true)) {
    if (cachedUser) return cachedUser;
    try {
      const data = await fetchCurrentUser();
      return data?.user || cachedUser || null;
    } catch {
      return cachedUser || null;
    }
  }

  try {
    if (await revalidateSession()) {
      return getStoredUser();
    }
  } catch {
    return cachedUser || null;
  }

  return cachedUser && token ? cachedUser : null;
}
