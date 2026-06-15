// Languages supported by OpenAI Whisper + GPT translation
export const LANGUAGE_NAMES = {
  af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', ar: 'Arabic', hy: 'Armenian',
  as: 'Assamese', az: 'Azerbaijani', eu: 'Basque', be: 'Belarusian', bn: 'Bengali',
  bs: 'Bosnian', br: 'Breton', bg: 'Bulgarian', my: 'Burmese', ca: 'Catalan',
  zh: 'Chinese', hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch',
  en: 'English', et: 'Estonian', fo: 'Faroese', fi: 'Finnish', fr: 'French',
  gl: 'Galician', ka: 'Georgian', de: 'German', el: 'Greek', gu: 'Gujarati',
  ht: 'Haitian Creole', ha: 'Hausa', haw: 'Hawaiian', he: 'Hebrew', hi: 'Hindi',
  hu: 'Hungarian', is: 'Icelandic', id: 'Indonesian', it: 'Italian', ja: 'Japanese',
  jw: 'Javanese', kn: 'Kannada', kk: 'Kazakh', km: 'Khmer', ko: 'Korean',
  lo: 'Lao', la: 'Latin', lv: 'Latvian', ln: 'Lingala', lt: 'Lithuanian',
  lb: 'Luxembourgish', mk: 'Macedonian', mg: 'Malagasy', ms: 'Malay', ml: 'Malayalam',
  mt: 'Maltese', mi: 'Maori', mr: 'Marathi', mn: 'Mongolian', ne: 'Nepali',
  no: 'Norwegian', nn: 'Norwegian Nynorsk', oc: 'Occitan', ps: 'Pashto', fa: 'Persian',
  pl: 'Polish', pt: 'Portuguese', pa: 'Punjabi', ro: 'Romanian', ru: 'Russian',
  sa: 'Sanskrit', sr: 'Serbian', sd: 'Sindhi', si: 'Sinhala', sk: 'Slovak',
  sl: 'Slovenian', so: 'Somali', es: 'Spanish', su: 'Sundanese', sw: 'Swahili',
  sv: 'Swedish', tl: 'Tagalog', tg: 'Tajik', ta: 'Tamil', tt: 'Tatar', te: 'Telugu',
  th: 'Thai', bo: 'Tibetan', tr: 'Turkish', tk: 'Turkmen', uk: 'Ukrainian',
  ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', cy: 'Welsh', yi: 'Yiddish', yo: 'Yoruba',
  ba: 'Bashkir', sn: 'Shona',
};

// Emoji flag for primary country; null = use customFlag
export const LANGUAGE_FLAGS = {
  af: '🇿🇦', sq: '🇦🇱', am: '🇪🇹', ar: '🇪🇬', hy: '🇦🇲', as: '🇮🇳', az: '🇦🇿',
  eu: '🇪🇸', be: '🇧🇾', bn: '🇧🇩', bs: '🇧🇦', br: '🇫🇷', bg: '🇧🇬', my: '🇲🇲',
  ca: null, zh: '🇨🇳', hr: '🇭🇷', cs: '🇨🇿', da: '🇩🇰', nl: '🇳🇱', en: '🇺🇸',
  et: '🇪🇪', fo: '🇫🇴', fi: '🇫🇮', fr: '🇫🇷', gl: '🇪🇸', ka: '🇬🇪', de: '🇩🇪',
  el: '🇬🇷', gu: '🇮🇳', ht: '🇭🇹', ha: '🇳🇬', haw: '🇺🇸', he: '🇮🇱', hi: '🇮🇳',
  hu: '🇭🇺', is: '🇮🇸', id: '🇮🇩', it: '🇮🇹', ja: '🇯🇵', jw: '🇮🇩', kn: '🇮🇳',
  kk: '🇰🇿', km: '🇰🇭', ko: '🇰🇷', lo: '🇱🇦', la: '🏛️', lv: '🇱🇻', ln: '🇨🇩',
  lt: '🇱🇹', lb: '🇱🇺', mk: '🇲🇰', mg: '🇲🇬', ms: '🇲🇾', ml: '🇮🇳', mt: '🇲🇹',
  mi: '🇳🇿', mr: '🇮🇳', mn: '🇲🇳', ne: '🇳🇵', no: '🇳🇴', nn: '🇳🇴', oc: '🇫🇷',
  ps: '🇦🇫', fa: '🇮🇷', pl: '🇵🇱', pt: '🇧🇷', pa: '🇮🇳', ro: '🇷🇴', ru: '🇷🇺',
  sa: '🇮🇳', sr: '🇷🇸', sd: '🇵🇰', si: '🇱🇰', sk: '🇸🇰', sl: '🇸🇮', so: '🇸🇴',
  es: '🇪🇸', su: '🇮🇩', sw: '🇰🇪', sv: '🇸🇪', tl: '🇵🇭', tg: '🇹🇯', ta: '🇮🇳',
  tt: '🇷🇺', te: '🇮🇳', th: '🇹🇭', bo: '🇨🇳', tr: '🇹🇷', tk: '🇹🇲', uk: '🇺🇦',
  ur: '🇵🇰', uz: '🇺🇿', vi: '🇻🇳', cy: '🏴', yi: '🇮🇱', yo: '🇳🇬', ba: '🇷🇺',
  sn: '🇿🇼',
};

export const CUSTOM_FLAGS = {};

// ISO codes for flat SVG flags (country-flag-icons)
export const LANGUAGE_FLAG_ISO = {
  af: 'za', sq: 'al', am: 'et', ar: 'sa', hy: 'am', as: 'in', az: 'az',
  eu: 'eu-basque', be: 'by', bn: 'bd', bs: 'ba', br: 'fr', bg: 'bg', my: 'mm',
  ca: 'es-ct', zh: 'cn', hr: 'hr', cs: 'cz', da: 'dk', nl: 'nl', en: 'us',
  et: 'ee', fo: 'fo', fi: 'fi', fr: 'fr', gl: 'es-galicia', ka: 'ge', de: 'de',
  el: 'gr', gu: 'in', ht: 'ht', ha: 'ng', haw: 'us', he: 'il', hi: 'in',
  hu: 'hu', is: 'is', id: 'id', it: 'it', ja: 'jp', jw: 'id', kn: 'in',
  kk: 'kz', km: 'kh', ko: 'kr', lo: 'la', la: 'va', lv: 'lv', ln: 'cd',
  lt: 'lt', lb: 'lu', mk: 'mk', mg: 'mg', ms: 'my', ml: 'in', mt: 'mt',
  mi: 'nz', mr: 'in', mn: 'mn', ne: 'np', no: 'no', nn: 'no', oc: 'fr',
  ps: 'af', fa: 'ir', pl: 'pl', pt: 'br', pa: 'in', ro: 'ro', ru: 'ru',
  sa: 'in', sr: 'rs', sd: 'pk', si: 'lk', sk: 'sk', sl: 'si', so: 'so',
  es: 'es', su: 'id', sw: 'ke', sv: 'se', tl: 'ph', tg: 'tj', ta: 'in',
  tt: 'ru', te: 'in', th: 'th', bo: 'cn', tr: 'tr', tk: 'tm', uk: 'ua',
  ur: 'pk', uz: 'uz', vi: 'vn', cy: 'gb-wls', yi: 'il', yo: 'ng', ba: 'ru',
  sn: 'zw',
};

export const DEFAULT_LANG1 = 'en';
export const DEFAULT_LANG2 = 'zh';

export function getLanguagesList() {
  return Object.entries(LANGUAGE_NAMES)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([code, name]) => ({
      code,
      name,
      flag: LANGUAGE_FLAGS[code] || '🌐',
      flagCode: LANGUAGE_FLAG_ISO[code] || null,
      customFlag: CUSTOM_FLAGS[code] || null,
    }));
}
