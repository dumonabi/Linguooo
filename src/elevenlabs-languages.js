// Keep in sync with server/elevenlabs-languages.js

export const ELEVEN_MODEL_V2 = 'eleven_multilingual_v2';
export const ELEVEN_MODEL_V3 = 'eleven_v3';

export const CLONED_VOICE_V2_LANGUAGE_CODES = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'tl',
  'tr', 'uk', 'zh',
]);

export const CLONED_VOICE_V3_LANGUAGE_CODES = new Set([
  'af', 'as', 'az', 'be', 'bn', 'bs', 'ca', 'cy', 'et', 'fa', 'gl', 'gu', 'ha',
  'he', 'hu', 'hy', 'is', 'jw', 'kk', 'kn', 'lb', 'ln', 'lt', 'lv', 'mk', 'ml',
  'mr', 'ne', 'no', 'pa', 'ps', 'sd', 'sl', 'so', 'sr', 'sw', 'te', 'th', 'ur',
  'vi',
]);

export const CLONED_VOICE_LANGUAGE_CODES = new Set([
  ...CLONED_VOICE_V2_LANGUAGE_CODES,
  ...CLONED_VOICE_V3_LANGUAGE_CODES,
]);

const APP_ALIASES = {
  nn: 'no',
};

export function resolveCloneVoiceLanguage(code) {
  const normalized = String(code || '').toLowerCase().trim();
  if (!normalized) return null;
  const mapped = Object.prototype.hasOwnProperty.call(APP_ALIASES, normalized)
    ? APP_ALIASES[normalized]
    : normalized;
  return mapped || null;
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

function getLanguageDisplayNames(locale) {
  const normalized = String(locale || 'en').toLowerCase().split('-')[0];
  try {
    return new Intl.DisplayNames([normalized], { type: 'language' });
  } catch {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  }
}

function formatLanguageCodeList(codes, locale = 'en') {
  const displayNames = getLanguageDisplayNames(locale);
  return codes
    .map((code) => {
      try {
        return displayNames.of(code) || code;
      } catch {
        return code;
      }
    })
    .join(', ');
}

export function formatCloneVoiceLanguageGroups(locale = 'en') {
  return {
    v2: formatLanguageCodeList(listCloneVoiceV2LanguageCodes(), locale),
    v3: formatLanguageCodeList(listCloneVoiceV3LanguageCodes(), locale),
  };
}
