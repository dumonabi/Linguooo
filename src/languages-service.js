import { apiFetch, persistKey, readPersistedValue } from './auth.js';
import { OFFLINE_LANGUAGES } from './offline-languages.js';

const STORED_LANGUAGES_KEY = 'lingo-languages-v1';

let cachedLanguages = null;
let loadPromise = null;

export { OFFLINE_LANGUAGES };

function readStoredLanguages() {
  try {
    const raw = readPersistedValue(STORED_LANGUAGES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isFullLanguageList(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function storeLanguages(languages) {
  try {
    void persistKey(STORED_LANGUAGES_KEY, JSON.stringify(languages));
  } catch {
    // storage full or unavailable — the in-memory copy still works
  }
}

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
      if (isFullLanguageList(cachedLanguages)) {
        // Remember the full list so a flaky network on the next startup
        // doesn't leave the language search with only the tiny fallback.
        storeLanguages(cachedLanguages);
      }
    } catch {
      if (!cachedLanguages || !isFullLanguageList(cachedLanguages)) {
        cachedLanguages = readStoredLanguages() || [...OFFLINE_LANGUAGES];
      }
    } finally {
      loadPromise = null;
    }
    return [...cachedLanguages];
  })();

  return loadPromise;
}
