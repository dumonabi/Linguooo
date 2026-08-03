// Input helpers for the recovery-code box on the auth gate. Sign-in only
// asks for (and recognizes) the compact Base58 code — the 12 words and
// their decimal numbers are never typed. The words only exist internally:
// the binary grid (12×11 bits, one row per word) and the side channels all
// resolve to the Base58 code shown in the box.

import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { revealTextFromEmoji } from './emoji-code.js';

const WORD_COUNT = 12;

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

// A 😊 with the Base58 code hidden in its invisible variation selectors
// (see emoji-code.js). Returns '' when the text hides nothing valid.
export function emojiToPhrase(value) {
  const hidden = revealTextFromEmoji(value);
  return hidden ? base58ToPhrase(hidden) : '';
}

// Any accepted backup form to the internal words: the emoji, the Base58
// code, or a legacy Base64 one. Words, numbers or anything else return ''.
export function codeToPhrase(value) {
  return emojiToPhrase(value) || base58ToPhrase(value) || base64ToPhrase(value);
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

export function attachSeedInputExtras({
  textarea,
  binaryToggle,
  binaryEl,
  onError,
  onBinaryToggle,
}) {
  if (!textarea) return { hidePanels() {} };

  const reportError = (message) => onError?.(message);

  // Pasted emoji or legacy Base64 codes normalize to the canonical Base58
  // code on blur. Anything else (words, numbers, typos) is left untouched —
  // only the code is recognized.
  textarea.addEventListener('blur', () => {
    const raw = textarea.value.trim();
    if (!raw) return;
    const phrase = codeToPhrase(raw);
    if (!phrase) return;
    const code = phraseToBase58(phrase);
    if (code && code !== raw) {
      textarea.value = code;
      dispatchInput(textarea);
    }
  });

  // ---- Binary grid (bip.lol style) ----
  //
  // 12 rows of 11 toggleable bits — each row is one word's index (0-2047),
  // most significant bit first, with the resulting number shown beside it.
  // The BIP39 checksum validates the finished grid.

  const BITS_PER_WORD = 11;
  const gridBits = Array.from({ length: WORD_COUNT }, () => Array(BITS_PER_WORD).fill(0));
  let lastBinaryPrefill = null;

  function rowIndexValue(row) {
    return gridBits[row].reduce((acc, bit) => acc * 2 + bit, 0);
  }

  function syncBinaryView() {
    if (!binaryEl?.childElementCount) return;
    for (let row = 0; row < WORD_COUNT; row += 1) {
      for (let bit = 0; bit < BITS_PER_WORD; bit += 1) {
        const cell = binaryEl.querySelector(`[data-row="${row}"][data-bit="${bit}"]`);
        if (!cell) continue;
        cell.classList.toggle('is-on', gridBits[row][bit] === 1);
        cell.setAttribute('aria-pressed', gridBits[row][bit] === 1 ? 'true' : 'false');
        cell.textContent = String(gridBits[row][bit]);
      }
      const num = binaryEl.querySelector(`.auth-bin-num[data-row="${row}"]`);
      if (num) num.textContent = String(rowIndexValue(row));
    }
  }

  function prefillBinaryFromTextarea() {
    const raw = textarea.value.trim();
    if (raw !== lastBinaryPrefill) {
      lastBinaryPrefill = raw;
      const words = codeToPhrase(raw).toLowerCase().split(/\s+/).filter(Boolean);
      for (let row = 0; row < WORD_COUNT; row += 1) {
        const index = row < words.length ? wordlist.indexOf(words[row]) : -1;
        for (let bit = 0; bit < BITS_PER_WORD; bit += 1) {
          gridBits[row][bit] = index > 0 ? (index >> (BITS_PER_WORD - 1 - bit)) & 1 : 0;
        }
      }
    }
    syncBinaryView();
  }

  function applyBinaryPhrase() {
    const phrase = gridBits.map((_, row) => wordlist[rowIndexValue(row)]).join(' ');
    if (!validateMnemonic(phrase, wordlist)) {
      reportError('These bits do not form a valid phrase (checksum fails) — compare each row with your backup');
      return;
    }
    reportError('');
    // The box always carries the Base58 code, never the words.
    textarea.value = phraseToBase58(phrase);
    moveCaretToEnd(textarea);
    dispatchInput(textarea);
    hidePanels();
  }

  function buildBinaryGrid() {
    if (!binaryEl || binaryEl.childElementCount) return;
    const rowsHtml = Array.from({ length: WORD_COUNT }, (_, row) => {
      const cells = Array.from({ length: BITS_PER_WORD }, (_, bit) =>
        `<button type="button" class="auth-bin-cell" data-row="${row}" data-bit="${bit}" aria-pressed="false" aria-label="Word ${row + 1} bit ${bit + 1}">0</button>`
      ).join('');
      return `<div class="auth-bin-row">${cells}<span class="auth-bin-num" data-row="${row}">0</span></div>`;
    }).join('');

    binaryEl.innerHTML = `
      <div class="auth-bin-grid">${rowsHtml}</div>
      <button type="button" class="auth-num-next auth-bin-use" data-action="use">Use code</button>`;

    binaryEl.addEventListener('mousedown', (event) => event.preventDefault());
    binaryEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="use"]')) {
        applyBinaryPhrase();
        return;
      }
      const cell = event.target.closest('.auth-bin-cell');
      if (!cell) return;
      const row = Number(cell.dataset.row);
      const bit = Number(cell.dataset.bit);
      gridBits[row][bit] = gridBits[row][bit] ? 0 : 1;
      syncBinaryView();
    });
  }

  function hideBinary() {
    if (binaryEl?.hasAttribute('hidden')) return;
    binaryEl?.setAttribute('hidden', '');
    binaryToggle?.classList.remove('is-active');
    binaryToggle?.setAttribute('aria-expanded', 'false');
    onBinaryToggle?.(false);
  }

  function showBinary() {
    buildBinaryGrid();
    prefillBinaryFromTextarea();
    binaryEl?.removeAttribute('hidden');
    binaryToggle?.classList.add('is-active');
    binaryToggle?.setAttribute('aria-expanded', 'true');
    onBinaryToggle?.(true);
  }

  binaryToggle?.addEventListener('click', () => {
    if (binaryEl?.hasAttribute('hidden')) {
      showBinary();
    } else {
      hideBinary();
    }
  });

  function hidePanels() {
    hideBinary();
  }

  return { hidePanels };
}
