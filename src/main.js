import { createLangPicker, renderFlag } from './lang-picker.js';
import { CHAMELEON_LOGO_SVG } from './chameleon-logo.js';
import { apiFetch, clearAuthToken, getAuthToken, setAuthToken } from './auth.js';
import {
  isRetryableSendError,
  listPendingRecordings,
  removePendingRecording,
  retryDelayMs,
  savePendingRecording,
  updatePendingRecording,
} from './pending-audio.js';

const STORAGE_KEY = 'lingo-languages';
const DEFAULT_LANG1 = 'en';
const DEFAULT_LANG2 = 'es';
const MAX_RECORDING_MS = 60_000;

let authRequired = false;

const state = {
  languages: [],
  lang1: DEFAULT_LANG1,
  lang2: DEFAULT_LANG2,
  messages: [],
  isProcessing: false,
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  mediaStream: null,
  currentAudio: null,
  recordingStartedAt: 0,
};

let picker1;
let picker2;

const $ = (sel) => document.querySelector(sel);

const conversationEl = $('#conversation');
const toastEl = $('#toast');
const mainMicBtn = $('#main-mic');
const liveTranscript = $('#live-transcript');
const progressWrap = $('#progress-wrap');
const progressTrack = $('#progress-track');
const progressFill = $('#progress-fill');

let progressRaf = null;
let recordingProgressRaf = null;
let progressStartedAt = 0;
let progressEstimateMs = 4000;
let pendingQueueBusy = false;
let pendingRetryTimer = null;

function findLang(code) {
  return state.languages.find((l) => l.code === code);
}

function langMeta(fromCode, toCode) {
  const from = findLang(fromCode);
  const to = findLang(toCode);
  if (!from || !to) return `${fromCode} → ${toCode}`;
  const tmp = document.createElement('span');
  tmp.innerHTML = `${renderFlag(from)} ${from.name} → ${renderFlag(to)} ${to.name}`;
  return tmp.innerHTML;
}

function prefetchAudio(msg) {
  return loadMessageAudio(msg);
}

function audioCacheKey(msg) {
  return `${msg.translated}|${msg.targetLanguage}`;
}

function invalidateMessageAudio(msg) {
  if (msg.audioUrl) {
    URL.revokeObjectURL(msg.audioUrl);
    msg.audioUrl = null;
  }
  msg._audioPromise = null;
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function loadMessageAudio(msg, { retry = false } = {}) {
  const key = audioCacheKey(msg);
  if (msg._audioKey && msg._audioKey !== key) {
    invalidateMessageAudio(msg);
  }
  msg._audioKey = key;

  if (msg.audioUrl) return;

  if (msg._audioPromise && !retry) {
    try {
      await withTimeout(msg._audioPromise, 25000, 'Audio timed out — tap Listen again');
    } catch {
      invalidateMessageAudio(msg);
    }
    if (msg.audioUrl) return;
  }

  msg._audioPromise = apiFetch('/api/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: msg.translated, lang: msg.targetLanguage }),
  }).then(async (res) => {
    let errMsg = 'Audio not ready — tap Listen again';
    if (!res.ok) {
      try {
        const data = await res.json();
        errMsg = data.error || errMsg;
      } catch {
        if (res.status === 429) errMsg = 'Too many audio requests — wait a moment';
      }
      throw new Error(errMsg);
    }
    msg.audioUrl = URL.createObjectURL(await res.blob());
  });

  try {
    await withTimeout(msg._audioPromise, 25000, 'Audio timed out — tap Listen again');
  } catch (err) {
    invalidateMessageAudio(msg);
    throw err;
  }
}

function playAudioUrl(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    state.currentAudio = audio;
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      state.currentAudio = null;
      fn();
    };

    const timer = setTimeout(() => {
      audio.pause();
      finish(() => reject(new Error('Playback timed out — tap again')));
    }, 90000);

    audio.onended = () => finish(resolve);
    audio.onerror = () => finish(() => reject(new Error('Playback failed')));
    audio.play().catch((err) => finish(() => reject(err)));
  });
}

function resetListenBtn(btn) {
  btn.classList.remove('playing');
  btn.disabled = false;
  delete btn.dataset.busy;
}

async function init() {
  $('#logo-icon').innerHTML = CHAMELEON_LOGO_SVG;
  $('#auth-logo').innerHTML = CHAMELEON_LOGO_SVG;

  const ready = await checkHealth();
  if (!ready) return;

  const authed = await ensureAuthenticated();
  if (!authed) return;

  await loadLanguages();
  initPickers();
  bindEvents();
  bindMicHelp();
  bindPendingQueue();
  checkMicSupport();
  updateMicState();
  void refreshPendingBanner();
  schedulePendingRetry(1500);
}

async function ensureAuthenticated() {
  if (!authRequired) return true;

  if (getAuthToken()) {
    const res = await apiFetch('/api/languages');
    if (res.ok) return true;
    clearAuthToken();
  }

  return showAuthGate();
}

function showAuthGate() {
  const gate = $('#auth-gate');
  const form = $('#auth-form');
  const input = $('#auth-input');
  const errorEl = $('#auth-error');
  const submitBtn = $('#auth-submit');

  gate.hidden = false;
  input.value = '';
  errorEl.hidden = true;

  return new Promise((resolve) => {
    const onUnauthorized = () => {
      gate.hidden = false;
      errorEl.textContent = 'Session expired — enter the code again';
      errorEl.hidden = false;
      resolve(false);
    };

    window.addEventListener('lingo:unauthorized', onUnauthorized, { once: true });

    form.onsubmit = async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      submitBtn.disabled = true;

      try {
        const password = input.value.trim();
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          errorEl.textContent = data.error || 'Wrong access code';
          errorEl.hidden = false;
          return;
        }

        setAuthToken(password);
        gate.hidden = true;
        window.removeEventListener('lingo:unauthorized', onUnauthorized);
        resolve(true);
      } catch {
        errorEl.textContent = 'Could not connect — try again';
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    };
  });
}

async function loadLanguages() {
  try {
    const res = await apiFetch('/api/languages');
    if (!res.ok) throw new Error('Failed to load languages');
    state.languages = await res.json();
  } catch {
    state.languages = [
      { code: 'en', name: 'English', flag: '🇺🇸', customFlag: null },
      { code: 'es', name: 'Spanish', flag: '🇪🇸', customFlag: null },
    ];
  }
}

function initPickers() {
  const saved = loadSavedLanguages();
  if (saved?.lang1 && saved?.lang2 && saved.lang1 !== saved.lang2) {
    state.lang1 = saved.lang1;
    state.lang2 = saved.lang2;
  }

  picker1 = createLangPicker($('#lang-picker-1'), {
    languages: state.languages,
    value: state.lang1,
    placeholder: 'English',
    onChange: (code) => {
      state.lang1 = code;
      if (state.lang1 === state.lang2) {
        const other = state.languages.find((l) => l.code !== state.lang1);
        state.lang2 = other?.code || DEFAULT_LANG2;
        picker2.setValue(state.lang2);
      }
      onLanguagesChanged();
    },
  });

  picker2 = createLangPicker($('#lang-picker-2'), {
    languages: state.languages,
    value: state.lang2,
    placeholder: 'Spanish',
    onChange: (code) => {
      state.lang2 = code;
      if (state.lang1 === state.lang2) {
        const other = state.languages.find((l) => l.code !== state.lang2);
        state.lang1 = other?.code || DEFAULT_LANG1;
        picker1.setValue(state.lang1);
      }
      onLanguagesChanged();
    },
  });
}

function loadSavedLanguages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveLanguages() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ lang1: state.lang1, lang2: state.lang2 }));
}

function clearConversation() {
  state.messages = [];
  conversationEl.innerHTML = '';
}

function onLanguagesChanged() {
  clearConversation();
  saveLanguages();
  updateMicState();
}

function detectBrowser() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS/i.test(ua);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg/i.test(ua);

  if (isIOS && isSafari) return 'ios-safari';
  if (isIOS && isChrome) return 'ios-chrome';
  if (isIOS) return 'ios-other';
  if (isAndroid && isChrome) return 'android-chrome';
  if (isAndroid) return 'android-other';
  if (isSafari) return 'desktop-safari';
  if (isChrome) return 'desktop-chrome';
  return 'generic';
}

function genericMicSteps() {
  return [
    'Connect or enable a microphone on your device',
    'Allow microphone access when your browser asks',
    'If you already denied it: open this site\'s settings (lock or “aA” icon in the address bar) and set Microphone to Allow',
    'Reload the page, then tap Try again',
  ];
}

function getMicHelp(err) {
  const browser = detectBrowser();
  const denied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
  const notFound = err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError';

  if (denied) {
    if (browser === 'ios-safari') {
      return {
        title: 'Allow microphone in Safari',
        intro: 'Safari needs permission to use your microphone.',
        steps: [
          'Open iPhone Settings → Safari → Microphone → Allow',
          'Or Settings → Privacy & Security → Microphone → turn ON for Safari',
          'Come back here, tap Try again, and tap Allow when asked',
        ],
      };
    }
    if (browser === 'ios-chrome') {
      return {
        title: 'Allow microphone in Chrome',
        intro: 'Chrome needs permission to use your microphone.',
        steps: [
          'Open iPhone Settings → Chrome → Microphone → ON',
          'Come back here, tap Try again, and tap Allow when asked',
        ],
      };
    }
    if (browser === 'ios-other') {
      return {
        title: 'Allow microphone',
        intro: 'Your browser needs permission to use the microphone.',
        steps: [
          'Open iPhone Settings → Privacy & Security → Microphone',
          'Turn ON access for the browser you are using',
          'Come back here, tap Try again, and tap Allow when asked',
        ],
      };
    }
    if (browser === 'android-chrome') {
      return {
        title: 'Allow microphone',
        intro: 'Allow microphone access for this site.',
        steps: [
          'Tap the lock icon next to the website address',
          'Tap Permissions → Microphone → Allow',
          'Tap Try again below',
        ],
      };
    }
    if (browser === 'desktop-safari') {
      return {
        title: 'Allow microphone in Safari',
        intro: 'Safari needs permission to use your microphone.',
        steps: [
          'Safari menu → Settings → Websites → Microphone',
          'Set this site to Allow',
          'Reload the page, then tap Try again',
        ],
      };
    }
    if (browser === 'desktop-chrome') {
      return {
        title: 'Allow microphone',
        intro: 'Chrome needs permission to use your microphone.',
        steps: [
          'Click the lock icon in the address bar',
          'Set Microphone to Allow',
          'Reload the page, then tap Try again',
        ],
      };
    }
    return {
      title: 'Allow microphone',
      intro: 'Your browser needs permission to use the microphone.',
      steps: genericMicSteps(),
    };
  }

  if (notFound) {
    return {
      title: 'Microphone not found',
      intro: 'No microphone was detected, or access is still blocked.',
      steps: genericMicSteps(),
    };
  }

  return {
    title: 'Could not access microphone',
    intro: 'Something stopped the microphone from starting.',
    steps: genericMicSteps(),
  };
}

function showMicHelp(err) {
  const help = getMicHelp(err);
  $('#mic-help-title').textContent = help.title;
  $('#mic-help-intro').textContent = help.intro;
  $('#mic-help-steps').innerHTML = help.steps.map((step) => `<li>${step}</li>`).join('');
  $('#mic-help').hidden = false;
}

function hideMicHelp() {
  $('#mic-help').hidden = true;
}

function bindMicHelp() {
  $('#mic-help-close').addEventListener('click', hideMicHelp);
  $('#mic-help-retry').addEventListener('click', async () => {
    hideMicHelp();
    releaseMic();
    try {
      await ensureMicStream();
    } catch (err) {
      showMicHelp(err);
    }
  });
}

function languagesReady() {
  return state.lang1 && state.lang2 && state.lang1 !== state.lang2;
}

function updateMicState() {
  const ready = languagesReady();
  mainMicBtn.disabled = !ready && !state.isRecording && !state.isProcessing;
  mainMicBtn.setAttribute('aria-label', ready ? 'Tap to speak' : 'Select two languages');
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    authRequired = Boolean(data.authRequired);
    return true;
  } catch {
    showToast('Run: npm run dev');
    return false;
  }
}

function checkMicSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    mainMicBtn.disabled = true;
    showToast('Microphone not supported');
  }
}

async function ensureMicStream() {
  if (state.mediaStream?.active) return state.mediaStream;

  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return state.mediaStream;
}

function getMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function estimateProcessingMs(recordingMs, blobBytes) {
  const MIN_MS = 3000;
  const MAX_MS = 6500;

  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 11000, 0.5);

  // Real waits cluster around 3–6s; longer clips add a little, not linearly
  const t = Math.min(audioSeconds / 10, 1);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

function simulatedProgress(elapsedMs) {
  const target = progressEstimateMs;
  const ratio = elapsedMs / target;

  if (ratio <= 1) return ratio * 97;

  // Past estimate: creep slowly so the bar never looks frozen
  const overtime = elapsedMs - target;
  return Math.min(97 + (overtime / (target * 0.6)) * 2, 99);
}

function updateProgressBar(pct) {
  const value = Math.round(pct);
  progressFill.style.width = `${pct}%`;
  progressTrack.setAttribute('aria-valuenow', String(value));
}

function stopRecordingProgress() {
  if (recordingProgressRaf) cancelAnimationFrame(recordingProgressRaf);
  recordingProgressRaf = null;
  progressWrap.classList.remove('is-recording');
}

function startRecordingProgress() {
  stopRecordingProgress();
  stopProgress();
  progressWrap.hidden = false;
  progressWrap.classList.add('is-recording');
  progressTrack.setAttribute('aria-label', 'Recording progress');
  updateProgressBar(0);

  const tick = () => {
    if (!state.isRecording) return;

    const elapsed = Date.now() - state.recordingStartedAt;
    updateProgressBar(Math.min((elapsed / MAX_RECORDING_MS) * 100, 100));

    if (elapsed >= MAX_RECORDING_MS) {
      stopRecordingProgress();
      showToast('1 minute limit — processing…');
      void stopRecording();
      return;
    }

    recordingProgressRaf = requestAnimationFrame(tick);
  };

  recordingProgressRaf = requestAnimationFrame(tick);
}

function startProgress(estimatedMs) {
  stopRecordingProgress();
  stopProgress();
  progressEstimateMs = estimatedMs;
  progressStartedAt = performance.now();
  progressWrap.hidden = false;
  progressWrap.classList.add('is-active');
  progressTrack.setAttribute('aria-label', 'Translation progress');
  updateProgressBar(0);

  const tick = (now) => {
    const elapsed = now - progressStartedAt;
    updateProgressBar(simulatedProgress(elapsed));
    progressRaf = requestAnimationFrame(tick);
  };

  progressRaf = requestAnimationFrame(tick);
}

function finishProgress() {
  return new Promise((resolve) => {
    stopProgress();
    progressWrap.classList.remove('is-active');
    updateProgressBar(100);
    setTimeout(() => {
      progressWrap.hidden = true;
      updateProgressBar(0);
      resolve();
    }, 220);
  });
}

function stopProgress() {
  if (progressRaf) cancelAnimationFrame(progressRaf);
  progressRaf = null;
  progressWrap.classList.remove('is-active');
  progressWrap.classList.remove('is-recording');
}

function buildConversationContext() {
  return state.messages
    .filter((m) => [state.lang1, state.lang2].includes(m.detectedLanguage))
    .slice(-2)
    .map((m) => ({
      detectedLanguage: m.detectedLanguage,
      original: m.original,
      translated: m.translated,
    }));
}

function applyTranslationResult(data) {
  const message = {
    id: Date.now(),
    original: data.sourceText || data.rawText,
    translated: data.translatedText,
    detectedLanguage: data.detectedLanguage,
    targetLanguage: data.targetLanguage,
    audioUrl: null,
  };

  state.messages.push(message);
  renderMessage(message);
  prefetchAudio(message).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConverse(form, { attempts = 3 } = {}) {
  let lastError;
  let lastRes;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await withTimeout(
        apiFetch('/api/converse', { method: 'POST', body: form }),
        90000,
        'Request timed out — message saved',
      );
      lastRes = res;

      if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408)
        && attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
    }
  }

  if (lastRes) return lastRes;

  const error = new Error(lastError?.message || 'Cannot connect to server');
  error.retryable = true;
  throw error;
}

async function submitRecording({ blob, mimeType, recordingMs, lang1, lang2, context, pendingId }) {
  const id = pendingId || crypto.randomUUID();

  if (!pendingId) {
    await savePendingRecording({
      id,
      blob,
      mimeType,
      lang1,
      lang2,
      contextJson: JSON.stringify(context),
      recordingMs,
      createdAt: Date.now(),
    });
  }

  const form = new FormData();
  form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('lang1', lang1);
  form.append('lang2', lang2);
  form.append('durationMs', String(recordingMs));
  form.append('context', JSON.stringify(context));

  let res;
  try {
    res = await fetchConverse(form, { attempts: pendingId ? 2 : 3 });
  } catch (err) {
    const current = (await listPendingRecordings()).find((item) => item.id === id);
    await updatePendingRecording(id, {
      attempts: (current?.attempts || 0) + 1,
      lastError: err.message,
    });
    throw err;
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    const error = new Error('Session expired — enter the access code again');
    error.retryable = true;
    throw error;
  }
  if (res.status === 429) {
    const error = new Error(data.error || 'Too many messages this hour');
    error.retryable = true;
    throw error;
  }
  if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408) {
    const error = new Error('Connection interrupted — message saved for retry');
    error.retryable = true;
    await updatePendingRecording(id, {
      attempts: (((await listPendingRecordings()).find((item) => item.id === id)?.attempts) || 0) + 1,
      lastError: error.message,
    });
    throw error;
  }
  if (!res.ok) {
    const error = new Error(data.error || 'Processing failed');
    error.retryable = isRetryableSendError(error, res);
    if (error.retryable) {
      await updatePendingRecording(id, { lastError: error.message });
    }
    throw error;
  }
  if (!data.translatedText?.trim()) {
    const error = new Error('Could not translate — message saved for retry');
    error.retryable = true;
    await updatePendingRecording(id, { lastError: error.message });
    throw error;
  }

  await removePendingRecording(id);
  return data;
}

async function refreshPendingBanner() {
  const items = await listPendingRecordings();
  const banner = $('#pending-banner');
  if (!items.length) {
    banner.hidden = true;
    return;
  }

  $('#pending-text').textContent = items.length === 1
    ? '1 message saved on this device. We will retry automatically when the connection is back.'
    : `${items.length} messages saved on this device. We will retry automatically when the connection is back.`;
  banner.hidden = false;
}

function schedulePendingRetry(delayMs = 5000) {
  clearTimeout(pendingRetryTimer);
  pendingRetryTimer = setTimeout(() => {
    void processPendingQueue();
  }, delayMs);
}

function wakePendingQueue() {
  void refreshPendingBanner();
  schedulePendingRetry(400);
}

async function processPendingQueue() {
  if (pendingQueueBusy || state.isProcessing || state.isRecording) return;
  if (!navigator.onLine) {
    await refreshPendingBanner();
    return;
  }

  const items = await listPendingRecordings();
  if (!items.length) {
    await refreshPendingBanner();
    return;
  }

  pendingQueueBusy = true;
  const sorted = items.sort((a, b) => a.createdAt - b.createdAt);

  for (const item of sorted) {
    if (state.isRecording) break;

    try {
      state.isProcessing = true;
      mainMicBtn.disabled = true;
      startProgress(estimateProcessingMs(item.recordingMs, item.blob?.size || 0));

      const context = JSON.parse(item.contextJson || '[]');
      const data = await submitRecording({
        blob: item.blob,
        mimeType: item.mimeType,
        recordingMs: item.recordingMs,
        lang1: item.lang1,
        lang2: item.lang2,
        context,
        pendingId: item.id,
      });

      applyTranslationResult(data);
      await finishProgress();
    } catch (err) {
      if (err.retryable !== false) {
        if (err.message?.includes('Session expired') && authRequired) {
          showAuthGate();
        }
        await updatePendingRecording(item.id, {
          attempts: (item.attempts || 0) + 1,
          lastError: err.message || 'Retry later',
        });
        showToast(err.message || 'Message saved — will retry');
        schedulePendingRetry(retryDelayMs((item.attempts || 0) + 1));
        break;
      }
      await removePendingRecording(item.id);
      showToast(err.message);
    } finally {
      state.isProcessing = false;
      resetMicUI();
    }
  }

  pendingQueueBusy = false;
  await refreshPendingBanner();
}

function bindPendingQueue() {
  $('#pending-retry').addEventListener('click', () => {
    void processPendingQueue();
  });
  $('#pending-dismiss').addEventListener('click', () => {
    $('#pending-banner').hidden = true;
  });
  window.addEventListener('online', wakePendingQueue);
  window.addEventListener('focus', wakePendingQueue);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakePendingQueue();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) wakePendingQueue();
  });
}

async function sendRecordingForTranslation({ blob, mimeType, recordingMs }) {
  const data = await submitRecording({
    blob,
    mimeType,
    recordingMs,
    lang1: state.lang1,
    lang2: state.lang2,
    context: buildConversationContext(),
  });
  applyTranslationResult(data);
}

async function toggleRecording() {
  if (!languagesReady()) {
    showToast('Select two languages');
    return;
  }
  if (state.isProcessing) return;

  if (state.isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    await ensureMicStream();
    state.audioChunks = [];

    const mimeType = getMimeType();
    state.mediaRecorder = mimeType
      ? new MediaRecorder(state.mediaStream, { mimeType })
      : new MediaRecorder(state.mediaStream);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    // Timeslice helps mobile browsers flush audio chunks reliably
    state.mediaRecorder.start(250);
    state.recordingStartedAt = Date.now();
    state.isRecording = true;
    mainMicBtn.classList.add('recording');
    liveTranscript.hidden = true;
    startRecordingProgress();
  } catch (err) {
    showMicHelp(err);
    releaseMic();
  }
}

async function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === 'inactive') return;

  state.isRecording = false;
  state.isProcessing = true;
  mainMicBtn.classList.remove('recording');
  mainMicBtn.classList.add('processing');
  mainMicBtn.disabled = true;
  liveTranscript.hidden = true;
  stopRecordingProgress();

  const mimeType = state.mediaRecorder.mimeType || 'audio/webm';

  await new Promise((resolve) => {
    state.mediaRecorder.onstop = () => {
      // Let the final ondataavailable fire (common mobile quirk)
      setTimeout(resolve, 120);
    };
    if (state.mediaRecorder.state === 'recording' && typeof state.mediaRecorder.requestData === 'function') {
      state.mediaRecorder.requestData();
    }
    state.mediaRecorder.stop();
  });

  cleanupRecorder();

  const blob = new Blob(state.audioChunks, { type: mimeType });
  state.audioChunks = [];

  const recordingMs = state.recordingStartedAt ? Date.now() - state.recordingStartedAt : 0;

  if (recordingMs < 450 && blob.size < 800) {
    showToast('Recording too short');
    resetMicUI();
    return;
  }

  if (blob.size < 400) {
    showToast('Could not capture audio — tap and speak again');
    resetMicUI();
    return;
  }

  if (recordingMs > MAX_RECORDING_MS) {
    showToast('Recording too long — 1 minute max');
    resetMicUI();
    return;
  }

  startProgress(estimateProcessingMs(recordingMs, blob.size));

  try {
    await sendRecordingForTranslation({ blob, mimeType, recordingMs });
    await finishProgress();
    await refreshPendingBanner();
  } catch (err) {
    if (err.retryable !== false) {
      await refreshPendingBanner();
      showToast(err.message || 'Message saved — will retry automatically');
      schedulePendingRetry(3000);
    } else {
      showToast(err.message);
    }
  } finally {
    resetMicUI();
  }
}

function cleanupRecorder() {
  state.mediaRecorder = null;
}

function releaseMic() {
  state.mediaStream?.getTracks().forEach((t) => t.stop());
  state.mediaStream = null;
  state.mediaRecorder = null;
}

function resetMicUI() {
  stopProgress();
  stopRecordingProgress();
  releaseMic();
  state.isProcessing = false;
  mainMicBtn.classList.remove('processing');
  liveTranscript.hidden = true;
  liveTranscript.textContent = '';
  progressWrap.hidden = true;
  updateProgressBar(0);
  updateMicState();
}

async function playTranslation(msg, btn) {
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';

  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio = null;
  }

  btn.classList.add('playing');
  btn.disabled = true;

  try {
    if (!msg.audioUrl) {
      try {
        await loadMessageAudio(msg);
      } catch {
        await loadMessageAudio(msg, { retry: true });
      }
    }

    if (!msg.audioUrl) throw new Error('Audio not ready — tap Listen again');

    await playAudioUrl(msg.audioUrl);
  } catch (err) {
    invalidateMessageAudio(msg);
    showToast(err.message);
  } finally {
    resetListenBtn(btn);
  }
}

function renderMessage(msg) {
  const el = document.createElement('div');
  el.className = 'message';

  el.innerHTML = `
    <div class="message-bubble">
      <div class="message-original">${escapeHtml(msg.original)}</div>
      <div class="message-translated">${escapeHtml(msg.translated)}</div>
    </div>
    <div class="message-meta">
      <span class="message-langs">${langMeta(msg.detectedLanguage, msg.targetLanguage)}</span>
      <div class="message-actions">
        <button type="button" class="icon-btn listen-btn" title="Listen">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
        </button>
        <button type="button" class="icon-btn copy-btn" title="Copy">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
      </div>
    </div>
  `;

  const listenBtn = el.querySelector('.listen-btn');
  listenBtn.addEventListener('click', () => playTranslation(msg, listenBtn));

  el.querySelector('.copy-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText(msg.translated);
    showToast('Copied!');
  });

  conversationEl.appendChild(el);
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function bindEvents() {
  mainMicBtn.addEventListener('click', toggleRecording);
  window.addEventListener('lingo:unauthorized', () => {
    if (authRequired) showAuthGate();
  });
  window.addEventListener('pagehide', releaseMic);
}

init();
