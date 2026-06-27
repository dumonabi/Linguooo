// Languages supported well by ElevenLabs eleven_multilingual_v2 for cloned voices.
// Other targets fall back to OpenAI TTS (nova) for more natural delivery.
export const CLONED_VOICE_LANGUAGE_CODES = new Set([
  'ar', 'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'id',
  'it', 'ja', 'ko', 'ms', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sv', 'ta', 'tl',
  'tr', 'uk', 'zh',
]);

const APP_ALIASES = {
  nn: 'no', // Norwegian Nynorsk → not in clone set; mapped code still fails allowlist
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
  if (!mapped) return false;
  return CLONED_VOICE_LANGUAGE_CODES.has(mapped);
}

export function listCloneVoiceLanguageCodes() {
  return [...CLONED_VOICE_LANGUAGE_CODES].sort();
}
