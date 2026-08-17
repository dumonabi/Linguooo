import {
  ELEVEN_MODEL_FLASH,
  ELEVEN_MODEL_V2,
  ELEVEN_MODEL_V3,
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

export async function generateClonedSpeech(text, voiceId, langCode = null, { pro = false, v3 = false } = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!voiceId) {
    throw new Error('Voice profile not ready');
  }

  // Pro requests run the Professional Voice Clone on multilingual v2 — the
  // model PVC voices are fine-tuned on — trading latency for fidelity.
  // v3 requests run the user's instant clone on eleven_v3: the only model
  // that speaks languages outside the flash set (e.g. Thai) in their voice.
  const modelId = pro ? ELEVEN_MODEL_V2 : v3 ? ELEVEN_MODEL_V3 : resolveSpeechModelId(langCode);
  const isFlash = modelId === ELEVEN_MODEL_FLASH;
  const isV3 = modelId === ELEVEN_MODEL_V3;

  // style and speaker boost add generation latency and are not meaningful
  // on the flash model, so they are only sent to the slower models.
  // eleven_v3 only accepts the stability presets 0.0 / 0.5 / 1.0 and no
  // style parameter.
  const voiceSettings = isV3
    ? { stability: 0.5, similarity_boost: 0.85 }
    : isFlash
      ? { stability: 0.45, similarity_boost: 0.8 }
      : {
        stability: 0.45,
        similarity_boost: 0.8,
        style: 0.15,
        use_speaker_boost: true,
      };
  const payload = {
    text: clampTextForModel(text, modelId),
    model_id: modelId,
    voice_settings: voiceSettings,
  };

  const elevenLang = toElevenLabsLanguageCode(langCode);
  if ((isFlash || modelId === 'eleven_v3') && elevenLang) {
    payload.language_code = elevenLang;
  }

  // Fast path: 64 kbps halves the payload vs the 128 kbps default; for speech
  // the quality difference is inaudible and the download reaches the phone
  // sooner. Pro/v3 paths: full 128 kbps, since quality is the whole point.
  const outputFormat = pro || isV3 ? 'mp3_44100_128' : 'mp3_44100_64';
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
// The whole PVC lifecycle runs through the API so users never leave the app:
// create the voice, upload samples, fetch the verification captcha (an image
// with lines the owner reads aloud), submit that recording, then start
// training. Once fine-tuned, the voice shows up in listProfessionalVoices()
// and the app links it to the PRO audio path automatically.

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

// When ElevenLabs caps verification attempts it also reports when the
// counter resets — surfaced to the user instead of a cryptic error.
async function fetchVerificationResetMs(voiceId) {
  try {
    const res = await fetch(`${ELEVENLABS_BASE}/voices/${encodeURIComponent(voiceId)}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    const resetMs = Number(data?.fine_tuning?.next_max_verification_attempts_reset_unix_ms);
    return Number.isFinite(resetMs) && resetMs > 0 ? resetMs : null;
  } catch {
    return null;
  }
}

async function buildVerificationError(detail, voiceId, fallback) {
  const status = typeof detail === 'object' ? detail?.status : '';
  const message = (typeof detail === 'object' ? detail?.message : detail) || fallback;
  const err = new Error(typeof message === 'string' ? message : fallback);
  if (status === 'max_verification_attempts_reached' || /maximum number of verification attempts/i.test(err.message)) {
    err.code = 'MAX_VERIFICATION_ATTEMPTS';
    err.resetAtMs = await fetchVerificationResetMs(voiceId);
  } else if (/has not started|nothing to verify/i.test(err.message)) {
    err.code = 'VERIFICATION_NOT_STARTED';
  }
  return err;
}

// Returns the verification captcha as { image (base64), mimeType }. The
// image contains a few lines of text the voice owner must read aloud.
// ElevenLabs may answer with raw image bytes, a JSON-wrapped base64 string,
// or a bare base64/data-URL — handle all three. Reading the body as text
// would corrupt raw bytes, so always start from the binary buffer.
export async function getPvcCaptcha(voiceId) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/pvc/${encodeURIComponent(voiceId)}/captcha`, {
    headers: authHeaders(),
  });

  const buffer = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (!res.ok) {
    let detail = null;
    try {
      const data = JSON.parse(buffer.toString('utf8'));
      detail = data?.detail || data;
    } catch {
      // keep default message
    }
    throw await buildVerificationError(detail, voiceId, 'Could not fetch the verification captcha');
  }

  const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
  if (isPng || isJpeg) {
    return { image: buffer.toString('base64'), mimeType: isPng ? 'image/png' : 'image/jpeg' };
  }

  // Not raw bytes — a JSON-wrapped or bare base64 string.
  let base64 = buffer.toString('utf8').trim();
  if (base64.startsWith('"') || base64.startsWith('{')) {
    try {
      const parsed = JSON.parse(base64);
      base64 = typeof parsed === 'string' ? parsed : parsed?.image || parsed?.captcha || '';
    } catch {
      // fall through with the raw text
    }
  }
  let mimeType = 'image/png';
  const dataUrlMatch = String(base64 || '').match(/^data:(image\/\w+);base64,/);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1];
    base64 = base64.slice(dataUrlMatch[0].length);
  }
  base64 = String(base64 || '').replace(/\s+/g, '');
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new Error('ElevenLabs returned an unreadable captcha');
  }
  return { image: base64, mimeType };
}

export async function verifyPvcCaptcha(voiceId, { buffer, mimeType }) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!buffer?.length) {
    throw new Error('No recording received');
  }

  const form = new FormData();
  const ext = (mimeType || '').includes('mp4') ? 'mp4' : (mimeType || '').includes('ogg') ? 'ogg' : 'webm';
  form.append('recording', new Blob([buffer], { type: mimeType || 'audio/webm' }), `verification.${ext}`);

  const res = await fetch(`${ELEVENLABS_BASE}/voices/pvc/${encodeURIComponent(voiceId)}/captcha`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw await buildVerificationError(data?.detail || data, voiceId, 'Verification failed');
  }
  return data;
}

export async function trainPvcVoice(voiceId, { modelId = ELEVEN_MODEL_V2 } = {}) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/pvc/${encodeURIComponent(voiceId)}/train`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ model_id: modelId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Could not start training';
    throw new Error(typeof detail === 'string' ? detail : 'Could not start training');
  }
  return data;
}

// Training progress for a specific voice: { state, progress } for the v2
// model the PRO path uses. state is e.g. 'not_started', 'queued',
// 'fine_tuning', 'fine_tuned', 'failed'.
export async function getPvcTrainingStatus(voiceId) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }

  const res = await fetch(`${ELEVENLABS_BASE}/voices/${encodeURIComponent(voiceId)}`, {
    headers: authHeaders(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.detail?.message || data?.detail || data?.message || 'Could not read voice status';
    throw new Error(typeof detail === 'string' ? detail : 'Could not read voice status');
  }

  const fineTuning = data?.fine_tuning || {};
  return {
    state: fineTuning.state?.[ELEVEN_MODEL_V2] || 'not_started',
    progress: Number(fineTuning.progress?.[ELEVEN_MODEL_V2] ?? 0),
    message: fineTuning.message?.[ELEVEN_MODEL_V2] || '',
  };
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
