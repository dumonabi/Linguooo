import { apiFetch, clearAuthToken, clearStoredUser, fetchCurrentUser, getStoredUser, setStoredUser } from './auth.js';
import { getVoicePrompt, getVoiceUi, VOICE_SAMPLE_TARGET } from './voice-prompts.js';

const MIN_SAMPLES = VOICE_SAMPLE_TARGET;

let rootEl = null;
let menuOpen = false;
let voiceProfile = null;
let recordingSession = null;
let creatingVoice = false;
let savingSample = false;
let voiceSetupError = '';
let onUserChange = null;
let showToastFn = () => {};

function toast(message) {
  showToastFn(message);
}

function $(selector, parent = document) {
  return parent.querySelector(selector);
}

function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function nextPromptIndex(sampleCount, maxSamples = MIN_SAMPLES) {
  return Math.min(sampleCount, maxSamples - 1);
}

function getProfileState(user) {
  const maxSamples = voiceProfile?.maxSamples ?? MIN_SAMPLES;
  const sampleCount = voiceProfile?.sampleCount ?? user?.voiceSampleCount ?? 0;
  const canRecordMore = voiceProfile?.canRecordMore ?? sampleCount < maxSamples;
  return {
    maxSamples,
    sampleCount,
    canRecordMore,
    voiceReady: voiceProfile?.voiceReady ?? user?.voiceReady ?? false,
    status: voiceProfile?.status ?? user?.voiceStatus ?? 'none',
    elevenlabsConfigured: voiceProfile?.elevenlabsConfigured !== false,
    samplesComplete: sampleCount >= maxSamples,
  };
}

function discardActiveRecording() {
  const session = recordingSession;
  if (!session) return;

  recordingSession = null;
  try {
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  } catch {
    // ignore stop errors when discarding
  }
  session.stream.getTracks().forEach((track) => track.stop());
}

function stopMediaRecorder(recorder) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recording stop timed out — try again')), 8000);
    const finish = (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    recorder.addEventListener('stop', () => finish(), { once: true });
    recorder.addEventListener('error', () => finish(new Error('Recording failed')), { once: true });

    if (recorder.state === 'recording') {
      try {
        recorder.requestData();
      } catch {
        // not supported in every browser
      }
      recorder.stop();
    } else if (recorder.state === 'inactive') {
      finish();
    }
  });
}

async function maybeEnsureVoiceConfigured() {
  const user = getStoredUser();
  if (!user || creatingVoice || recordingSession || savingSample) return;

  const state = getProfileState(user);
  if (state.samplesComplete && state.elevenlabsConfigured && !state.voiceReady) {
    await createVoiceProfile(false);
  }
}

function getMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function renderMenuContent() {
  const user = getStoredUser();
  const panel = $('#user-profile-panel', rootEl);
  if (!panel || !user) return;

  const ui = getVoiceUi(user.nativeLanguage);
  const state = getProfileState(user);
  const {
    maxSamples,
    sampleCount,
    canRecordMore,
    voiceReady,
    status,
    elevenlabsConfigured,
    samplesComplete,
  } = state;
  const prompt = getVoicePrompt(user.nativeLanguage, nextPromptIndex(sampleCount, maxSamples));
  const isRecording = Boolean(recordingSession);
  const recordingAtLimit = isRecording && !canRecordMore;
  const showRecord = canRecordMore && !isRecording && !creatingVoice && !savingSample;
  const showUpdate = samplesComplete && voiceReady && status === 'needs_update' && !creatingVoice && !savingSample;
  const showSetup = samplesComplete && !voiceReady && elevenlabsConfigured && !creatingVoice && !isRecording && !savingSample;

  panel.innerHTML = `
    <div class="user-profile-header">
      <div class="user-profile-avatar" aria-hidden="true">${initials(user.name)}</div>
      <div class="user-profile-meta">
        <strong class="user-profile-name">${escapeHtml(user.name)}</strong>
        <span class="user-profile-status">${voiceReady ? ui.voiceReady : ui.voiceNotReady}</span>
      </div>
    </div>

    <div class="user-profile-section">
      <p class="user-profile-label">${ui.voiceProfile}</p>
      <p class="user-profile-copy">${ui.voiceCopy}</p>
      <p class="user-profile-count">${Math.min(sampleCount, maxSamples)}/${maxSamples} ${ui.samplesRecorded}</p>
      ${status === 'needs_update' ? `<p class="user-profile-note">${ui.needsUpdate}</p>` : ''}
      ${creatingVoice ? `<p class="user-profile-note user-profile-note--active">${ui.creatingVoice}</p>` : ''}
      ${savingSample ? `<p class="user-profile-note user-profile-note--active">${ui.savingSample}</p>` : ''}
      ${!creatingVoice && !savingSample && samplesComplete && elevenlabsConfigured && !voiceReady ? `<p class="user-profile-note user-profile-note--active">${ui.samplesComplete}</p>` : ''}
      ${!elevenlabsConfigured ? `<p class="user-profile-note">${ui.elevenlabsMissing}</p>` : ''}
      ${voiceSetupError ? `<p class="user-profile-note user-profile-note--error">${escapeHtml(ui.voiceSetupFailed)} ${escapeHtml(voiceSetupError)}</p>` : ''}
      ${recordingAtLimit ? `<p class="user-profile-note">${ui.recordingBlocked}</p>` : ''}
    </div>

    <div class="user-profile-samples"${sampleCount ? '' : ' hidden'}>
      <p class="user-profile-label">${ui.savedSamples}</p>
      <ul class="user-profile-sample-list" id="user-voice-sample-list">
        ${(voiceProfile?.samples || []).map((sample, index) => `
          <li>
            <span>${ui.sampleLabel} ${index + 1}</span>
            <button type="button" class="user-profile-delete-btn" data-sample-id="${escapeHtml(sample.id)}" aria-label="${ui.deleteSample} ${index + 1}"${isRecording || creatingVoice ? ' disabled' : ''}>${ui.deleteSample}</button>
          </li>
        `).join('')}
      </ul>
    </div>

    ${showRecord || (isRecording && !recordingAtLimit) ? `
    <div class="user-profile-prompt${isRecording ? ' is-recording' : ''}">
      <p class="user-profile-label">${isRecording ? ui.readingNow : ui.readNext}</p>
      <p class="user-profile-prompt-text">"${escapeHtml(prompt)}"</p>
    </div>
    ` : samplesComplete && !isRecording ? `<p class="user-profile-note user-profile-note--success">${ui.enoughSamples}</p>` : ''}

    <div class="user-profile-actions">
      <button type="button" class="user-profile-record-btn" id="user-voice-record-btn"${showRecord ? '' : ' hidden'}>
        ${ui.recordSample}
      </button>
      <div class="user-profile-recording-actions${recordingAtLimit ? ' is-single' : ''}"${isRecording ? '' : ' hidden'}>
        <button type="button" class="user-profile-cancel-btn" id="user-voice-cancel-btn"${savingSample ? ' disabled' : ''}>
          ${recordingAtLimit ? ui.discardRecording : ui.cancelRecording}
        </button>
        ${recordingAtLimit ? '' : `
        <button type="button" class="user-profile-stop-btn" id="user-voice-stop-btn"${savingSample ? ' disabled' : ''}>
          ${ui.stopSample}
        </button>`}
      </div>
      <button type="button" class="user-profile-create-btn" id="user-voice-setup-btn"${showSetup ? '' : ' hidden'}>
        ${ui.setupVoice}
      </button>
      <button type="button" class="user-profile-create-btn" id="user-voice-update-btn"${showUpdate ? '' : ' hidden'}>
        ${ui.updateVoice}
      </button>
    </div>

    <button type="button" class="user-profile-signout" id="user-profile-signout">${ui.switchUser}</button>
  `;

  $('#user-voice-record-btn', panel)?.addEventListener('click', () => void startVoiceSampleRecording());
  $('#user-voice-stop-btn', panel)?.addEventListener('click', () => void stopVoiceSampleRecording());
  $('#user-voice-cancel-btn', panel)?.addEventListener('click', () => cancelVoiceSampleRecording());
  $('#user-voice-setup-btn', panel)?.addEventListener('click', () => void createVoiceProfile(false));
  $('#user-voice-update-btn', panel)?.addEventListener('click', () => void createVoiceProfile(true));
  $('#user-profile-signout', panel)?.addEventListener('click', () => signOut());
  panel.querySelectorAll('[data-sample-id]').forEach((btn) => {
    btn.addEventListener('click', () => void deleteVoiceSample(btn.dataset.sampleId));
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateTrigger() {
  const user = getStoredUser();
  const trigger = $('#user-profile-trigger', rootEl);
  if (!trigger) return;
  trigger.textContent = initials(user?.name || '?');
  trigger.title = user?.name ? `${user.name} profile` : 'User profile';
  trigger.setAttribute('aria-label', user?.name ? `${user.name} profile` : 'User profile');
}

function setMenuOpen(open) {
  menuOpen = open;
  rootEl?.classList.toggle('is-open', open);
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) panel.hidden = !open;
}

async function refreshVoiceProfile() {
  const res = await apiFetch('/api/voice/profile');
  if (!res.ok) return;
  voiceProfile = await res.json();

  const user = getStoredUser();
  const { maxSamples } = getProfileState(user);
  if (!state.canRecordMore && recordingSession) {
    discardActiveRecording();
    toast(`Extra recording discarded — you already have ${maxSamples} samples`);
  }

  renderMenuContent();
  await maybeEnsureVoiceConfigured();
}

export async function refreshUserSession() {
  const data = await fetchCurrentUser();
  if (data?.user) {
    setStoredUser(data.user);
    voiceProfile = data.voiceProfile ? {
      ...data.voiceProfile,
      samples: [],
    } : null;
    await refreshVoiceProfile();
  }
  updateTrigger();
  renderMenuContent();
  onUserChange?.(getStoredUser());
}

async function startVoiceSampleRecording() {
  if (recordingSession) return;

  const user = getStoredUser();
  const maxSamples = voiceProfile?.maxSamples ?? MIN_SAMPLES;
  const sampleCount = voiceProfile?.sampleCount ?? user?.voiceSampleCount ?? 0;
  const canRecordMore = voiceProfile?.canRecordMore ?? sampleCount < maxSamples;
  if (!canRecordMore) {
    toast(`You already have ${maxSamples} voice samples`);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = getMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    const chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recordingSession = {
      stream,
      recorder,
      chunks,
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      startedAt: Date.now(),
    };

    recorder.start(250);
    renderMenuContent();
  } catch {
    toast('Microphone access is required to record voice samples');
  }
}

function cancelVoiceSampleRecording() {
  discardActiveRecording();
  renderMenuContent();
}

async function stopVoiceSampleRecording() {
  const session = recordingSession;
  if (!session || savingSample) return;

  const user = getStoredUser();
  const state = getProfileState(user);
  if (!state.canRecordMore) {
    cancelVoiceSampleRecording();
    toast(`You already have ${state.maxSamples} samples`);
    return;
  }

  savingSample = true;
  renderMenuContent();

  try {
    await stopMediaRecorder(session.recorder);
    session.stream.getTracks().forEach((track) => track.stop());
    recordingSession = null;

    const durationMs = Date.now() - session.startedAt;
    if (durationMs < 1200) {
      toast('Record a little longer — at least 2 seconds');
      return;
    }

    const blob = new Blob(session.chunks, { type: session.mimeType });
    if (!blob.size) {
      toast('No audio captured — try again');
      return;
    }

    const form = new FormData();
    form.append('audio', blob, `voice-sample.${session.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);

    const res = await apiFetch('/api/voice/samples', {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      voiceSetupError = data.error || 'Could not save voice sample';
      toast(voiceSetupError);
      renderMenuContent();
      return;
    }

    voiceSetupError = '';
    toast('Voice sample saved');
    await refreshUserSession();

    if (data.readyForClone && voiceProfile?.elevenlabsConfigured !== false && !getStoredUser()?.voiceReady) {
      await createVoiceProfile(false);
    }
  } catch (err) {
    voiceSetupError = err.message || 'Could not save voice sample';
    toast(voiceSetupError);
    renderMenuContent();
  } finally {
    savingSample = false;
    if (recordingSession) discardActiveRecording();
    session.stream.getTracks().forEach((track) => track.stop());
    renderMenuContent();
  }
}

async function deleteVoiceSample(sampleId) {
  const res = await apiFetch(`/api/voice/samples/${encodeURIComponent(sampleId)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || 'Could not delete sample');
    return;
  }
  toast('Sample deleted');
  await refreshUserSession();
}

async function createVoiceProfile(isUpdate) {
  if (creatingVoice) return;
  creatingVoice = true;
  voiceSetupError = '';
  renderMenuContent();

  try {
    const res = await apiFetch('/api/voice/create', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      voiceSetupError = data.error || 'Could not create voice profile';
      toast(voiceSetupError);
      renderMenuContent();
      return;
    }
    voiceSetupError = '';
    toast(isUpdate ? 'Voice profile updated' : 'Personal voice ready');
    await refreshUserSession();
  } catch (err) {
    voiceSetupError = err.message || 'Could not create voice profile';
    toast(voiceSetupError);
    renderMenuContent();
  } finally {
    creatingVoice = false;
    renderMenuContent();
  }
}

function signOut() {
  clearAuthToken();
  clearStoredUser();
  setMenuOpen(false);
  window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
}

function bindMenuEvents() {
  const trigger = $('#user-profile-trigger', rootEl);
  trigger?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);
    if (nextOpen) {
      await refreshVoiceProfile();
      renderMenuContent();
    }
  });

  document.addEventListener('click', (event) => {
    if (!menuOpen || !rootEl) return;
    if (rootEl.contains(event.target)) return;
    setMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (recordingSession) cancelVoiceSampleRecording();
      setMenuOpen(false);
    }
  });
}

export function initUserProfile(slotEl, { onChange, showToast } = {}) {
  if (!slotEl) return;
  onUserChange = onChange;
  showToastFn = showToast || (() => {});
  rootEl = document.createElement('div');
  rootEl.className = 'user-profile';
  rootEl.innerHTML = `
    <button type="button" class="user-profile-trigger" id="user-profile-trigger" aria-haspopup="true" aria-expanded="false">?</button>
    <div class="user-profile-panel" id="user-profile-panel" hidden></div>
  `;
  slotEl.appendChild(rootEl);

  bindMenuEvents();
  updateTrigger();
  renderMenuContent();
}

export function getActiveUser() {
  return getStoredUser();
}
