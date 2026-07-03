import { apiFetch, getStoredUser } from './auth.js';
import {
  getProfileMenuSelectionStorageKey,
  loadActiveProfileSlot,
} from './profile-active-slot.js';
import {
  loadProfileSlotNumbers,
  MAX_PROFILE_SLOTS,
  saveProfileSlotNumbers,
} from './profile-slots.js';
import { readProfileValue, writeProfileValue } from './profile-storage.js';
import {
  getSlotNameStorageKey,
  getVoiceLangStorageKey,
} from './profile-keys.js';

const MAX_SLOT_NAME_CHARS = 8;

let syncTimer = null;
let hydrating = false;

function normalizeSlotList(slots) {
  return [...new Set(
    (Array.isArray(slots) ? slots : [])
      .map((value) => Number(value))
      .filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= MAX_PROFILE_SLOTS),
  )].sort((a, b) => a - b);
}

function collectLocalProfileSettings(userId) {
  const slots = loadProfileSlotNumbers(userId);
  const slotNames = {};
  const voiceLangBySlot = {};

  for (const slot of slots) {
    const name = readProfileValue(getSlotNameStorageKey(userId, slot))?.trim();
    if (name) slotNames[String(slot)] = name.slice(0, MAX_SLOT_NAME_CHARS);

    const lang = readProfileValue(getVoiceLangStorageKey(userId, slot))?.trim();
    if (lang) voiceLangBySlot[String(slot)] = lang;
  }

  return {
    slots,
    slotNames,
    activeSlot: loadActiveProfileSlot(userId),
    voiceLangBySlot,
  };
}

function mergeProfileSettings(localSnapshot, serverData, voiceOccupied) {
  const mergedSlots = normalizeSlotList([
    ...(localSnapshot.slots || []),
    ...(Array.isArray(serverData?.slots) ? serverData.slots : []),
    ...voiceOccupied,
  ]);

  const slotNames = {
    ...(serverData?.slotNames && typeof serverData.slotNames === 'object' ? serverData.slotNames : {}),
    ...localSnapshot.slotNames,
  };

  const voiceLangBySlot = {
    ...(serverData?.voiceLangBySlot && typeof serverData.voiceLangBySlot === 'object'
      ? serverData.voiceLangBySlot
      : {}),
    ...localSnapshot.voiceLangBySlot,
  };

  const serverActive = Number(serverData?.activeSlot);
  const localActive = Number(localSnapshot.activeSlot);
  let activeSlot = localActive;
  if (!Number.isInteger(activeSlot) || activeSlot < 1 || activeSlot > MAX_PROFILE_SLOTS) {
    activeSlot = serverActive;
  }
  if (!Number.isInteger(activeSlot) || activeSlot < 1 || activeSlot > MAX_PROFILE_SLOTS) {
    activeSlot = mergedSlots[0] ?? 1;
  }
  if (mergedSlots.length && !mergedSlots.includes(activeSlot)) {
    activeSlot = mergedSlots[0];
  }

  return {
    slots: mergedSlots.length ? mergedSlots : localSnapshot.slots,
    slotNames,
    activeSlot,
    voiceLangBySlot,
  };
}

function applyProfileSettingsLocally(userId, settings) {
  if (settings.slots?.length) {
    saveProfileSlotNumbers(userId, settings.slots);
  }

  for (const [slot, name] of Object.entries(settings.slotNames || {})) {
    writeProfileValue(
      getSlotNameStorageKey(userId, slot),
      String(name || '').trim().slice(0, MAX_SLOT_NAME_CHARS),
    );
  }

  for (const [slot, lang] of Object.entries(settings.voiceLangBySlot || {})) {
    const normalized = String(lang || '').trim().toLowerCase();
    if (normalized) {
      writeProfileValue(getVoiceLangStorageKey(userId, slot), normalized);
    }
  }

  const activeSlot = Number(settings.activeSlot);
  if (Number.isInteger(activeSlot) && activeSlot >= 1 && activeSlot <= MAX_PROFILE_SLOTS) {
    writeProfileValue(getProfileMenuSelectionStorageKey(userId), String(activeSlot));
  }
}

function settingsDiffer(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export function scheduleProfileSettingsSync() {
  if (hydrating) return;
  const userId = getStoredUser()?.id;
  if (!userId) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    void pushProfileSettingsToServer(userId);
  }, 400);
}

export async function pushProfileSettingsToServer(userId = getStoredUser()?.id) {
  if (!userId || hydrating) return null;
  try {
    const res = await apiFetch('/api/profile/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectLocalProfileSettings(userId)),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function pullProfileSettingsFromServer(userId = getStoredUser()?.id) {
  if (!userId) return null;
  try {
    const res = await apiFetch('/api/profile/settings');
    if (!res.ok) return null;
    return res.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function hydrateProfileFromServer(userId = getStoredUser()?.id) {
  if (!userId) return false;

  hydrating = true;
  let merged = null;
  let serverData = null;
  let success = false;

  try {
    const localSnapshot = collectLocalProfileSettings(userId);
    serverData = await pullProfileSettingsFromServer(userId);
    if (!serverData) return false;

    const voiceOccupied = (serverData.voiceSlots || [])
      .map((entry) => Number(entry.slot))
      .filter((slot) => Number.isInteger(slot) && slot >= 1 && slot <= MAX_PROFILE_SLOTS);

    merged = mergeProfileSettings(localSnapshot, serverData, voiceOccupied);
    applyProfileSettingsLocally(userId, merged);
    success = true;
  } finally {
    hydrating = false;
  }

  if (!success || !merged || !serverData) return false;

  const serverPayload = {
    slots: normalizeSlotList(serverData.slots),
    slotNames: serverData.slotNames || {},
    activeSlot: Number(serverData.activeSlot) || 1,
    voiceLangBySlot: serverData.voiceLangBySlot || {},
  };
  const mergedPayload = {
    slots: merged.slots,
    slotNames: merged.slotNames,
    activeSlot: merged.activeSlot,
    voiceLangBySlot: merged.voiceLangBySlot,
  };

  if (settingsDiffer(serverPayload, mergedPayload)) {
    await pushProfileSettingsToServer(userId);
  }

  return true;
}
