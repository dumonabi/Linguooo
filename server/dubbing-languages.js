import { LANGUAGE_NAMES } from './languages.js';

// Verified against ElevenLabs /v1/dubbing (legacy automatic dubbing).
export const DUBBING_SUPPORTED_CODES = new Set([
  'ar', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hu', 'id', 'it',
  'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk', 'vi',
  'zh', 'tl', 'ta',
]);

const APP_TO_DUBBING = {
  nn: 'no',
};

export function resolveDubbingLanguage(code) {
  const normalized = String(code || '').toLowerCase().trim();
  if (!normalized) return null;

  const mapped = Object.prototype.hasOwnProperty.call(APP_TO_DUBBING, normalized)
    ? APP_TO_DUBBING[normalized]
    : normalized;

  if (!mapped || !DUBBING_SUPPORTED_CODES.has(mapped)) return null;
  return mapped;
}

export function isDubbingLanguageSupported(code) {
  return resolveDubbingLanguage(code) != null;
}

export function dubbingLanguageError(code) {
  const normalized = String(code || '').toLowerCase().trim();
  const name = LANGUAGE_NAMES[normalized] || normalized || 'that language';
  return `Natural delivery to ${name} isn't available yet. ElevenLabs dubbing doesn't support this language — try translating into English, Spanish, Chinese, Japanese, or Vietnamese instead.`;
}

export function listDubbingLanguageCodes() {
  return [...DUBBING_SUPPORTED_CODES].sort();
}
