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

import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const MULTITAP_COMMIT_MS = 900;

const KEYPAD_LETTER_KEYS = ['abc', 'def', 'ghi', 'jkl', 'mno', 'pqrs', 'tuv', 'wxyz'];

const wordSet = new Set(wordlist);

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

export function attachSeedInputExtras({ textarea, micBtn, keypadToggle, keypadEl, onError }) {
  if (!textarea) return { stopVoice() {}, hideKeypad() {} };

  const reportError = (message) => onError?.(message);

  // ---- Voice dictation ----

  const SpeechRecognitionCtor = getSpeechRecognitionCtor();
  let recognition = null;
  let listening = false;

  if (micBtn && !SpeechRecognitionCtor) {
    micBtn.hidden = true;
  }

  function setListening(value) {
    listening = value;
    micBtn?.classList.toggle('is-listening', value);
    micBtn?.setAttribute('aria-pressed', value ? 'true' : 'false');
  }

  function stopVoice() {
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

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) handleRecognizedText(result[0]?.transcript);
      }
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        reportError('Microphone blocked — allow mic access and try again');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        reportError('Voice input failed — try again or type the words');
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    try {
      recognition.start();
      setListening(true);
      reportError('');
    } catch {
      setListening(false);
      reportError('Voice input is not available in this browser');
    }
  }

  micBtn?.addEventListener('click', () => {
    if (listening) {
      stopVoice();
    } else {
      startVoice();
    }
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

  return { stopVoice, hideKeypad };
}
