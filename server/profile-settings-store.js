import { readText, writeText } from './persistent-store.js';
import { getVoiceProfile, voiceProfileSummary } from './voice-store.js';

export const MAX_PROFILE_SLOT = 11;
const DEFAULT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];
const MAX_SLOT_NAME_CHARS = 8;

function settingsKey(userId) {
  return `profiles/${userId}/settings.json`;
}

function normalizeSlots(slots) {
  if (!Array.isArray(slots)) return [];
  return [...new Set(
    slots
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_PROFILE_SLOT),
  )].sort((a, b) => a - b);
}

function normalizeSlotNames(slotNames) {
  if (!slotNames || typeof slotNames !== 'object') return {};
  const normalized = {};
  for (const [rawSlot, rawName] of Object.entries(slotNames)) {
    const slot = Number(rawSlot);
    const name = String(rawName || '').trim().slice(0, MAX_SLOT_NAME_CHARS);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PROFILE_SLOT || !name) continue;
    normalized[String(slot)] = name;
  }
  return normalized;
}

function normalizeSlotNamesUpdatedAt(slotNamesUpdatedAt) {
  if (!slotNamesUpdatedAt || typeof slotNamesUpdatedAt !== 'object') return {};
  const normalized = {};
  for (const [rawSlot, rawAt] of Object.entries(slotNamesUpdatedAt)) {
    const slot = Number(rawSlot);
    const at = Number(rawAt);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PROFILE_SLOT) continue;
    if (!Number.isFinite(at) || at <= 0) continue;
    normalized[String(slot)] = Math.round(at);
  }
  return normalized;
}

// Slot names sync last-write-wins across devices: for each slot, the entry
// with the newest timestamp survives — whether it comes from this request or
// from what is already stored. A timestamp without a name is a deletion.
function mergeSlotNames(stored, input) {
  const storedNames = normalizeSlotNames(stored?.slotNames);
  const storedAt = normalizeSlotNamesUpdatedAt(stored?.slotNamesUpdatedAt);
  const inputNames = normalizeSlotNames(input.slotNames);
  const inputAt = normalizeSlotNamesUpdatedAt(input.slotNamesUpdatedAt);

  // Legacy clients send no timestamps; keep their old replace semantics so
  // renames from a not-yet-updated device still work.
  if (!input.slotNamesUpdatedAt || typeof input.slotNamesUpdatedAt !== 'object') {
    return { slotNames: inputNames, slotNamesUpdatedAt: storedAt };
  }

  const slotNames = {};
  const slotNamesUpdatedAt = {};
  const slots = new Set([
    ...Object.keys(storedNames),
    ...Object.keys(storedAt),
    ...Object.keys(inputNames),
    ...Object.keys(inputAt),
  ]);
  for (const slot of slots) {
    const useInput = (inputAt[slot] || 0) >= (storedAt[slot] || 0);
    const name = useInput ? inputNames[slot] : storedNames[slot];
    const at = useInput ? inputAt[slot] : storedAt[slot];
    if (name) slotNames[slot] = name;
    if (at) slotNamesUpdatedAt[slot] = at;
  }
  return { slotNames, slotNamesUpdatedAt };
}

function normalizeVoiceLangBySlot(voiceLangBySlot) {
  if (!voiceLangBySlot || typeof voiceLangBySlot !== 'object') return {};
  const normalized = {};
  for (const [rawSlot, rawLang] of Object.entries(voiceLangBySlot)) {
    const slot = Number(rawSlot);
    const lang = String(rawLang || '').trim().toLowerCase().slice(0, 12);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PROFILE_SLOT || !lang) continue;
    normalized[String(slot)] = lang;
  }
  return normalized;
}

function normalizeActiveSlot(activeSlot, slots) {
  const slot = Number(activeSlot);
  if (Number.isInteger(slot) && slots.includes(slot)) return slot;
  return slots[0] ?? 1;
}

function slotHasVoiceData(profile) {
  return Boolean(
    profile?.samples?.length
    || profile?.elevenlabsVoiceId
    || (profile?.status && profile.status !== 'none'),
  );
}

export async function listVoiceSlotSummaries(userId) {
  const summaries = [];
  for (let slot = 1; slot <= MAX_PROFILE_SLOT; slot += 1) {
    const profile = await getVoiceProfile(userId, slot);
    if (!slotHasVoiceData(profile)) continue;
    summaries.push({
      slot,
      ...voiceProfileSummary(profile),
    });
  }
  return summaries;
}

async function readStoredSettings(userId) {
  const raw = await readText(settingsKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mergeSlots(storedSlots, voiceSlotNumbers) {
  let slots = normalizeSlots(storedSlots);
  if (!slots.length) slots = [...DEFAULT_SLOTS];
  slots = normalizeSlots([...slots, ...voiceSlotNumbers]);
  return slots.length ? slots : [...DEFAULT_SLOTS];
}

function buildSettingsPayload(stored, voiceSlots) {
  const voiceSlotNumbers = voiceSlots.map((entry) => entry.slot);
  const slots = mergeSlots(stored?.slots, voiceSlotNumbers);
  const slotNames = normalizeSlotNames(stored?.slotNames);
  const voiceLangBySlot = normalizeVoiceLangBySlot(stored?.voiceLangBySlot);
  const activeSlot = normalizeActiveSlot(stored?.activeSlot, slots);

  return {
    slots,
    slotNames,
    slotNamesUpdatedAt: normalizeSlotNamesUpdatedAt(stored?.slotNamesUpdatedAt),
    activeSlot,
    voiceLangBySlot,
    voiceSlots,
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function getProfileSettings(userId) {
  const [stored, voiceSlots] = await Promise.all([
    readStoredSettings(userId),
    listVoiceSlotSummaries(userId),
  ]);
  return buildSettingsPayload(stored, voiceSlots);
}

export async function saveProfileSettings(userId, input = {}) {
  const [previous, voiceSlots] = await Promise.all([
    readStoredSettings(userId),
    listVoiceSlotSummaries(userId),
  ]);
  const voiceSlotNumbers = voiceSlots.map((entry) => entry.slot);
  const slots = mergeSlots(input.slots, voiceSlotNumbers);
  const { slotNames, slotNamesUpdatedAt } = mergeSlotNames(previous, input);
  const voiceLangBySlot = normalizeVoiceLangBySlot(input.voiceLangBySlot);
  const activeSlot = normalizeActiveSlot(input.activeSlot, slots);
  const stored = {
    slots,
    slotNames,
    slotNamesUpdatedAt,
    activeSlot,
    voiceLangBySlot,
    updatedAt: Date.now(),
  };

  await writeText(settingsKey(userId), JSON.stringify(stored, null, 2));
  return buildSettingsPayload(stored, voiceSlots);
}
