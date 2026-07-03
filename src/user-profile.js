import { apiFetch, clearAuthSession, fetchCurrentUser, getAuthToken, getRecoveryPhrase, getStoredUser, setStoredUser } from './auth.js';
import { createLangPicker, createCollapsibleNumberedSquareGrid, hideAllLangPickerCarets } from './lang-picker.js';
import {
  addProfileSlot,
  canDeleteProfileSlot,
  deleteProfileSlot,
  loadProfileSlotNumbers,
  MAX_PROFILE_SLOTS,
} from './profile-slots.js';
import { $, escapeHtml } from './dom-utils.js';
import { createMicWave } from './mic-wave.js';
import { buildRecordingBlob, getRecordingMimeType, isIosDevice } from './media-utils.js';
import { formatCloneVoiceLanguageGroups } from './elevenlabs-languages.js';
import { loadLanguagesList } from './languages-service.js';
import {
  getProfileMenuSelectionStorageKey,
  loadActiveProfileSlot,
  voiceApiPath,
} from './profile-active-slot.js';
import { getSlotNameStorageKey, getVoiceLangStorageKey, VOICE_LANG_PREFIX } from './profile-keys.js';
import { readProfileValue, writeProfileValue } from './profile-storage.js';
import {
  hydrateProfileFromServer,
  scheduleProfileSettingsSync,
} from './profile-sync.js';
import {
  getVoicePrompt,
  getVoiceUi,
  resolveVoiceLanguage,
  VOICE_ADVISABLE_CLIP_SEC,
  VOICE_MIN_CLIP_SEC,
  VOICE_SAMPLE_TARGET,
} from './voice-prompts.js';

const MAX_SLOT_NAME_CHARS = 8;
const MAX_SLOT_LABEL_CHARS = 8;

const profileMicWave = createMicWave();
let profileWaveRaf = null;

const USER_PROFILE_BADGES_HTML = `
    <span class="user-profile-badge user-profile-badge--check">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1.75 5.25 4 7.5 8.25 2.75" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
    <span class="user-profile-badge user-profile-badge--close">
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M2 5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </span>
`;

function loadProfileUserMenuSelection(userId) {
  if (!userId) return null;
  try {
    const raw = readProfileValue(getProfileMenuSelectionStorageKey(userId));
    if (!raw) return null;
    const number = Number(raw);
    return number >= 1 && number <= MAX_PROFILE_SLOTS ? number : null;
  } catch {
    return null;
  }
}

function saveProfileUserMenuSelection(userId, number) {
  if (!userId || !number) return;
  try {
    writeProfileValue(getProfileMenuSelectionStorageKey(userId), String(number));
    scheduleProfileSettingsSync();
  } catch {
    // ignore storage errors
  }
}

function loadProfileSlotName(sessionUserId, slotNumber) {
  if (!sessionUserId || !slotNumber) return '';
  try {
    return readProfileValue(getSlotNameStorageKey(sessionUserId, slotNumber))?.trim() || '';
  } catch {
    return '';
  }
}

function saveProfileSlotName(sessionUserId, slotNumber, name) {
  if (!sessionUserId || !slotNumber) return;
  try {
    writeProfileValue(
      getSlotNameStorageKey(sessionUserId, slotNumber),
      String(name || '').trim().slice(0, MAX_SLOT_NAME_CHARS),
    );
    scheduleProfileSettingsSync();
  } catch {
    // ignore storage errors
  }
}

function formatSlotLabel(name, slotNumber, maxChars = MAX_SLOT_LABEL_CHARS) {
  const full = String(name || '').trim();
  if (full) {
    if (full.length <= maxChars) return full;
    return `${full.slice(0, maxChars - 1)}.`;
  }
  if (slotNumber === 11) return PROFILE_USER_MENU_OPTION_11_SYMBOL;
  return slotNumber ? String(slotNumber) : '···';
}

function getSlotDisplayLabel(sessionUserId, slotNumber) {
  if (!slotNumber) return '···';
  return formatSlotLabel(loadProfileSlotName(sessionUserId, slotNumber), slotNumber, MAX_SLOT_NAME_CHARS);
}

function getSlotCompactDisplayLabel(sessionUserId, slotNumber) {
  if (!slotNumber) return '···';
  return formatSlotLabel(loadProfileSlotName(sessionUserId, slotNumber), slotNumber, MAX_SLOT_LABEL_CHARS);
}

function getSlotDefaultName(slotNumber) {
  if (slotNumber === 11) return PROFILE_USER_MENU_OPTION_11_SYMBOL;
  return slotNumber ? String(slotNumber) : '';
}

function getSlotEditableName(sessionUserId, slotNumber) {
  if (!sessionUserId || !slotNumber) return '';
  const saved = loadProfileSlotName(sessionUserId, slotNumber);
  if (saved) return saved;
  return getSlotDefaultName(slotNumber);
}

function shouldSaveProfileSlotName(sessionUserId, slotNumber, value) {
  const saved = loadProfileSlotName(sessionUserId, slotNumber);
  const trimmed = String(value || '').trim();
  if (trimmed === saved) return false;
  if (!saved && trimmed === getSlotDefaultName(slotNumber)) return false;
  return true;
}

function ensureProfileUserMenuSelection(sessionUserId) {
  if (!sessionUserId) return null;
  const slotNumbers = loadProfileSlotNumbers(sessionUserId);
  if (profileUserMenuSelection === null) {
    profileUserMenuSelection = loadProfileUserMenuSelection(sessionUserId);
  }
  if (!profileUserMenuSelection || !slotNumbers.includes(profileUserMenuSelection)) {
    profileUserMenuSelection = slotNumbers[0] ?? loadActiveProfileSlot(sessionUserId) ?? null;
    if (profileUserMenuSelection) {
      saveProfileUserMenuSelection(sessionUserId, profileUserMenuSelection);
    }
  }
  return profileUserMenuSelection;
}

function normalizeSlotNumber(slotNumber) {
  const number = Number(slotNumber);
  return Number.isInteger(number) && number >= 1 && number <= MAX_PROFILE_SLOTS ? number : null;
}

function countProfileUsers(sessionUserId) {
  return loadProfileSlotNumbers(sessionUserId).length;
}

const PROFILE_USER_ICON_SVG = `
  <svg class="user-profile-switch-user-icon" viewBox="0 0 24 24" fill="#dffce9" aria-hidden="true">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
`;

const PROFILE_SWITCH_ICON_SVG = `
  <svg class="user-profile-switch-renew-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 7h-9"/><path d="M14 1l6 6-6 6"/><path d="M4 17h9"/><path d="M10 23l-6-6 6-6"/>
  </svg>
`;

function buildProfileSquareHtml(label, { badges = false, extraClass = '' } = {}) {
  const className = ['lang-picker-square', 'user-profile-square', extraClass].filter(Boolean).join(' ');
  return `
    <span class="${className}">
      <span class="lang-picker-square-label">${escapeHtml(label)}</span>
      ${badges ? USER_PROFILE_BADGES_HTML : ''}
    </span>
  `.trim();
}

function buildProfileTriggerSquareHtml(selection, sessionUserId, { badges = false } = {}) {
  const label = getSlotDisplayLabel(sessionUserId, selection);
  return buildProfileSquareHtml(label, { badges });
}

const PROFILE_DELETE_USER_ICON_SVG = `
  <svg class="user-profile-delete-user-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
`;

function buildProfileDeleteUserSquareHtml() {
  return `
    <span class="user-profile-name-delete-square">
      <span class="user-profile-name-delete-glyph" aria-hidden="true">${PROFILE_DELETE_USER_ICON_SVG}</span>
      <span class="user-profile-name-delete-badge" aria-hidden="true">×</span>
    </span>
  `.trim();
}

function buildProfileCollapsibleUserTriggerHtml() {
  return `
    <span class="user-profile-switch-user-square">
      <span class="user-profile-switch-user-glyph" aria-hidden="true">${PROFILE_USER_ICON_SVG}</span>
      <span class="user-profile-switch-user-badge" aria-hidden="true">${PROFILE_SWITCH_ICON_SVG}</span>
    </span>
  `.trim();
}

function buildProfileAddUserSquareHtml() {
  return buildProfileSquareHtml('+', { extraClass: 'user-profile-add-user-square' });
}

function syncProfileNameField() {
  const sessionUserId = getStoredUser()?.id;
  const slotNumber = normalizeSlotNumber(ensureProfileUserMenuSelection(sessionUserId));
  const display = $('#user-profile-name-display', rootEl);
  const deleteBtn = $('#user-profile-name-delete', rootEl);
  if (display && sessionUserId && slotNumber) {
    const label = profileUserGridOpen
      ? getSlotCompactDisplayLabel(sessionUserId, slotNumber)
      : getSlotDisplayLabel(sessionUserId, slotNumber);
    display.textContent = label;
  }
  if (deleteBtn && sessionUserId && slotNumber) {
    deleteBtn.hidden = !canDeleteProfileSlot(sessionUserId, slotNumber);
  }
}

function syncProfilePanelLayout() {
  const topRow = $('.user-profile-top-row', rootEl);
  const backBtn = $('#user-profile-grid-back', rootEl);
  const belowFold = $('#user-profile-below-fold', rootEl);
  const userPanel = $('#user-profile-panel-user-panel', rootEl);
  if (!topRow) return;

  topRow.classList.toggle('user-profile-top-row--user-grid-open', profileUserGridOpen);
  if (backBtn) backBtn.hidden = false;
  if (belowFold) belowFold.hidden = profileUserGridOpen;
  if (userPanel) userPanel.hidden = !profileUserGridOpen;

  syncProfileNameField();
}

function closeProfileUserGrid() {
  profileUserMenuPicker?.finishOptionEdit?.();
  profileUserGridOpen = false;
  profileUserMenuPicker?.setExpanded?.(false);
  profileUserMenuPicker?.close?.();
  syncProfilePanelLayout();
}

function isProfileUserGridOpen() {
  return Boolean(profileUserGridOpen || profileUserMenuPicker?.isExpanded?.());
}

function isProfileUserGridInteractiveTarget(target) {
  return Boolean(target?.closest(
    '#user-profile-grid-back, #user-profile-voice-samples-back, #user-profile-panel-user-trigger, .lang-picker-collapsible-user-trigger, #user-profile-panel-user-panel, #user-profile-name-delete, #user-profile-samples-btn, .user-profile-session-toggle, .user-profile-session-icon-btn, button, a, input, textarea, select',
  ));
}

function handleProfileBack() {
  if (voiceSamplesPageOpen) {
    setVoiceSamplesPageOpen(false);
    return;
  }
  if (profileUserGridOpen || profileUserMenuPicker?.isExpanded?.()) {
    closeProfileUserGrid();
    return;
  }
  setMenuOpen(false);
}

function syncProfileAvatarDisplay() {
  const user = getStoredUser();
  const userId = user?.id || '';
  const selection = profileUserMenuSelection;

  const trigger = $('#user-profile-trigger', rootEl);
  if (trigger) {
    trigger.innerHTML = buildProfileTriggerSquareHtml(selection, userId, { badges: true });
  }

  profileUserMenuPicker?.refreshTrigger?.();
  if (profileUserMenuPicker?.isExpanded?.()) {
    if (userId) {
      profileUserMenuPicker?.setItems?.(buildProfileGridMenuItems(userId));
    } else {
      profileUserMenuPicker?.refresh?.();
    }
  }
  syncProfilePanelLayout();
}

function buildProfileSquareMarkup() {
  const user = getStoredUser();
  return buildProfileTriggerSquareHtml(profileUserMenuSelection, user?.id, { badges: true });
}

const PROFILE_SPEAK_AUDIO_ICON_SVG = `
  <svg class="user-profile-speak-audio-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M1,16V8A1,1,0,0,1,3,8v8a1,1,0,0,1-2,0Zm7,4V4A1,1,0,0,0,6,4V20a1,1,0,0,0,2,0Zm5,2V2a1,1,0,0,0-2,0V22a1,1,0,0,0,2,0Zm5-2V4a1,1,0,0,0-2,0V20a1,1,0,0,0,2,0ZM22,7a1,1,0,0,0-1,1v8a1,1,0,0,0,2,0V8A1,1,0,0,0,22,7Z"/>
  </svg>
`;

const PROFILE_BACK_ARROW_SVG = `
  <svg class="user-profile-back-arrow-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
  </svg>
`;

const PROFILE_CHECK_ICON = (className) => `
  <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
`;

const PROFILE_RECORDING_MIC_SVG = `
  <svg class="compose-mic-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.03c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
  </svg>
`;

const PROFILE_RECORDING_ACCEPT_SVG = PROFILE_CHECK_ICON('compose-recording-send-icon');

const PROFILE_CLOSE_SESSION_ICON_SVG = `
  <svg class="user-profile-close-session-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
  </svg>
`;

const PROFILE_SHOW_SEED_ICON_SVG = `
  <svg class="user-profile-seed-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
  </svg>
`;

const PROFILE_HIDE_SEED_ICON_SVG = `
  <svg class="user-profile-seed-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
  </svg>
`;

const PROFILE_CREATE_ACCOUNT_ICON_SVG = `
  <svg class="user-profile-create-account-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
  </svg>
`;

const PROFILE_RECORDING_CANCEL_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
`;

const PROFILE_RECORD_AGAIN_ICON_SVG = `
  <svg class="user-profile-record-again-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 2v6h6"/>
    <path d="M21 12a9 9 0 0 0-15-6.7L3 8"/>
    <path d="M21 22v-6h-6"/>
    <path d="M3 12a9 9 0 0 0 15 6.7L21 16"/>
  </svg>
`;

const PROFILE_COPY_ICON_SVG = `
  <svg class="user-profile-copy-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
  </svg>
`;

const SUPER_USER_ID = 'u-super';

let rootEl = null;
let menuOpen = false;
let voiceProfile = null;
let recordingSession = null;
let creatingVoice = false;
let savingSample = false;
let onUserChange = null;
let showToastFn = () => {};
let profileLanguages = [];
let voiceLang = 'en';
const PROFILE_USER_MENU_OPTION_11_SYMBOL = '◎';

let profileUserMenuSelection = null;
let profileUserMenuPicker = null;
let profileUserGridAbortController = null;
let profileUserGridOpen = false;
let voiceSamplesPageOpen = false;

const MIN_SAMPLES = VOICE_SAMPLE_TARGET;
const MIN_VOICE_CLIP_MS = VOICE_MIN_CLIP_SEC * 1000;

function saveProfileGridSlotName(slotNumber, value) {
  const sessionUserId = getStoredUser()?.id;
  const normalizedSlot = normalizeSlotNumber(slotNumber);
  if (!sessionUserId || !normalizedSlot) return;
  if (!shouldSaveProfileSlotName(sessionUserId, normalizedSlot, value)) {
    syncProfileNameField();
    syncProfileAvatarDisplay();
    return;
  }
  saveProfileSlotName(sessionUserId, normalizedSlot, value);
  syncProfileNameField();
  syncProfileAvatarDisplay();
}

function toast(message) {
  showToastFn(message);
}

async function copyPhraseToClipboard(text, { button, ui } = {}) {
  const phrase = text?.trim();
  if (!phrase) return;
  try {
    await navigator.clipboard.writeText(phrase);
    toast(ui?.copiedPhrase || 'Copied');
    if (button) {
      button.classList.add('is-action-ack');
      window.setTimeout(() => button.classList.remove('is-action-ack'), 360);
    }
  } catch {
    toast(ui?.couldNotCopy || 'Could not copy');
  }
}

function getDisplayName(user) {
  return user?.name?.trim() || 'User';
}

function applyDisplayName(user) {
  return user;
}

function getCurrentProfileSlot() {
  const userId = getStoredUser()?.id;
  if (!userId) return null;
  return profileUserMenuSelection ?? loadProfileUserMenuSelection(userId) ?? loadActiveProfileSlot(userId);
}

function syncStoredUserVoiceState() {
  const user = getStoredUser();
  if (!user) return;
  const updated = {
    ...user,
    voiceReady: voiceProfile?.voiceReady ?? false,
    voiceSampleCount: voiceProfile?.sampleCount ?? 0,
    voiceStatus: voiceProfile?.status ?? 'none',
    activeProfileSlot: getCurrentProfileSlot(),
  };
  setStoredUser(updated);
  onUserChange?.(updated);
}

async function deleteProfileSlotVoice(sessionUserId, slotNumber) {
  if (!sessionUserId || !slotNumber) return;
  try {
    await apiFetch(voiceApiPath('/api/voice/profile', slotNumber), { method: 'DELETE' });
  } catch {
    // ignore network errors
  }
}

export function getActiveProfileSlotNumber() {
  return getCurrentProfileSlot();
}

function loadVoiceLangPrefs(user, slotNumber = getCurrentProfileSlot()) {
  if (!user || !slotNumber) return;
  try {
    voiceLang = resolveVoiceLanguage(
      readProfileValue(getVoiceLangStorageKey(user.id, slotNumber))
      || readProfileValue(`${VOICE_LANG_PREFIX}${user.id}`)
      || readProfileValue(`${VOICE_LANG_PREFIX}primary:${user.id}`)
      || 'en',
    );
  } catch {
    voiceLang = 'en';
  }
}

function saveVoiceLangPref(userId, code, slotNumber = getCurrentProfileSlot()) {
  if (!userId || !slotNumber) return;
  try {
    writeProfileValue(getVoiceLangStorageKey(userId, slotNumber), resolveVoiceLanguage(code));
    scheduleProfileSettingsSync();
  } catch {
    // ignore storage errors
  }
}

function updateVoicePromptText() {
  const user = getStoredUser();
  if (!user) return;
  const page = $('#user-profile-voice-samples-page', rootEl);
  if (!page) return;
  const state = getProfileState(user);
  const prompt = getVoicePrompt(
    voiceLang,
    nextPromptIndex(state.sampleCount, state.maxSamples),
  );
  const el = $('.user-profile-prompt-text', page);
  if (el) el.textContent = `"${prompt}"`;
}

async function ensureProfileLanguages() {
  if (profileLanguages.length) return profileLanguages;
  profileLanguages = await loadLanguagesList();
  return profileLanguages;
}

function setupProfileLangPicker(root, user, langSlotId = 'user-profile-voice-samples-lang') {
  const slot = $(`#${langSlotId}`, root);
  if (!slot || !profileLanguages.length) return;

  slot.innerHTML = '';

  createLangPicker(slot, {
    languages: profileLanguages,
    value: voiceLang,
    circle: true,
    inBar: true,
    closeProfileOnOpen: false,
    onChange: (code) => {
      voiceLang = resolveVoiceLanguage(code);
      saveVoiceLangPref(user.id, code, getCurrentProfileSlot());
      renderMenuContent();
    },
    onFocusEdit: () => {
      hideAllLangPickerCarets();
    },
  });
}

function buildProfileGridMenuItems(sessionUserId) {
  const slotNumbers = loadProfileSlotNumbers(sessionUserId);
  const items = slotNumbers.map((number) => {
    const name = loadProfileSlotName(sessionUserId, number);
    const label = getSlotDisplayLabel(sessionUserId, number);
    return {
      key: number,
      ariaLabel: name || `User ${number}`,
      symbol: label,
    };
  });

  if (slotNumbers.length < MAX_PROFILE_SLOTS) {
    items.push({
      key: 'add',
      ariaLabel: 'Add user',
      html: buildProfileAddUserSquareHtml(),
      menuClass: 'user-profile-menu-add-option',
    });
  }

  return items;
}

function buildProfileMenuItems(sessionUserId) {
  return buildProfileGridMenuItems(sessionUserId);
}

async function handleDeleteProfileUser(slotNumber) {
  const sessionUserId = getStoredUser()?.id;
  const normalizedSlot = normalizeSlotNumber(slotNumber);
  if (!sessionUserId || !normalizedSlot) return;

  if (countProfileUsers(sessionUserId) <= 1) {
    toast('Cannot delete the last user');
    return;
  }

  if (!deleteProfileSlot(sessionUserId, normalizedSlot)) {
    toast('Could not delete user');
    return;
  }

  try {
    writeProfileValue(getSlotNameStorageKey(sessionUserId, normalizedSlot), '');
  } catch {
    // ignore storage errors
  }

  await deleteProfileSlotVoice(sessionUserId, normalizedSlot);

  if (profileUserMenuSelection === normalizedSlot) {
    const remaining = loadProfileSlotNumbers(sessionUserId);
    profileUserMenuSelection = remaining[0] ?? null;
    if (profileUserMenuSelection) {
      saveProfileUserMenuSelection(sessionUserId, profileUserMenuSelection);
    }
  }

  profileUserGridOpen = true;
  await refreshUserSession();
  renderMenuContent();
  syncProfileAvatarDisplay();
  toast('User deleted');
}

function handleAddProfileUser() {
  const sessionUserId = getStoredUser()?.id;
  if (!sessionUserId) return;

  const slotNumbers = loadProfileSlotNumbers(sessionUserId);
  if (slotNumbers.length >= MAX_PROFILE_SLOTS) {
    toast('Maximum users created');
    return;
  }

  const slotNumber = addProfileSlot(sessionUserId);
  if (!slotNumber) {
    toast('Maximum users created');
    return;
  }

  profileUserMenuSelection = slotNumber;
  saveProfileUserMenuSelection(sessionUserId, slotNumber);
  profileUserGridOpen = true;
  renderMenuContent();
  syncProfileAvatarDisplay();
  requestAnimationFrame(() => {
    profileUserMenuPicker?.startOptionEdit?.(slotNumber);
  });
}

function setupProfileUserGrid() {
  const triggerSlot = $('#user-profile-panel-user-trigger', rootEl);
  const panelSlot = $('#user-profile-panel-user-panel', rootEl);
  if (!triggerSlot || !panelSlot) return;

  profileUserGridAbortController?.abort();
  profileUserGridAbortController = new AbortController();
  const { signal } = profileUserGridAbortController;

  triggerSlot.innerHTML = '';
  panelSlot.innerHTML = '';

  const user = getStoredUser();
  const sessionUserId = user?.id || '';
  ensureProfileUserMenuSelection(sessionUserId);
  const slotNumbers = loadProfileSlotNumbers(sessionUserId);

  const menuItems = buildProfileMenuItems(sessionUserId);

  profileUserMenuPicker = createCollapsibleNumberedSquareGrid(triggerSlot, {
    signal,
    panelContainer: panelSlot,
    items: menuItems,
    value: profileUserMenuSelection,
    open: profileUserGridOpen,
    onOpenChange: (open) => {
      profileUserGridOpen = open;
      syncProfilePanelLayout();
    },
    getTriggerHtml: () => (
      buildProfileCollapsibleUserTriggerHtml()
    ),
    onChange: (number) => {
      if (recordingSession) cancelVoiceSampleRecording();
      profileUserMenuSelection = number;
      saveProfileUserMenuSelection(sessionUserId, number);
      syncProfileNameField();
      syncProfileAvatarDisplay();
      loadVoiceLangPrefs(getStoredUser(), number);
      void refreshVoiceProfile();
    },
    onOptionAction: (key) => {
      if (key === 'add') {
        handleAddProfileUser();
        return true;
      }
      return false;
    },
    getOptionEditValue: (number) => getSlotEditableName(sessionUserId, number),
    onOptionEditSave: (number, value) => {
      saveProfileGridSlotName(number, value);
    },
    maxEditLength: MAX_SLOT_NAME_CHARS,
  });
}

function setVoiceSamplesPageOpen(open) {
  const wasOpen = voiceSamplesPageOpen;
  voiceSamplesPageOpen = open;
  const page = $('#user-profile-voice-samples-page', rootEl);
  if (page) page.hidden = !open;
  if (open) {
    const user = getStoredUser();
    const slot = getCurrentProfileSlot();
    if (user?.id && slot) saveProfileUserMenuSelection(user.id, slot);
    window.dispatchEvent(new CustomEvent('lingo:close-lang-pickers'));
    void renderVoiceSamplesPage();
  } else if (wasOpen && recordingSession) {
    cancelVoiceSampleRecording();
  }
}

function formatVoiceClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatVoiceTotalSeconds(ms) {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}

function getSavedVoiceDurationMs() {
  if (Number.isFinite(voiceProfile?.totalDurationMs)) {
    return Math.max(0, voiceProfile.totalDurationMs);
  }
  const samples = voiceProfile?.samples;
  if (!Array.isArray(samples)) return 0;
  return samples.reduce((sum, sample) => sum + (Number(sample.durationMs) || 0), 0);
}

function updateProfileRecordingTimer() {
  const timerEl = $('#user-voice-recording-timer', rootEl);
  if (!timerEl || !recordingSession) return;
  const elapsed = Date.now() - recordingSession.startedAt;
  timerEl.textContent = formatVoiceClock(elapsed);
  timerEl.classList.toggle('user-profile-recording-timer--ready', elapsed >= MIN_VOICE_CLIP_MS);
  timerEl.classList.toggle(
    'user-profile-recording-timer--advisable',
    elapsed >= VOICE_ADVISABLE_CLIP_SEC * 1000,
  );
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
  teardownProfileRecordingWave();
  try {
    if (session.recorder.state !== 'inactive') session.recorder.stop();
  } catch {
    // ignore stop errors when discarding
  }
  session.stream.getTracks().forEach((track) => track.stop());
}

function getProfileRecordingToolbar() {
  const page = $('#user-profile-voice-samples-page', rootEl);
  const levelEl = $('#user-voice-level', page);
  const toolbar = levelEl?.closest('.user-profile-recording-toolbar');
  return { page, levelEl, toolbar };
}

function startProfileWaveLoop() {
  cancelAnimationFrame(profileWaveRaf);
  const tick = () => {
    if (!recordingSession) return;
    const { levelEl, toolbar } = getProfileRecordingToolbar();
    profileMicWave.applyMicVoicePulse(levelEl, toolbar);
    updateProfileRecordingTimer();
    profileWaveRaf = requestAnimationFrame(tick);
  };
  profileWaveRaf = requestAnimationFrame(tick);
}

function stopProfileWaveLoop() {
  if (profileWaveRaf) cancelAnimationFrame(profileWaveRaf);
  profileWaveRaf = null;
}

function setupProfileRecordingWave() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!recordingSession) return;
      const { levelEl, toolbar } = getProfileRecordingToolbar();
      profileMicWave.ensureLevelBars(levelEl, toolbar, true);
      profileMicWave.observeWaveResize(levelEl, toolbar, () => Boolean(recordingSession));
      startProfileWaveLoop();
    });
  });
}

function teardownProfileRecordingWave() {
  stopProfileWaveLoop();
  profileMicWave.unobserveWaveResize();
  profileMicWave.teardownMicMeter();
}

async function maybeEnsureVoiceConfigured() {
  const user = getStoredUser();
  if (!user || creatingVoice || recordingSession || savingSample) return;

  const state = getProfileState(user);
  if (state.samplesComplete && state.elevenlabsConfigured && !state.voiceReady) {
    await createVoiceProfile(false);
  }
}

function buildVoiceSamplesProgressMarkup(ui, savedCount, maxSamples, savedDurationMs) {
  const totalSecondsLabel = formatVoiceTotalSeconds(savedDurationMs);
  return `
    <div class="user-profile-samples-progress" aria-label="${escapeHtml(ui.samplesSaved)}: ${savedCount}/${maxSamples}">
      <div class="user-profile-samples-progress-count-row">
        <p class="user-profile-samples-progress-count">${savedCount}/${maxSamples}</p>
        ${PROFILE_SPEAK_AUDIO_ICON_SVG}
      </div>
      <p class="user-profile-duration-total" aria-label="${escapeHtml(totalSecondsLabel)}">
        <span class="user-profile-duration-total-value">${escapeHtml(totalSecondsLabel)}</span>
      </p>
    </div>
  `;
}

function buildVoiceRecordingMarkup({
  ui,
  prompt,
  isRecording,
  recordingAtLimit,
  showRecord,
  savingSample,
  showRecordAgain,
}) {
  return `
    ${recordingAtLimit ? `<p class="user-profile-note">${ui.recordingBlocked}</p>` : ''}

    ${showRecord || (isRecording && !recordingAtLimit) || savingSample ? `
    <div class="user-profile-prompt">
      <p class="user-profile-prompt-text">"${escapeHtml(prompt)}"</p>
    </div>
    ` : ''}

    <div class="user-profile-actions${isRecording ? ' user-profile-actions--recording' : ''}">
      ${savingSample ? `
      <p class="user-profile-note user-profile-saving-note">${escapeHtml(ui.savingSample || 'Saving sample…')}</p>
      ` : isRecording ? `
      <p class="user-profile-recording-timer-wrap" aria-live="polite">
        <span class="user-profile-recording-timer" id="user-voice-recording-timer">0:00</span>
      </p>
      <div class="compose-toolbar user-profile-recording-toolbar">
        <div class="compose-toolbar-left">
          <button
            type="button"
            class="compose-recording-cancel"
            id="user-voice-cancel-btn"
            title="${escapeHtml(ui.cancelRecording)}"
            aria-label="${escapeHtml(ui.cancelRecording)}"
            ${savingSample ? 'disabled' : ''}
          >
            ${PROFILE_RECORDING_CANCEL_SVG}
          </button>
        </div>
        <div class="compose-toolbar-center">
          <div class="compose-level" id="user-voice-level" aria-hidden="true"></div>
        </div>
        <div class="compose-toolbar-right">
          <button
            type="button"
            class="compose-recording-send user-profile-recording-accept"
            id="user-voice-stop-btn"
            title="${escapeHtml(ui.stopSample)}"
            aria-label="${escapeHtml(ui.stopSample)}"
            ${savingSample ? 'disabled' : ''}
          >
            ${PROFILE_RECORDING_ACCEPT_SVG}
          </button>
        </div>
      </div>
      ` : showRecord ? `
      <div class="user-profile-mic-action">
        <div class="user-profile-mic-slot lang-bar-rect-slot">
          <button
            type="button"
            class="user-profile-record-mic user-profile-record-mic--boxed"
            id="user-voice-record-btn"
            title="${escapeHtml(ui.recordSample)}"
            aria-label="${escapeHtml(ui.recordSample)}"
          >
            ${PROFILE_RECORDING_MIC_SVG}
          </button>
        </div>
      </div>
      ` : ''}
    </div>

    ${showRecordAgain ? `
    <div class="user-profile-record-again-wrap">
      <div class="user-profile-mic-slot lang-bar-rect-slot">
        <button
          type="button"
          class="user-profile-record-again-btn"
          id="user-voice-record-again-btn"
          title="${escapeHtml(ui.recordAgain)}"
          aria-label="${escapeHtml(ui.recordAgain)}"
        >${PROFILE_RECORD_AGAIN_ICON_SVG}</button>
      </div>
    </div>
    ` : ''}
  `;
}

function bindVoiceRecordingControls(root) {
  $('#user-voice-record-btn', root)?.addEventListener('click', () => void startVoiceSampleRecording());
  $('#user-voice-stop-btn', root)?.addEventListener('click', () => void stopVoiceSampleRecording());
  $('#user-voice-cancel-btn', root)?.addEventListener('click', () => cancelVoiceSampleRecording());
  $('#user-voice-record-again-btn', root)?.addEventListener('click', () => void resetAllVoiceSamples());
}

async function renderVoiceSamplesPage() {
  const user = getStoredUser();
  const page = $('#user-profile-voice-samples-page', rootEl);
  const main = $('#user-profile-voice-samples-main', page);
  if (!page || !main || !user) return;

  await ensureProfileLanguages();
  loadVoiceLangPrefs(user);
  const ui = getVoiceUi(voiceLang);
  const state = getProfileState(user);
  const { maxSamples, sampleCount, canRecordMore } = state;
  const prompt = getVoicePrompt(voiceLang, nextPromptIndex(sampleCount, maxSamples));
  const isRecording = Boolean(recordingSession);
  const recordingAtLimit = isRecording && !canRecordMore;
  const showRecord = canRecordMore && !isRecording && !creatingVoice && !savingSample;
  const showRecordAgain = sampleCount >= maxSamples && !isRecording && !creatingVoice && !savingSample;
  const savedCount = Math.min(sampleCount, maxSamples);
  const savedDurationMs = getSavedVoiceDurationMs();
  const progressSlot = $('#user-profile-voice-samples-progress', page);
  if (progressSlot) {
    progressSlot.innerHTML = buildVoiceSamplesProgressMarkup(ui, savedCount, maxSamples, savedDurationMs);
  }

  main.innerHTML = buildVoiceRecordingMarkup({
    ui,
    prompt,
    isRecording,
    recordingAtLimit,
    showRecord,
    savingSample,
    showRecordAgain,
  });

  bindVoiceRecordingControls(page);
  setupProfileLangPicker(page, user);
  if (isRecording) {
    setupProfileRecordingWave();
    updateProfileRecordingTimer();
  }
}

async function renderActiveProfileUi() {
  if (voiceSamplesPageOpen) {
    await renderVoiceSamplesPage();
    return;
  }
  await renderMenuContent();
}

async function renderMenuContent() {
  const user = getStoredUser();
  const panel = $('#user-profile-panel', rootEl);
  if (!panel || !user) return;

  await ensureProfileLanguages();
  loadVoiceLangPrefs(user);
  const ui = getVoiceUi(voiceLang);
  const state = getProfileState(user);
  const { maxSamples, sampleCount } = state;
  const savedCount = Math.min(sampleCount, maxSamples);
  const cloneLanguageGroups = formatCloneVoiceLanguageGroups(voiceLang);

  panel.innerHTML = `
    <div class="user-profile-layout">
      <div class="user-profile-top-row user-profile-top-row--nav${profileUserGridOpen ? ' user-profile-top-row--user-grid-open' : ''}">
        <button
          type="button"
          class="user-profile-grid-back lang-bar-rect-slot user-profile-nav-square-slot"
          id="user-profile-grid-back"
          aria-label="Back"
          title="Back"
        >
          <span class="lang-picker-square user-profile-square user-profile-grid-back-square">
            <span class="user-profile-grid-back-glyph" aria-hidden="true">${PROFILE_BACK_ARROW_SVG}</span>
          </span>
        </button>
        <div
          class="user-profile-user-trigger-slot lang-bar-rect-slot user-profile-nav-square-slot"
          id="user-profile-panel-user-trigger"
        ></div>
        <div class="user-profile-name-field user-profile-name-field--plain lang-bar-rect-slot user-profile-nav-square-slot">
          <span
            class="user-profile-name-display-label"
            id="user-profile-name-display"
            aria-live="polite"
            aria-readonly="true"
          ></span>
        </div>
      </div>
      <div
        class="user-profile-user-panel-slot user-profile-square-dropdown"
        id="user-profile-panel-user-panel"
        hidden
      ></div>

      <div class="user-profile-below-fold" id="user-profile-below-fold"${profileUserGridOpen ? ' hidden' : ''}>
        <div class="user-profile-second-row language-bar-row language-bar-row--three">
          <button
            type="button"
            class="user-profile-samples-rect lang-bar-rect-slot user-profile-second-cell--left"
            id="user-profile-samples-btn"
            title="${escapeHtml(ui.samplesSaved)}"
            aria-label="${escapeHtml(ui.samplesSaved)}: ${savedCount}/${maxSamples}"
          >
            <span class="lang-picker-square user-profile-square user-profile-samples-square">
              <span class="user-profile-samples-content">
                ${PROFILE_SPEAK_AUDIO_ICON_SVG}
              </span>
            </span>
          </button>
          <button
            type="button"
            class="user-profile-name-delete lang-bar-rect-slot user-profile-second-cell--right"
            id="user-profile-name-delete"
            aria-label="Delete user"
            title="Delete user"
            hidden
          >
            ${buildProfileDeleteUserSquareHtml()}
          </button>
        </div>

    <div class="user-profile-session-area">
      <div class="user-profile-session-bar">
        <button
          type="button"
          class="user-profile-session-toggle"
          id="user-profile-session-toggle"
          aria-expanded="false"
          aria-controls="user-profile-session-row"
          aria-label="Session options"
        >&gt;_</button>
        <div class="user-profile-session-row" id="user-profile-session-row" hidden>
          <div class="user-profile-session-drawer" id="user-profile-session-drawer">
            ${user.id === SUPER_USER_ID ? `
            <button
              type="button"
              class="user-profile-create-account user-profile-session-icon-btn"
              id="user-profile-create-account"
              title="${escapeHtml(ui.createAccount)}"
              aria-label="${escapeHtml(ui.createAccount)}"
            >${PROFILE_CREATE_ACCOUNT_ICON_SVG}</button>
            ` : ''}
            <button
              type="button"
              class="user-profile-recovery-btn user-profile-session-icon-btn"
              id="user-profile-recovery-toggle"
              title="${escapeHtml(ui.showRecoveryPhrase)}"
              aria-label="${escapeHtml(ui.showRecoveryPhrase)}"
            >${PROFILE_SHOW_SEED_ICON_SVG}</button>
          </div>
          <span class="user-profile-session-spacer" aria-hidden="true"></span>
          <div class="user-profile-session-end">
            <button
              type="button"
              class="user-profile-clone-languages-toggle user-profile-session-icon-btn"
              id="user-profile-clone-languages-toggle"
              aria-expanded="false"
              aria-controls="user-profile-clone-languages-text"
              title="${escapeHtml(ui.showCloneVoiceLanguages)}"
              aria-label="${escapeHtml(ui.showCloneVoiceLanguages)}"
            >*</button>
            <button
              type="button"
              class="user-profile-signout user-profile-session-icon-btn"
              id="user-profile-signout"
              title="${escapeHtml(ui.switchUser)}"
              aria-label="${escapeHtml(ui.switchUser)}"
            >
              ${PROFILE_CLOSE_SESSION_ICON_SVG}
            </button>
          </div>
        </div>
      </div>
      <p
        class="user-profile-clone-languages-text"
        id="user-profile-clone-languages-text"
        hidden
      >
        <span class="user-profile-clone-languages-label">${escapeHtml(ui.cloneVoiceLanguagesFootnote)}</span>
        <span class="user-profile-clone-languages-group">
          <span class="user-profile-clone-languages-tier">${escapeHtml(ui.cloneVoiceLanguagesV2)}:</span>
          ${escapeHtml(cloneLanguageGroups.v2)}
        </span>
        <span class="user-profile-clone-languages-group">
          <span class="user-profile-clone-languages-tier">${escapeHtml(ui.cloneVoiceLanguagesV3)}:</span>
          ${escapeHtml(cloneLanguageGroups.v3)}
        </span>
      </p>
      <div class="user-profile-recovery-wrap" id="user-profile-recovery-wrap" hidden>
        <p class="user-profile-recovery-text" id="user-profile-recovery-text"></p>
        <button
          type="button"
          class="user-profile-recovery-copy"
          id="user-profile-recovery-copy"
          hidden
        >${PROFILE_COPY_ICON_SVG}</button>
      </div>
      <div class="user-profile-recovery-wrap user-profile-admin-seed-wrap" id="user-profile-admin-seed-wrap" hidden>
        <p class="user-profile-recovery-text user-profile-admin-seed" id="user-profile-admin-seed"></p>
        <button
          type="button"
          class="user-profile-recovery-copy"
          id="user-profile-admin-seed-copy"
          hidden
        >${PROFILE_COPY_ICON_SVG}</button>
      </div>
    </div>
      </div>
    </div>
  `;

  $('#user-profile-samples-btn', panel)?.addEventListener('click', () => setVoiceSamplesPageOpen(true));
  $('#user-profile-signout', panel)?.addEventListener('click', () => signOut());
  $('#user-profile-create-account', panel)?.addEventListener('click', () => void createAdminAccount(panel));

  const sessionRow = $('#user-profile-session-row', panel);
  const sessionToggle = $('#user-profile-session-toggle', panel);
  const recoveryToggle = $('#user-profile-recovery-toggle', panel);
  const recoveryWrap = $('#user-profile-recovery-wrap', panel);
  const recoveryText = $('#user-profile-recovery-text', panel);
  const recoveryCopyBtn = $('#user-profile-recovery-copy', panel);
  const adminSeedWrap = $('#user-profile-admin-seed-wrap', panel);
  const adminSeed = $('#user-profile-admin-seed', panel);
  const adminSeedCopyBtn = $('#user-profile-admin-seed-copy', panel);
  const cloneLangToggle = $('#user-profile-clone-languages-toggle', panel);
  const cloneLangText = $('#user-profile-clone-languages-text', panel);

  const setCloneLanguagesOpen = (open) => {
    if (!cloneLangToggle || !cloneLangText) return;
    cloneLangText.hidden = !open;
    cloneLangToggle.setAttribute('aria-expanded', String(open));
    cloneLangToggle.title = open ? ui.hideCloneVoiceLanguages : ui.showCloneVoiceLanguages;
    cloneLangToggle.setAttribute('aria-label', open ? ui.hideCloneVoiceLanguages : ui.showCloneVoiceLanguages);
  };

  sessionToggle?.addEventListener('click', () => {
    const opening = sessionRow?.hidden;
    if (!sessionRow || !sessionToggle) return;

    sessionRow.hidden = !opening;
    sessionToggle.setAttribute('aria-expanded', String(opening));

    if (!opening) {
      setCloneLanguagesOpen(false);
      if (recoveryWrap) recoveryWrap.hidden = true;
      if (recoveryText) recoveryText.textContent = '';
      if (recoveryCopyBtn) recoveryCopyBtn.hidden = true;
      if (adminSeedWrap) adminSeedWrap.hidden = true;
      if (adminSeed) adminSeed.textContent = '';
      if (adminSeedCopyBtn) adminSeedCopyBtn.hidden = true;
      setRecoveryToggleUi(recoveryToggle, voiceLang, false);
    }
  });

  cloneLangToggle?.addEventListener('click', () => {
    setCloneLanguagesOpen(cloneLangText?.hidden);
  });

  recoveryToggle?.addEventListener('click', () => {
    const uiStrings = getVoiceUi(voiceLang);
    const visible = !recoveryWrap?.hidden;
    if (visible) {
      if (recoveryWrap) recoveryWrap.hidden = true;
      if (recoveryText) recoveryText.textContent = '';
      if (recoveryCopyBtn) recoveryCopyBtn.hidden = true;
      setRecoveryToggleUi(recoveryToggle, voiceLang, false);
      return;
    }

    const phrase = getRecoveryPhrase(user.id) || getAuthToken() || '';
    if (!phrase) {
      recoveryText.textContent = uiStrings.recoveryPhraseMissing;
      if (recoveryCopyBtn) recoveryCopyBtn.hidden = true;
    } else {
      recoveryText.textContent = phrase;
      if (recoveryCopyBtn) {
        recoveryCopyBtn.hidden = false;
        recoveryCopyBtn.title = uiStrings.copyPhrase;
        recoveryCopyBtn.setAttribute('aria-label', uiStrings.copyPhrase);
      }
    }
    if (recoveryWrap) recoveryWrap.hidden = false;
    setRecoveryToggleUi(recoveryToggle, voiceLang, true);
  });

  recoveryCopyBtn?.addEventListener('click', () => {
    void copyPhraseToClipboard(recoveryText?.textContent, {
      button: recoveryCopyBtn,
      ui: getVoiceUi(voiceLang),
    });
  });

  adminSeedCopyBtn?.addEventListener('click', () => {
    void copyPhraseToClipboard(adminSeed?.textContent, {
      button: adminSeedCopyBtn,
      ui: getVoiceUi(voiceLang),
    });
  });

  setupProfileUserGrid();
  syncProfileNameField();
  syncProfilePanelLayout();
  syncProfileAvatarDisplay();
  if (voiceSamplesPageOpen) {
    await renderVoiceSamplesPage();
  }
}

async function createAdminAccount(panel) {
  const uiStrings = getVoiceUi(voiceLang);
  const button = $('#user-profile-create-account', panel);
  const adminSeedWrap = $('#user-profile-admin-seed-wrap', panel);
  const adminSeed = $('#user-profile-admin-seed', panel);
  const adminSeedCopyBtn = $('#user-profile-admin-seed-copy', panel);
  const recoveryWrap = $('#user-profile-recovery-wrap', panel);
  const recoveryText = $('#user-profile-recovery-text', panel);
  const recoveryCopyBtn = $('#user-profile-recovery-copy', panel);
  if (button) button.disabled = true;

  try {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || uiStrings.createAccountFailed);
      return;
    }

    if (recoveryWrap) recoveryWrap.hidden = true;
    if (recoveryText) recoveryText.textContent = '';
    if (recoveryCopyBtn) recoveryCopyBtn.hidden = true;
    if (data.recoveryPhrase && adminSeed) {
      adminSeed.textContent = data.recoveryPhrase;
      if (adminSeedWrap) adminSeedWrap.hidden = false;
      if (adminSeedCopyBtn) {
        adminSeedCopyBtn.hidden = false;
        adminSeedCopyBtn.title = uiStrings.copyPhrase;
        adminSeedCopyBtn.setAttribute('aria-label', uiStrings.copyPhrase);
      }
    } else {
      if (adminSeedWrap) adminSeedWrap.hidden = true;
      if (adminSeed) adminSeed.textContent = '';
      if (adminSeedCopyBtn) adminSeedCopyBtn.hidden = true;
    }
  } catch {
    window.alert(uiStrings.createAccountFailed);
  } finally {
    if (button) button.disabled = false;
  }
}

function setRecoveryToggleUi(recoveryToggle, voiceLang, showingPhrase) {
  if (!recoveryToggle) return;
  const uiStrings = getVoiceUi(voiceLang);
  recoveryToggle.innerHTML = showingPhrase
    ? PROFILE_HIDE_SEED_ICON_SVG
    : PROFILE_SHOW_SEED_ICON_SVG;
  const label = showingPhrase ? uiStrings.hideRecoveryPhrase : uiStrings.showRecoveryPhrase;
  recoveryToggle.setAttribute('aria-label', label);
  recoveryToggle.setAttribute('title', label);
}

function getTriggerVisualState(user) {
  if (menuOpen) return 'open';
  const { samplesComplete, voiceReady } = getProfileState(user);
  if (voiceReady || samplesComplete) return 'ready';
  return 'setup';
}

function updateTrigger() {
  const user = getStoredUser();
  const trigger = $('#user-profile-trigger', rootEl);
  if (!trigger) return;

  const visual = getTriggerVisualState(user);
  trigger.dataset.visual = visual;

  const name = getDisplayName(user) || 'User';

  const labels = {
    open: `Close ${name} profile`,
    ready: `Close ${name} profile`,
    setup: `Open ${name} profile`,
  };
  trigger.title = labels[visual];
  trigger.setAttribute('aria-label', labels[visual]);
  syncProfileAvatarDisplay();
}

function setMenuOpen(open) {
  if (!open && menuOpen) {
    profileUserMenuPicker?.finishOptionEdit?.();
  }
  menuOpen = open;
  if (!open) {
    if (recordingSession) cancelVoiceSampleRecording();
    setVoiceSamplesPageOpen(false);
    profileUserMenuPicker?.close?.();
    profileUserGridOpen = false;
  }
  rootEl?.classList.toggle('is-open', open);
  document.documentElement.classList.toggle('user-profile-menu-open', open);
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);
  trigger?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (panel) panel.hidden = !open;
  if (open) {
    window.dispatchEvent(new CustomEvent('lingo:close-lang-pickers'));
  }
  updateTrigger();
}

async function refreshVoiceProfile(slotNumber = getCurrentProfileSlot()) {
  const slot = slotNumber;
  if (!slot) return;

  const res = await apiFetch(voiceApiPath('/api/voice/profile', slot));
  if (!res.ok) return;
  voiceProfile = await res.json();

  const user = getStoredUser();
  const state = getProfileState(user);
  if (!state.canRecordMore && recordingSession) {
    discardActiveRecording();
    toast(`Extra recording discarded — you already have ${state.maxSamples} samples`);
  }

  syncStoredUserVoiceState();
  renderMenuContent();
  updateTrigger();
  await maybeEnsureVoiceConfigured();
}

export async function refreshUserSession() {
  const user = getStoredUser();
  const sessionSlot = getCurrentProfileSlot() ?? loadActiveProfileSlot(user?.id);
  if (user?.id) {
    await hydrateProfileFromServer(user.id);
  }
  const slot = sessionSlot ?? loadActiveProfileSlot(user?.id);
  const data = slot ? await fetchCurrentUser(slot) : await fetchCurrentUser();
  if (data?.user) {
    setStoredUser(applyDisplayName(data.user));
    profileUserMenuSelection = slot ?? loadProfileUserMenuSelection(data.user.id) ?? 1;
    if (profileUserMenuSelection) {
      saveProfileUserMenuSelection(data.user.id, profileUserMenuSelection);
    }
    voiceProfile = data.voiceProfile ? {
      ...data.voiceProfile,
      samples: data.voiceProfile.samples || [],
    } : null;
    syncStoredUserVoiceState();
    if (!voiceProfile) {
      await refreshVoiceProfile();
    } else {
      renderMenuContent();
      updateTrigger();
    }
  }
  updateTrigger();
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
    const mimeType = getRecordingMimeType();
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

    recorder.start(isIosDevice() ? undefined : 250);
    profileMicWave.primeMicAudioOnGesture();
    profileMicWave.prepareMicMeter(stream);
    await renderActiveProfileUi();
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
  const slot = getCurrentProfileSlot();
  if (user?.id && slot) saveProfileUserMenuSelection(user.id, slot);
  const state = getProfileState(user);
  if (!state.canRecordMore) {
    cancelVoiceSampleRecording();
    toast(`You already have ${state.maxSamples} samples`);
    return;
  }

  savingSample = true;
  await renderActiveProfileUi();

  try {
    const blob = await buildRecordingBlob(session.chunks, session.mimeType, session.recorder);
    teardownProfileRecordingWave();
    session.stream.getTracks().forEach((track) => track.stop());
    recordingSession = null;

    const durationMs = Date.now() - session.startedAt;
    if (durationMs < MIN_VOICE_CLIP_MS) {
      toast(getVoiceUi(voiceLang).recordTooShort);
      return;
    }

    if (!blob.size) {
      toast('No audio captured — try again');
      return;
    }

    const form = new FormData();
    form.append('audio', blob, `voice-sample.${session.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
    form.append('durationMs', String(durationMs));
    form.append('slot', String(slot));

    const res = await apiFetch(voiceApiPath('/api/voice/samples', slot), {
      method: 'POST',
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Could not save voice sample');
      await renderActiveProfileUi();
      return;
    }

    toast('Voice sample saved');
    await refreshVoiceProfile(slot);

    if (data.readyForClone && voiceProfile?.elevenlabsConfigured !== false && !getStoredUser()?.voiceReady) {
      await createVoiceProfile(false);
    }
  } catch (err) {
    toast(err.message || 'Could not save voice sample');
    await renderActiveProfileUi();
  } finally {
    savingSample = false;
    if (recordingSession) discardActiveRecording();
    else teardownProfileRecordingWave();
    try {
      session.stream.getTracks().forEach((track) => track.stop());
    } catch {
      // stream may already be stopped
    }
    await renderActiveProfileUi();
  }
}

async function resetAllVoiceSamples() {
  if (recordingSession || savingSample || creatingVoice) return;

  const user = getStoredUser();
  const ui = getVoiceUi(voiceLang);
  if (!window.confirm(ui.confirmRecordAgain)) return;

  const res = await apiFetch(voiceApiPath('/api/voice/samples', getCurrentProfileSlot()), { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(data.error || 'Could not reset samples');
    return;
  }
  toast(ui.recordAgain);
  await refreshUserSession();
}

async function createVoiceProfile(isUpdate) {
  if (creatingVoice) return;
  creatingVoice = true;
  renderMenuContent();

  try {
    const res = await apiFetch(voiceApiPath('/api/voice/create', getCurrentProfileSlot()), { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || 'Could not create voice profile');
      renderMenuContent();
      return;
    }
    toast(isUpdate ? 'Voice profile updated' : 'Personal voice ready');
    await refreshUserSession();
  } catch (err) {
    toast(err.message || 'Could not create voice profile');
    renderMenuContent();
  } finally {
    creatingVoice = false;
    renderMenuContent();
  }
}

function signOut() {
  const user = getStoredUser();
  discardActiveRecording();
  clearAuthSession(user?.id);
  setMenuOpen(false);
  window.dispatchEvent(new CustomEvent('lingo:unauthorized'));
}

function bindMenuEvents() {
  const trigger = $('#user-profile-trigger', rootEl);
  const panel = $('#user-profile-panel', rootEl);

  trigger?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const nextOpen = !menuOpen;
    setMenuOpen(nextOpen);
    if (nextOpen) {
      await ensureProfileLanguages();
      await refreshVoiceProfile();
      await renderMenuContent();
    }
  });

  rootEl?.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#user-profile-grid-back, #user-profile-voice-samples-back')) return;
    event.stopPropagation();
    handleProfileBack();
  }, true);

  panel?.addEventListener('pointerdown', (event) => {
    if (!isProfileUserGridOpen()) return;
    if (isProfileUserGridInteractiveTarget(event.target)) return;
    event.stopPropagation();
    closeProfileUserGrid();
  });

  panel?.addEventListener('click', (event) => {
    if (event.target.closest('#user-profile-name-delete')) {
      event.preventDefault();
      event.stopPropagation();
      const slotNumber = normalizeSlotNumber(profileUserMenuSelection);
      if (slotNumber) void handleDeleteProfileUser(slotNumber);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (menuOpen && rootEl && !rootEl.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && recordingSession) {
      cancelVoiceSampleRecording();
      return;
    }
    if (event.key === 'Escape' && (profileUserMenuPicker?.isExpanded?.() || profileUserGridOpen)) {
      event.stopPropagation();
      closeProfileUserGrid();
      return;
    }
    if (event.key === 'Escape' && voiceSamplesPageOpen) {
      event.stopPropagation();
      setVoiceSamplesPageOpen(false);
      return;
    }
    if (event.key === 'Escape' && menuOpen) {
      const openInnerPanel = panel?.querySelector('.lang-picker-circle-panel:not([hidden]), .lang-picker-square-panel:not([hidden]), .lang-picker-bar-dropdown:not([hidden])');
      if (openInnerPanel) return;
      setMenuOpen(false);
      trigger?.focus();
    }
  });

  const voiceSamplesPage = $('#user-profile-voice-samples-page', rootEl);
  voiceSamplesPage?.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });
}

export function initUserProfile(slotEl, { onChange, showToast } = {}) {
  if (!slotEl) return;
  onUserChange = onChange;
  showToastFn = showToast || (() => {});
  rootEl = document.createElement('div');
  rootEl.className = 'user-profile';
  rootEl.innerHTML = `
    <button type="button" class="user-profile-trigger" id="user-profile-trigger" data-visual="setup" aria-haspopup="true" aria-expanded="false">
      ${buildProfileSquareMarkup()}
    </button>
    <div class="user-profile-panel" id="user-profile-panel" hidden></div>
    <div class="user-profile-voice-samples-page" id="user-profile-voice-samples-page" hidden>
      <div class="user-profile-voice-samples-layout">
        <div class="user-profile-voice-samples-header user-profile-voice-lang-anchor">
          <button
            type="button"
            class="user-profile-voice-samples-back"
            id="user-profile-voice-samples-back"
            aria-label="Go back"
          >${PROFILE_BACK_ARROW_SVG}</button>
          <div class="user-profile-voice-lang-wrap lang-bar-rect-slot">
            <div
              class="user-profile-voice-lang-slot"
              id="user-profile-voice-samples-lang"
            ></div>
          </div>
          <div class="user-profile-voice-samples-progress" id="user-profile-voice-samples-progress"></div>
        </div>
        <div class="user-profile-voice-samples-main" id="user-profile-voice-samples-main"></div>
      </div>
    </div>
  `;
  slotEl.appendChild(rootEl);

  const user = getStoredUser();
  profileUserMenuSelection = loadProfileUserMenuSelection(user?.id);

  bindMenuEvents();
  window.addEventListener('lingo:close-profile-menu', () => setMenuOpen(false));
  void ensureProfileLanguages();
  updateTrigger();
  renderMenuContent();
}
