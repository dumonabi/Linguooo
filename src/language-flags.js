// ISO 639-1 language code → ISO 3166-1 alpha-2 for Unicode flag emoji (regional indicators).
// Omit or use '' when there is no suitable single-country Unicode flag.
const LANGUAGE_FLAG_COUNTRIES = {
  af: 'ZA',
  sq: 'AL',
  am: 'ET',
  ar: 'SA',
  hy: 'AM',
  as: 'IN',
  az: 'AZ',
  be: 'BY',
  bn: 'BD',
  bs: 'BA',
  bg: 'BG',
  my: 'MM',
  zh: 'CN',
  hr: 'HR',
  cs: 'CZ',
  da: 'DK',
  nl: 'NL',
  en: 'US',
  et: 'EE',
  fo: 'FO',
  fi: 'FI',
  fr: 'FR',
  gl: 'ES',
  ka: 'GE',
  de: 'DE',
  el: 'GR',
  gu: 'IN',
  ht: 'HT',
  ha: 'NG',
  he: 'IL',
  hi: 'IN',
  hu: 'HU',
  is: 'IS',
  id: 'ID',
  it: 'IT',
  ja: 'JP',
  jw: 'ID',
  kn: 'IN',
  kk: 'KZ',
  km: 'KH',
  ko: 'KR',
  lo: 'LA',
  lv: 'LV',
  ln: 'CD',
  lt: 'LT',
  lb: 'LU',
  mk: 'MK',
  mg: 'MG',
  ms: 'MY',
  ml: 'IN',
  mt: 'MT',
  mi: 'NZ',
  mr: 'IN',
  mn: 'MN',
  ne: 'NP',
  no: 'NO',
  nn: 'NO',
  ps: 'AF',
  fa: 'IR',
  pl: 'PL',
  pt: 'PT',
  pa: 'IN',
  ro: 'RO',
  ru: 'RU',
  sa: 'IN',
  sr: 'RS',
  sd: 'PK',
  si: 'LK',
  sk: 'SK',
  sl: 'SI',
  so: 'SO',
  es: 'ES',
  su: 'ID',
  sw: 'KE',
  sv: 'SE',
  tl: 'PH',
  tg: 'TJ',
  ta: 'IN',
  tt: 'RU',
  te: 'IN',
  th: 'TH',
  tr: 'TR',
  tk: 'TM',
  uk: 'UA',
  ur: 'PK',
  uz: 'UZ',
  vi: 'VN',
  yo: 'NG',
  ba: 'RU',
  sn: 'ZW',
  // No flag: ca, eu, br, la, bo, cy, yi, haw, oc
};

const MAX_LABEL_CHARS = 8;
const MAX_ABBREV_CHARS = 7;

export function getLanguageDisplayName(langCode, fullName = '') {
  const full = String(fullName || '').trim();
  if (!full) {
    const code = String(langCode || '').trim();
    return code ? code.toUpperCase() : '';
  }

  if (full.length <= MAX_LABEL_CHARS) {
    return full;
  }

  return `${full.slice(0, MAX_ABBREV_CHARS)}.`;
}

export function buildLanguageSquareHtml(langCode, fullName = '', { extraClass = '' } = {}) {
  const label = getLanguageDisplayName(langCode, fullName) || '···';
  const className = ['lang-picker-square', extraClass].filter(Boolean).join(' ');

  return `
    <span class="${className}">
      <span class="lang-picker-square-label">${escapeHtmlText(label)}</span>
    </span>
  `.trim();
}

export function buildLanguageCircleHtml(langCode, fullName = '', { extraClass = '' } = {}) {
  const label = getLanguageDisplayName(langCode, fullName);
  const flag = getLanguageFlag(langCode);
  const bgClass = flag
    ? 'lang-picker-circle-bg'
    : 'lang-picker-circle-bg lang-picker-circle-bg--empty';
  const bgContent = flag || '';
  const className = ['lang-picker-circle', extraClass].filter(Boolean).join(' ');

  return `
    <span class="${className}">
      <span class="${bgClass}" aria-hidden="true">${bgContent}</span>
      <span class="lang-picker-circle-shade" aria-hidden="true"></span>
      <span class="lang-picker-circle-label">${escapeHtmlText(label)}</span>
    </span>
  `.trim();
}

function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countryCodeToFlag(countryCode) {
  const code = String(countryCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(
    ...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
  );
}

export function getLanguageFlag(langCode) {
  const country = LANGUAGE_FLAG_COUNTRIES[String(langCode || '').toLowerCase()];
  if (!country) return '';
  return countryCodeToFlag(country);
}

export function formatLanguageFlagHtml(langCode) {
  const flag = getLanguageFlag(langCode);
  if (!flag) {
    return '<span class="lang-picker-flag lang-picker-flag--empty" aria-hidden="true"></span>';
  }
  return `<span class="lang-picker-flag" aria-hidden="true">${flag}</span>`;
}
