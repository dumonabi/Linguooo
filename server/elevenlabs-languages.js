// ElevenLabs cloned-voice language routing.
// Speed-first policy: cloned speech only runs on eleven_flash_v2_5 (~75ms
// model latency, 32 languages). Languages outside that set fall back to the
// OpenAI default voice, which is faster than the slow eleven_v3 model.

export const ELEVEN_MODEL_V3 = 'eleven_v3';
export const ELEVEN_MODEL_FLASH = 'eleven_flash_v2_5';
export const ELEVEN_MODEL_V2 = 'eleven_multilingual_v2';

// Flash v2.5 covers every multilingual-v2 language plus hu/no/vi.
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
  if (CLONED_VOICE_LANGUAGE_CODES.has(mapped)) return ELEVEN_MODEL_FLASH;
  return null;
}

export function supportsClonedVoice(langCode) {
  return Boolean(resolveCloneVoiceModel(langCode));
}

export function supportsProVoice(langCode) {
  const mapped = resolveCloneVoiceLanguage(langCode);
  return Boolean(mapped && PRO_VOICE_LANGUAGE_CODES.has(mapped));
}

export function listCloneVoiceLanguageCodes() {
  return [...CLONED_VOICE_LANGUAGE_CODES].sort();
}

export function cloneVoiceLanguagesByModel() {
  return {
    flash: listCloneVoiceLanguageCodes(),
  };
}
