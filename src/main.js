import { createLangPicker, hideAllLangPickerCarets } from './lang-picker.js';
import { listCloneVoiceLanguageCodes, supportsClonedVoice } from './elevenlabs-languages.js';
import { headIsStable, splitSpeechText } from './speech-chunks.js';
import { createTypingCaret, measureCharCell, positionBlockCaret } from './caret-style.js';
import { CHAMELEON_LOGO_SVG } from './chameleon-logo.js';
import { $, escapeHtml } from './dom-utils.js';
import { createMicWave } from './mic-wave.js';
import { getRecordingMimeType, sleep } from './media-utils.js';
import { apiFetch, clearAuthToken, getAuthToken, getStoredUser, initAuthStorage, persistKey, readPersistedValue, revalidateSession, restoreSessionIfPossible, setStoredUser } from './auth.js';
import { mountAuthGate, openAuthGate, resetAuthGate } from './auth-gate.js';
import { initUserProfile, refreshUserSession } from './user-profile.js';
import { loadActiveProfileSlot } from './profile-active-slot.js';
import { readProfileValue, writeProfileValue } from './profile-storage.js';
import { OFFLINE_LANGUAGES, isFullLanguageList, loadLanguagesList } from './languages-service.js';
import {
  clearAllPendingRecordings,
  isRetryableSendError,
  listPendingRecordings,
  purgeStalePendingRecordings,
  removePendingRecording,
  retryDelayMs,
  savePendingRecording,
  updatePendingRecording,
} from './pending-audio.js';
import { bindKeepWarm } from './keep-warm.js';
import { registerPwa } from './pwa.js';

const STORAGE_KEY = 'lingo-languages';
const DEFAULT_LANG1 = 'en';
const DEFAULT_LANG2 = 'es';

const MAX_RECORDING_MS = 90_000;
const RECORDING_TAIL_MS = 150;
const RECORDER_STOP_FLUSH_MS = 150;

let authRequired = false;
let recordingSessionId = 0;

const state = {
  languages: [],
  lang1: DEFAULT_LANG1,
  lang2: DEFAULT_LANG2,
  messages: [],
  user: null,
  isProcessing: false,
  isRecording: false,
  stoppingRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  mediaStream: null,
  currentAudio: null,
  recordingStartedAt: 0,
  latestMessageId: null,
  draftText: '',
  composerSession: false,
};

let playbackEpoch = 0;
let activePlayback = null;
let speakChain = Promise.resolve();
let latestTranslationRequest = 0;
let lastTranslationAppliedAt = 0;
let pendingQueuePausedUntil = 0;
let activeConverseController = null;
let draftTranslationPrefetch = null;
let draftPrefetchSeq = 0;
let pendingSourceRecording = null;
let cloneVoiceLanguages = new Set(listCloneVoiceLanguageCodes());

let picker1;
let picker2;

const appEl = $('#app');
const languageBarEl = document.querySelector('.language-bar');
const currentMessageEl = $('#current-message');
const toastEl = $('#toast');
const composeBoxEl = $('#compose-box');
const composeMicBtn = $('#compose-mic');
const composeNewBtn = $('#compose-new');
const composeCopyBtn = $('#compose-copy');
const composeSpeakBtn = $('#compose-speak');
const composeLevelEl = $('#compose-level');
const recordingCancelBtn = $('#recording-cancel');
const recordingSendBtn = $('#recording-send');
const recordingSendProgressFill = $('#recording-send-progress-fill');
const dictationInputEl = $('#dictation-input');
const composeInputWrapEl = $('#compose-input-wrap');
const composeCaretEl = $('#compose-caret');
const composeLoadingDotsEl = $('#compose-loading-dots');
const dictationTranslateBtn = $('#dictation-translate');

const LOADING_DOT_MS = 500;
const LOADING_DOT_MAX = 20;
let composeLoadingActive = false;

let composeCaretMirrorEl = null;

const RECORDING_SEND_RING_R = 19;
const RECORDING_SEND_RING_CIRCUMFERENCE = 2 * Math.PI * RECORDING_SEND_RING_R;

const composeMicWave = createMicWave();

let recordingProgressRaf = null;
let pendingQueueBusy = false;
let pendingRetryTimer = null;

const COPY_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const SHARE_BTN_SVG = '<svg class="footer-share-text-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';
const PLAY_BTN_SVG = '<svg class="listen-btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_BTN_SVG = '<svg class="listen-btn-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const RESTART_PLAYBACK_BTN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';
const SHARE_AUDIO_BTN_SVG = '<svg class="footer-share-audio-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';

function prefetchAudio(msg) {
  return loadMessageAudio(msg, { prefetch: true });
}

function activeSpeakProfileSlot() {
  return loadActiveProfileSlot(state.user?.id) ?? 1;
}

function isPersonalVoiceReady() {
  if (state.user?.voiceReady) return true;
  return Boolean(getStoredUser()?.voiceReady);
}

function speakModeForLang(lang) {
  if (!lang || !isPersonalVoiceReady()) return 'default';
  if (!supportsClonedVoice(lang)) return 'default';
  return 'clone';
}

function speakModeForMessage(msg) {
  return speakModeForLang(msg.targetLanguage);
}

function syncMessageAudioCache(msg) {
  if (!msg?.translated?.trim() || !msg.targetLanguage) {
    if (msg?.audioUrl || msg?._audioPromise) invalidateMessageAudio(msg);
    return;
  }

  const key = audioCacheKey(msg);
  if (msg.audioUrl && msg._audioKey !== key) {
    invalidateMessageAudio(msg);
  } else if (msg._audioKey && msg._audioKey !== key) {
    invalidateMessageAudio(msg);
  }
}

function adoptMessageAudio(source, target) {
  if (!source || (!source.audioUrl && !source._audioPromise)) return;

  const key = audioCacheKey(target);
  if (source._audioKey && source._audioKey !== key) {
    cancelMessageAudio(source);
    return;
  }

  if (source.audioUrl) {
    target.audioUrl = source.audioUrl;
    target._audioKey = source._audioKey || key;
  }
  if (source._audioPromise) target._audioPromise = source._audioPromise;
  if (source._speakAbort) target._speakAbort = source._speakAbort;
  if (source._audioUrls) target._audioUrls = source._audioUrls;
  if (source._audioTailPromise) target._audioTailPromise = source._audioTailPromise;
  if (source._audioTailUrl) target._audioTailUrl = source._audioTailUrl;
  target._audioPartial = Boolean(source._audioPartial);
}

function syncListenBtnVoiceMode(msg) {
  const btn = getListenBtn(msg);
  if (!btn) return;
  const usesClone = speakModeForMessage(msg) === 'clone';
  btn.classList.toggle('uses-clone-voice', usesClone);
  btn.classList.toggle('uses-fallback-voice', !usesClone);
}

function audioCacheKey(msg) {
  const userId = state.user?.id || 'default';
  const slot = activeSpeakProfileSlot();
  const mode = speakModeForMessage(msg);
  return `${userId}|${slot}|${mode}|${msg.translated}|${msg.targetLanguage}`;
}

function getMessageCardEl(message) {
  return document.querySelector(`.message-card[data-message-id="${message.id}"]`);
}

function getListenBtn(message) {
  return getMessageCardEl(message)?.querySelector('.listen-btn');
}

function setListenButtonState(btn, mode) {
  if (!btn) return;

  btn.classList.remove('is-playing', 'is-paused', 'is-loading', 'playing');
  btn.disabled = false;

  if (mode === 'playing') {
    btn.classList.add('is-playing');
    btn.innerHTML = PAUSE_BTN_SVG;
    btn.title = 'Pause';
    btn.setAttribute('aria-label', 'Pause');
    return;
  }

  if (mode === 'paused') {
    btn.classList.add('is-paused');
    btn.innerHTML = PLAY_BTN_SVG;
    btn.title = 'Resume';
    btn.setAttribute('aria-label', 'Resume');
    return;
  }

  if (mode === 'loading') {
    btn.classList.add('is-loading');
    btn.innerHTML = PLAY_BTN_SVG;
    btn.title = 'Loading audio';
    btn.setAttribute('aria-label', 'Loading audio');
    return;
  }

  btn.innerHTML = PLAY_BTN_SVG;
  btn.title = 'Play';
  btn.setAttribute('aria-label', 'Play');
}

function setPlaybackRestartVisible(message, mode) {
  const card = getMessageCardEl(message);
  const restartBtn = card?.querySelector('.playback-restart-btn');
  const restartSpacer = card?.querySelector('.message-playback-side-right');
  const footer = card?.querySelector('.message-footer-actions');
  const audio = state.currentAudio;

  const showRestart = mode === 'paused'
    && activePlayback?.messageId === message.id
    && audio
    && audio.paused
    && !audio.ended
    && audio.currentTime > 0.25;

  if (restartBtn) restartBtn.hidden = !showRestart;
  if (restartSpacer) restartSpacer.hidden = !showRestart;
}

function syncPlaybackUi(message, mode) {
  setListenButtonState(getListenBtn(message), mode);
  syncListenBtnVoiceMode(message);
  setPlaybackRestartVisible(message, mode);
}

function restartActivePlayback(msg) {
  const audio = state.currentAudio;
  if (!audio || activePlayback?.messageId !== msg.id) return;

  // If playback is past the head chunk, restarting the current element would
  // only rewind the tail; reset the whole playback instead.
  if (activePlayback.part === 'tail') {
    stopPlayback();
    syncPlaybackUi(msg, 'idle');
    return;
  }

  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // ignore seek errors
  }
  syncPlaybackUi(msg, 'idle');
}

function resetActiveListenButton() {
  const latest = state.messages.at(-1);
  if (!latest) return;
  syncPlaybackUi(latest, 'idle');
}

function hideAudioActions(message) {
  const card = getMessageCardEl(message);
  const footer = card?.querySelector('.message-footer-actions');
  const playbackSlot = card?.querySelector('.message-playback-slot');
  const shareAudioBtn = card?.querySelector('.share-audio-btn');
  const listenBtn = card?.querySelector('.listen-btn');
  if (!footer) return;

  footer.classList.remove('has-audio-actions');
  footer.setAttribute('hidden', '');
  playbackSlot?.setAttribute('hidden', '');
  shareAudioBtn?.setAttribute('hidden', '');
  listenBtn?.classList.remove('is-ready');
  shareAudioBtn?.classList.remove('is-ready');
}

function revealAudioActions(message) {
  if (!message?.audioUrl) {
    hideAudioActions(message);
    return;
  }

  const card = getMessageCardEl(message);
  const footer = card?.querySelector('.message-footer-actions');
  const playbackSlot = card?.querySelector('.message-playback-slot');
  const shareAudioBtn = card?.querySelector('.share-audio-btn');
  if (!footer) return;

  footer.classList.add('has-audio-actions');
  footer.removeAttribute('hidden');
  playbackSlot?.removeAttribute('hidden');
  shareAudioBtn?.removeAttribute('hidden');
  card?.querySelector('.listen-btn')?.classList.add('is-ready');
  shareAudioBtn?.classList.add('is-ready');
}

function startBackgroundAudio(message) {
  syncMessageAudioCache(message);
  if (message.audioUrl) {
    revealAudioActions(message);
    return;
  }

  void prefetchAudio(message).finally(() => {
    if (message.id !== state.latestMessageId) return;
    if (message.audioUrl) revealAudioActions(message);
  });
}

function cancelMessageAudio(msg) {
  if (msg._speakAbort) {
    msg._speakAbort.abort();
    msg._speakAbort = null;
  }
  invalidateMessageAudio(msg);
}

function invalidateMessageAudio(msg) {
  for (const url of msg._audioUrls || []) {
    URL.revokeObjectURL(url);
  }
  msg._audioUrls = null;
  if (msg.audioUrl) {
    URL.revokeObjectURL(msg.audioUrl);
    msg.audioUrl = null;
  }
  msg._audioPromise = null;
  msg._audioTailPromise = null;
  msg._audioTailUrl = null;
  msg._audioPartial = false;
  msg._audioKey = null;
  hideAudioActions(msg);
}

function stopPlayback() {
  playbackEpoch++;
  const audio = state.currentAudio;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // ignore seek errors
    }
    audio.removeAttribute('src');
    audio.load();
    state.currentAudio = null;
  }
  activePlayback = null;
  resetActiveListenButton();
}

function prepareForNewTranslation(message) {
  stopPlayback();
  state.latestMessageId = message.id;
  for (const m of state.messages) {
    if (m.id !== message.id) {
      cancelMessageAudio(m);
    }
  }
}

function enqueueSpeak(task) {
  const run = speakChain.then(task, task);
  speakChain = run.catch(() => {});
  return run;
}

function withTimeout(promise, ms, message, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function converseTimeoutMs(recordingMs, blobBytes) {
  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 12000, 1);
  return Math.min(240000, Math.max(90000, audioSeconds * 2500 + 45000));
}

function abortActiveConverse() {
  if (activeConverseController) {
    activeConverseController.abort();
    activeConverseController = null;
  }
}

function cancelDraftTranslationPrefetch() {
  if (!draftTranslationPrefetch) return;
  draftTranslationPrefetch.controller?.abort();
  if (draftTranslationPrefetch.hiddenMessage) {
    cancelMessageAudio(draftTranslationPrefetch.hiddenMessage);
  }
  draftTranslationPrefetch = null;
}

function releaseDraftTranslationPrefetch() {
  draftTranslationPrefetch = null;
}

function syncDraftTranslationPrefetch() {
  const text = getDraftText();
  if (!draftTranslationPrefetch) return;
  if (text === draftTranslationPrefetch.sourceText) return;
  cancelDraftTranslationPrefetch();
}

function startDraftTranslationPrefetch(text) {
  const sourceText = String(text ?? '').trim();
  if (!sourceText || !languagesReady()) return;
  if (state.isProcessing) return;

  cancelDraftTranslationPrefetch();

  const controller = new AbortController();
  const prefetchRequestId = ++draftPrefetchSeq;
  const entry = {
    sourceText,
    prefetchRequestId,
    controller,
    result: null,
    error: null,
    hiddenMessage: {
      id: `prefetch-${prefetchRequestId}`,
      translated: '',
      targetLanguage: null,
      audioUrl: null,
    },
    promise: null,
  };
  draftTranslationPrefetch = entry;

  entry.promise = runDraftTranslationPrefetch(entry).catch((err) => {
    if (err?.name !== 'AbortError') entry.error = err;
    return null;
  });
}

async function runDraftTranslationPrefetch(entry) {
  if (draftTranslationPrefetch !== entry) return null;

  const data = await sendTextForTranslation({
    text: entry.sourceText,
    signal: entry.controller.signal,
    requestId: entry.prefetchRequestId,
    mode: 'prefetch',
    prefetchRef: entry,
  });

  if (draftTranslationPrefetch === entry && data?.translatedText?.trim()) {
    entry.result = data;
  }
  return data;
}

function kickoffPrefetchAudio(prefetchRef, doneData) {
  if (!doneData?.translatedText?.trim() || !prefetchRef?.hiddenMessage) return;
  const msg = prefetchRef.hiddenMessage;
  msg.translated = doneData.translatedText;
  msg.targetLanguage = doneData.targetLanguage;
  void prefetchAudio(msg);
}

const SPEAK_ERR_MSG = 'Audio not ready — tap Listen again';

function trackMessageAudioUrl(msg, url) {
  if (!msg._audioUrls) msg._audioUrls = [];
  msg._audioUrls.push(url);
  return url;
}

// Audio blobs fetched mid-stream, before the message object is finalized.
const speakBlobPrefetch = new Map();

function speakPrefetchKey(text, lang, mode, slot) {
  return `${text}|${lang}|${mode}|${slot}`;
}

// Fires as soon as enough of the translation has streamed to lock in the
// first audio chunk, so the sound is often already downloaded by the time
// the translation finishes.
function prefetchHeadAudioMidStream(message) {
  if (message._headPrefetched) return;
  const lang = message._expectedTarget;
  if (!lang) return;
  if (!headIsStable(message.translated)) return;

  const { head } = splitSpeechText(message.translated);
  message._headPrefetched = true;
  const mode = speakModeForLang(lang);
  const slot = activeSpeakProfileSlot();
  const key = speakPrefetchKey(head, lang, mode, slot);
  if (speakBlobPrefetch.has(key)) return;

  // Only one translation streams at a time; drop any stale entry.
  speakBlobPrefetch.clear();

  const controller = new AbortController();
  speakBlobPrefetch.set(
    key,
    fetchSpeakBlob({ targetLanguage: lang }, head, controller, { attempts: 1 })
      .catch((err) => {
        speakBlobPrefetch.delete(key);
        throw err;
      }),
  );
}

async function fetchSpeakBlob(msg, text, controller, { attempts = 2 } = {}) {
  const lang = msg.targetLanguage;
  const mode = speakModeForMessage(msg);
  const slot = activeSpeakProfileSlot();

  const prefetched = speakBlobPrefetch.get(speakPrefetchKey(text, lang, mode, slot));
  if (prefetched) {
    try {
      return await prefetched;
    } catch {
      // fall through to a fresh fetch
    }
  }

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const res = await apiFetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          lang,
          voiceMode: mode,
          slot,
        }),
        signal: controller.signal,
      });

      let message = SPEAK_ERR_MSG;
      if (!res.ok) {
        try {
          const data = await res.json();
          message = data.error || SPEAK_ERR_MSG;
        } catch {
          if (res.status === 429) message = 'Too many audio requests — wait a moment';
        }
        throw new Error(message);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('audio')) {
        throw new Error(SPEAK_ERR_MSG);
      }

      const blob = await res.blob();
      if (!blob.size) throw new Error(SPEAK_ERR_MSG);
      return blob;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw lastError || new Error(SPEAK_ERR_MSG);
}

// Fetches the remainder of a chunked message in the background. When it
// lands, future plays get the combined audio; an in-progress playback of the
// head chunk chains into the tail via msg._audioTailUrl.
function startTailAudioFetch(msg, key, headBlob, tailText, controller) {
  msg._audioTailPromise = (async () => {
    const tailBlob = await fetchSpeakBlob(msg, tailText, controller, { attempts: 2 });
    if (controller.signal.aborted || msg._audioKey !== key) return;

    msg._audioTailUrl = trackMessageAudioUrl(msg, URL.createObjectURL(tailBlob));
    const fullBlob = new Blob([headBlob, tailBlob], { type: 'audio/mpeg' });
    msg.audioUrl = trackMessageAudioUrl(msg, URL.createObjectURL(fullBlob));
    msg._audioPartial = false;
    msg._speakAbort = null;
  })().catch((err) => {
    msg._audioTailPromise = null;
    if (err?.name !== 'AbortError') {
      console.warn('Tail audio fetch failed:', err?.message || err);
    }
  });
}

async function loadMessageAudio(msg, { prefetch = false } = {}) {
  syncMessageAudioCache(msg);
  const key = audioCacheKey(msg);
  if (msg._audioKey && msg._audioKey !== key) {
    invalidateMessageAudio(msg);
  }
  msg._audioKey = key;

  if (msg.audioUrl) return;

  if (msg._audioPromise) {
    try {
      await msg._audioPromise;
    } catch {
      // handled below
    }
    if (msg.audioUrl) return;
  }

  const messageId = msg.id;

  msg._audioPromise = enqueueSpeak(async () => {
    if (prefetch && state.latestMessageId && messageId !== state.latestMessageId) return;

    if (msg._speakAbort) {
      msg._speakAbort.abort();
      msg._speakAbort = null;
    }
    const controller = new AbortController();
    msg._speakAbort = controller;

    // Generate the first sentence/clause on its own so playback can start
    // while the rest of the audio is still being synthesized.
    const { head, tail } = splitSpeechText(msg.translated);

    let headBlob;
    try {
      headBlob = await fetchSpeakBlob(msg, head, controller);
    } catch (err) {
      if (err?.name !== 'AbortError') invalidateMessageAudio(msg);
      msg._speakAbort = null;
      throw err;
    }
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    msg.audioUrl = trackMessageAudioUrl(msg, URL.createObjectURL(headBlob));
    msg._audioPartial = Boolean(tail);

    if (tail) {
      startTailAudioFetch(msg, key, headBlob, tail, controller);
    } else {
      msg._speakAbort = null;
    }

    if (messageId === state.latestMessageId) revealAudioActions(msg);
  });

  try {
    await withTimeout(msg._audioPromise, 40000, 'Audio timed out — tap Listen again');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      invalidateMessageAudio(msg);
      if (!prefetch) throw err;
    }
  } finally {
    if (prefetch && state.latestMessageId && messageId !== state.latestMessageId) {
      cancelMessageAudio(msg);
    }
  }
}

function waitForAudioReady(audio, ms = 4000) {
  if (audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onErr = () => {
      cleanup();
      reject(new Error('Playback failed'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('error', onErr);
    };

    audio.addEventListener('loadeddata', onReady, { once: true });
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('error', onErr, { once: true });
  });
}

function createPlaybackAudio(url) {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.playsInline = true;
  audio.setAttribute('playsinline', '');
  audio.volume = 1;
  audio.src = url;
  return audio;
}

async function toggleTranslationAudio(msg, btn) {
  acknowledgeActionButton(btn);
  if (btn?.dataset.busy === '1') return;

  const audio = state.currentAudio;
  const sameMessage = activePlayback?.messageId === msg.id;

  if (sameMessage && audio && !audio.ended) {
    if (!audio.paused) {
      audio.pause();
      syncPlaybackUi(msg, 'paused');
      return;
    }

    try {
      syncPlaybackUi(msg, 'playing');
      await audio.play();
    } catch (err) {
      showToast(err?.message || 'Playback failed');
      syncPlaybackUi(msg, 'paused');
    }
    return;
  }

  await beginTranslationPlayback(msg, btn);
}

function finishPlayback(msg, epoch) {
  if (epoch !== playbackEpoch) return;
  state.currentAudio = null;
  activePlayback = null;
  syncPlaybackUi(msg, 'idle');
}

async function playPlaybackPart(msg, url, epoch, part) {
  const audio = createPlaybackAudio(url);
  state.currentAudio = audio;
  activePlayback = { messageId: msg.id, part };

  audio.onended = () => {
    if (epoch !== playbackEpoch) return;
    if (part === 'head') {
      void continueWithTailAudio(msg, epoch);
      return;
    }
    finishPlayback(msg, epoch);
  };
  audio.onerror = () => {
    if (epoch !== playbackEpoch) return;
    finishPlayback(msg, epoch);
    showToast('Playback failed');
  };

  await waitForAudioReady(audio);
  if (epoch !== playbackEpoch) return;

  syncPlaybackUi(msg, 'playing');
  await audio.play();
}

// The head chunk just finished: keep going with the rest of the audio,
// waiting for its background fetch if it has not landed yet.
async function continueWithTailAudio(msg, epoch) {
  try {
    if (!msg._audioTailUrl && msg._audioTailPromise) {
      syncPlaybackUi(msg, 'loading');
      await withTimeout(msg._audioTailPromise, 30000, 'Audio timed out — tap Listen again');
    }
    if (epoch !== playbackEpoch) return;
    if (!msg._audioTailUrl) {
      finishPlayback(msg, epoch);
      return;
    }
    await playPlaybackPart(msg, msg._audioTailUrl, epoch, 'tail');
  } catch (err) {
    if (epoch !== playbackEpoch) return;
    finishPlayback(msg, epoch);
    if (err?.name !== 'AbortError') {
      showToast(err?.message || 'Playback failed');
    }
  }
}

async function beginTranslationPlayback(msg, btn) {
  if (btn) btn.dataset.busy = '1';
  stopPlayback();
  syncPlaybackUi(msg, 'loading');

  try {
    syncMessageAudioCache(msg);
    if (!msg.audioUrl) {
      await loadMessageAudio(msg);
    }
    if (!msg.audioUrl) throw new Error('Audio not ready — tap Play again');
    revealAudioActions(msg);

    playbackEpoch++;
    const epoch = playbackEpoch;
    const part = msg._audioPartial ? 'head' : 'full';
    await playPlaybackPart(msg, msg.audioUrl, epoch, part);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showToast(err?.message || 'Playback failed');
    }
    state.currentAudio = null;
    activePlayback = null;
    syncPlaybackUi(msg, 'idle');
  } finally {
    if (btn) delete btn.dataset.busy;
    releaseActionButtonFocus(btn);
  }
}

function releaseActionButtonFocus(btn) {
  btn?.blur();
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
}

function acknowledgeActionButton(btn) {
  if (!btn) return;
  btn.classList.remove('is-action-ack');
  void btn.offsetWidth;
  btn.classList.add('is-action-ack');
  const done = () => {
    btn.classList.remove('is-action-ack');
    btn.removeEventListener('animationend', done);
  };
  btn.addEventListener('animationend', done);
}

async function shareTranslation(text, btn) {
  acknowledgeActionButton(btn);
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
  } catch (err) {
    if (err?.name === 'AbortError') return;
    showToast('Could not share');
  } finally {
    releaseActionButtonFocus(btn);
  }
}

async function init() {
  $('#auth-logo').innerHTML = CHAMELEON_LOGO_SVG;

  await initAuthStorage();

  const online = await checkHealth();
  if (!online) {
    showToast('Offline — using saved session');
  }

  bindKeepWarm();

  const authed = await ensureAuthenticated();
  if (!authed) return;

  await loadLanguages();
  initPickers();
  void ensureLanguagesLoaded();
  bindEvents();
  bindMicHelp();
  bindPendingQueue();
  bindDictation();
  checkMicSupport();
  if (recordingSendProgressFill) {
    recordingSendProgressFill.style.strokeDasharray = String(RECORDING_SEND_RING_CIRCUMFERENCE);
    recordingSendProgressFill.style.strokeDashoffset = String(RECORDING_SEND_RING_CIRCUMFERENCE);
  }
  resizeDictationInput();
  updateComposeState();
  scheduleComposeFocus();
  initUserProfile($('#user-profile-slot'), {
    showToast,
    onChange: (user) => {
      state.user = user;
      for (const msg of state.messages) {
        syncMessageAudioCache(msg);
        syncListenBtnVoiceMode(msg);
      }
      const latest = state.messages.at(-1);
      if (latest) syncListenBtnVoiceMode(latest);
    },
  });
  void refreshUserSession();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncLanguageStateFromStorage();
    }
  });
  void purgeStalePendingRecordings();
  void refreshPendingBanner();
  wakePendingQueue();
}

async function ensureAuthenticated() {
  if (!authRequired) return true;

  const user = await restoreSessionIfPossible();
  if (user) {
    state.user = user;
    return true;
  }

  clearAuthToken();
  return showAuthGate();
}

let authGateMounted = false;

function showAuthGate() {
  const gate = $('#auth-gate');
  if (!gate) return Promise.resolve(false);

  if (!authGateMounted) {
    mountAuthGate({
      gate,
      onSuccess: async (user) => {
        if (user) state.user = user;
        await refreshUserSession();
      },
      onUnauthorized: () => {
        resetAuthGate(gate);
        openAuthGate(gate);
      },
    });
    authGateMounted = true;
  }

  resetAuthGate(gate);
  openAuthGate(gate);

  return new Promise((resolve) => {
    const onUnauthorized = () => {
      openAuthGate(gate);
      const errorEl = $('#auth-error', gate);
      if (errorEl) {
        errorEl.textContent = 'Session expired — enter your recovery phrase again';
        errorEl.hidden = false;
      }
      resolve(false);
    };

    window.addEventListener('lingo:unauthorized', onUnauthorized, { once: true });

    const observer = new MutationObserver(() => {
      if (gate.hidden) {
        observer.disconnect();
        window.removeEventListener('lingo:unauthorized', onUnauthorized);
        resolve(Boolean(getAuthToken()));
      }
    });
    observer.observe(gate, { attributes: true, attributeFilter: ['hidden'] });
  });
}

async function loadLanguages() {
  state.languages = await loadLanguagesList();
  syncPickerLanguages();
}

function initPickers() {
  restoreSavedLanguages();

  picker1 = createLangPicker($('#lang-picker-1'), {
    languages: state.languages,
    value: state.lang1,
    circle: true,
    inBar: true,
    placeholder: '',
    onFocusEdit: syncComposeCaret,
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
    circle: true,
    inBar: true,
    placeholder: '',
    onFocusEdit: syncComposeCaret,
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

  saveLanguages();
}

function loadSavedLanguages() {
  try {
    const raw = readProfileValue(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isKnownLanguage(code) {
  return Boolean(code && state.languages.some((lang) => lang.code === code));
}

function languagePairKey(lang1, lang2) {
  return [lang1, lang2].sort().join('\0');
}

function syncLanguageStateFromPickers() {
  const lang1 = picker1?.getValue() || state.lang1;
  const lang2 = picker2?.getValue() || state.lang2;
  if (lang1 && lang2 && lang1 !== lang2) {
    state.lang1 = lang1;
    state.lang2 = lang2;
  }
}

function restoreSavedLanguages() {
  const saved = loadSavedLanguages();
  if (!saved?.lang1 || !saved?.lang2 || saved.lang1 === saved.lang2) return false;

  if (isKnownLanguage(saved.lang1) && isKnownLanguage(saved.lang2)) {
    state.lang1 = saved.lang1;
    state.lang2 = saved.lang2;
    return true;
  }

  // Language list may still be the offline fallback — trust saved pair anyway.
  if (state.languages.length <= OFFLINE_LANGUAGES.length) {
    state.lang1 = saved.lang1;
    state.lang2 = saved.lang2;
    return true;
  }

  return false;
}

async function ensureLanguagesLoaded() {
  if (isFullLanguageList(state.languages)) {
    syncPickerLanguages();
    return;
  }

  state.languages = await loadLanguagesList();
  syncPickerLanguages();
  restoreSavedLanguages();
  picker1?.setValue(state.lang1);
  picker2?.setValue(state.lang2);
}

function syncPickerLanguages() {
  picker1?.setLanguages(state.languages);
  picker2?.setLanguages(state.languages);
}

function syncLanguageStateFromStorage() {
  if (!state.languages.length) return;
  void ensureLanguagesLoaded();
  const prevKey = languagePairKey(state.lang1, state.lang2);
  syncLanguageStateFromPickers();
  restoreSavedLanguages();
  picker1?.setValue(state.lang1);
  picker2?.setValue(state.lang2);
  const nextKey = languagePairKey(state.lang1, state.lang2);
  if (prevKey !== nextKey) {
    cancelDraftTranslationPrefetch();
  }
}

function getLanguagePair() {
  syncLanguageStateFromPickers();
  restoreSavedLanguages();
  return { lang1: state.lang1, lang2: state.lang2 };
}

function saveLanguages() {
  writeProfileValue(STORAGE_KEY, JSON.stringify({ lang1: state.lang1, lang2: state.lang2 }));
}

function clearConversation() {
  state.messages = [];
  currentMessageEl.innerHTML = '';
}

function onLanguagesChanged() {
  cancelDraftTranslationPrefetch();
  clearConversation();
  saveLanguages();
  void clearAllPendingRecordings();
  updateComposeState();
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

function isRecordingUiActive() {
  return composeBoxEl?.classList.contains('is-recording');
}

function setRecordingUI(active) {
  composeBoxEl?.classList.toggle('is-recording', Boolean(active));
  if (active) {
    requestAnimationFrame(() => {
      ensureComposeLevelBars(true);
      observeComposeWaveResize();
    });
  } else {
    composeMicWave.unobserveWaveResize();
  }
}

function ensureComposeLevelBars(force = false) {
  const toolbar = composeLevelEl?.closest('.compose-toolbar');
  composeMicWave.ensureLevelBars(composeLevelEl, toolbar, force);
}

function observeComposeWaveResize() {
  const toolbar = composeLevelEl?.closest('.compose-toolbar');
  composeMicWave.observeWaveResize(composeLevelEl, toolbar, () => state.isRecording);
}

function applyMicVoicePulse() {
  const toolbar = composeLevelEl?.closest('.compose-toolbar');
  composeMicWave.applyMicVoicePulse(composeLevelEl, toolbar);
}

function clearMicVoicePulse() {
  composeMicWave.clearMicVoicePulse();
}

function teardownMicMeter() {
  composeMicWave.teardownMicMeter();
}

function prepareMicMeter(stream) {
  composeMicWave.prepareMicMeter(stream);
}

function primeMicAudioOnGesture() {
  composeMicWave.primeMicAudioOnGesture();
}

function updateComposeState() {
  const ready = languagesReady();
  const recordingUi = isRecordingUiActive();
  const busy = recordingUi || state.isRecording || state.isProcessing || state.stoppingRecording || composeLoadingActive;
  const hasText = Boolean(getDraftText());
  const canUseDraftActions = hasText && !busy;

  composeMicBtn.disabled = !ready || busy;
  composeNewBtn.hidden = !canUseDraftActions;
  composeNewBtn.disabled = !canUseDraftActions;
  if (composeCopyBtn) {
    composeCopyBtn.hidden = !canUseDraftActions;
    composeCopyBtn.disabled = !canUseDraftActions;
  }
  if (composeSpeakBtn) {
    composeSpeakBtn.hidden = !canUseDraftActions;
    composeSpeakBtn.disabled = !canUseDraftActions || draftSpeechBusy;
  }
  dictationTranslateBtn.hidden = !canUseDraftActions;
  dictationTranslateBtn.disabled = !canUseDraftActions;
  dictationTranslateBtn.classList.toggle('is-ready', canUseDraftActions);
  recordingCancelBtn.disabled = state.stoppingRecording;
  recordingSendBtn.disabled = !state.isRecording || state.stoppingRecording;
  dictationInputEl.disabled = recordingUi || state.isRecording || state.isProcessing;
  syncComposeCaret();
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    authRequired = Boolean(data.authRequired);
    if (Array.isArray(data.cloneVoiceLanguages) && data.cloneVoiceLanguages.length) {
      cloneVoiceLanguages = new Set(data.cloneVoiceLanguages);
    }
    void persistKey('lingo-auth-required', authRequired ? '1' : '0');
    return true;
  } catch {
    authRequired = readPersistedValue('lingo-auth-required') !== '0';
    return false;
  }
}

function checkMicSupport() {
  if (!navigator.mediaDevices?.getUserMedia) {
    composeMicBtn.disabled = true;
    showToast('Microphone not supported');
  }
}

function resizeDictationInput() {
  if (!dictationInputEl) return;
  dictationInputEl.style.height = 'auto';
  dictationInputEl.style.height = `${dictationInputEl.scrollHeight}px`;
  syncComposeCaret();
}

let composeCaretTyping = null;

function getComposeCaretTyping() {
  if (!composeCaretTyping && composeCaretEl) {
    composeCaretTyping = createTypingCaret(composeCaretEl);
  }
  return composeCaretTyping;
}

function pulseComposeCaretTyping() {
  getComposeCaretTyping()?.pulse();
}

function ensureComposeCaretMirror() {
  if (composeCaretMirrorEl || !composeInputWrapEl) return composeCaretMirrorEl;
  composeCaretMirrorEl = document.createElement('div');
  composeCaretMirrorEl.className = 'compose-caret-mirror';
  composeCaretMirrorEl.setAttribute('aria-hidden', 'true');
  composeInputWrapEl.appendChild(composeCaretMirrorEl);
  return composeCaretMirrorEl;
}

function syncMirrorStyles(mirror, ta, style) {
  // Use the fractional width: clientWidth rounds down to whole pixels, which
  // can make the mirror wrap a word one line later than the real textarea on
  // mobile, leaving the fake caret on the previous line while typed letters
  // continue below.
  mirror.style.width = `${ta.getBoundingClientRect().width}px`;
  mirror.style.font = style.font;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.boxSizing = style.boxSizing;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.wordBreak = style.wordBreak;
}

function syncComposeCaret() {
  const wrap = composeInputWrapEl;
  const ta = dictationInputEl;
  const caret = composeCaretEl;
  if (!wrap || !ta || !caret) return;

  const recording = isRecordingUiActive() || state.isRecording || state.isProcessing;
  const focused = document.activeElement === ta;

  if (recording || ta.disabled || !focused || composeLoadingActive) {
    caret.hidden = true;
    getComposeCaretTyping()?.reset();
    return;
  }

  caret.hidden = false;

  const mirror = ensureComposeCaretMirror();
  const style = getComputedStyle(ta);
  syncMirrorStyles(mirror, ta, style);

  const caretPos = focused ? (ta.selectionStart ?? ta.value.length) : ta.value.length;
  const textBefore = ta.value.slice(0, caretPos);
  const textAfter = ta.value.slice(caretPos);

  mirror.replaceChildren();
  mirror.append(document.createTextNode(textBefore));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);
  if (textAfter) mirror.append(document.createTextNode(textAfter));

  const markerRect = marker.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const { charWidth, lineHeight } = measureCharCell(mirror, style);

  positionBlockCaret(caret, {
    left: markerRect.left - wrapRect.left,
    top: markerRect.top - wrapRect.top + ta.scrollTop,
    charWidth,
    lineHeight,
    markerHeight: markerRect.height,
  });
}

function shouldRefocusComposeInput(next) {
  if (!next) return true;
  if (next === dictationInputEl) return false;
  if (next.closest?.('button, .lang-picker, #auth-gate, .user-profile, select, input, textarea, a')) return false;
  return true;
}

function focusComposeInput({ moveCaretToEnd = false } = {}) {
  if (!dictationInputEl || state.isRecording || state.isProcessing || dictationInputEl.disabled) return;
  dictationInputEl.focus({ preventScroll: true });
  if (moveCaretToEnd) {
    const pos = dictationInputEl.value.length;
    dictationInputEl.setSelectionRange(pos, pos);
  }
  syncComposeCaret();
}

function scheduleComposeFocus({ moveCaretToEnd = false } = {}) {
  syncComposeCaret();
  const run = () => focusComposeInput({ moveCaretToEnd });
  requestAnimationFrame(run);
  if (moveCaretToEnd) {
    window.setTimeout(run, 80);
  }
}

function enterComposerSession() {
  if (state.composerSession) return;
  state.composerSession = true;
  appEl?.classList.add('session-active');
  requestAnimationFrame(() => {
    languageBarEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function showDraftPanel(text) {
  const value = String(text ?? '').trim();
  state.draftText = value;
  dictationInputEl.value = value;
  if (!state.composerSession) enterComposerSession();
  resizeDictationInput();
  updateComposeState();
}

function appendToDraft(text, { prefetch = true } = {}) {
  const addition = String(text ?? '').trim();
  if (!addition) return;
  const current = dictationInputEl.value.trim();
  const combined = current ? `${current} ${addition}` : addition;
  showDraftPanel(combined);
  if (!dictationInputEl.value.endsWith(' ')) {
    dictationInputEl.value += ' ';
    state.draftText = dictationInputEl.value;
    resizeDictationInput();
  }
  if (prefetch) startDraftTranslationPrefetch(getDraftText());
  scheduleComposeFocus({ moveCaretToEnd: true });
}

function clearPendingSourceRecording() {
  pendingSourceRecording = null;
}

function clearDraftText() {
  cancelDraftTranslationPrefetch();
  clearPendingSourceRecording();
  emptyDraftFields();
}

function emptyDraftFields() {
  state.draftText = '';
  dictationInputEl.value = '';
  resizeDictationInput();
  updateComposeState();
  scheduleComposeFocus();
}

function getDraftText() {
  return dictationInputEl.value.trim() || state.draftText.trim();
}

let draftSpeechBusy = false;
let draftSpeechAudio = null;

function stopDraftSpeech() {
  if (draftSpeechAudio) {
    draftSpeechAudio.pause();
    draftSpeechAudio.src = '';
    draftSpeechAudio = null;
  }
  composeSpeakBtn?.classList.remove('is-playing');
}

async function speakDraftAloud() {
  const text = getDraftText();
  if (!text || draftSpeechBusy) return;

  if (draftSpeechAudio && !draftSpeechAudio.paused) {
    stopDraftSpeech();
    return;
  }

  draftSpeechBusy = true;
  composeSpeakBtn?.classList.add('is-loading');
  updateComposeState();

  try {
    const res = await apiFetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        slot: activeSpeakProfileSlot(),
      }),
    });

    if (!res.ok) {
      let message = 'Could not generate audio';
      try {
        const data = await res.json();
        message = data.error || message;
      } catch {
        if (res.status === 429) message = 'Too many audio requests — wait a moment';
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    if (!blob.size) throw new Error('Could not generate audio');

    stopPlayback();
    stopDraftSpeech();

    const url = URL.createObjectURL(blob);
    const audio = createPlaybackAudio(url);
    draftSpeechAudio = audio;
    composeSpeakBtn?.classList.add('is-playing');

    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (draftSpeechAudio === audio) {
        draftSpeechAudio = null;
        composeSpeakBtn?.classList.remove('is-playing');
      }
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;

    await audio.play();
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showToast(err?.message || 'Could not speak message');
    }
    stopDraftSpeech();
  } finally {
    draftSpeechBusy = false;
    composeSpeakBtn?.classList.remove('is-loading');
    updateComposeState();
    releaseActionButtonFocus(composeSpeakBtn);
  }
}

async function copyDraftText(btn) {
  const text = getDraftText();
  if (!text) return;
  acknowledgeActionButton(btn);
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied as text');
  } catch {
    showToast('Could not copy');
  } finally {
    releaseActionButtonFocus(btn);
  }
}

function bindDictation() {
  dictationInputEl.addEventListener('input', () => {
    state.draftText = dictationInputEl.value;
    syncDraftTranslationPrefetch();
    resizeDictationInput();
    updateComposeState();
    pulseComposeCaretTyping();
  });
  dictationInputEl.addEventListener('focus', () => {
    hideAllLangPickerCarets();
    syncComposeCaret();
  });
  dictationInputEl.addEventListener('blur', syncComposeCaret);
  dictationInputEl.addEventListener('blur', (e) => {
    if (shouldRefocusComposeInput(e.relatedTarget)) {
      requestAnimationFrame(() => focusComposeInput());
      return;
    }
    requestAnimationFrame(syncComposeCaret);
  });
  dictationInputEl.addEventListener('keydown', pulseComposeCaretTyping);
  dictationInputEl.addEventListener('keyup', syncComposeCaret);
  dictationInputEl.addEventListener('click', () => {
    pulseComposeCaretTyping();
    syncComposeCaret();
  });
  dictationInputEl.addEventListener('touchend', () => {
    requestAnimationFrame(syncComposeCaret);
  }, { passive: true });
  dictationInputEl.addEventListener('scroll', () => {
    syncComposeCaret();
    syncComposeLoadingDots();
  }, { passive: true });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === dictationInputEl) syncComposeCaret();
  });
  composeBoxEl?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (e.target === dictationInputEl) return;
    focusComposeInput();
  });
  dictationTranslateBtn.addEventListener('click', () => {
    void translateDraft();
  });
  composeNewBtn.addEventListener('click', () => {
    stopDraftSpeech();
    clearDraftText();
  });
  composeCopyBtn?.addEventListener('click', () => {
    void copyDraftText(composeCopyBtn);
  });
  composeSpeakBtn?.addEventListener('click', () => {
    acknowledgeActionButton(composeSpeakBtn);
    void speakDraftAloud();
  });
  window.addEventListener('resize', () => {
    resizeDictationInput();
    syncComposeCaret();
    syncComposeLoadingDots();
  }, { passive: true });
}

async function translateDraft() {
  const text = getDraftText();
  if (!text) {
    showToast('Enter or dictate something first');
    return;
  }
  if (state.isProcessing || state.isRecording || state.stoppingRecording) return;

  stopDraftSpeech();
  abortActiveConverse();
  const controller = new AbortController();
  activeConverseController = controller;
  const requestId = ++latestTranslationRequest;
  const prefetch = draftTranslationPrefetch;
  const matchesPrefetch = prefetch?.sourceText === text;

  state.isProcessing = true;
  updateComposeState();

  try {
    if (matchesPrefetch && prefetch.result) {
      await applyTranslationResult(prefetch.result, { requestId, prefetchEntry: prefetch });
      releaseDraftTranslationPrefetch();
      emptyDraftFields();
      return;
    }

    beginTranslationPanel(text, requestId);

    if (matchesPrefetch && prefetch.promise) {
      const data = await prefetch.promise;
      if (getDraftText() !== text) {
        throw new Error('Message changed');
      }
      if (data?.translatedText?.trim()) {
        await applyTranslationResult(data, { requestId, prefetchEntry: prefetch });
        releaseDraftTranslationPrefetch();
        emptyDraftFields();
        return;
      }
    }

    cancelDraftTranslationPrefetch();
    await sendTextForTranslation({ text, signal: controller.signal, requestId });
    releaseDraftTranslationPrefetch();
    emptyDraftFields();
  } catch (err) {
    if (err?.name === 'AbortError') return;
    stopLoadingDots();
    state.messages = [];
    renderConversation();
    showDraftPanel(text);
    showToast(err.message || 'Translation failed');
  } finally {
    stopLoadingDots();
    if (activeConverseController === controller) {
      activeConverseController = null;
    }
    resetMicUI();
  }
}

async function sendTextForTranslation({ text, signal, requestId, mode = 'active', prefetchRef }) {
  const { lang1, lang2 } = getLanguagePair();
  let res;
  try {
    res = await withTimeout(
      apiFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          lang1,
          lang2,
          context: buildConversationContext(),
          slot: activeSpeakProfileSlot(),
        }),
        signal,
      }),
      60000,
      'Request timed out',
      () => {},
    );
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const error = new Error(err.message || 'Cannot connect to server');
    error.retryable = true;
    throw error;
  }

  if (res.status === 401) {
    const error = new Error('Session expired — enter the access code again');
    error.retryable = true;
    throw error;
  }

  let data = {};
  if (!res.ok) {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    const error = new Error(data.error || 'Processing failed');
    error.retryable = isRetryableSendError(error, res);
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('ndjson')) {
    throw new Error('Unexpected server response');
  }

  data = await consumeConverseStream(res, { requestId, signal, mode, prefetchRef });
  if (!data.translatedText?.trim()) {
    throw new Error('Could not translate');
  }

  if (mode === 'prefetch') {
    return data;
  }

  if (requestId !== latestTranslationRequest) return;
  await applyTranslationResult(data, { requestId });
}

async function fetchTranscriptFromAudio({ blob, mimeType }) {
  const { lang1, lang2 } = getLanguagePair();
  const form = new FormData();
  form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('lang1', lang1);
  form.append('lang2', lang2);

  const timeoutMs = Math.min(90000, Math.max(15000, 12000 + (blob?.size || 0) / 8));

  const res = await withTimeout(
    apiFetch('/api/transcribe', {
      method: 'POST',
      body: form,
    }),
    timeoutMs,
    'Transcription timed out',
    () => {},
  );

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (res.status === 401) {
    throw new Error('Session expired — sign in again and resend');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Could not transcribe audio');
  }

  return data.rawText?.trim() || '';
}

// If a warmed-up mic stream is not used by a recording within this window
// (e.g. the tap turned into a scroll and the click never fired), close it so
// the phone's "microphone in use" indicator does not stay on.
const MIC_WARM_RELEASE_MS = 8000;
let micWarmReleaseTimer = null;

function scheduleWarmMicRelease() {
  clearTimeout(micWarmReleaseTimer);
  micWarmReleaseTimer = setTimeout(() => {
    micWarmReleaseTimer = null;
    if (state.isRecording || state.stoppingRecording || isRecordingUiActive()) return;
    teardownMicMeter();
    releaseMicTracks();
  }, MIC_WARM_RELEASE_MS);
}

function cancelWarmMicRelease() {
  clearTimeout(micWarmReleaseTimer);
  micWarmReleaseTimer = null;
}

function warmMicForRecording() {
  if (!languagesReady() || state.isProcessing || state.isRecording || state.stoppingRecording) return;
  primeMicAudioOnGesture();
  void ensureMicStream()
    .then(() => scheduleWarmMicRelease())
    .catch(() => {});
}

async function ensureMicStream() {
  if (state.mediaStream?.active) return state.mediaStream;

  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  return state.mediaStream;
}

function estimateProcessingMs(recordingMs, blobBytes) {
  const MIN_MS = 2500;
  const MAX_MS = 7500;

  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 11000, 0.5);

  const t = Math.min(audioSeconds / 20, 1);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

function estimateTranscribeMs(recordingMs, blobBytes) {
  const MIN_MS = 1000;
  const MAX_MS = 3500;
  const audioSeconds = Math.max(recordingMs / 1000, blobBytes / 14000, 0.4);
  const t = Math.min(audioSeconds / 12, 1);
  return Math.round(MIN_MS + t * (MAX_MS - MIN_MS));
}

function loadingDotCapFromMs(ms) {
  return Math.min(LOADING_DOT_MAX, Math.max(4, Math.ceil(ms / LOADING_DOT_MS)));
}

function cancelRecordingProgressRaf() {
  if (recordingProgressRaf) cancelAnimationFrame(recordingProgressRaf);
  recordingProgressRaf = null;
}

function resetRecordingSendProgress() {
  if (!recordingSendProgressFill) return;
  recordingSendProgressFill.style.strokeDashoffset = String(RECORDING_SEND_RING_CIRCUMFERENCE);
}

function updateRecordingSendProgress(pct) {
  if (!recordingSendProgressFill) return;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = RECORDING_SEND_RING_CIRCUMFERENCE * (1 - clamped / 100);
  recordingSendProgressFill.style.strokeDashoffset = String(offset);
}

function stopRecordingProgress() {
  cancelRecordingProgressRaf();
  clearMicVoicePulse();
  resetRecordingSendProgress();
}

async function startRecordingProgress() {
  cancelRecordingProgressRaf();
  updateRecordingSendProgress(0);

  const tick = () => {
    if (!state.isRecording) return;

    applyMicVoicePulse();

    const elapsed = Date.now() - state.recordingStartedAt;
    const pct = (elapsed / MAX_RECORDING_MS) * 100;
    updateRecordingSendProgress(pct);

    if (elapsed >= MAX_RECORDING_MS) {
      updateRecordingSendProgress(100);
      cancelRecordingProgressRaf();
      void acceptRecording({ autoLimit: true });
      return;
    }

    recordingProgressRaf = requestAnimationFrame(tick);
  };

  recordingProgressRaf = requestAnimationFrame(tick);
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

async function applyTranslationResult(data, { requestId, prefetchEntry, sourceRecording } = {}) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  stopLoadingDots();

  const prev = state.messages[0];
  const streamId = requestId !== undefined ? `stream-${requestId}` : null;

  const attachedRecording = sourceRecording || pendingSourceRecording;

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    original: data.rawText || data.sourceText,
    translated: data.translatedText,
    detectedLanguage: data.detectedLanguage,
    targetLanguage: data.targetLanguage,
    audioUrl: null,
    sourceRecording: attachedRecording
      ? {
          blob: attachedRecording.blob,
          mimeType: attachedRecording.mimeType,
          recordingMs: attachedRecording.recordingMs,
        }
      : null,
  };

  if (attachedRecording && !sourceRecording) {
    clearPendingSourceRecording();
  }

  if (prev?._streaming && streamId && prev.id === streamId) {
    adoptMessageAudio(prev, message);
  }

  const hidden = prefetchEntry?.hiddenMessage;
  if (hidden) {
    adoptMessageAudio(hidden, message);
  }

  for (const m of state.messages) {
    if (m.id !== message.id) {
      cancelMessageAudio(m);
    }
  }

  state.messages = [message];
  lastTranslationAppliedAt = Date.now();
  pendingQueuePausedUntil = lastTranslationAppliedAt + 8000;
  prepareForNewTranslation(message);
  renderConversation();
  startBackgroundAudio(message);
  await clearAllPendingRecordings();
}

function beginTranslationPanel(sourceText, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  if (!state.composerSession) enterComposerSession();

  const message = {
    id: `stream-${requestId}`,
    original: sourceText,
    translated: '',
    detectedLanguage: null,
    targetLanguage: null,
    audioUrl: null,
    _streaming: true,
    _loading: true,
  };

  state.messages = [message];
  state.latestMessageId = message.id;
  renderConversation();
}

function maxLoadingDots(textLength) {
  const chars = Math.max(textLength, 1);
  return Math.min(LOADING_DOT_MAX, Math.max(3, Math.ceil(chars / 12)));
}

let activeTranslationDotsEl = null;

function stopLoadingDots(dotsEl) {
  if (!dotsEl) return;
  if (dotsEl._dotsTimer) {
    clearInterval(dotsEl._dotsTimer);
    dotsEl._dotsTimer = null;
  }
  dotsEl.textContent = '';
}

function animateLoadingDots(dotsEl, {
  cap = LOADING_DOT_MAX,
  shouldContinue,
  onTick,
  initialCount = 1,
} = {}) {
  if (!dotsEl) return;

  if (dotsEl._dotsTimer) {
    clearInterval(dotsEl._dotsTimer);
    dotsEl._dotsTimer = null;
  }

  let dotCount = Math.max(1, initialCount);
  dotsEl.textContent = '.'.repeat(dotCount);
  onTick?.();

  dotsEl._dotsTimer = window.setInterval(() => {
    if (shouldContinue && !shouldContinue()) {
      stopLoadingDots(dotsEl);
      return;
    }
    if (dotCount >= cap) return;
    dotCount += 1;
    dotsEl.textContent = '.'.repeat(dotCount);
    onTick?.();
  }, LOADING_DOT_MS);
}

function syncComposeLoadingDots() {
  if (!composeLoadingActive || !composeLoadingDotsEl || composeLoadingDotsEl.hasAttribute('hidden')) return;

  const wrap = composeInputWrapEl;
  const ta = dictationInputEl;
  if (!wrap || !ta) return;

  const mirror = ensureComposeCaretMirror();
  const style = getComputedStyle(ta);
  syncMirrorStyles(mirror, ta, style);

  const textBefore = ta.value;
  const needsSpace = textBefore.length > 0 && !/\s$/.test(textBefore);
  const markerText = `${textBefore}${needsSpace ? ' ' : ''}`;

  mirror.replaceChildren();
  mirror.append(document.createTextNode(markerText));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.append(marker);

  const markerRect = marker.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();

  composeLoadingDotsEl.style.left = `${markerRect.left - wrapRect.left}px`;
  composeLoadingDotsEl.style.top = `${markerRect.top - wrapRect.top + ta.scrollTop}px`;
}

function startComposeLoadingDots(dotCap = 12) {
  composeLoadingActive = true;
  composeLoadingDotsEl?.removeAttribute('hidden');
  composeLoadingDotsEl?.removeAttribute('aria-hidden');
  composeLoadingDotsEl?.setAttribute('aria-live', 'polite');
  dictationInputEl?.setAttribute('aria-busy', 'true');
  composeBoxEl?.classList.add('is-processing');
  updateComposeState();
  syncComposeLoadingDots();
  animateLoadingDots(composeLoadingDotsEl, {
    cap: dotCap,
    shouldContinue: () => composeLoadingActive,
    onTick: syncComposeLoadingDots,
  });
}

function stopComposeLoadingDots() {
  composeLoadingActive = false;
  composeLoadingDotsEl?.setAttribute('hidden', '');
  composeLoadingDotsEl?.setAttribute('aria-hidden', 'true');
  composeLoadingDotsEl?.removeAttribute('aria-live');
  dictationInputEl?.removeAttribute('aria-busy');
  stopLoadingDots(composeLoadingDotsEl);
  composeBoxEl?.classList.remove('is-processing');
  updateComposeState();
}

function startTranslationLoadingDots(card, message) {
  const dotsEl = card?.querySelector('.translation-loading-dots');
  if (!dotsEl || !message) return;

  activeTranslationDotsEl = dotsEl;
  animateLoadingDots(dotsEl, {
    cap: LOADING_DOT_MAX,
    initialCount: message._loadingDotCount || 1,
    shouldContinue: () => Boolean(message._loading && !message.translated),
    onTick: () => {
      message._loadingDotCount = dotsEl.textContent.length;
    },
  });
}

function showStreamingTranscript(rawText, requestId, expectedTarget = null) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  stopComposeLoadingDots();

  const existing = state.messages[0];
  if (existing?._streaming && existing.id === `stream-${requestId}`) {
    existing.original = rawText;
    if (expectedTarget) existing._expectedTarget = expectedTarget;
    return;
  }

  const message = {
    id: `stream-${requestId}`,
    original: rawText,
    translated: '',
    detectedLanguage: null,
    targetLanguage: null,
    _expectedTarget: expectedTarget,
    audioUrl: null,
    _streaming: true,
    _loading: true,
  };

  state.messages = [message];
  state.latestMessageId = message.id;
  renderConversation();
}

function appendStreamingTranslation(text, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;

  const message = state.messages[0];
  if (!message?._streaming) return;

  const translatedEl = getMessageCardEl(message)?.querySelector('.message-translated-text');
  if (message._loading) {
    stopLoadingDots(translatedEl?.querySelector('.translation-loading-dots'));
    message._loading = false;
    message._loadingDotCount = 0;
    if (translatedEl) {
      translatedEl.classList.remove('is-loading');
      translatedEl.removeAttribute('aria-busy');
      translatedEl.textContent = '';
    }
  }

  message.translated += text;
  if (translatedEl) {
    translatedEl.textContent = message.translated;
    translatedEl.classList.add('is-streaming');
  }

  prefetchHeadAudioMidStream(message);
}

function kickoffTranslationAudio(doneData, requestId) {
  if (requestId !== undefined && requestId !== latestTranslationRequest) return;
  if (!doneData?.translatedText?.trim()) return;

  const message = state.messages[0];
  if (!message?._streaming || message.id !== `stream-${requestId}`) return;

  message.translated = doneData.translatedText;
  message.detectedLanguage = doneData.detectedLanguage;
  message.targetLanguage = doneData.targetLanguage;
  startBackgroundAudio(message);
}

function handleStreamEvent(evt, requestId) {
  if (!evt?.event) return;

  if (evt.event === 'transcript') {
    showStreamingTranscript(evt.rawText, requestId, evt.targetLanguage || null);
    return;
  }

  if (evt.event === 'delta') {
    appendStreamingTranslation(evt.text || '', requestId);
    return;
  }

  if (evt.event === 'error') {
    const error = new Error(evt.error || 'Processing failed');
    error.retryable = true;
    throw error;
  }
}

async function consumeConverseStream(res, { requestId, signal, mode = 'active', prefetchRef } = {}) {
  if (!res.body) {
    throw new Error('No response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const evt = JSON.parse(line);
        if (evt.event === 'done') {
          finalData = evt;
          if (mode === 'prefetch') {
            kickoffPrefetchAudio(prefetchRef, evt);
          } else {
            kickoffTranslationAudio(evt, requestId);
          }
          continue;
        }
        if (mode === 'prefetch') {
          if (evt.event === 'error') {
            const error = new Error(evt.error || 'Processing failed');
            error.retryable = true;
            throw error;
          }
          continue;
        }
        handleStreamEvent(evt, requestId);
      }
    }

    if (buffer.trim()) {
      const evt = JSON.parse(buffer);
      if (evt.event === 'done') {
        finalData = evt;
        if (mode === 'prefetch') {
          kickoffPrefetchAudio(prefetchRef, evt);
        } else {
          kickoffTranslationAudio(evt, requestId);
        }
      } else if (mode === 'prefetch') {
        if (evt.event === 'error') {
          const error = new Error(evt.error || 'Processing failed');
          error.retryable = true;
          throw error;
        }
      } else {
        handleStreamEvent(evt, requestId);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!finalData) {
    const error = new Error('Connection interrupted — message saved for retry');
    error.retryable = true;
    throw error;
  }

  return finalData;
}

async function fetchConverse(formFactory, { attempts = 3, signal, timeoutMs = 120000 } = {}) {
  let lastError;
  let lastRes;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const attemptController = new AbortController();
    const onAbort = () => attemptController.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const body = typeof formFactory === 'function' ? formFactory() : formFactory;
      const res = await withTimeout(
        apiFetch('/api/converse', {
          method: 'POST',
          body,
          signal: attemptController.signal,
        }),
        timeoutMs,
        'Request timed out — message saved',
        () => attemptController.abort(),
      );
      lastRes = res;

      if ((res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408)
        && attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }

      return res;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < attempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  if (lastRes) return lastRes;

  const error = new Error(lastError?.message || 'Cannot connect to server');
  error.retryable = true;
  throw error;
}

function clampRecordingMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(ms, MAX_RECORDING_MS);
}

async function submitRecording({
  blob,
  mimeType,
  recordingMs,
  lang1,
  lang2,
  context,
  pendingId,
  signal,
  requestId,
}) {
  const id = pendingId || crypto.randomUUID();
  const safeRecordingMs = clampRecordingMs(recordingMs);
  const timeoutMs = converseTimeoutMs(safeRecordingMs, blob?.size || 0);

  if (!pendingId) {
    await savePendingRecording({
      id,
      blob,
      mimeType,
      lang1,
      lang2,
      contextJson: JSON.stringify(context),
      recordingMs: safeRecordingMs,
      createdAt: Date.now(),
    });
  }

  const buildForm = () => {
    const form = new FormData();
    form.append('audio', blob, `audio.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
    form.append('lang1', lang1);
    form.append('lang2', lang2);
    form.append('durationMs', String(safeRecordingMs));
    form.append('context', JSON.stringify(context));
    form.append('slot', String(activeSpeakProfileSlot()));
    return form;
  };

  let res;
  try {
    res = await fetchConverse(buildForm, {
      attempts: pendingId ? 2 : 3,
      signal,
      timeoutMs,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const current = (await listPendingRecordings()).find((item) => item.id === id);
    await updatePendingRecording(id, {
      attempts: (current?.attempts || 0) + 1,
      lastError: err.message,
    });
    throw err;
  }

  let data = {};
  const contentType = res.headers.get('content-type') || '';

  if (res.ok && contentType.includes('ndjson')) {
    try {
      data = await consumeConverseStream(res, { requestId, signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const current = (await listPendingRecordings()).find((item) => item.id === id);
      await updatePendingRecording(id, {
        attempts: (current?.attempts || 0) + 1,
        lastError: err.message,
      });
      throw err;
    }
  } else {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
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
    } else {
      await removePendingRecording(id);
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
  $('#pending-banner').hidden = true;
}

function schedulePendingRetry(delayMs = 5000) {
  clearTimeout(pendingRetryTimer);
  pendingRetryTimer = setTimeout(() => {
    void processPendingQueue();
  }, delayMs);
}

function wakePendingQueue() {
  if (Date.now() < pendingQueuePausedUntil) return;
  schedulePendingRetry(400);
}

async function processPendingQueue() {
  if (pendingQueueBusy || state.isProcessing || state.isRecording) return;
  if (Date.now() < pendingQueuePausedUntil) return;
  if (!navigator.onLine) {
    await refreshPendingBanner();
    return;
  }

  const items = await listPendingRecordings();
  if (!items.length) {
    await refreshPendingBanner();
    return;
  }

  const actionable = items.filter((item) => item.createdAt > lastTranslationAppliedAt);
  if (!actionable.length) {
    await clearAllPendingRecordings();
    return;
  }

  syncLanguageStateFromStorage();
  const { lang1, lang2 } = getLanguagePair();
  const currentPairKey = languagePairKey(lang1, lang2);
  const compatible = [];
  for (const item of actionable) {
    if (languagePairKey(item.lang1, item.lang2) === currentPairKey) {
      compatible.push(item);
    } else {
      await removePendingRecording(item.id);
    }
  }

  if (!compatible.length) {
    await refreshPendingBanner();
    return;
  }

  pendingQueueBusy = true;
  const item = compatible.sort((a, b) => b.createdAt - a.createdAt)[0];
  const requestId = latestTranslationRequest;

  try {
    if (state.isRecording) return;

    state.isProcessing = true;
    startComposeLoadingDots(loadingDotCapFromMs(estimateProcessingMs(item.recordingMs, item.blob?.size || 0)));

    const context = JSON.parse(item.contextJson || '[]');
    const data = await submitRecording({
      blob: item.blob,
      mimeType: item.mimeType,
      recordingMs: item.recordingMs,
      lang1,
      lang2,
      context,
      pendingId: item.id,
      requestId,
    });

    if (requestId !== latestTranslationRequest) return;
    if (item.createdAt <= lastTranslationAppliedAt) return;

    await applyTranslationResult(data, {
      requestId,
      sourceRecording: {
        blob: item.blob,
        mimeType: item.mimeType,
        recordingMs: item.recordingMs,
      },
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    if (err.retryable !== false) {
      if (err.message?.includes('Session expired') && authRequired) {
        showAuthGate();
      }
      await updatePendingRecording(item.id, {
        attempts: (item.attempts || 0) + 1,
        lastError: err.message || 'Retry later',
      });
      schedulePendingRetry(retryDelayMs((item.attempts || 0) + 1));
    } else {
      await removePendingRecording(item.id);
    }
  } finally {
    state.isProcessing = false;
    resetMicUI();
    pendingQueueBusy = false;
    await refreshPendingBanner();
  }
}

function bindPendingQueue() {
  window.addEventListener('online', wakePendingQueue);
  window.addEventListener('focus', () => {
    syncLanguageStateFromStorage();
    wakePendingQueue();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncLanguageStateFromStorage();
      wakePendingQueue();
    }
  });
  window.addEventListener('pageshow', (event) => {
    syncLanguageStateFromStorage();
    if (event.persisted) wakePendingQueue();
  });
}

async function sendRecordingForTranslation({ blob, mimeType, recordingMs }) {
  abortActiveConverse();
  const controller = new AbortController();
  activeConverseController = controller;
  const requestId = ++latestTranslationRequest;
  const { lang1, lang2 } = getLanguagePair();

  try {
    const data = await submitRecording({
      blob,
      mimeType,
      recordingMs,
      lang1,
      lang2,
      context: buildConversationContext(),
      signal: controller.signal,
      requestId,
    });
    if (requestId !== latestTranslationRequest) return;
    await applyTranslationResult(data, {
      requestId,
      sourceRecording: { blob, mimeType, recordingMs },
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  } finally {
    if (activeConverseController === controller) {
      activeConverseController = null;
    }
  }
}

async function beginRecording() {
  if (!languagesReady()) {
    showToast('Select two languages');
    return;
  }
  if (state.isProcessing || state.stoppingRecording || state.isRecording || isRecordingUiActive()) return;

  const sessionId = ++recordingSessionId;
  primeMicAudioOnGesture();
  stopDraftSpeech();
  abortActiveConverse();
  cancelDraftTranslationPrefetch();
  clearPendingSourceRecording();
  latestTranslationRequest++;
  stopPlayback();
  clearMicVoicePulse();
  state.audioChunks = [];
  setRecordingUI(true);
  updateComposeState();

  try {
    const stream = await ensureMicStream();
    if (sessionId !== recordingSessionId) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    prepareMicMeter(stream);

    // 32kbps Opus is plenty for speech transcription and shrinks uploads ~3x.
    const mimeType = getRecordingMimeType();
    const recorderOptions = { audioBitsPerSecond: 32000 };
    if (mimeType) recorderOptions.mimeType = mimeType;
    state.mediaRecorder = new MediaRecorder(stream, recorderOptions);

    state.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.start(250);
    state.recordingStartedAt = Date.now();
    state.isRecording = true;
    state.mediaStream = stream;
    cancelWarmMicRelease();

    updateComposeState();
    startRecordingProgress();
  } catch (err) {
    if (sessionId !== recordingSessionId) return;
    setRecordingUI(false);
    showMicHelp(err);
    releaseMic();
    updateComposeState();
  }
}

async function cancelRecording() {
  if (!isRecordingUiActive()) return;

  recordingSessionId++;
  state.isRecording = false;
  state.stoppingRecording = false;
  stopRecordingProgress();
  setRecordingUI(false);

  try {
    const recorder = state.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await waitForRecorderStop(recorder);
    }
  } catch {
    // ignore stop errors while cancelling
  }

  state.audioChunks = [];
  cleanupRecorder();
  teardownMicMeter();
  releaseMicTracks();
  updateComposeState();
}

async function acceptRecording({ autoLimit = false } = {}) {
  if (state.stoppingRecording) return;
  if (!state.isRecording) return;

  state.stoppingRecording = true;
  const mimeType = state.mediaRecorder?.mimeType || 'audio/webm';

  try {
    if (!autoLimit) {
      await sleep(RECORDING_TAIL_MS);
    }

    state.isRecording = false;
    stopRecordingProgress();
    setRecordingUI(false);

    const recorder = state.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      await waitForRecorderStop(recorder);
    }

    const blob = buildRecordingBlob(mimeType);
    state.audioChunks = [];
    cleanupRecorder();
    teardownMicMeter();
    releaseMicTracks();

    const recordingMs = clampRecordingMs(
      state.recordingStartedAt ? Date.now() - state.recordingStartedAt : 0,
    );

    if (!autoLimit && (recordingMs < 450 || blob.size < 400)) {
      showToast('Recording too short');
      updateComposeState();
      return;
    }

    pendingSourceRecording = { blob, mimeType, recordingMs };

    updateComposeState();
    startComposeLoadingDots(loadingDotCapFromMs(estimateTranscribeMs(recordingMs, blob.size)));

    let transcript = '';
    try {
      transcript = await fetchTranscriptFromAudio({ blob, mimeType });
    } catch (err) {
      showToast(err.message || 'Could not transcribe audio');
      return;
    } finally {
      stopComposeLoadingDots();
    }

    if (!transcript.trim()) {
      showToast('No speech detected — try again');
      return;
    }

    appendToDraft(transcript);
  } finally {
    state.stoppingRecording = false;
    updateComposeState();
  }
}

async function waitForRecorderStop(mediaRecorder) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      setTimeout(resolve, RECORDER_STOP_FLUSH_MS);
    };

    const timeout = setTimeout(finish, 5000);

    mediaRecorder.onstop = finish;

    try {
      if (mediaRecorder.state === 'recording' && typeof mediaRecorder.requestData === 'function') {
        mediaRecorder.requestData();
      }
      mediaRecorder.stop();
    } catch {
      finish();
    }
  });
}

function buildRecordingBlob(mimeType) {
  return new Blob(state.audioChunks, { type: mimeType });
}

function cleanupRecorder() {
  state.mediaRecorder = null;
}

function releaseMicTracks() {
  state.mediaStream?.getTracks().forEach((t) => t.stop());
  state.mediaStream = null;
  state.mediaRecorder = null;
}

function releaseMic() {
  stopPlayback();
  teardownMicMeter();
  releaseMicTracks();
}

function resetMicUI() {
  stopComposeLoadingDots();
  stopLoadingDots();
  stopRecordingProgress();
  cleanupRecorder();
  state.isProcessing = false;
  state.stoppingRecording = false;
  state.isRecording = false;
  setRecordingUI(false);
  updateComposeState();
}
async function blobFromAudioUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not read audio');
  return res.blob();
}

async function shareClonedAudio(msg, btn) {
  if (btn?.dataset.busy === '1') return;

  acknowledgeActionButton(btn);
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
  }

  try {
    if (!msg.audioUrl) {
      await loadMessageAudio(msg);
    }
    if (msg._audioPartial && msg._audioTailPromise) {
      await withTimeout(msg._audioTailPromise, 30000, 'Audio not ready — try again');
    }
    if (!msg.audioUrl || msg._audioPartial) throw new Error('Audio not ready — try again');
    revealAudioActions(msg);

    const blob = await blobFromAudioUrl(msg.audioUrl);
    const filename = `lingu-translation-${Date.now()}.mp3`;
    const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });

    if (typeof navigator.share !== 'function') {
      showToast('Sharing audio is not supported on this device');
      return;
    }
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      showToast('Sharing audio is not supported on this device');
      return;
    }

    await navigator.share({ files: [file], title: 'Translation audio' });
  } catch (err) {
    if (err?.name !== 'AbortError') {
      showToast(err.message || 'Could not share audio');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      delete btn.dataset.busy;
      releaseActionButtonFocus(btn);
    }
  }
}

function renderTranslatedContent(msg) {
  if (msg._streaming && msg._loading && !msg.translated) {
    return `<span class="message-translated-text is-loading" aria-busy="true" aria-live="polite"><span class="translation-loading-dots"></span></span>`;
  }

  const streamingClass = msg._streaming ? ' is-streaming' : '';
  return `<span class="message-translated-text${streamingClass}">${escapeHtml(msg.translated)}</span>`;
}

function createMessageCard(msg) {
  const el = document.createElement('article');
  el.className = 'message-card message-card-current';
  el.dataset.messageId = String(msg.id);
  const hideTextActions = msg._streaming || msg._loading;

  const hasAudio = Boolean(msg.audioUrl);
  const audioActionsClass = hasAudio ? ' has-audio-actions' : '';
  const hideFooter = hideTextActions || !hasAudio;

  el.innerHTML = `
    <div class="message-bubble">
      <div class="message-translated message-translated-only">
        ${renderTranslatedContent(msg)}
        <div class="message-text-actions"${hideTextActions ? ' hidden' : ''}>
          <button type="button" class="icon-btn copy-btn copy-btn-inline" title="Copy as text" aria-label="Copy as text">
            ${COPY_BTN_SVG}
          </button>
          <button type="button" class="icon-btn share-btn share-btn-inline" title="Share" aria-label="Share">
            ${SHARE_BTN_SVG}
          </button>
        </div>
      </div>
      <div class="message-footer-actions${audioActionsClass}"${hideFooter ? ' hidden' : ''}>
        <div class="message-playback-slot"${hasAudio ? '' : ' hidden'}>
          <div class="message-playback-side message-playback-side-left">
            <button type="button" class="icon-btn playback-seek-btn playback-restart-btn" hidden title="Start from beginning" aria-label="Start from beginning">
              ${RESTART_PLAYBACK_BTN_SVG}
            </button>
          </div>
          <button type="button" class="icon-btn listen-btn listen-btn-inline" title="Play" aria-label="Play">
            ${PLAY_BTN_SVG}
          </button>
          <div class="message-playback-side message-playback-side-right" hidden aria-hidden="true">
            <span class="playback-side-spacer"></span>
          </div>
        </div>
        <button type="button" class="icon-btn share-audio-btn share-audio-btn-end"${hasAudio ? '' : ' hidden'} title="Share audio" aria-label="Share audio">
          ${SHARE_AUDIO_BTN_SVG}
        </button>
      </div>
    </div>
  `;

  if (msg.audioUrl) {
    el.querySelector('.listen-btn')?.classList.add('is-ready');
    el.querySelector('.share-audio-btn')?.classList.add('is-ready');
  }

  syncListenBtnVoiceMode(msg);

  const listenBtn = el.querySelector('.listen-btn');
  const shareAudioBtn = el.querySelector('.share-audio-btn');
  const copyBtn = el.querySelector('.copy-btn');
  const shareBtn = el.querySelector('.share-btn');
  const restartBtn = el.querySelector('.playback-restart-btn');

  listenBtn?.addEventListener('click', () => void toggleTranslationAudio(msg, listenBtn));
  shareAudioBtn?.addEventListener('click', () => void shareClonedAudio(msg, shareAudioBtn));
  restartBtn?.addEventListener('click', () => {
    acknowledgeActionButton(restartBtn);
    restartActivePlayback(msg);
  });
  copyBtn?.addEventListener('click', async () => {
    acknowledgeActionButton(copyBtn);
    try {
      await navigator.clipboard.writeText(msg.translated);
      showToast('Copied as text');
    } catch {
      showToast('Could not copy');
    } finally {
      releaseActionButtonFocus(copyBtn);
    }
  });
  shareBtn?.addEventListener('click', () => shareTranslation(msg.translated, shareBtn));

  return el;
}

function renderConversation() {
  if (activeTranslationDotsEl) {
    stopLoadingDots(activeTranslationDotsEl);
    activeTranslationDotsEl = null;
  }

  currentMessageEl.innerHTML = '';

  if (!state.messages.length) {
    currentMessageEl.innerHTML = '';
    return;
  }

  const latest = state.messages[state.messages.length - 1];
  const card = createMessageCard(latest);
  currentMessageEl.appendChild(card);

  if (latest._loading) {
    startTranslationLoadingDots(card, latest);
  }
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

// iOS Safari does not honor ::selection styles, so mirror the native text
// selection with a custom highlight that we can style (light green + black).
function bindSelectionHighlight() {
  if (typeof Highlight !== 'function' || !CSS?.highlights) return;

  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    const ranges = [];

    for (let i = 0; i < (selection?.rangeCount || 0); i += 1) {
      const range = selection.getRangeAt(i);
      if (range.collapsed) continue;
      const node = range.commonAncestorContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (el?.closest('.message-translated-text')) ranges.push(range);
    }

    if (ranges.length) {
      CSS.highlights.set('lingu-text-selection', new Highlight(...ranges));
    } else {
      CSS.highlights.delete('lingu-text-selection');
    }
  });
}

function isIosDevice() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// iOS Safari also ignores ::selection inside the compose textarea. Since the
// Custom Highlight API cannot reach a textarea's internal text, the selection
// is painted by a mirror overlay on top while the textarea text goes
// transparent for the duration of the selection.
function bindComposeSelectionOverlay() {
  const ta = dictationInputEl;
  const wrap = composeInputWrapEl;
  if (!ta || !wrap || !isIosDevice()) return;

  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'compose-selection-mirror';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.hidden = true;
    wrap.appendChild(overlay);
    return overlay;
  }

  function clearOverlay() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    overlay.replaceChildren();
    ta.classList.remove('has-selection-overlay');
  }

  function syncOverlay() {
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    if (document.activeElement !== ta || start === end || ta.disabled) {
      clearOverlay();
      return;
    }

    const el = ensureOverlay();
    syncMirrorStyles(el, ta, getComputedStyle(ta));

    const selected = document.createElement('span');
    selected.className = 'compose-selection-range';
    selected.textContent = ta.value.slice(start, end);

    el.replaceChildren(
      document.createTextNode(ta.value.slice(0, start)),
      selected,
      document.createTextNode(ta.value.slice(end)),
    );
    el.hidden = false;
    ta.classList.add('has-selection-overlay');
  }

  document.addEventListener('selectionchange', syncOverlay);
  ta.addEventListener('input', syncOverlay);
  ta.addEventListener('blur', clearOverlay);
}

function bindEvents() {
  bindSelectionHighlight();
  bindComposeSelectionOverlay();
  composeMicBtn.addEventListener('pointerdown', warmMicForRecording, { passive: true });
  composeMicBtn.addEventListener('click', () => void beginRecording());
  recordingCancelBtn.addEventListener('click', () => void cancelRecording());
  recordingSendBtn.addEventListener('click', () => void acceptRecording());
  window.addEventListener('lingo:unauthorized', () => {
    if (!authRequired) return;
    void (async () => {
      if (await revalidateSession()) {
        state.user = getStoredUser();
        return;
      }
      showAuthGate();
    })();
  });
  window.addEventListener('pagehide', releaseMic);
  // iOS often skips pagehide when switching apps; close any idle mic stream
  // so the OS "microphone in use" indicator does not stay on.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (state.isRecording || state.stoppingRecording) return;
    teardownMicMeter();
    releaseMicTracks();
  });
}

init();
registerPwa();
