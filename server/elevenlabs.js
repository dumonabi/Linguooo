import {
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
  return resolveCloneVoiceModel(langCode) || ELEVEN_MODEL_V2;
}

export async function generateClonedSpeech(text, voiceId, langCode = null) {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error('ElevenLabs API key not configured');
  }
  if (!voiceId) {
    throw new Error('Voice profile not ready');
  }

  const modelId = resolveSpeechModelId(langCode);
  const payload = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.8,
      style: 0.15,
      use_speaker_boost: true,
    },
  };

  const elevenLang = toElevenLabsLanguageCode(langCode);
  if (modelId === 'eleven_v3' && elevenLang) {
    payload.language_code = elevenLang;
  }

  const res = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}`, {
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
