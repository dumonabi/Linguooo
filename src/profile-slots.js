import { readProfileValue, writeProfileValue } from './profile-storage.js';
import { scheduleProfileSettingsSync } from './profile-sync.js';
import { removeKey } from './auth-storage.js';

export const MAX_PROFILE_USERS = 11;
export const MAX_PROFILE_SLOTS = MAX_PROFILE_USERS;

const SLOTS_REGISTRY_PREFIX = 'lingo-profile-slots:';
const DEFAULT_SLOT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];

function getSlotsRegistryKey(sessionUserId) {
  return `${SLOTS_REGISTRY_PREFIX}${sessionUserId}`;
}

export function loadProfileSlotNumbers(sessionUserId) {
  if (!sessionUserId) return [];
  try {
    const raw = readProfileValue(getSlotsRegistryKey(sessionUserId));
    if (!raw) return [...DEFAULT_SLOT_NUMBERS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_SLOT_NUMBERS];
    const numbers = parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_PROFILE_SLOTS);
    return numbers.length ? [...new Set(numbers)].sort((a, b) => a - b) : [...DEFAULT_SLOT_NUMBERS];
  } catch {
    return [...DEFAULT_SLOT_NUMBERS];
  }
}

export function saveProfileSlotNumbers(sessionUserId, numbers) {
  if (!sessionUserId) return;
  try {
    const normalized = [...new Set(numbers)]
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_PROFILE_SLOTS)
      .sort((a, b) => a - b);
    writeProfileValue(getSlotsRegistryKey(sessionUserId), JSON.stringify(normalized));
    scheduleProfileSettingsSync();
  } catch {
    // ignore storage errors
  }
}

export function addProfileSlot(sessionUserId) {
  const slots = loadProfileSlotNumbers(sessionUserId);
  for (let number = 1; number <= MAX_PROFILE_SLOTS; number += 1) {
    if (!slots.includes(number)) {
      slots.push(number);
      saveProfileSlotNumbers(sessionUserId, slots);
      return number;
    }
  }
  return null;
}

export function deleteProfileSlot(sessionUserId, slotNumber) {
  const slot = Number(slotNumber);
  if (!Number.isInteger(slot)) return false;
  const slots = loadProfileSlotNumbers(sessionUserId);
  if (slots.length <= 1) return false;
  if (!slots.includes(slot)) return false;
  saveProfileSlotNumbers(sessionUserId, slots.filter((number) => number !== slot));
  return true;
}

export function canDeleteProfileSlot(sessionUserId, slotNumber) {
  const slot = Number(slotNumber);
  const slots = loadProfileSlotNumbers(sessionUserId);
  return slots.length > 1 && slots.includes(slot);
}
