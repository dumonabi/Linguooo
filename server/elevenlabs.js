import {
  ELEVEN_MODEL_FLASH,
  ELEVEN_MODEL_V2,
  resolveCloneVoiceModel,
  toElevenLabsLanguageCode,
} from './elevenlabs-languages.js';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

export function getElevenLabsApiKey() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  return key || null;
}

export function isElevenLabsConfigured() {
  return Boolean(getElevenLabsApiKey());
}

function authHeaders(extra = {}) {
  return {
    'xi-api-key': getElevenLabsApiKey(),
    ...extra,
  };
}

export async function createVoiceClone({ name, description, samples }) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!samples?.length) {
    throw new Error('At least one voice sample is required');
  }

  const form = new FormData();
  form.append('name', name);
  form.append('description', description || 'Lingu.ooo personal voice profile');

  for (const sample of samples) {
    const filename = `sample-${sample.id}.${sample.ext || 'webm'}`;
    const blob = new Blob([sample.buffer], { type: sample.mimeType || 'audio/webm' });
    form.append('files', blob, filename);
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Voice clone failed';
    throw new Error(typeof detail === 'string' ? detail : 'Voice clone failed');
  }

  if (!data?.voice_id) {
    throw new Error('Voice clone did not return a voice id');
  }

  return data.voice_id;
}

function resolveSpeechModelId(langCode) {
  const override = process.env.ELEVENLABS_MODEL_ID?.trim();
  if (override) return override;
  return resolveCloneVoiceModel(langCode) || ELEVEN_MODEL_FLASH;
}

// Per-request character limits (ElevenLabs docs): exceeding them returns
// a max_character_limit_exceeded error, so clamp at a sentence boundary.
const MODEL_CHAR_LIMITS = {
  eleven_v3: 5000,
  eleven_multilingual_v2: 10000,
  eleven_flash_v2_5: 40000,
  eleven_turbo_v2_5: 40000,
};
const DEFAULT_CHAR_LIMIT = 5000;

function clampTextForModel(text, modelId) {
  const limit = MODEL_CHAR_LIMITS[modelId] ?? DEFAULT_CHAR_LIMIT;
  if (text.length <= limit) return text;

  const slice = text.slice(0, limit);
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('。'),
  );
  const cutAt = sentenceEnd > limit * 0.5 ? sentenceEnd + 1 : slice.lastIndexOf(' ');
  const clamped = slice.slice(0, cutAt > 0 ? cutAt : limit).trimEnd();

  console.warn(`TTS text clamped for ${modelId}: ${text.length} chars exceeds ${limit} limit`);
  return clamped;
}

export async function generateClonedSpeech(text, voiceId, langCode = null, { pro = false } = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!voiceId) {
    throw new Error('Voice profile not ready');
  }

  // Pro requests run the Professional Voice Clone on multilingual v2 — the
  // model PVC voices are fine-tuned on — trading latency for fidelity.
  const modelId = pro ? ELEVEN_MODEL_V2 : resolveSpeechModelId(langCode);
  const isFlash = modelId === ELEVEN_MODEL_FLASH;

  // style and speaker boost add generation latency and are not meaningful
  // on the flash model, so they are only sent to the slower models.
  const payload = {
    text: clampTextForModel(text, modelId),
    model_id: modelId,
    voice_settings: isFlash
      ? { stability: 0.45, similarity_boost: 0.8 }
      : {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.15,
        use_speaker_boost: true,
      },
  };

  const elevenLang = toElevenLabsLanguageCode(langCode);
  if ((isFlash || modelId === 'eleven_v3') && elevenLang) {
    payload.language_code = elevenLang;
  }

  // Fast path: 64 kbps halves the payload vs the 128 kbps default; for speech
  // the quality difference is inaudible and the download reaches the phone
  // sooner. Pro path: full 128 kbps, since quality is the whole point.
  const outputFormat = pro ? 'mp3_44100_128' : 'mp3_44100_64';
  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    }),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data?.detail?.message || data?.detail || data?.message || 'Cloned speech failed';
    throw new Error(typeof detail === 'string' ? detail : 'Cloned speech failed');
  }

  return Buffer.from(await res.arrayBuffer());
}

// Professional (PVC) voices in the ElevenLabs account. Used to auto-link a
// Professional Voice Clone created in the ElevenLabs dashboard to the app's
// pro audio path without manual configuration.
export async function listProfessionalVoices() {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices?category=professional`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Could not list voices';
    throw new Error(typeof detail === 'string' ? detail : 'Could not list voices');
  }

  return (data?.voices || [])
    .filter((voice) => voice?.category === 'professional' && voice?.voice_id)
    // A PVC voice exists as soon as it is created, but it can only speak
    // after fine-tuning finishes — skip voices that are still training.
    .filter((voice) => {
      const state = voice?.fine_tuning?.state?.[ELEVEN_MODEL_V2];
      return state == null || state === 'fine_tuned';
    })
    .map((voice) => ({ voiceId: voice.voice_id, name: voice.name || '' }));
}

// ---- Professional Voice Cloning (PVC) ----
// Creating a PVC voice and feeding it samples works on the Creator plan.
// Verification and training are finished in the ElevenLabs dashboard; once
// trained, the voice shows up in listProfessionalVoices() and the app links
// it to the PRO audio path automatically.

export async function createPvcVoice({ name, language, description }) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/pvc`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name,
      language: language || 'en',
      description: description || 'Lingu.ooo professional voice profile',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Could not create PVC voice';
    throw new Error(typeof detail === 'string' ? detail : 'Could not create PVC voice');
  }
  if (!data?.voice_id) {
    throw new Error('PVC voice creation did not return a voice id');
  }
  return data.voice_id;
}

export async function addPvcSamples(voiceId, samples, { removeBackgroundNoise = false } = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!samples?.length) {
    throw new Error('At least one sample is required');
  }

  const form = new FormData();
  for (const sample of samples) {
    const filename = sample.name || `pro-sample-${sample.id}.${sample.ext || 'webm'}`;
    const blob = new Blob([sample.buffer], { type: sample.mimeType || 'audio/webm' });
    form.append('files', blob, filename);
  }
  if (removeBackgroundNoise) {
    form.append('remove_background_noise', 'true');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/pvc/${encodeURIComponent(voiceId)}/samples`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Could not upload PVC samples';
    throw new Error(typeof detail === 'string' ? detail : 'Could not upload PVC samples');
  }
  return data;
}

function dubFilename(mimeType = 'audio/webm') {
  if (mimeType.includes('mp4')) return 'source.mp4';
  if (mimeType.includes('ogg')) return 'source.ogg';
  if (mimeType.includes('wav')) return 'source.wav';
  return 'source.webm';
}

export async function startDubbingJob({ buffer, mimeType, sourceLang, targetLang }) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!buffer?.length) {
    throw new Error('No audio received');
  }
  if (!targetLang) {
    throw new Error('Target language is required');
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'audio/webm' }), dubFilename(mimeType));
  form.append('target_lang', targetLang);
  form.append('source_lang', sourceLang || 'auto');
  form.append('num_speakers', '1');
  form.append('drop_background_audio', 'true');

  const res = await fetch(`${ELEVENLABS_BASE}/dubbing`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Dubbing failed to start';
    throw new Error(typeof detail === 'string' ? detail : 'Dubbing failed to start');
  }

  if (!data?.dubbing_id) {
    throw new Error('Dubbing did not return a job id');
  }

  return data.dubbing_id;
}

export async function getDubbingStatus(dubbingId) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/dubbing/${encodeURIComponent(dubbingId)}`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Could not check dubbing status';
    throw new Error(typeof detail === 'string' ? detail : 'Could not check dubbing status');
  }

  return data;
}

export async function fetchDubbingAudio(dubbingId, targetLang) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(
    `${ELEVENLABS_BASE}/dubbing/${encodeURIComponent(dubbingId)}/audio/${encodeURIComponent(targetLang)}`,
    { headers: authHeaders({ Accept: 'audio/mpeg' }) },
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data?.detail?.message || data?.detail || data?.message || 'Dubbed audio not ready';
    throw new Error(typeof detail === 'string' ? detail : 'Dubbed audio not ready');
  }

  return Buffer.from(await res.arrayBuffer());
}
