// On-device voice matching for automatic pro-sample collection.
//
// Once the user has the instant clone samples (~90 s), those recordings
// define a reference voiceprint. Every accepted dictation is embedded with
// the same model, and only clips whose cosine similarity clears the
// threshold are uploaded to the pro-voice sample bank (rolling window on
// the server). Other people talking into the translator stay out.
//
// Everything runs locally: a ~26 MB eres2net speaker-embedding ONNX model
// (lazy-loaded once, cached by the browser) over onnxruntime-web. The
// threshold was calibrated against sherpa-onnx reference speakers and two
// TTS voices — same speaker scores ≥0.70, different speakers ≤0.38 — see
// scripts/validate-voice-match.mjs.

import { computeFbankFeatures, cosineSimilarity, FBANK_NUM_BINS, FBANK_SAMPLE_RATE } from './fbank.js';
import { apiFetch, getStoredUser } from './auth.js';
import { loadActiveProfileSlot } from './profile-active-slot.js';

const MATCH_THRESHOLD = 0.55;
const MIN_CLIP_MS = 4000;
const MODEL_URL = '/models/speaker-eres2net.onnx';
const VOICEPRINT_CACHE_KEY = 'lingo-voiceprint';
const AUTO_COLLECT_KEY = 'lingo-voice-auto-collect';

let sessionPromise = null;
let collecting = false;

// ---- settings ----

function settingKey(userId, slot) {
  return `${AUTO_COLLECT_KEY}:${userId}:${slot}`;
}

export function isAutoCollectEnabled(userId, slot) {
  try {
    return localStorage.getItem(settingKey(userId, slot)) !== '0';
  } catch {
    return true;
  }
}

export function setAutoCollectEnabled(userId, slot, enabled) {
  try {
    localStorage.setItem(settingKey(userId, slot), enabled ? '1' : '0');
  } catch { /* storage full — stays enabled by default */ }
}

// ---- model ----

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // The /wasm build is CPU-only: it skips the 26 MB WebGPU (jsep)
      // binary that the default export would drag into the bundle, and it
      // carries its own .wasm asset so no wasmPaths setup is needed.
      const ort = await import('onnxruntime-web/wasm');
      // Without cross-origin isolation there is no SharedArrayBuffer;
      // single-threaded wasm works everywhere and is fast enough here.
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
      });
      return { ort, session };
    })().catch((err) => {
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

// ---- audio → embedding ----

async function decodeToMono16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const probeCtx = new AC();
  let decoded;
  try {
    decoded = await probeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void probeCtx.close().catch(() => {});
  }

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const length = Math.ceil(decoded.duration * FBANK_SAMPLE_RATE);
  const offline = new OfflineCtx(1, length, FBANK_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

async function embedSamples(samples) {
  const { ort, session } = await getSession();
  const { frames, numFrames } = computeFbankFeatures(samples);
  if (numFrames < 25) throw new Error('Clip too short to embed');
  const tensor = new ort.Tensor('float32', frames, [1, numFrames, FBANK_NUM_BINS]);
  const results = await session.run({ x: tensor });
  return Float32Array.from(results.embedding.data);
}

async function embedBlob(blob) {
  return embedSamples(await decodeToMono16k(blob));
}

// Exported for in-browser diagnostics (loads the model on first call).
export { embedSamples as embedAudioSamples };

// ---- reference voiceprint ----

function voiceprintCacheKey(userId, slot) {
  return `${VOICEPRINT_CACHE_KEY}:${userId}:${slot}`;
}

function readCachedVoiceprint(userId, slot, samplesKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(voiceprintCacheKey(userId, slot)) || 'null');
    if (parsed?.samplesKey !== samplesKey || !Array.isArray(parsed.embedding)) return null;
    return Float32Array.from(parsed.embedding);
  } catch {
    return null;
  }
}

function writeCachedVoiceprint(userId, slot, samplesKey, embedding) {
  try {
    localStorage.setItem(
      voiceprintCacheKey(userId, slot),
      JSON.stringify({ samplesKey, embedding: [...embedding] }),
    );
  } catch { /* cache miss next time — recomputed */ }
}

// The reference is the average of the per-sample embeddings of the user's
// instant-clone recordings. Cached per profile until the sample set changes.
async function ensureReferenceEmbedding(userId, slot) {
  const profileRes = await apiFetch(`/api/voice/profile?slot=${slot}`);
  if (!profileRes.ok) return null;
  const profile = await profileRes.json();
  const samples = Array.isArray(profile.samples) ? profile.samples : [];
  if (!profile.voiceReady || !samples.length) return null;

  const samplesKey = samples.map((s) => s.id).join(',');
  const cached = readCachedVoiceprint(userId, slot, samplesKey);
  if (cached) return cached;

  const embeddings = [];
  for (const sample of samples) {
    try {
      const res = await apiFetch(`/api/voice/samples/${encodeURIComponent(sample.id)}/audio?slot=${slot}`);
      if (!res.ok) continue;
      embeddings.push(await embedBlob(await res.blob()));
    } catch { /* a broken sample must not block the rest */ }
  }
  if (!embeddings.length) return null;

  const reference = new Float32Array(embeddings[0].length);
  for (const emb of embeddings) {
    for (let i = 0; i < reference.length; i++) reference[i] += emb[i];
  }
  for (let i = 0; i < reference.length; i++) reference[i] /= embeddings.length;

  writeCachedVoiceprint(userId, slot, samplesKey, reference);
  return reference;
}

// ---- auto collection ----

async function uploadAutoSample(blob, mimeType, durationMs, slot) {
  const form = new FormData();
  form.append('audio', blob, `auto-voice.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('durationMs', String(Math.round(durationMs)));
  form.append('slot', String(slot));
  form.append('auto', '1');
  await apiFetch(`/api/voice/pro-samples?slot=${slot}`, { method: 'POST', body: form });
}

/**
 * Fire-and-forget: called after each accepted dictation. Silently does
 * nothing unless the clip is long enough, the profile has a ready voice,
 * auto-collection is on, and the voiceprints match.
 */
export function maybeCollectVoiceSample(blob, mimeType, durationMs) {
  void (async () => {
    try {
      if (collecting) return;
      if (!blob?.size || durationMs < MIN_CLIP_MS) return;
      const user = getStoredUser();
      if (!user?.id || !user.voiceReady) return;
      const slot = loadActiveProfileSlot(user.id) ?? 1;
      if (!isAutoCollectEnabled(user.id, slot)) return;

      collecting = true;
      try {
        // Test hook: e2e runs have no decodable audio nor the model, so
        // they inject the similarity score directly.
        const forced = typeof window !== 'undefined' ? window.__voiceMatchTestSimilarity : undefined;
        let similarity;
        if (typeof forced === 'number') {
          similarity = forced;
        } else {
          const reference = await ensureReferenceEmbedding(user.id, slot);
          if (!reference) return;
          similarity = cosineSimilarity(reference, await embedBlob(blob));
        }

        if (similarity < MATCH_THRESHOLD) return;
        await uploadAutoSample(blob, mimeType, durationMs, slot);
      } finally {
        collecting = false;
      }
    } catch (err) {
      collecting = false;
      console.warn('Voice auto-collect skipped:', err?.message || err);
    }
  })();
}
