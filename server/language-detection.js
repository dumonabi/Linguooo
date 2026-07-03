import { franc } from 'franc';
import { iso6393To1 } from 'iso-639-3';

/** ISO 639-1 → ISO 639-3 (for franc). Covers every code in languages.js. */
export const ISO1_TO_ISO3 = {
  af: 'afr', sq: 'sqi', am: 'amh', ar: 'arb', hy: 'hye', as: 'asm', az: 'aze',
  eu: 'eus', be: 'bel', bn: 'ben', bs: 'bos', br: 'bre', bg: 'bul', my: 'mya',
  ca: 'cat', zh: 'cmn', hr: 'hrv', cs: 'ces', da: 'dan', nl: 'nld', en: 'eng',
  et: 'est', fo: 'fao', fi: 'fin', fr: 'fra', gl: 'glg', ka: 'kat', de: 'deu',
  el: 'ell', gu: 'guj', ht: 'hat', ha: 'hau', haw: 'haw', he: 'heb', hi: 'hin',
  hu: 'hun', is: 'isl', id: 'ind', it: 'ita', ja: 'jpn', jw: 'jav', kn: 'kan',
  kk: 'kaz', km: 'khm', ko: 'kor', lo: 'lao', la: 'lat', lv: 'lav', ln: 'lin',
  lt: 'lit', lb: 'ltz', mk: 'mkd', mg: 'mlg', ms: 'zsm', ml: 'mal', mt: 'mlt',
  mi: 'mri', mr: 'mar', mn: 'mon', ne: 'nep', no: 'nob', nn: 'nno', oc: 'oci',
  ps: 'pbt', fa: 'pes', pl: 'pol', pt: 'por', pa: 'pan', ro: 'ron', ru: 'rus',
  sa: 'san', sr: 'srp', sd: 'snd', si: 'sin', sk: 'slk', sl: 'slv', so: 'som',
  es: 'spa', su: 'sun', sw: 'swa', sv: 'swe', tl: 'tgl', tg: 'tgk', ta: 'tam',
  tt: 'tat', te: 'tel', th: 'tha', bo: 'bod', tr: 'tur', tk: 'tuk', uk: 'ukr',
  ur: 'urd', uz: 'uzb', vi: 'vie', cy: 'cym', yi: 'yid', yo: 'yor', ba: 'bak',
  sn: 'sna',
};

/** Script groups: if text matches and only one language in the pair uses it, we know the language. */
const SCRIPT_GROUPS = [
  { regex: /[\u3040-\u30FF]/, langs: ['ja'] },
  { regex: /[\uAC00-\uD7AF]/, langs: ['ko'] },
  { regex: /[\u0E00-\u0E7F]/, langs: ['th'] },
  { regex: /[\u0E80-\u0EFF]/, langs: ['lo'] },
  { regex: /[\u1780-\u17FF]/, langs: ['km'] },
  { regex: /[\u1000-\u109F]/, langs: ['my'] },
  { regex: /[\u0F00-\u0FFF]/, langs: ['bo'] },
  { regex: /[\u10A0-\u10FF]/, langs: ['ka'] },
  { regex: /[\u0530-\u058F]/, langs: ['hy'] },
  { regex: /[\u0370-\u03FF]/, langs: ['el'] },
  { regex: /[\u0590-\u05FF]/, langs: ['he', 'yi'] },
  { regex: /[\u0600-\u06FF]/, langs: ['ar', 'fa', 'ur', 'ps', 'sd'] },
  { regex: /[\u0400-\u04FF]/, langs: ['ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'mn', 'tg', 'tt', 'tk', 'ba', 'uz'] },
  { regex: /[\u0900-\u097F]/, langs: ['hi', 'mr', 'ne', 'sa'] },
  { regex: /[\u0980-\u09FF]/, langs: ['bn', 'as'] },
  { regex: /[\u0A00-\u0A7F]/, langs: ['pa'] },
  { regex: /[\u0A80-\u0AFF]/, langs: ['gu'] },
  { regex: /[\u0B80-\u0BFF]/, langs: ['ta'] },
  { regex: /[\u0C00-\u0C7F]/, langs: ['te'] },
  { regex: /[\u0C80-\u0CFF]/, langs: ['kn'] },
  { regex: /[\u0D00-\u0D7F]/, langs: ['ml'] },
  { regex: /[\u0D80-\u0DFF]/, langs: ['si'] },
  { regex: /[\u1200-\u137F]/, langs: ['am'] },
  { regex: /[\u4E00-\u9FFF]/, langs: ['zh', 'ja'] },
];

const DIACRITIC_PATTERNS = {
  es: /[ñáéíóúü¿¡]/g,
  pl: /[ąćęłńóśźż]/g,
  pt: /[ãõçáéíóúâêô]/g,
  fr: /[àâçéèêëîïôùûüœæ]/g,
  de: /[äöüß]/g,
  it: /[àèéìòù]/g,
  cs: /[áčďéěíňóřšťúůýž]/g,
  sk: /[áäčďéíĺľňóôŕšťúýž]/g,
  ro: /[ăâîșț]/g,
  hu: /[áéíóöőúüű]/g,
  tr: /[çğıöşü]/g,
  vi: /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/g,
  da: /[æøå]/g,
  no: /[æøå]/g,
  nn: /[æøå]/g,
  sv: /[åäö]/g,
  fi: /[äö]/g,
  et: /[äöõü]/g,
  lv: /[āčēģīķļņšūž]/g,
  lt: /[ąčęėįšųūž]/g,
  is: /[áéíóúýðþæö]/g,
  cy: /[âêîôûŵŷ]/g,
  mt: /[ċġħ]/g,
  sq: /[çë]/g,
  hr: /[čćđšž]/g,
  bs: /[čćđšž]/g,
  sl: /[čšž]/g,
  ca: /[àèéíïòóúüç]/g,
  gl: /[áéíñóú]/g,
  oc: /[àçéèíòóú]/g,
  lb: /[äëé]/g,
  fo: /[áíóúýð]/g,
  br: /[añéù]/g,
  ht: /[àèéò]/g,
  uk: /[іїєґ]/g,
  id: /[áéíóú]/g,
  ms: /[áéíóú]/g,
  tl: /[áéíóúñ]/g,
  sw: /[áéíóú]/g,
  af: /[áéíóúêëîôû]/g,
  nl: /[äëïöüáéíóú]/g,
};

const WORD_MARKERS = {
  es: /\b(el|la|los|las|de|que|y|en|un|una|es|por|con|no|se|hola|gracias|qué|cómo|está|muy|pero|bien|también|ahora|puedo|quiero|tengo|hay|esto|vale)\b/gi,
  en: /\b(the|and|is|are|you|your|have|this|that|with|for|not|but|what|how|hello|thanks|please|can|will|from|they|when|where|because|good|okay)\b/gi,
  pt: /\b(o|a|os|as|de|que|e|em|um|uma|não|se|por|com|para|muito|mas|bem|olá|obrigad|está|também|agora|posso|quero|tenho|há|isto|isso|aqui)\b/gi,
  fr: /\b(le|la|les|de|que|et|en|un|une|est|pas|se|pour|avec|dans|sur|très|mais|bien|bonjour|merci|comment|aussi|maintenant|je|tu|il|elle|nous|vous|ce|ça|ici)\b/gi,
  de: /\b(der|die|das|und|ist|nicht|ein|eine|ich|du|er|sie|wir|ihr|mit|für|auf|auch|aber|sehr|gut|hallo|danke|bitte|wie|was|wann|wo|warum)\b/gi,
  it: /\b(il|la|lo|gli|le|di|che|e|un|una|non|per|con|molto|ma|bene|ciao|grazie|come|anche|ora|io|tu|lui|lei|noi|voi|questo|quello)\b/gi,
  pl: /\b(i|w|z|na|do|że|się|nie|to|jest|jak|ale|tylko|mam|masz|czy|co|tu|tam|bardzo|dziękuję|dzień|dobry|tak|proszę|już|jeszcze|będzie|być|gdzie|kiedy|cześć)\b/gi,
  nl: /\b(de|het|een|en|van|is|niet|dat|die|in|op|met|voor|maar|ook|zeer|goed|hallo|dank|hoe|wat|wanneer|waar|waarom|ik|jij|hij|zij|wij)\b/gi,
  sv: /\b(och|att|det|som|för|är|inte|en|ett|på|med|men|också|mycket|bra|hej|tack|hur|vad|när|var|varför|jag|du|han|hon|vi)\b/gi,
  da: /\b(og|at|det|som|for|er|ikke|en|et|på|med|men|også|meget|god|hej|tak|hvordan|hvad|hvornår|hvor|hvorfor|jeg|du|han|hun|vi)\b/gi,
  no: /\b(og|at|det|som|for|er|ikke|en|et|på|med|men|også|mycket|bra|hei|takk|hvordan|hva|når|hvor|hvorfor|jeg|du|han|hun|vi)\b/gi,
  fi: /\b(ja|on|ei|se|että|kun|mutta|myös|hyvin|hyvä|hei|kiitos|miten|mitä|milloin|missä|miksi|minä|sinä|hän|me)\b/gi,
  cs: /\b(a|v|z|na|do|že|se|ne|to|je|jak|ale|jen|mám|máš|co|tu|tam|velmi|děkuji|den|dobrý|ano|prosím|už|ještě|bude|být|kde|kdy)\b/gi,
  sk: /\b(a|v|z|na|do|že|sa|nie|to|je|ako|ale|len|mám|máš|čo|tu|tam|veľmi|ďakujem|deň|dobrý|áno|prosím|už|ešte|bude|byť|kde|kedy)\b/gi,
  ro: /\b(și|în|de|la|nu|este|cum|dar|doar|am|ai|ce|aici|acolo|foarte|mulțumesc|zi|bună|da|vă|rog|deja|încă|va|fi|unde|când)\b/gi,
  hu: /\b(és|a|az|hogy|nem|van|hogy|de|csak|van|mit|itt|ott|nagyon|köszönöm|nap|jó|igen|kérlek|már|még|lesz|lenni|hol|mikor)\b/gi,
  tr: /\b(ve|bir|bu|şu|de|da|için|ile|ama|çok|iyi|merhaba|teşekkür|nasıl|ne|ne zaman|nerede|neden|ben|sen|o|biz|siz|onlar|değil|var)\b/gi,
  ru: /\b(и|в|не|на|я|что|он|с|это|как|но|да|ты|мы|вы|они|за|из|от|для|по|при|очень|хорошо|привет|спасибо|как|где|когда|почему)\b/gi,
  uk: /\b(і|в|не|на|я|що|він|з|це|як|але|так|ти|ми|ви|вони|за|з|від|для|по|при|дуже|добре|привіт|дякую|де|коли|чому)\b/gi,
  ar: /[\u0600-\u06FF]/,
  hi: /[\u0900-\u097F]/,
  ja: /[\u3040-\u30FF]/,
  ko: /[\uAC00-\uD7AF]/,
  zh: /[\u4E00-\u9FFF]/,
  th: /[\u0E00-\u0E7F]/,
  vi: /\b(và|của|là|không|tôi|bạn|anh|chị|em|này|đó|ở|đây|rất|tốt|xin|chào|cảm|ơn|như|thế|nào|gì|khi|nào|đâu|tại|sao)\b/gi,
  id: /\b(dan|yang|di|ini|itu|tidak|saya|anda|dia|kami|mereka|dengan|untuk|tapi|juga|sangat|baik|halo|terima|kasih|bagaimana|apa|kapan|di mana|mengapa)\b/gi,
};

const SUFFIX_PATTERNS = {
  es: /\w+(ción|sión|miento|dad|mente|ando|iendo|ado|ada)\b/gi,
};

function diacriticScore(text, code) {
  const pattern = DIACRITIC_PATTERNS[code];
  if (!pattern) return 0;
  return (text.toLowerCase().match(pattern) || []).length;
}

function heuristicScore(text, code) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score = diacriticScore(text, code) * 2.5;
  if (WORD_MARKERS[code] instanceof RegExp && !['ar', 'hi', 'ja', 'ko', 'zh', 'th'].includes(code)) {
    score += (lower.match(WORD_MARKERS[code]) || []).length;
  }
  if (SUFFIX_PATTERNS[code]) {
    score += (lower.match(SUFFIX_PATTERNS[code]) || []).length * 1.5;
  }
  return score;
}

function iso3ForPair(lang1, lang2) {
  const a = ISO1_TO_ISO3[lang1];
  const b = ISO1_TO_ISO3[lang2];
  if (!a || !b || a === b) return null;
  return [a, b];
}

function francToPairCode(iso3, lang1, lang2) {
  if (!iso3 || iso3 === 'und') return null;
  const iso1 = iso6393To1[iso3];
  if (iso1 === lang1 || iso1 === lang2) return iso1;
  if (iso3 === ISO1_TO_ISO3[lang1]) return lang1;
  if (iso3 === ISO1_TO_ISO3[lang2]) return lang2;
  return null;
}

function detectByExclusiveScript(text, lang1, lang2) {
  const pair = new Set([lang1, lang2]);

  if (/[\u3040-\u30FF]/.test(text) && pair.has('ja')) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text) && pair.has('ko')) return 'ko';

  for (const { regex, langs } of SCRIPT_GROUPS) {
    if (!regex.test(text)) continue;
    const inPair = langs.filter((l) => pair.has(l));
    if (inPair.length === 1) return inPair[0];
  }
  return null;
}

function detectByFranc(text, lang1, lang2) {
  const only = iso3ForPair(lang1, lang2);
  if (!only) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return francToPairCode(franc(trimmed, { only, minLength: 1 }), lang1, lang2);
}

/**
 * Detect which of the two configured languages `text` is written in.
 * Works for any language pair supported by the app.
 */
export function detectLanguageInPair(text, lang1, lang2) {
  if (!text?.trim()) return null;

  const byScript = detectByExclusiveScript(text, lang1, lang2);
  if (byScript) return byScript;

  const h1 = heuristicScore(text, lang1);
  const h2 = heuristicScore(text, lang2);
  if (h1 > h2 && h1 >= 1.5) return lang1;
  if (h2 > h1 && h2 >= 1.5) return lang2;

  if (h1 === h2 && h1 > 0) {
    const d1 = diacriticScore(text, lang1);
    const d2 = diacriticScore(text, lang2);
    if (d1 > d2) return lang1;
    if (d2 > d1) return lang2;
  }

  return detectByFranc(text, lang1, lang2);
}

/**
 * Infer source language when both original and translation are available.
 */
export function detectLanguageFromTranslation(sourceText, translatedText, lang1, lang2) {
  const source = sourceText?.trim();
  const translated = translatedText?.trim();
  if (!source || !translated) return null;
  if (source.toLowerCase() === translated.toLowerCase()) return null;

  const sourceLang = detectLanguageInPair(source, lang1, lang2);
  const translatedLang = detectLanguageInPair(translated, lang1, lang2);

  if (sourceLang && translatedLang && sourceLang !== translatedLang) return sourceLang;
  if (sourceLang && !translatedLang) return sourceLang;
  if (!sourceLang && translatedLang) return translatedLang === lang1 ? lang2 : lang1;
  return null;
}

/**
 * Ensure source and translation fields are not swapped (model sometimes echoes input).
 */
export function alignTranslationFields(sourceText, translatedText, lang1, lang2) {
  const source = sourceText?.trim() || '';
  const translated = translatedText?.trim() || '';
  if (!source || !translated) {
    return { sourceText: source, translatedText: translated };
  }
  if (source.toLowerCase() === translated.toLowerCase()) {
    return { sourceText: source, translatedText: translated };
  }

  const sourceLang = detectLanguageInPair(source, lang1, lang2);
  const translatedLang = detectLanguageInPair(translated, lang1, lang2);

  if (sourceLang && translatedLang && sourceLang !== translatedLang) {
    if (sourceLang === lang1 && translatedLang === lang2) {
      return { sourceText: source, translatedText: translated };
    }
    if (sourceLang === lang2 && translatedLang === lang1) {
      return { sourceText: source, translatedText: translated };
    }
  }

  if (sourceLang === lang2 && translatedLang === lang1) {
    return { sourceText: translated, translatedText: source };
  }
  if (sourceLang === lang1 && translatedLang === lang2) {
    return { sourceText: source, translatedText: translated };
  }

  if (!sourceLang && translatedLang) {
    const expectedSource = translatedLang === lang1 ? lang2 : lang1;
    if (expectedSource === lang2) {
      return { sourceText: translated, translatedText: source };
    }
  }

  return { sourceText: source, translatedText: translated };
}
