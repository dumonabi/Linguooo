// Keep in sync with server/elevenlabs-languages.js
// Speed-first policy: cloned speech only runs on eleven_flash_v2_5; other
// languages use the fast default voice.

export const CLONED_VOICE_LANGUAGE_CODES = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'hu',
  'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv',
  'ta', 'tl', 'tr', 'uk', 'vi', 'zh',
]);

// The on-demand "pro" voice runs Professional Voice Cloning on multilingual
// v2 (the model PVC is fine-tuned on), which supports the flash set minus
// hu/no/vi.
export const PRO_VOICE_LANGUAGE_CODES = new Set(
  [...CLONED_VOICE_LANGUAGE_CODES].filter((code) => !['hu', 'no', 'vi'].includes(code)),
);

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

export function supportsClonedVoice(langCode) {
  const mapped = resolveCloneVoiceLanguage(langCode);
  return Boolean(mapped && CLONED_VOICE_LANGUAGE_CODES.has(mapped));
}

export function supportsProVoice(langCode) {
  const mapped = resolveCloneVoiceLanguage(langCode);
  return Boolean(mapped && PRO_VOICE_LANGUAGE_CODES.has(mapped));
}

// eleven_v3 supports 74 languages (ISO 639-1 codes). It is much slower than
// flash, so it only powers the optional on-demand cloned audio for languages
// the flash model cannot clone (e.g. Thai) — never the fast path.
export const V3_VOICE_LANGUAGE_CODES = new Set([
  'af', 'ar', 'as', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da',
  'de', 'el', 'en', 'es', 'et', 'fa', 'fi', 'fr', 'ga', 'gl', 'gu', 'ha',
  'he', 'hi', 'hr', 'hu', 'hy', 'id', 'is', 'it', 'ja', 'jv', 'ka', 'kk',
  'kn', 'ko', 'ky', 'lb', 'ln', 'lt', 'lv', 'mk', 'ml', 'mr', 'ms', 'ne',
  'nl', 'no', 'ny', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'sd', 'sk', 'sl',
  'so', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi',
  'zh',
]);

// Languages where the only way to hear the user's cloned voice is the slow
// eleven_v3 model: supported by v3 but not by the fast flash model.
export function supportsV3OnlyVoice(langCode) {
  const mapped = resolveCloneVoiceLanguage(langCode);
  return Boolean(
    mapped
    && V3_VOICE_LANGUAGE_CODES.has(mapped)
    && !CLONED_VOICE_LANGUAGE_CODES.has(mapped),
  );
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

export function formatCloneVoiceLanguageList(locale = 'en') {
  const displayNames = getLanguageDisplayNames(locale);
  return listCloneVoiceLanguageCodes()
    .map((code) => {
      try {
        return displayNames.of(code) || code;
      } catch {
        return code;
      }
    })
    .join(', ');
}
