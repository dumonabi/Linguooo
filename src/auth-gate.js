import {
  normalizeClientPassphrase,
  saveRecoveryPhrase,
  setAuthToken,
  setStoredUser,
} from './auth.js';
import { attachBip39WordAutocomplete } from './bip39-word-autocomplete.js';
import { attachSeedInputExtras, decodePhraseInput, phraseToBase58, phraseToNumbers } from './seed-input-extras.js';
import { $ } from './dom-utils.js';

let seedExtras = null;

function showError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function setActiveTab(gate, tab) {
  gate.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.authTab === tab);
  });

  const signInPanel = $('#auth-panel-signin', gate);
  const registerPanel = $('#auth-panel-register', gate);
  const revealPanel = $('#auth-recovery-reveal', gate);
  const tabs = gate.querySelector('.auth-tabs');

  if (signInPanel) signInPanel.hidden = tab !== 'signin';
  if (registerPanel) registerPanel.hidden = tab !== 'register';
  if (revealPanel) revealPanel.hidden = true;
  tabs?.removeAttribute('hidden');
}

function showRecoveryReveal(gate, phrase) {
  const signInPanel = $('#auth-panel-signin', gate);
  const registerPanel = $('#auth-panel-register', gate);
  const reveal = $('#auth-recovery-reveal', gate);
  const numbersText = $('#auth-mnemonic-numbers', gate);
  const codeText = $('#auth-mnemonic-code', gate);
  const codeBlock = $('#auth-mnemonic-code-block', gate);
  const continueBtn = $('#auth-continue-after-register', gate);
  const checkbox = $('#auth-saved-checkbox', gate);

  if (signInPanel) signInPanel.hidden = true;
  if (registerPanel) registerPanel.hidden = true;
  gate.querySelector('.auth-tabs')?.setAttribute('hidden', '');
  if (!reveal || !numbersText || !continueBtn || !checkbox) return;

  // The backup the user saves is the numeric form of the phrase plus its
  // compact Base58 code, each in its own block with its own copy button;
  // the words never appear in the UI. Signing in accepts numbers, Base58
  // (or a legacy Base64 code) or words.
  const numbers = phraseToNumbers(phrase);
  const code = phraseToBase58(phrase);
  numbersText.textContent = numbers || phrase;
  if (codeText) codeText.textContent = code;
  if (codeBlock) codeBlock.hidden = !code;
  checkbox.checked = false;
  continueBtn.disabled = true;
  reveal.hidden = false;
}

async function completeAuth({ gate, passphrase, user, sessionToken, onSuccess, onUnauthorized }) {
  seedExtras?.stopVoice();
  seedExtras?.hidePanels();
  const normalized = normalizeClientPassphrase(passphrase);
  setAuthToken(sessionToken || normalized);
  if (user) {
    setStoredUser(user);
    if (normalized) saveRecoveryPhrase(user.id, normalized);
  }
  gate.hidden = true;
  if (onUnauthorized) {
    window.removeEventListener('lingo:unauthorized', onUnauthorized);
  }
  await onSuccess?.(user);
}

export function mountAuthGate({
  gate,
  onSuccess,
  onUnauthorized,
}) {
  if (!gate) return;

  const signInForm = $('#auth-signin-form', gate);
  const registerForm = $('#auth-register-form', gate);
  const passphraseInput = $('#auth-passphrase-input', gate);
  const superPasswordInput = $('#auth-super-password', gate);
  const errorEl = $('#auth-error', gate);
  const copyNumbersBtn = $('#auth-copy-numbers', gate);
  const copyCodeBtn = $('#auth-copy-code', gate);
  const savedCheckbox = $('#auth-saved-checkbox', gate);
  const continueBtn = $('#auth-continue-after-register', gate);

  let pendingRecoveryPhrase = '';
  let pendingUser = null;
  let pendingSessionToken = '';

  if (passphraseInput) {
    attachBip39WordAutocomplete(
      passphraseInput,
      $('#auth-word-list', gate),
    );
    seedExtras = attachSeedInputExtras({
      textarea: passphraseInput,
      micBtn: $('#auth-seed-mic', gate),
      numericToggle: $('#auth-seed-numeric-toggle', gate),
      numericEl: $('#auth-seed-numeric', gate),
      onError: (message) => showError(errorEl, message),
    });
  }

  gate.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(gate, button.dataset.authTab);
      showError(errorEl, '');
    });
  });

  // The numbers and the Base58 code each have their own copy button so
  // either backup form can be saved on its own.
  const wireCopyButton = (button, sourceSelector) => {
    button?.addEventListener('click', async () => {
      const value = $(sourceSelector, gate)?.textContent?.trim();
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        button.classList.add('is-action-ack');
        window.setTimeout(() => button.classList.remove('is-action-ack'), 360);
      } catch {
        showError(errorEl, 'Could not copy — select and copy manually');
      }
    });
  };
  wireCopyButton(copyNumbersBtn, '#auth-mnemonic-numbers');
  wireCopyButton(copyCodeBtn, '#auth-mnemonic-code');

  savedCheckbox?.addEventListener('change', () => {
    if (continueBtn) continueBtn.disabled = !savedCheckbox.checked;
  });

  continueBtn?.addEventListener('click', async () => {
    if (!pendingRecoveryPhrase || !pendingUser) return;
    await completeAuth({
      gate,
      passphrase: pendingRecoveryPhrase,
      user: pendingUser,
      sessionToken: pendingSessionToken,
      onSuccess,
      onUnauthorized,
    });
    pendingRecoveryPhrase = '';
    pendingUser = null;
    pendingSessionToken = '';
  });

  signInForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(errorEl, '');
    const submitBtn = signInForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      // Backups are shown as numbers, so accept them typed as numbers too.
      const passphrase = normalizeClientPassphrase(decodePhraseInput(passphraseInput?.value));
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(errorEl, data.error || 'Wrong recovery phrase or password');
        return;
      }

      await completeAuth({
        gate,
        passphrase,
        user: data.user,
        sessionToken: data.sessionToken,
        onSuccess,
        onUnauthorized,
      });
    } catch {
      showError(errorEl, 'Could not connect — try again');
    } finally {
      submitBtn.disabled = false;
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(errorEl, '');
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const superPassword = superPasswordInput?.value || '';
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ superPassword }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        showError(errorEl, data.error || 'Could not create account');
        return;
      }

      pendingRecoveryPhrase = data.recoveryPhrase || '';
      pendingUser = data.user || null;
      pendingSessionToken = data.sessionToken || '';
      if (superPasswordInput) superPasswordInput.value = '';
      if (pendingUser && pendingRecoveryPhrase) {
        saveRecoveryPhrase(pendingUser.id, pendingRecoveryPhrase);
        setAuthToken(pendingSessionToken || pendingRecoveryPhrase);
        setStoredUser(pendingUser);
      }
      showRecoveryReveal(gate, pendingRecoveryPhrase);
    } catch {
      showError(errorEl, 'Could not connect — try again');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export function openAuthGate(gate) {
  if (!gate) return;
  gate.hidden = false;
  showError($('#auth-error', gate), '');
  setActiveTab(gate, 'signin');
  $('#auth-passphrase-input', gate)?.focus();
}

export function resetAuthGate(gate) {
  if (!gate) return;
  seedExtras?.stopVoice();
  seedExtras?.hidePanels();
  const input = $('#auth-passphrase-input', gate);
  if (input) input.value = '';
  const superPasswordInput = $('#auth-super-password', gate);
  if (superPasswordInput) superPasswordInput.value = '';
  const reveal = $('#auth-recovery-reveal', gate);
  if (reveal) reveal.hidden = true;
  const wordList = $('#auth-word-list', gate);
  if (wordList) {
    wordList.hidden = true;
    wordList.innerHTML = '';
  }
  setActiveTab(gate, 'signin');
}
