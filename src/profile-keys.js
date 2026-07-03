export const SLOT_NAME_PREFIX = 'lingo-profile-slot-name:';
export const VOICE_LANG_PREFIX = 'lingo-voice-lang:';

export function getSlotNameStorageKey(userId, slotNumber) {
  return `${SLOT_NAME_PREFIX}${userId}:${slotNumber}`;
}

export function getVoiceLangStorageKey(userId, slotNumber) {
  return `${VOICE_LANG_PREFIX}${userId}:${slotNumber}`;
}
