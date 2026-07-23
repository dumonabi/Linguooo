// Extra input methods for the recovery-phrase textarea on the auth gate:
//
// 1. Voice dictation via the browser's Web Speech API. The auth gate shows
//    before the user is signed in, so the server transcription endpoints
//    (which require auth) are not available — recognition runs on-device or
//    through the browser vendor instead. Recognized tokens are snapped to
//    the closest BIP39 word, since the wordlist is a closed set of 2048
//    English words.
//
// 2. A word-by-word numeric wizard: each BIP39 word is entered as its
//    decimal number (0-2047) on a phone-style keypad with 3 digits per row.
//
// Everywhere in the app the phrase is displayed and entered as numbers; the
// words themselves only exist in the underlying mnemonic.

import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const WORD_COUNT = 12;
const MAX_WORD_INDEX = wordlist.length - 1; // 2047

const wordSet = new Set(wordlist);

// "abandon ability … zoo" → "0 1 … 2047". Returns '' if any word is unknown.
export function phraseToNumbers(phrase) {
  const words = String(phrase || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const numbers = words.map((word) => wordlist.indexOf(word));
  if (numbers.some((n) => n < 0)) return '';
  return numbers.join(' ');
}

// Replaces digit tokens (0-2047) in a phrase with their BIP39 words, so a
// backup saved as numbers can be typed or pasted straight into the sign-in
// box. Non-numeric tokens pass through untouched.
export function numbersToPhrase(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (!/^\d{1,4}$/.test(token)) return token;
      const index = Number(token);
      return index <= MAX_WORD_INDEX ? wordlist[index] : token;
    })
    .join(' ');
}

// Base58 (Bitcoin alphabet): no 0/O/I/l, so the code survives handwriting
// and reads aloud unambiguously — which is why it replaced Base64 as the
// compact backup form.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToBase58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
  return out;
}

function base58ToBytes(value, expectedLength) {
  let zeros = 0;
  let start = 0;
  while (start < value.length && value[start] === '1') {
    zeros += 1;
    start += 1;
  }

  const bytes = [];
  for (let i = start; i < value.length; i += 1) {
    const digit = BASE58_ALPHABET.indexOf(value[i]);
    if (digit < 0) return null;
    let carry = digit;
    for (let j = 0; j < bytes.length; j += 1) {
      const v = bytes[j] * 58 + carry;
      bytes[j] = v & 0xff;
      carry = v >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let z = 0; z < zeros; z += 1) bytes.push(0);
  bytes.reverse();
  if (bytes.length !== expectedLength) return null;
  return Uint8Array.from(bytes);
}

// "abandon … zoo" → the 16 entropy bytes as ~22 Base58 characters, the
// compact backup form. Returns '' for anything that is not a valid 12-word
// mnemonic.
export function phraseToBase58(phrase) {
  try {
    const entropy = mnemonicToEntropy(String(phrase || '').trim().toLowerCase(), wordlist);
    return bytesToBase58(entropy);
  } catch {
    return '';
  }
}

// Decodes the Base58 backup form back into the 12 words. Returns '' when the
// input does not decode to exactly 16 bytes.
export function base58ToPhrase(value) {
  const raw = String(value || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{12,25}$/.test(raw)) return '';
  const bytes = base58ToBytes(raw, 16);
  if (!bytes) return '';
  try {
    return entropyToMnemonic(bytes, wordlist);
  } catch {
    return '';
  }
}

// Decodes the legacy Base64 backup form (shown before the switch to Base58)
// so old saved codes keep working. Returns '' when the input is not Base64
// for exactly 16 bytes.
export function base64ToPhrase(value) {
  const raw = String(value || '').trim();
  if (!/^[A-Za-z0-9+/]{22}(==)?$/.test(raw)) return '';
  try {
    const bin = atob(`${raw.slice(0, 22)}==`);
    if (bin.length !== 16) return '';
    return entropyToMnemonic(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)), wordlist);
  } catch {
    return '';
  }
}

// Accepts any backup form — the Base58 code (or a legacy Base64 one), the
// 12 numbers, or the words themselves — and returns a phrase of words.
export function decodePhraseInput(value) {
  return base58ToPhrase(value) || base64ToPhrase(value) || numbersToPhrase(value);
}

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// Levenshtein distance capped at `max` (returns max + 1 when exceeded).
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

// Map a recognized token to the closest BIP39 word, or null if nothing is
// close enough to trust. Digit tokens are treated as word numbers.
export function snapToBip39Word(token) {
  const digits = String(token || '').replace(/[^\d]/g, '');
  if (digits && digits === String(token || '').replace(/[^\da-z]/gi, '')) {
    const index = Number(digits);
    return index <= MAX_WORD_INDEX ? wordlist[index] : null;
  }

  const t = String(token || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t || t.length < 2) return null;
  if (wordSet.has(t)) return t;

  // BIP39 words are unique by their first 4 letters; accept an unambiguous
  // prefix (e.g. recognizer returned a truncated word).
  if (t.length >= 4) {
    const prefixMatches = wordlist.filter((w) => w.startsWith(t.slice(0, 4)));
    if (prefixMatches.length === 1) return prefixMatches[0];
  }

  let best = null;
  let bestDistance = 3;
  for (const word of wordlist) {
    const d = editDistance(t, word, 2);
    if (d < bestDistance) {
      bestDistance = d;
      best = word;
      if (d === 1) break;
    }
  }
  return best;
}

function isCompletePhrase(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  try {
    return validateMnemonic(normalized, wordlist);
  } catch {
    return false;
  }
}

function dispatchInput(textarea) {
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function moveCaretToEnd(textarea) {
  const end = textarea.value.length;
  try {
    textarea.setSelectionRange(end, end);
  } catch {
    // Some environments disallow selection APIs; appending still works.
  }
}

function appendWords(textarea, words) {
  if (!words.length) return;
  const base = textarea.value.replace(/\s+$/, '');
  textarea.value = `${base ? `${base} ` : ''}${words.join(' ')} `;
  moveCaretToEnd(textarea);
  dispatchInput(textarea);
}

export function attachSeedInputExtras({
  textarea,
  micBtn,
  numericToggle,
  numericEl,
  onError,
}) {
  if (!textarea) return { stopVoice() {}, hidePanels() {} };

  const reportError = (message) => onError?.(message);

  // ---- Voice dictation ----

  const SpeechRecognitionCtor = getSpeechRecognitionCtor();
  let recognition = null;
  let listening = false;
  let gotAudio = false;
  let startWatchdog = null;

  // Some browsers/webviews expose the SpeechRecognition constructor but the
  // service never starts or delivers events. If nothing happens shortly
  // after start(), give up and point at the keyboard's own dictation.
  const NO_SERVICE_MESSAGE = 'Voice input is not available in this browser — tap the text box and use the keyboard\u2019s own dictation (mic) instead';
  const START_WATCHDOG_MS = 5000;

  if (micBtn && !SpeechRecognitionCtor) {
    micBtn.hidden = true;
  }

  function clearStartWatchdog() {
    if (startWatchdog) window.clearTimeout(startWatchdog);
    startWatchdog = null;
  }

  function setListening(value) {
    listening = value;
    micBtn?.classList.toggle('is-listening', value);
    micBtn?.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  function stopVoice() {
    clearStartWatchdog();
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // already stopped
    }
    setListening(false);
  }

  function handleRecognizedText(transcript) {
    const words = String(transcript || '')
      .split(/\s+/)
      .map(snapToBip39Word)
      .filter(Boolean);
    if (!words.length) return;
    appendWords(textarea, words);
    if (isCompletePhrase(textarea.value)) stopVoice();
  }

  function startVoice() {
    if (!SpeechRecognitionCtor) return;
    recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    gotAudio = false;
    recognition.onaudiostart = () => {
      gotAudio = true;
      clearStartWatchdog();
    };
    recognition.onresult = (event) => {
      gotAudio = true;
      clearStartWatchdog();
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) handleRecognizedText(result[0]?.transcript);
      }
    };
    recognition.onerror = (event) => {
      clearStartWatchdog();
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        reportError('Microphone blocked — allow mic access and try again');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        reportError('Voice input failed — try again or type the words');
      }
      setListening(false);
    };
    recognition.onend = () => {
      clearStartWatchdog();
      setListening(false);
    };

    try {
      recognition.start();
      setListening(true);
      reportError('');
      clearStartWatchdog();
      startWatchdog = window.setTimeout(() => {
        if (!gotAudio) {
          stopVoice();
          reportError(NO_SERVICE_MESSAGE);
        }
      }, START_WATCHDOG_MS);
    } catch {
      setListening(false);
      reportError(NO_SERVICE_MESSAGE);
    }
  }

  micBtn?.addEventListener('click', () => {
    if (listening) {
      stopVoice();
    } else {
      startVoice();
    }
  });

  // Keyboard dictation types capitalized, punctuated text straight into the
  // textarea. On blur, if snapping every token to the wordlist yields a
  // valid phrase, adopt the clean version.
  textarea.addEventListener('blur', () => {
    const raw = textarea.value.trim();
    if (!raw || isCompletePhrase(raw)) return;
    const fromCode = base58ToPhrase(raw) || base64ToPhrase(raw);
    if (fromCode) {
      textarea.value = `${fromCode} `;
      dispatchInput(textarea);
      return;
    }
    const snapped = raw.split(/\s+/).map(snapToBip39Word);
    if (snapped.some((word) => !word)) return;
    const phrase = snapped.join(' ');
    if (!isCompletePhrase(phrase)) return;
    textarea.value = `${phrase} `;
    dispatchInput(textarea);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopVoice();
  });

  // ---- Word-by-word numeric wizard ----
  //
  // Each of the 12 words is entered as its decimal number (0-2047) on a
  // phone-style keypad, one word at a time. The typed digits for each row
  // are kept as strings so an untouched word ('') is not confused with an
  // entered 0 — pressing next confirms the current value, even 0.

  const digits = Array(WORD_COUNT).fill('');
  let currentRow = 0;
  let lastPrefillValue = null;

  function syncNumericView() {
    if (!numericEl?.childElementCount) return;

    const display = numericEl.querySelector('.auth-num-display');
    display.textContent = digits[currentRow];
    display.classList.toggle('is-empty', digits[currentRow] === '');

    const back = numericEl.querySelector('[data-action="back"]');
    if (back) back.disabled = currentRow === 0;
    const next = numericEl.querySelector('[data-action="next"]');
    if (next) {
      next.textContent = currentRow === WORD_COUNT - 1
        ? 'Use phrase'
        : `${currentRow + 1} of ${WORD_COUNT} ›`;
    }
  }

  // Words already in the textarea (as words or numbers) start pre-filled and
  // the wizard opens on the first word still missing. If the textarea has
  // not changed since the last prefill, in-session progress is kept.
  function prefillWizardFromTextarea() {
    const raw = textarea.value.trim();
    if (raw !== lastPrefillValue) {
      lastPrefillValue = raw;
      const words = decodePhraseInput(raw).toLowerCase().split(/\s+/).filter(Boolean);
      for (let row = 0; row < WORD_COUNT; row += 1) {
        const index = row < words.length ? wordlist.indexOf(words[row]) : -1;
        digits[row] = index >= 0 ? String(index) : '';
      }
      const firstMissing = digits.findIndex((value) => value === '');
      currentRow = firstMissing === -1 ? WORD_COUNT - 1 : firstMissing;
    }
    syncNumericView();
  }

  function applyWizardPhrase() {
    const phrase = digits.map((value) => wordlist[Number(value || '0')]).join(' ');
    if (!validateMnemonic(phrase, wordlist)) {
      reportError('These numbers do not form a valid phrase (checksum fails) — compare each number with your backup');
      return;
    }
    reportError('');
    textarea.value = `${phrase} `;
    moveCaretToEnd(textarea);
    dispatchInput(textarea);
    hidePanels();
  }

  function handleWizardNav(action) {
    if (action === 'back') {
      if (currentRow > 0) {
        currentRow -= 1;
        syncNumericView();
      }
      return;
    }
    // Confirming an empty row enters it as 0.
    if (digits[currentRow] === '') digits[currentRow] = '0';
    if (currentRow === WORD_COUNT - 1) {
      applyWizardPhrase();
    } else {
      currentRow += 1;
      syncNumericView();
    }
  }

  function pressDigit(digit) {
    const candidate = `${digits[currentRow]}${digit}`;
    if (Number(candidate) > MAX_WORD_INDEX) return;
    digits[currentRow] = String(Number(candidate)); // collapses leading zeros
    syncNumericView();
  }

  function pressDelete() {
    digits[currentRow] = digits[currentRow].slice(0, -1);
    syncNumericView();
  }

  function buildNumericPad() {
    if (!numericEl || numericEl.childElementCount) return;
    const keyRows = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ];
    const rowsHtml = keyRows
      .map((row) => row
        .map((key) => `<button type="button" class="auth-num-key" data-digit="${key}" aria-label="Digit ${key}">${key}</button>`)
        .join(''))
      .join('');

    numericEl.innerHTML = `
      <div class="auth-num-display is-empty" aria-live="polite"></div>
      <div class="auth-num-pad">
        ${rowsHtml}
        <span class="auth-num-spacer" aria-hidden="true"></span>
        <button type="button" class="auth-num-key" data-digit="0" aria-label="Digit 0">0</button>
        <button type="button" class="auth-num-key auth-num-delete" data-action="delete" aria-label="Delete digit">&#9003;</button>
      </div>
      <div class="auth-num-nav">
        <button type="button" class="auth-num-back" data-action="back" aria-label="Previous word">&lsaquo;</button>
        <button type="button" class="auth-num-next" data-action="next">1 of ${WORD_COUNT} &rsaquo;</button>
      </div>`;

    numericEl.addEventListener('mousedown', (event) => event.preventDefault());
    numericEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (action) {
        if (action.dataset.action === 'delete') {
          pressDelete();
        } else {
          handleWizardNav(action.dataset.action);
        }
        return;
      }
      const key = event.target.closest('[data-digit]');
      if (key) pressDigit(key.dataset.digit);
    });
  }

  function hideNumeric() {
    numericEl?.setAttribute('hidden', '');
    numericToggle?.classList.remove('is-active');
    numericToggle?.setAttribute('aria-expanded', 'false');
  }

  function showNumeric() {
    buildNumericPad();
    prefillWizardFromTextarea();
    numericEl?.removeAttribute('hidden');
    numericToggle?.classList.add('is-active');
    numericToggle?.setAttribute('aria-expanded', 'true');
  }

  numericToggle?.addEventListener('click', () => {
    if (numericEl?.hasAttribute('hidden')) {
      showNumeric();
    } else {
      hideNumeric();
    }
  });

  function hidePanels() {
    hideNumeric();
  }

  return { stopVoice, hidePanels };
}
