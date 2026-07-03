// ElevenLabs cloned-voice language routing.
// v2: eleven_multilingual_v2 (29 languages). v3: eleven_v3 (70+ languages, incl. Thai).

export const ELEVEN_MODEL_V2 = 'eleven_multilingual_v2';
export const ELEVEN_MODEL_V3 = 'eleven_v3';

export const CLONED_VOICE_V2_LANGUAGE_CODES = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'tl',
  'tr', 'uk', 'zh',
]);

// App languages supported by eleven_v3 but not eleven_multilingual_v2.
export const CLONED_VOICE_V3_LANGUAGE_CODES = new Set([
  'af', 'as', 'az', 'be', 'bn', 'bs', 'ca', 'cy', 'et', 'fa', 'gl', 'gu', 'ha',
  'he', 'hu', 'hy', 'is', 'jw', 'kk', 'kn', 'lb', 'ln', 'lt', 'lv', 'mk', 'ml',
  'mr', 'ne', 'no', 'pa', 'ps', 'sd', 'sl', 'so', 'sr', 'sw', 'te', 'th', 'ur',
  'vi',
]);

/** @deprecated Use union of v2 + v3 sets. */
export const CLONED_VOICE_LANGUAGE_CODES = new Set([
  ...CLONED_VOICE_V2_LANGUAGE_CODES,
  ...CLONED_VOICE_V3_LANGUAGE_CODES,
]);

const APP_ALIASES = {
  nn: 'no',
};

const ELEVEN_LANGUAGE_CODE_ALIASES = {
  tl: 'fil',
};

export function resolveCloneVoiceLanguage(code) {
  const normalized = String(code || '').toLowerCase().trim();
  if (!normalized) return null;
  const mapped = Object.prototype.hasOwnProperty.call(APP_ALIASES, normalized)
    ? APP_ALIASES[normalized]
    : normalized;
  return mapped || null;
}

export function toElevenLabsLanguageCode(code) {
  const mapped = resolveCloneVoiceLanguage(code);
  if (!mapped) return null;
  return ELEVEN_LANGUAGE_CODE_ALIASES[mapped] || mapped;
}

export function resolveCloneVoiceModel(langCode) {
  const mapped = resolveCloneVoiceLanguage(langCode);
  if (!mapped) return null;
  if (CLONED_VOICE_V2_LANGUAGE_CODES.has(mapped)) return ELEVEN_MODEL_V2;
  if (CLONED_VOICE_V3_LANGUAGE_CODES.has(mapped)) return ELEVEN_MODEL_V3;
  return null;
}

export function supportsClonedVoice(langCode) {
  return Boolean(resolveCloneVoiceModel(langCode));
}

export function listCloneVoiceV2LanguageCodes() {
  return [...CLONED_VOICE_V2_LANGUAGE_CODES].sort();
}

export function listCloneVoiceV3LanguageCodes() {
  return [...CLONED_VOICE_V3_LANGUAGE_CODES].sort();
}

export function listCloneVoiceLanguageCodes() {
  return [...CLONED_VOICE_LANGUAGE_CODES].sort();
}

export function cloneVoiceLanguagesByModel() {
  return {
    v2: listCloneVoiceV2LanguageCodes(),
    v3: listCloneVoiceV3LanguageCodes(),
  };
}
