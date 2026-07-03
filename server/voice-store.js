import {
  deleteFile,
  deletePrefix,
  readBuffer,
  readText,
  writeBuffer,
  writeText,
} from './persistent-store.js';

const MAX_PROFILE_SLOT = 11;
const LEGACY_MIGRATION_SLOT = 1;

const MAX_VOICE_SAMPLES = 6;
const VOICE_TARGET_DURATION_MS = 90_000;

function slotPrefix(userId, slotNumber) {
  return `voices/${userId}/slots/${slotNumber}`;
}

function metaKey(userId, slotNumber) {
  return `${slotPrefix(userId, slotNumber)}/meta.json`;
}

function sampleKey(userId, slotNumber, sampleId, ext) {
  return `${slotPrefix(userId, slotNumber)}/samples/${sampleId}.${ext}`;
}

function legacyMetaKey(userId) {
  return `voices/${userId}/meta.json`;
}

function legacySampleKey(userId, sampleId, ext) {
  return `voices/${userId}/samples/${sampleId}.${ext}`;
}

function emptyProfile() {
  return {
    status: 'none',
    elevenlabsVoiceId: null,
    samples: [],
    updatedAt: null,
  };
}

export function validateProfileSlot(slotNumber) {
  const slot = Number(slotNumber);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_PROFILE_SLOT) {
    const err = new Error(`Profile slot must be an integer from 1 to ${MAX_PROFILE_SLOT}`);
    err.code = 'INVALID_SLOT';
    throw err;
  }
  return slot;
}

function parseMeta(raw) {
  const parsed = JSON.parse(raw);
  return {
    ...emptyProfile(),
    ...parsed,
    samples: Array.isArray(parsed.samples) ? parsed.samples : [],
  };
}

async function readMetaFile(key) {
  const raw = await readText(key);
  if (!raw) return null;
  return parseMeta(raw);
}

async function migrateLegacyProfile(userId) {
  const legacyMeta = await readMetaFile(legacyMetaKey(userId));
  if (!legacyMeta) return false;

  const profile = { ...legacyMeta };
  const slot = LEGACY_MIGRATION_SLOT;

  for (const sample of profile.samples) {
    const source = await readBuffer(legacySampleKey(userId, sample.id, sample.ext));
    if (source) {
      await writeBuffer(sampleKey(userId, slot, sample.id, sample.ext), source, sample.mimeType || 'audio/webm');
    }
  }

  profile.updatedAt = Date.now();
  await writeText(metaKey(userId, slot), JSON.stringify(profile, null, 2));
  await deletePrefix(`voices/${userId}/samples`);
  await deleteFile(legacyMetaKey(userId));
  return true;
}

async function writeMeta(userId, slotNumber, meta) {
  meta.updatedAt = Date.now();
  await writeText(metaKey(userId, slotNumber), JSON.stringify(meta, null, 2));
}

export { MAX_VOICE_SAMPLES, VOICE_TARGET_DURATION_MS };

function totalSampleDurationMs(samples) {
  return samples.reduce((sum, sample) => sum + (Number(sample.durationMs) || 0), 0);
}

export async function getVoiceProfile(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const key = metaKey(userId, slot);

  let profile = await readMetaFile(key);
  if (profile) return profile;

  if (slot === LEGACY_MIGRATION_SLOT) {
    const migrated = await migrateLegacyProfile(userId);
    if (migrated) {
      profile = await readMetaFile(key);
      if (profile) return profile;
    }
  }

  return emptyProfile();
}

export async function listVoiceSampleBuffers(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  const buffers = [];

  for (const sample of profile.samples) {
    const buffer = await readBuffer(sampleKey(userId, slot, sample.id, sample.ext));
    if (buffer) {
      buffers.push({ id: sample.id, buffer, ext: sample.ext, mimeType: sample.mimeType || 'audio/webm' });
    }
  }

  return { profile, buffers };
}

export async function addVoiceSample(userId, slotNumber, buffer, mimeType = 'audio/webm', durationMs = null) {
  const slot = validateProfileSlot(slotNumber);
  const before = await getVoiceProfile(userId, slot);
  if (before.samples.length >= MAX_VOICE_SAMPLES) {
    const err = new Error(`You already have ${MAX_VOICE_SAMPLES} samples`);
    err.code = 'SAMPLE_LIMIT';
    throw err;
  }
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await writeBuffer(sampleKey(userId, slot, id, ext), buffer, mimeType);

  const profile = await getVoiceProfile(userId, slot);
  if (profile.samples.some((entry) => entry.id === id)) {
    return profile;
  }
  if (profile.samples.length >= MAX_VOICE_SAMPLES) {
    const err = new Error(`You already have ${MAX_VOICE_SAMPLES} samples`);
    err.code = 'SAMPLE_LIMIT';
    throw err;
  }

  const safeDurationMs = Number(durationMs);
  profile.samples.push({
    id,
    ext,
    mimeType,
    createdAt: Date.now(),
    ...(Number.isFinite(safeDurationMs) && safeDurationMs > 0
      ? { durationMs: Math.round(safeDurationMs) }
      : {}),
  });
  profile.status = profile.elevenlabsVoiceId ? 'needs_update' : 'collecting';

  await writeMeta(userId, slot, profile);
  return profile;
}

export async function deleteVoiceSample(userId, slotNumber, sampleId) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  const sample = profile.samples.find((entry) => entry.id === sampleId);
  if (!sample) return null;

  profile.samples = profile.samples.filter((entry) => entry.id !== sampleId);
  await deleteFile(sampleKey(userId, slot, sample.id, sample.ext));

  if (!profile.samples.length) {
    profile.status = profile.elevenlabsVoiceId ? 'needs_update' : 'none';
  } else if (!profile.elevenlabsVoiceId) {
    profile.status = 'collecting';
  } else {
    profile.status = 'needs_update';
  }

  await writeMeta(userId, slot, profile);
  return profile;
}

export async function clearAllVoiceSamples(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);

  for (const sample of profile.samples) {
    await deleteFile(sampleKey(userId, slot, sample.id, sample.ext));
  }

  profile.samples = [];
  profile.elevenlabsVoiceId = null;
  profile.status = 'none';
  await writeMeta(userId, slot, profile);
  return profile;
}

export async function deleteVoiceProfileSlot(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  await deletePrefix(`${slotPrefix(userId, slot)}/`);
  return emptyProfile();
}

export async function saveVoiceClone(userId, slotNumber, elevenlabsVoiceId) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  profile.elevenlabsVoiceId = elevenlabsVoiceId;
  profile.status = 'ready';
  await writeMeta(userId, slot, profile);
  return profile;
}

export async function clearVoiceClone(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  profile.elevenlabsVoiceId = null;
  profile.status = profile.samples.length ? 'collecting' : 'none';
  await writeMeta(userId, slot, profile);
  return profile;
}

export function resolveVoiceId(user, voiceProfile) {
  return voiceProfile?.elevenlabsVoiceId || user?.elevenlabsVoiceId || null;
}

export function voiceProfileSummary(voiceProfile) {
  const totalDurationMs = totalSampleDurationMs(voiceProfile.samples);
  return {
    status: voiceProfile.status,
    sampleCount: voiceProfile.samples.length,
    voiceReady: Boolean(voiceProfile.elevenlabsVoiceId),
    elevenlabsConfigured: true,
    minSamples: MAX_VOICE_SAMPLES,
    maxSamples: MAX_VOICE_SAMPLES,
    canRecordMore: voiceProfile.samples.length < MAX_VOICE_SAMPLES,
    totalDurationMs,
    targetDurationMs: VOICE_TARGET_DURATION_MS,
  };
}
