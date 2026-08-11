export const SLOT_NAME_PREFIX = 'lingo-profile-slot-name:';
export const VOICE_LANG_PREFIX = 'lingo-voice-lang:';

export function getSlotNameStorageKey(userId, slotNumber) {
  return `${SLOT_NAME_PREFIX}${userId}:${slotNumber}`;
}

// When the slot name was last changed on this device. Cross-device sync is
// last-write-wins, so every rename (or clear) records its moment.
export function getSlotNameUpdatedAtStorageKey(userId, slotNumber) {
  return `${SLOT_NAME_PREFIX}${userId}:${slotNumber}:at`;
}

export function getVoiceLangStorageKey(userId, slotNumber) {
  return `${VOICE_LANG_PREFIX}${userId}:${slotNumber}`;
}
