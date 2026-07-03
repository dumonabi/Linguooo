import { apiFetch } from './auth.js';
import { OFFLINE_LANGUAGES } from './offline-languages.js';

let cachedLanguages = null;
let loadPromise = null;

export { OFFLINE_LANGUAGES };

export function getCachedLanguages() {
  return cachedLanguages ? [...cachedLanguages] : [...OFFLINE_LANGUAGES];
}

export function isFullLanguageList(languages = cachedLanguages) {
  return Array.isArray(languages) && languages.length > OFFLINE_LANGUAGES.length;
}

/** Single shared fetch for /api/languages with offline fallback. */
export async function loadLanguagesList({ force = false } = {}) {
  if (!force && cachedLanguages && isFullLanguageList(cachedLanguages)) {
    return [...cachedLanguages];
  }
  if (!force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await apiFetch('/api/languages');
      if (!res.ok) throw new Error('Failed to load languages');
      cachedLanguages = await res.json();
    } catch {
      if (!cachedLanguages) cachedLanguages = [...OFFLINE_LANGUAGES];
    } finally {
      loadPromise = null;
    }
    return [...cachedLanguages];
  })();

  return loadPromise;
}
