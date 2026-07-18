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

// Professional Voice Cloning needs far more audio than the instant clone:
// ElevenLabs recommends at least 30 minutes and accepts up to 3 hours.
const PRO_MIN_TOTAL_MS = 30 * 60_000;
const PRO_MAX_TOTAL_MS = 3 * 3_600_000;
const MAX_PRO_SAMPLES = 400;

// Profile metadata lives in Blob storage, which costs a network round-trip
// on every read. /api/speak and the TTS warm-up read the profile on each
// request, so keep a short-lived in-memory copy per instance.
const profileCache = new Map();
const PROFILE_CACHE_TTL_MS = 60_000;

function readProfileCache(key) {
  const hit = profileCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PROFILE_CACHE_TTL_MS) {
    profileCache.delete(key);
    return null;
  }
  return hit.profile;
}

function writeProfileCache(key, profile) {
  profileCache.set(key, { profile, at: Date.now() });
}

function slotPrefix(userId, slotNumber) {
  return `voices/${userId}/slots/${slotNumber}`;
}

function metaKey(userId, slotNumber) {
  return `${slotPrefix(userId, slotNumber)}/meta.json`;
}

function sampleKey(userId, slotNumber, sampleId, ext) {
  return `${slotPrefix(userId, slotNumber)}/samples/${sampleId}.${ext}`;
}

function proSampleKey(userId, slotNumber, sampleId, ext) {
  return `${slotPrefix(userId, slotNumber)}/pro-samples/${sampleId}.${ext}`;
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
    // Professional Voice Clone (PVC) id, used only by the on-demand pro
    // audio path; the fast path always uses elevenlabsVoiceId.
    proVoiceId: null,
    // PVC voice created and fed with samples but not yet verified/trained.
    // Promoted to proVoiceId once training finishes.
    pvcPendingVoiceId: null,
    samples: [],
    // Long-form samples collected for PVC training (30 min – 3 h total).
    proSamples: [],
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
    proSamples: Array.isArray(parsed.proSamples) ? parsed.proSamples : [],
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
  writeProfileCache(metaKey(userId, slotNumber), meta);
}

export { MAX_VOICE_SAMPLES, VOICE_TARGET_DURATION_MS, PRO_MIN_TOTAL_MS, PRO_MAX_TOTAL_MS };

function totalSampleDurationMs(samples) {
  return samples.reduce((sum, sample) => sum + (Number(sample.durationMs) || 0), 0);
}

export async function getVoiceProfile(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const key = metaKey(userId, slot);

  const cached = readProfileCache(key);
  if (cached) return cached;

  let profile = await readMetaFile(key);
  if (!profile && slot === LEGACY_MIGRATION_SLOT) {
    const migrated = await migrateLegacyProfile(userId);
    if (migrated) profile = await readMetaFile(key);
  }

  const resolved = profile || emptyProfile();
  writeProfileCache(key, resolved);
  return resolved;
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

function extForMime(mimeType = 'audio/webm') {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('ogg') || mimeType.includes('opus')) return 'ogg';
  return 'webm';
}

export async function addVoiceSample(userId, slotNumber, buffer, mimeType = 'audio/webm', durationMs = null) {
  const slot = validateProfileSlot(slotNumber);
  const before = await getVoiceProfile(userId, slot);
  if (before.samples.length >= MAX_VOICE_SAMPLES) {
    const err = new Error(`You already have ${MAX_VOICE_SAMPLES} samples`);
    err.code = 'SAMPLE_LIMIT';
    throw err;
  }
  const ext = extForMime(mimeType);
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

export async function addProVoiceSample(userId, slotNumber, buffer, {
  mimeType = 'audio/webm',
  durationMs = null,
} = {}) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);

  if (profile.proSamples.length >= MAX_PRO_SAMPLES) {
    const err = new Error(`You already have ${MAX_PRO_SAMPLES} pro samples`);
    err.code = 'SAMPLE_LIMIT';
    throw err;
  }
  const existingMs = totalSampleDurationMs(profile.proSamples);
  if (existingMs >= PRO_MAX_TOTAL_MS) {
    const err = new Error('You already have 3 hours of pro audio — that is the maximum');
    err.code = 'DURATION_LIMIT';
    throw err;
  }

  const ext = extForMime(mimeType);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeBuffer(proSampleKey(userId, slot, id, ext), buffer, mimeType);

  const safeDurationMs = Number(durationMs);
  profile.proSamples.push({
    id,
    ext,
    mimeType,
    createdAt: Date.now(),
    sizeBytes: buffer.length,
    ...(Number.isFinite(safeDurationMs) && safeDurationMs > 0
      ? { durationMs: Math.round(safeDurationMs) }
      : {}),
  });

  await writeMeta(userId, slot, profile);
  return profile;
}

export async function deleteProVoiceSample(userId, slotNumber, sampleId) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  const sample = profile.proSamples.find((entry) => entry.id === sampleId);
  if (!sample) return null;

  profile.proSamples = profile.proSamples.filter((entry) => entry.id !== sampleId);
  await deleteFile(proSampleKey(userId, slot, sample.id, sample.ext));
  await writeMeta(userId, slot, profile);
  return profile;
}

export async function clearAllProVoiceSamples(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);

  for (const sample of profile.proSamples) {
    await deleteFile(proSampleKey(userId, slot, sample.id, sample.ext));
  }

  profile.proSamples = [];
  await writeMeta(userId, slot, profile);
  return profile;
}

export async function listProVoiceSampleBuffers(userId, slotNumber) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  const buffers = [];

  for (const sample of profile.proSamples) {
    const buffer = await readBuffer(proSampleKey(userId, slot, sample.id, sample.ext));
    if (buffer) {
      buffers.push({
        id: sample.id,
        buffer,
        ext: sample.ext,
        mimeType: sample.mimeType || 'audio/webm',
        name: `pro-sample-${sample.id}.${sample.ext}`,
      });
    }
  }

  return { profile, buffers };
}

export async function savePvcPendingVoice(userId, slotNumber, pvcVoiceId) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  profile.pvcPendingVoiceId = pvcVoiceId || null;
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
  profileCache.delete(metaKey(userId, slot));
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

export async function saveProVoice(userId, slotNumber, proVoiceId) {
  const slot = validateProfileSlot(slotNumber);
  const profile = await getVoiceProfile(userId, slot);
  profile.proVoiceId = proVoiceId || null;
  await writeMeta(userId, slot, profile);
  return profile;
}

export function resolveVoiceId(user, voiceProfile) {
  return voiceProfile?.elevenlabsVoiceId || user?.elevenlabsVoiceId || null;
}

export function resolveProVoiceId(voiceProfile) {
  return voiceProfile?.proVoiceId || process.env.ELEVENLABS_PRO_VOICE_ID?.trim() || null;
}

export function voiceProfileSummary(voiceProfile) {
  const totalDurationMs = totalSampleDurationMs(voiceProfile.samples);
  const proSamples = voiceProfile.proSamples || [];
  const proTotalDurationMs = totalSampleDurationMs(proSamples);
  return {
    status: voiceProfile.status,
    sampleCount: voiceProfile.samples.length,
    voiceReady: Boolean(voiceProfile.elevenlabsVoiceId),
    proVoiceReady: Boolean(resolveProVoiceId(voiceProfile)),
    elevenlabsConfigured: true,
    minSamples: MAX_VOICE_SAMPLES,
    maxSamples: MAX_VOICE_SAMPLES,
    canRecordMore: voiceProfile.samples.length < MAX_VOICE_SAMPLES,
    totalDurationMs,
    targetDurationMs: VOICE_TARGET_DURATION_MS,
    proSampleCount: proSamples.length,
    proTotalDurationMs,
    proMinTotalMs: PRO_MIN_TOTAL_MS,
    proMaxTotalMs: PRO_MAX_TOTAL_MS,
    pvcSubmitted: Boolean(voiceProfile.pvcPendingVoiceId),
  };
}
