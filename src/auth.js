const AUTH_KEY = 'lingo-access';
const USER_KEY = 'lingo-user';

export function getAuthToken() {
  return sessionStorage.getItem(AUTH_KEY);
}

export function setAuthToken(token) {
  sessionStorage.setItem(AUTH_KEY, token);
}

export function clearAuthToken() {
  sessionStorage.removeItem(AUTH_KEY);
}

export function getStoredUser() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  if (!user) {
    sessionStorage.removeItem(USER_KEY);
    return;
  }
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  sessionStorage.removeItem(USER_KEY);
}

export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function apiFetch(url, options = {}) {
  const headers = authHeaders(options.headers || {});
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    clearAuthToken();
    clearStoredUser();
    window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
  }

  return res;
}

export async function fetchCurrentUser() {
  const res = await apiFetch('/api/me');
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (!data.user) return null;
  setStoredUser(data.user);
  return data;
}
