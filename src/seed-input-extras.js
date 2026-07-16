// Extra input methods for the recovery-phrase textarea on the auth gate:
//
// 1. Voice dictation via the browser's Web Speech API. The auth gate shows
//    before the user is signed in, so the server transcription endpoints
//    (which require auth) are not available — recognition runs on-device or
//    through the browser vendor instead. Recognized tokens are snapped to
//    the closest BIP39 word, since the wordlist is a closed set of 2048
//    English words.
//
// 2. A multi-tap keypad like on old mobile phones (2=abc, 3=def, …), so the
//    phrase can be entered on devices without a usable keyboard, e.g. an
//    Apple Watch browser.

// 3. A word-by-word wizard with two views sharing the same state: a binary
//    grid (ported from the bip.lol vault) where tapping squares sets the 1s
//    of the word's 11-bit BIP39 index, and a phone-style numeric pad where
//    the word's number (0-2047) is typed digit by digit.

import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const MULTITAP_COMMIT_MS = 900;

const KEYPAD_LETTER_KEYS = ['abc', 'def', 'ghi', 'jkl', 'mno', 'pqrs', 'tuv', 'wxyz'];

const WORD_COUNT = 12;
const BITS_PER_WORD = 11;

const wordSet = new Set(wordlist);

export function bitsToIndex(bits) {
  return bits.reduce((acc, bit) => (acc << 1) | (bit ? 1 : 0), 0);
}

export function indexToBits(index) {
  const bits = [];
  for (let b = BITS_PER_WORD - 1; b >= 0; b -= 1) bits.push(((index >> b) & 1) === 1);
  return bits;
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
// close enough to trust.
export function snapToBip39Word(token) {
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

// watchOS's Quickboard (the system text-entry sheet) has a WebKit bug with
// <textarea>: it opens without the field's current value, so what the user
// sees in the sheet does not match the page. Single-line <input> elements are
// handled correctly, so on watch-sized screens the phrase textarea is swapped
// for an equivalent input before any handlers are attached.
export function swapTextareaForWatchInput(textarea) {
  if (!textarea || textarea.tagName !== 'TEXTAREA') return textarea;
  if (!window.matchMedia('(max-width: 330px)').matches) return textarea;
  const input = document.createElement('input');
  input.type = 'text';
  for (const attr of textarea.attributes) {
    if (attr.name === 'rows' || attr.name === 'cols') continue;
    input.setAttribute(attr.name, attr.value);
  }
  input.value = textarea.value;
  textarea.replaceWith(input);
  return input;
}

export function attachSeedInputExtras({
  textarea,
  micBtn,
  keypadToggle,
  keypadEl,
  numericToggle,
  numericEl,
  binaryToggle,
  binaryEl,
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

  // watchOS (and some webviews) exposes the SpeechRecognition constructor
  // but the service never starts or delivers events. If nothing happens
  // shortly after start(), give up and point at the system dictation, which
  // does work on the watch keyboard.
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

  // System dictation (e.g. the Apple Watch keyboard mic) types capitalized,
  // punctuated text straight into the textarea. On blur, if snapping every
  // token to the wordlist yields a valid phrase, adopt the clean version.
  textarea.addEventListener('blur', () => {
    const raw = textarea.value.trim();
    if (!raw || isCompletePhrase(raw)) return;
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

  // ---- Multi-tap keypad ----

  let pendingTap = null; // { letters, index }
  let commitTimer = null;

  function clearCommitTimer() {
    if (commitTimer) window.clearTimeout(commitTimer);
    commitTimer = null;
  }

  function commitPendingTap() {
    clearCommitTimer();
    if (!pendingTap) return;
    pendingTap = null;
    markActiveKey(null);
    // The letter is already in the textarea; committing just fixes it so the
    // next tap on the same key starts a new letter.
    dispatchInput(textarea);
  }

  function scheduleCommit() {
    clearCommitTimer();
    commitTimer = window.setTimeout(commitPendingTap, MULTITAP_COMMIT_MS);
  }

  function markActiveKey(letters) {
    if (!keypadEl) return;
    keypadEl.querySelectorAll('.auth-keypad-key').forEach((btn) => {
      btn.classList.toggle('is-cycling', Boolean(letters) && btn.dataset.letters === letters);
    });
  }

  function setEndChar(char) {
    textarea.value = `${textarea.value.slice(0, -1)}${char}`;
    moveCaretToEnd(textarea);
  }

  function tapLetterKey(letters) {
    if (pendingTap && pendingTap.letters === letters) {
      pendingTap.index = (pendingTap.index + 1) % letters.length;
      setEndChar(letters[pendingTap.index]);
    } else {
      commitPendingTap();
      pendingTap = { letters, index: 0 };
      textarea.value += letters[0];
      moveCaretToEnd(textarea);
    }
    markActiveKey(letters);
    dispatchInput(textarea);
    scheduleCommit();
  }

  function tapSpace() {
    commitPendingTap();
    if (!textarea.value || textarea.value.endsWith(' ')) return;
    textarea.value += ' ';
    moveCaretToEnd(textarea);
    dispatchInput(textarea);
  }

  function tapBackspace() {
    clearCommitTimer();
    pendingTap = null;
    markActiveKey(null);
    if (!textarea.value) return;
    textarea.value = textarea.value.slice(0, -1);
    moveCaretToEnd(textarea);
    dispatchInput(textarea);
  }

  function buildKeypad() {
    if (!keypadEl || keypadEl.childElementCount) return;
    const keys = KEYPAD_LETTER_KEYS.map((letters) =>
      `<button type="button" class="auth-keypad-key" data-letters="${letters}">${letters}</button>`);
    keys.push('<button type="button" class="auth-keypad-key auth-keypad-backspace" data-action="backspace" aria-label="Delete letter">⌫</button>');
    keys.push('<button type="button" class="auth-keypad-key auth-keypad-space" data-action="space" aria-label="Space">space</button>');
    keypadEl.innerHTML = keys.join('');

    // Keep focus (and the iOS keyboard state) unchanged while tapping keys.
    keypadEl.addEventListener('mousedown', (event) => event.preventDefault());
    keypadEl.addEventListener('click', (event) => {
      const btn = event.target.closest('.auth-keypad-key');
      if (!btn) return;
      if (btn.dataset.action === 'backspace') {
        tapBackspace();
      } else if (btn.dataset.action === 'space') {
        tapSpace();
      } else if (btn.dataset.letters) {
        tapLetterKey(btn.dataset.letters);
      }
    });
  }

  function hideKeypad() {
    commitPendingTap();
    keypadEl?.setAttribute('hidden', '');
    keypadToggle?.classList.remove('is-active');
    keypadToggle?.setAttribute('aria-expanded', 'false');
  }

  function showKeypad() {
    buildKeypad();
    hideBinary();
    hideNumeric();
    keypadEl?.removeAttribute('hidden');
    keypadToggle?.classList.add('is-active');
    keypadToggle?.setAttribute('aria-expanded', 'true');
  }

  keypadToggle?.addEventListener('click', () => {
    if (keypadEl?.hasAttribute('hidden')) {
      showKeypad();
    } else {
      hideKeypad();
    }
  });

  // Typing on a real keyboard cancels any pending multi-tap cycle.
  textarea.addEventListener('keydown', () => {
    clearCommitTimer();
    pendingTap = null;
    markActiveKey(null);
  });

  // ---- Word-by-word wizard: binary squares and numeric keypad views ----
  //
  // Both views drive the same state: one BIP39 index per word plus whether
  // that word has been entered yet (an untouched word shows no preview, so a
  // fresh word is not confused with an entered "0 abandon" — pressing next
  // confirms the current value, even 0).
  //
  // Binary view (ported from bip.lol): 12 big frames, 4 per row like the rest
  // of the UI. The first 11 are the word's bits; the free 12th frame shows
  // the number and the word is written in a row above the grid.
  //
  // Numeric view: a phone-style digit pad (1-9 in three rows, then 0 in the
  // middle with delete beside it) to type each word's number directly.

  const MAX_WORD_INDEX = wordlist.length - 1;

  const values = Array(WORD_COUNT).fill(0);
  const entered = Array(WORD_COUNT).fill(false);
  let currentRow = 0;
  let lastPrefillValue = null;

  function syncWizardViews() {
    const value = values[currentRow];
    const word = wordlist[value];
    const isEntered = entered[currentRow];

    if (binaryEl?.childElementCount) {
      const bits = indexToBits(value);
      binaryEl.querySelector('.auth-bit-preview').textContent = isEntered ? word : '';
      binaryEl.querySelectorAll('.auth-bit').forEach((cell, col) => {
        cell.classList.toggle('is-on', bits[col]);
        cell.setAttribute('aria-pressed', bits[col] ? 'true' : 'false');
        cell.setAttribute('aria-label', `Word ${currentRow + 1}, bit ${col + 1}`);
      });
      const filler = binaryEl.querySelector('.auth-bit-filler');
      filler.textContent = isEntered ? String(value) : '';
      filler.dataset.len = String(String(value).length);
    }

    if (numericEl?.childElementCount) {
      numericEl.querySelector('.auth-num-value').textContent = isEntered ? String(value) : '';
      numericEl.querySelector('.auth-num-word').textContent = isEntered ? word : '';
    }

    [binaryEl, numericEl].forEach((panel) => {
      if (!panel?.childElementCount) return;
      const back = panel.querySelector('[data-action="back"]');
      if (back) back.disabled = currentRow === 0;
      const next = panel.querySelector('[data-action="next"]');
      if (next) {
        next.textContent = currentRow === WORD_COUNT - 1
          ? 'Use phrase'
          : `${currentRow + 1} of ${WORD_COUNT} ›`;
      }
    });
  }

  // Words already typed in the textarea start pre-filled and the wizard opens
  // on the first word still missing. If the textarea has not changed since
  // the last prefill, in-session progress is kept (e.g. when switching
  // between the binary and numeric views).
  function prefillWizardFromTextarea() {
    const raw = textarea.value.trim();
    if (raw !== lastPrefillValue) {
      lastPrefillValue = raw;
      const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
      for (let row = 0; row < WORD_COUNT; row += 1) {
        const index = row < words.length ? wordlist.indexOf(words[row]) : -1;
        values[row] = index >= 0 ? index : 0;
        entered[row] = index >= 0;
      }
      const firstMissing = entered.findIndex((flag) => !flag);
      currentRow = firstMissing === -1 ? WORD_COUNT - 1 : firstMissing;
    }
    syncWizardViews();
  }

  function applyWizardPhrase() {
    const phrase = values.map((value) => wordlist[value]).join(' ');
    if (!validateMnemonic(phrase, wordlist)) {
      reportError('These words do not form a valid phrase (checksum fails) — compare each word with your backup');
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
        syncWizardViews();
      }
      return;
    }
    entered[currentRow] = true;
    if (currentRow === WORD_COUNT - 1) {
      applyWizardPhrase();
    } else {
      currentRow += 1;
      syncWizardViews();
    }
  }

  // While tapping squares or digits, keep the live word preview at the very
  // top of the screen so it stays visible above the pad (important on small
  // screens like a watch, where the pad fills the viewport).
  function scrollWordPreviewToTop(panel) {
    const target = panel?.querySelector('.auth-bit-preview, .auth-num-display');
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function wizardNavMarkup() {
    return `<div class="auth-bit-nav">
      <button type="button" class="auth-bit-back" data-action="back" aria-label="Previous word">&lsaquo;</button>
      <button type="button" class="auth-bit-next" data-action="next">1 of ${WORD_COUNT} &rsaquo;</button>
    </div>`;
  }

  function buildBinaryGrid() {
    if (!binaryEl || binaryEl.childElementCount) return;
    const cells = [];
    for (let col = 0; col < BITS_PER_WORD; col += 1) {
      cells.push(`<button type="button" class="auth-bit" data-col="${col}" aria-pressed="false"></button>`);
    }
    cells.push('<span class="auth-bit-filler" aria-hidden="true"></span>');
    binaryEl.innerHTML = `
      <div class="auth-bit-preview" aria-live="polite"></div>
      <div class="auth-bit-row">${cells.join('')}</div>
      ${wizardNavMarkup()}`;

    binaryEl.addEventListener('mousedown', (event) => event.preventDefault());
    binaryEl.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]');
      if (action) {
        handleWizardNav(action.dataset.action);
        return;
      }
      const bit = event.target.closest('.auth-bit');
      if (!bit) return;
      const col = Number(bit.dataset.col);
      if (!Number.isInteger(col)) return;
      const bits = indexToBits(values[currentRow]);
      bits[col] = !bits[col];
      values[currentRow] = bitsToIndex(bits);
      entered[currentRow] = true;
      syncWizardViews();
      scrollWordPreviewToTop(binaryEl);
    });
  }

  function buildNumericPad() {
    if (!numericEl || numericEl.childElementCount) return;
    const keys = [];
    for (let digit = 1; digit <= 9; digit += 1) {
      keys.push(`<button type="button" class="auth-num-key" data-digit="${digit}">${digit}</button>`);
    }
    keys.push('<span class="auth-num-spacer" aria-hidden="true"></span>');
    keys.push('<button type="button" class="auth-num-key" data-digit="0">0</button>');
    keys.push('<button type="button" class="auth-num-key auth-num-delete" data-action="delete" aria-label="Delete digit">⌫</button>');
    numericEl.innerHTML = `
      <div class="auth-num-display" aria-live="polite">
        <span class="auth-num-value"></span>
        <span class="auth-num-word"></span>
      </div>
      <div class="auth-num-pad">${keys.join('')}</div>
      ${wizardNavMarkup()}`;

    numericEl.addEventListener('mousedown', (event) => event.preventDefault());
    numericEl.addEventListener('click', (event) => {
      const key = event.target.closest('[data-digit], [data-action]');
      if (!key) return;
      if (key.dataset.action === 'back' || key.dataset.action === 'next') {
        handleWizardNav(key.dataset.action);
        return;
      }
      if (key.dataset.action === 'delete') {
        if (!entered[currentRow]) return;
        const digits = String(values[currentRow]);
        if (digits.length <= 1) {
          values[currentRow] = 0;
          entered[currentRow] = false;
        } else {
          values[currentRow] = Number(digits.slice(0, -1));
        }
        syncWizardViews();
        scrollWordPreviewToTop(numericEl);
        return;
      }
      const digit = Number(key.dataset.digit);
      const next = entered[currentRow] ? values[currentRow] * 10 + digit : digit;
      if (next > MAX_WORD_INDEX) return;
      values[currentRow] = next;
      entered[currentRow] = true;
      syncWizardViews();
      scrollWordPreviewToTop(numericEl);
    });
  }

  function hideBinary() {
    binaryEl?.setAttribute('hidden', '');
    binaryToggle?.classList.remove('is-active');
    binaryToggle?.setAttribute('aria-expanded', 'false');
  }

  function showBinary() {
    buildBinaryGrid();
    hideKeypad();
    hideNumeric();
    prefillWizardFromTextarea();
    binaryEl?.removeAttribute('hidden');
    binaryToggle?.classList.add('is-active');
    binaryToggle?.setAttribute('aria-expanded', 'true');
  }

  binaryToggle?.addEventListener('click', () => {
    if (binaryEl?.hasAttribute('hidden')) {
      showBinary();
    } else {
      hideBinary();
    }
  });

  function hideNumeric() {
    numericEl?.setAttribute('hidden', '');
    numericToggle?.classList.remove('is-active');
    numericToggle?.setAttribute('aria-expanded', 'false');
  }

  function showNumeric() {
    buildNumericPad();
    hideKeypad();
    hideBinary();
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
    hideKeypad();
    hideBinary();
    hideNumeric();
  }

  return { stopVoice, hidePanels };
}
