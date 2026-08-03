import {
  normalizeClientPassphrase,
  saveRecoveryPhrase,
  setAuthToken,
  setStoredUser,
} from './auth.js';
import { attachSeedInputExtras, codeToPhrase, phraseToBase58 } from './seed-input-extras.js';
import { listenForSeedSound, phraseToEmoji, playSeedSound, seedPhraseFromQrImage, seedQrDataUrl, startSeedQrScan } from './seed-share.js';
import { $ } from './dom-utils.js';

let seedExtras = null;
// Set by mountAuthGate; stops the QR camera and the sound listener so they
// never outlive the gate (called on auth completion and gate reset).
let stopSeedChannels = () => {};

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
  const codeText = $('#auth-mnemonic-code', gate);
  const continueBtn = $('#auth-continue-after-register', gate);
  const checkbox = $('#auth-saved-checkbox', gate);

  if (signInPanel) signInPanel.hidden = true;
  if (registerPanel) registerPanel.hidden = true;
  gate.querySelector('.auth-tabs')?.setAttribute('hidden', '');
  if (!reveal || !codeText || !continueBtn || !checkbox) return;

  // The backup the user saves is the compact Base58 code — the words (and
  // their numbers) never appear in the UI, and signing in only accepts the
  // code (typed, scanned, heard, drawn as bits or hidden in an emoji).
  const code = phraseToBase58(phrase);
  codeText.textContent = code || phrase;
  const qrImg = $('#auth-reveal-qr', gate);
  if (qrImg) {
    qrImg.hidden = true;
    qrImg.removeAttribute('src');
  }
  $('#auth-reveal-qr-btn', gate)?.setAttribute('aria-expanded', 'false');
  checkbox.checked = false;
  continueBtn.disabled = true;
  reveal.hidden = false;
}

async function completeAuth({ gate, passphrase, user, sessionToken, onSuccess, onUnauthorized }) {
  seedExtras?.hidePanels();
  stopSeedChannels();
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
  const copyCodeBtn = $('#auth-copy-code', gate);
  const savedCheckbox = $('#auth-saved-checkbox', gate);
  const continueBtn = $('#auth-continue-after-register', gate);

  let pendingRecoveryPhrase = '';
  let pendingUser = null;
  let pendingSessionToken = '';

  // ---- receive the phrase through a side channel (QR camera/photo, sound) ----

  const qrToggle = $('#auth-seed-qr-toggle', gate);
  const scanEl = $('#auth-seed-scan', gate);
  const scanVideo = $('#auth-seed-scan-video', gate);
  const qrFileInput = $('#auth-seed-qr-file', gate);
  const soundBtn = $('#auth-seed-sound', gate);
  const toolStatus = $('#auth-tool-status', gate);
  const passphraseWrap = gate.querySelector('.auth-passphrase-wrap');

  let qrScanner = null;
  let soundListener = null;
  let binaryOpen = false;
  let soundListening = false;

  // While the binary grid, the QR scanner or the sound listener is active
  // the text box is redundant — hide it and leave only the tool buttons, so
  // deselecting the tool brings it back.
  const syncToolsOnly = () => {
    const scanOpen = Boolean(scanEl && !scanEl.hasAttribute('hidden'));
    passphraseWrap?.classList.toggle('is-tools-only', binaryOpen || scanOpen || soundListening);
  };

  if (passphraseInput) {
    seedExtras = attachSeedInputExtras({
      textarea: passphraseInput,
      binaryToggle: $('#auth-seed-binary-toggle', gate),
      binaryEl: $('#auth-seed-binary', gate),
      onError: (message) => showError(errorEl, message),
      onBinaryToggle: (open) => {
        binaryOpen = open;
        if (open) {
          stopQrScan();
          stopSoundListen();
          setToolStatus('');
        }
        syncToolsOnly();
      },
    });
  }

  const setToolStatus = (message) => {
    if (!toolStatus) return;
    toolStatus.textContent = message || '';
    toolStatus.hidden = !message;
  };

  const acceptChannelPhrase = (phrase) => {
    if (!passphraseInput) return;
    // The box always shows the Base58 code, never the underlying words.
    passphraseInput.value = phraseToBase58(phrase) || '';
    passphraseInput.dispatchEvent(new Event('input', { bubbles: true }));
    showError(errorEl, '');
    setToolStatus('Code received — press Continue');
  };

  const stopQrScan = () => {
    qrScanner?.stop();
    qrScanner = null;
    scanEl?.setAttribute('hidden', '');
    qrToggle?.classList.remove('is-active');
    qrToggle?.setAttribute('aria-expanded', 'false');
    syncToolsOnly();
  };

  const stopSoundListen = () => {
    soundListener?.stop();
    soundListener = null;
    soundListening = false;
    soundBtn?.classList.remove('is-listening');
    soundBtn?.setAttribute('aria-pressed', 'false');
    syncToolsOnly();
  };

  stopSeedChannels = () => {
    stopQrScan();
    stopSoundListen();
    setToolStatus('');
  };

  qrToggle?.addEventListener('click', async () => {
    if (scanEl && !scanEl.hasAttribute('hidden')) {
      stopQrScan();
      setToolStatus('');
      return;
    }
    seedExtras?.hidePanels();
    stopSoundListen();
    scanEl?.removeAttribute('hidden');
    qrToggle.classList.add('is-active');
    qrToggle.setAttribute('aria-expanded', 'true');
    syncToolsOnly();
    setToolStatus('Point the camera at the QR code');
    try {
      qrScanner = await startSeedQrScan(scanVideo, (phrase) => {
        stopQrScan();
        acceptChannelPhrase(phrase);
      });
    } catch {
      // No camera (or permission denied): the panel stays open so the
      // photo-upload path below still works.
      setToolStatus('Camera unavailable — read the code from a photo instead');
    }
  });

  qrFileInput?.addEventListener('change', async () => {
    const file = qrFileInput.files?.[0];
    if (!file) return;
    setToolStatus('Reading the photo…');
    const phrase = await seedPhraseFromQrImage(file).catch(() => '');
    qrFileInput.value = '';
    if (phrase) {
      stopQrScan();
      acceptChannelPhrase(phrase);
    } else {
      setToolStatus('No valid code found in that photo');
    }
  });

  soundBtn?.addEventListener('click', async () => {
    if (soundListener) {
      stopSoundListen();
      setToolStatus('');
      return;
    }
    seedExtras?.hidePanels();
    stopQrScan();
    soundListening = true;
    soundBtn.classList.add('is-listening');
    soundBtn.setAttribute('aria-pressed', 'true');
    syncToolsOnly();
    setToolStatus('Listening — play the sound code on the other device');
    try {
      soundListener = await listenForSeedSound((phrase) => {
        stopSoundListen();
        acceptChannelPhrase(phrase);
      });
    } catch {
      stopSoundListen();
      setToolStatus('');
      showError(errorEl, 'Microphone unavailable — allow mic access and try again');
    }
  });

  gate.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      stopSeedChannels();
      setActiveTab(gate, button.dataset.authTab);
      showError(errorEl, '');
    });
  });

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
  wireCopyButton(copyCodeBtn, '#auth-mnemonic-code');

  // ---- share the freshly created phrase: QR, sound, emoji ----

  const revealQrBtn = $('#auth-reveal-qr-btn', gate);
  const revealQrImg = $('#auth-reveal-qr', gate);
  const revealSoundBtn = $('#auth-reveal-sound-btn', gate);
  const revealEmojiBtn = $('#auth-reveal-emoji-btn', gate);

  revealQrBtn?.addEventListener('click', async () => {
    if (!revealQrImg) return;
    if (!revealQrImg.hidden) {
      revealQrImg.hidden = true;
      revealQrBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    try {
      revealQrImg.src = await seedQrDataUrl(pendingRecoveryPhrase);
      revealQrImg.hidden = false;
      revealQrBtn.setAttribute('aria-expanded', 'true');
    } catch {
      showError(errorEl, 'Could not build the QR code');
    }
  });

  revealSoundBtn?.addEventListener('click', async () => {
    revealSoundBtn.disabled = true;
    revealSoundBtn.classList.add('is-playing');
    try {
      await playSeedSound(pendingRecoveryPhrase);
    } catch {
      showError(errorEl, 'Could not play the sound code');
    } finally {
      revealSoundBtn.disabled = false;
      revealSoundBtn.classList.remove('is-playing');
    }
  });

  revealEmojiBtn?.addEventListener('click', async () => {
    const emoji = phraseToEmoji(pendingRecoveryPhrase);
    if (!emoji) return;
    try {
      await navigator.clipboard.writeText(emoji);
      revealEmojiBtn.classList.add('is-action-ack');
      window.setTimeout(() => revealEmojiBtn.classList.remove('is-action-ack'), 360);
    } catch {
      showError(errorEl, 'Could not copy — select and copy manually');
    }
  });

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
      // Only the Base58 code (or its emoji / legacy Base64 form) signs in —
      // words and numbers are not recognized.
      const phrase = codeToPhrase(passphraseInput?.value);
      if (!phrase) {
        showError(errorEl, 'Enter your Base58 code — words are not accepted');
        return;
      }
      const passphrase = normalizeClientPassphrase(phrase);
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
  seedExtras?.hidePanels();
  stopSeedChannels();
  const input = $('#auth-passphrase-input', gate);
  if (input) input.value = '';
  const superPasswordInput = $('#auth-super-password', gate);
  if (superPasswordInput) superPasswordInput.value = '';
  const reveal = $('#auth-recovery-reveal', gate);
  if (reveal) reveal.hidden = true;
  setActiveTab(gate, 'signin');
}
