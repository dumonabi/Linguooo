import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { LANGUAGE_NAMES, getLanguagesList } from './languages.js';
import {
  authRegisterRateLimit,
  authVerifyRateLimit,
  converseRateLimit,
  getCorsOptions,
  isAuthRequired,
  requireAppAuth,
  resolveRequestUser,
  speakRateLimit,
  voiceSampleRateLimit,
} from './security.js';
import { isSuperUser, verifySuperUserPassword } from './bootstrap-user.js';
import {
  createUser,
  findUserByPassphrase,
  getGuestUser,
  publicUserProfile,
} from './users.js';
import {
  getProfileSettings,
  saveProfileSettings,
} from './profile-settings-store.js';
import { ensureUserRegistryLoaded } from './user-store.js';
import {
  addVoiceSample,
  clearAllVoiceSamples,
  deleteVoiceProfileSlot,
  deleteVoiceSample,
  getVoiceProfile,
  listVoiceSampleBuffers,
  MAX_VOICE_SAMPLES,
  resolveVoiceId,
  saveVoiceClone,
  validateProfileSlot,
  voiceProfileSummary,
} from './voice-store.js';
import {
  createVoiceClone,
  generateClonedSpeech,
  isElevenLabsConfigured,
} from './elevenlabs.js';
import {
  cloneVoiceLanguagesByModel,
  listCloneVoiceLanguageCodes,
  supportsClonedVoice,
} from './elevenlabs-languages.js';
import { createSessionToken } from './session-token.js';
import { isPersistentBlobEnabled } from './persistent-store.js';
import {
  alignTranslationFields,
  detectLanguageFromTranslation,
  detectLanguageInPair,
} from './language-detection.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

let openaiClient = null;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === 'sk-your-openai-api-key-here') {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function buildStreamingSystemPrompt(lang1, lang2) {
  const name1 = LANGUAGE_NAMES[lang1] || lang1;
  const name2 = LANGUAGE_NAMES[lang2] || lang2;
  return `You translate between ${name1} and ${name2}. Detect which language the user wrote in, then output ONLY the translation in the other language. Never repeat the input. No quotes, labels, or JSON.`;
}

function buildTranslationUserMessage(text, lang1, lang2, context, detected) {
  const trimmed = text.trim();
  const inferred = detected ?? detectLanguageInPair(trimmed, lang1, lang2);
  const name1 = LANGUAGE_NAMES[lang1] || lang1;
  const name2 = LANGUAGE_NAMES[lang2] || lang2;

  let directive;
  if (inferred) {
    const target = inferred === lang1 ? lang2 : lang1;
    const fromName = LANGUAGE_NAMES[inferred] || inferred;
    const toName = LANGUAGE_NAMES[target] || target;
    directive = `Translate from ${fromName} to ${toName}:\n${trimmed}`;
  } else {
    directive = `The message is in ${name1} or ${name2}. Detect its language and translate into the other only. Output only the translation:\n${trimmed}`;
  }

  const recentContext = context
    .filter((m) => [lang1, lang2].includes(m.detectedLanguage))
    .slice(-2)
    .map((m) => `${m.detectedLanguage}: ${m.original} → ${m.translated}`)
    .join('\n');

  return recentContext ? `${recentContext}\n\n${directive}` : directive;
}

function finalizeTranslation(rawText, translatedText, lang1, lang2, preDetected = null, gptTarget = null) {
  const sourceText = stripTrailingPeriod(rawText.trim());
  let translated = stripTrailingPeriod(translatedText || '');

  const aligned = alignTranslationFields(sourceText, translated, lang1, lang2);
  translated = aligned.translatedText === sourceText && aligned.sourceText !== sourceText
    ? aligned.sourceText
    : aligned.translatedText;

  const detected = detectLanguageInPair(aligned.sourceText, lang1, lang2)
    || detectLanguageFromTranslation(aligned.sourceText, translated, lang1, lang2)
    || normalizeLangCode(preDetected, lang1, lang2)
    || normalizeLangCode(gptTarget, lang1, lang2);
  const target = detected === lang1 ? lang2 : detected === lang2 ? lang1 : null;

  return {
    detectedLanguage: detected,
    sourceText: aligned.sourceText,
    translatedText: translated,
    targetLanguage: target,
  };
}

function normalizeLangCode(value, lang1, lang2) {
  if (!value) return null;
  const v = String(value).toLowerCase().trim();
  if (v === lang1 || v === lang2) return v;

  for (const code of [lang1, lang2]) {
    const name = (LANGUAGE_NAMES[code] || '').toLowerCase();
    if (v === name || v.includes(name)) return code;
  }
  return null;
}

function formatApiError(err) {
  const msg = err?.message || '';
  const status = err?.status;
  const code = err?.code || err?.error?.code;

  if (msg.includes('Too many concurrent requests')) {
    return 'Voice service is busy — wait a moment and try again';
  }
  if (status === 429 || code === 'insufficient_quota' || msg.includes('quota') || msg.includes('billing')) {
    return 'OpenAI quota exceeded — add credits at platform.openai.com/account/billing';
  }
  if (msg.includes('Connection error') || err?.cause?.code === 'ECONNRESET') {
    return 'Connection error — check your internet';
  }
  if (status === 401 || msg.includes('Incorrect API key')) {
    return 'Invalid API key — check your environment variables';
  }
  return msg || 'Request failed';
}

async function withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable =
        err?.cause?.code === 'ECONNRESET' ||
        err?.code === 'ECONNRESET' ||
        err?.message?.includes('Connection error');
      if (!retryable || attempt === maxAttempts) throw err;
      await new Promise((r) => setTimeout(r, attempt * 400));
    }
  }
  throw lastError;
}

function requireOpenAI(res) {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'sk-your-openai-api-key-here') {
    res.status(500).json({ error: 'API key not configured' });
    return null;
  }
  const openai = getOpenAI();
  if (!openai) {
    res.status(500).json({ error: 'API key not configured' });
    return null;
  }
  return openai;
}

function stripTrailingPeriod(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/[.。．]+$/u, '').trimEnd();
}

async function translateTextStream(openai, text, lang1, lang2, context, onDelta, { detected } = {}) {
  const userMessage = buildTranslationUserMessage(text, lang1, lang2, context, detected);

  const stream = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.25,
      max_tokens: 180,
      stream: true,
      messages: [
        { role: 'system', content: buildStreamingSystemPrompt(lang1, lang2) },
        { role: 'user', content: userMessage },
      ],
    })
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) onDelta(delta);
  }
}

function beginTranslationStream(res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  return (obj) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };
}

async function pipeTranslationStream(res, openai, rawText, lang1, lang2, context) {
  const writeLine = beginTranslationStream(res);
  writeLine({ event: 'transcript', rawText });

  const preDetected = detectLanguageInPair(rawText, lang1, lang2);

  let accumulated = '';
  await translateTextStream(openai, rawText, lang1, lang2, context, (chunk) => {
    accumulated += chunk;
    writeLine({ event: 'delta', text: chunk });
  }, { detected: preDetected });

  const translated = finalizeTranslation(rawText, accumulated, lang1, lang2, preDetected);

  if (!translated.translatedText) {
    writeLine({ event: 'error', error: 'Could not translate message' });
    res.end();
    return;
  }

  writeLine({ event: 'done', rawText, ...translated });
  res.end();
}

function parseConversationContext(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function validateLanguagePair(lang1, lang2, res) {
  if (!lang1 || !lang2 || lang1 === lang2) {
    res.status(400).json({ error: 'Select two different languages' });
    return false;
  }
  if (!LANGUAGE_NAMES[lang1] || !LANGUAGE_NAMES[lang2]) {
    res.status(400).json({ error: 'Invalid language selection' });
    return false;
  }
  return true;
}

function isRetryableTranscribeFallback(err) {
  const status = err?.status;
  if (status === 400 || status === 401 || status === 403 || status === 413) return false;
  if (status === 429) return false;
  const code = err?.code || err?.error?.code;
  if (code === 'insufficient_quota') return false;
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('quota') || msg.includes('billing')) return false;
  return true;
}

function buildTranscriptionPrompt(lang1, lang2) {
  const name1 = LANGUAGE_NAMES[lang1];
  const name2 = LANGUAGE_NAMES[lang2];
  if (!name1 || !name2) return undefined;
  return `The speaker may use ${name1} or ${name2}.`;
}

async function transcribeAudio(openai, file, { lang1, lang2 } = {}) {
  const prompt = buildTranscriptionPrompt(lang1, lang2);
  const primary = { file, model: 'gpt-4o-mini-transcribe' };
  if (prompt) primary.prompt = prompt;

  try {
    return await withRetry(() => openai.audio.transcriptions.create(primary));
  } catch (err) {
    if (!isRetryableTranscribeFallback(err)) throw err;
    const fallback = { file, model: 'whisper-1' };
    if (prompt) fallback.prompt = prompt;
    return await withRetry(() => openai.audio.transcriptions.create(fallback));
  }
}

const ttsCache = new Map();
const TTS_CACHE_MAX = 120;

function ttsCacheKey(text, lang, voiceId = null) {
  return `${voiceId || 'default'}|${lang || ''}|${prepareTextForSpeech(text, lang)}`;
}

function readTtsCache(key) {
  const hit = ttsCache.get(key);
  if (!hit) return null;
  ttsCache.delete(key);
  ttsCache.set(key, hit);
  return hit;
}

function writeTtsCache(key, buffer) {
  if (ttsCache.has(key)) ttsCache.delete(key);
  ttsCache.set(key, buffer);
  while (ttsCache.size > TTS_CACHE_MAX) {
    const oldest = ttsCache.keys().next().value;
    ttsCache.delete(oldest);
  }
}

async function generateSpeech(openai, text, lang, voiceId = null) {
  const input = prepareTextForSpeech(text, lang);
  if (!input) {
    throw new Error('No speakable text');
  }

  const cacheKey = ttsCacheKey(input, lang, voiceId);
  const cached = readTtsCache(cacheKey);
  if (cached) return cached;

  let buffer;
  if (voiceId && isElevenLabsConfigured() && supportsClonedVoice(lang)) {
    buffer = await generateClonedSpeech(input, voiceId, lang);
  } else {
    const speech = await withRetry(() =>
      openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input,
        speed: 1.08,
        response_format: 'mp3',
      }),
      2
    );
    buffer = Buffer.from(await speech.arrayBuffer());
  }

  writeTtsCache(cacheKey, buffer);
  return buffer;
}

function prepareTextForSpeech(text, lang) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[…]/g, '...')
    .replace(/\s+/g, ' ');
}

function parseProfileSlot(req, { required = false, fallback = 1 } = {}) {
  const raw = req.query?.slot ?? req.body?.slot;
  if (raw == null || raw === '') {
    if (required) return null;
    return fallback;
  }
  try {
    return validateProfileSlot(raw);
  } catch {
    return required ? null : fallback;
  }
}

function requireProfileSlot(req, res, { fallback = 1 } = {}) {
  const slot = parseProfileSlot(req, { required: fallback == null, fallback });
  if (slot == null) {
    res.status(400).json({ error: 'Valid profile slot (1–11) is required' });
    return null;
  }
  return slot;
}

function formatVoiceProfileResponse(user, voiceProfile) {
  return {
    ...voiceProfileSummary(voiceProfile),
    samples: voiceProfile.samples.map(({ id, createdAt, durationMs }) => ({
      id,
      createdAt,
      durationMs: Number(durationMs) || 0,
    })),
    voiceReady: Boolean(resolveVoiceId(user, voiceProfile)),
    elevenlabsConfigured: isElevenLabsConfigured(),
  };
}

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors(getCorsOptions()));
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', async (req, res, next) => {
    try {
      await ensureUserRegistryLoaded();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      persistentBlob: isPersistentBlobEnabled(),
      authRequired: isAuthRequired(),
      cloneVoiceLanguages: listCloneVoiceLanguageCodes(),
      cloneVoiceLanguagesByModel: cloneVoiceLanguagesByModel(),
    });
  });

  app.post('/api/auth/register', authRegisterRateLimit, async (req, res) => {
    if (!isAuthRequired()) {
      return res.status(400).json({ error: 'Registration is disabled' });
    }

    const requestUser = resolveRequestUser(req);
    const authorized = (requestUser && isSuperUser(requestUser))
      || verifySuperUserPassword(req.body?.superPassword);

    if (!authorized) {
      return res.status(403).json({ error: 'Admin password required' });
    }

    const name = String(req.body?.name || '').trim();
    if (name.length > 48) {
      return res.status(400).json({ error: 'Name is too long' });
    }

    try {
      const { user, recoveryPhrase } = await createUser({ name });
      const voiceProfile = await getVoiceProfile(user.id, 1);
      return res.json({
        ok: true,
        user: publicUserProfile(user, voiceProfile),
        recoveryPhrase,
        sessionToken: createSessionToken(user),
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Could not create account' });
    }
  });

  app.post('/api/auth/verify', authVerifyRateLimit, async (req, res) => {
    if (!isAuthRequired()) {
      const guest = getGuestUser();
      const voiceProfile = await getVoiceProfile(guest.id, 1);
      return res.json({ ok: true, user: publicUserProfile(guest, voiceProfile) });
    }

    const attempt = req.body?.passphrase || req.body?.password;
    const user = await findUserByPassphrase(attempt);
    if (user) {
      const voiceProfile = await getVoiceProfile(user.id, 1);
      return res.json({
        ok: true,
        user: publicUserProfile(user, voiceProfile),
        sessionToken: createSessionToken(user),
      });
    }

    res.status(401).json({ error: 'Wrong recovery phrase or password' });
  });

  app.get('/api/me', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    const voiceProfile = await getVoiceProfile(req.user.id, slot);
    res.json({
      user: publicUserProfile(req.user, voiceProfile),
      voiceProfile: formatVoiceProfileResponse(req.user, voiceProfile),
      profileSlot: slot,
    });
  });

  app.get('/api/profile/settings', requireAppAuth, async (req, res) => {
    try {
      const settings = await getProfileSettings(req.user.id);
      res.json(settings);
    } catch (err) {
      console.error('Profile settings read error:', err);
      res.status(500).json({ error: err.message || 'Could not load profile settings' });
    }
  });

  app.put('/api/profile/settings', requireAppAuth, async (req, res) => {
    try {
      const settings = await saveProfileSettings(req.user.id, req.body || {});
      res.json(settings);
    } catch (err) {
      console.error('Profile settings save error:', err);
      res.status(500).json({ error: err.message || 'Could not save profile settings' });
    }
  });

  app.get('/api/voice/profile', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    const voiceProfile = await getVoiceProfile(req.user.id, slot);
    res.json(formatVoiceProfileResponse(req.user, voiceProfile));
  });

  app.delete('/api/voice/profile', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    try {
      const profile = await deleteVoiceProfileSlot(req.user.id, slot);
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        voiceReady: false,
        canRecordMore: true,
      });
    } catch (err) {
      console.error('Voice profile delete error:', err);
      res.status(500).json({ error: err.message || 'Could not delete voice profile' });
    }
  });

  app.post('/api/voice/samples', requireAppAuth, voiceSampleRateLimit, upload.single('audio'), async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    try {
      const mimeType = req.file.mimetype || 'audio/webm';
      const durationMs = Number(req.body?.durationMs);
      const profile = await addVoiceSample(
        req.user.id,
        slot,
        req.file.buffer,
        mimeType,
        durationMs,
      );
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        canRecordMore: profile.samples.length < MAX_VOICE_SAMPLES,
        readyForClone: profile.samples.length >= MAX_VOICE_SAMPLES,
        profileSlot: slot,
      });
    } catch (err) {
      console.error('Voice sample upload error:', err);
      const status = err.code === 'SAMPLE_LIMIT' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Could not save voice sample' });
    }
  });

  app.delete('/api/voice/samples', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    try {
      const profile = await clearAllVoiceSamples(req.user.id, slot);
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        voiceReady: false,
        canRecordMore: true,
        profileSlot: slot,
      });
    } catch (err) {
      console.error('Voice samples reset error:', err);
      res.status(500).json({ error: err.message || 'Could not reset voice samples' });
    }
  });

  app.delete('/api/voice/samples/:sampleId', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    try {
      const profile = await deleteVoiceSample(req.user.id, slot, req.params.sampleId);
      if (!profile) {
        return res.status(404).json({ error: 'Sample not found' });
      }
      res.json({
        ok: true,
        sampleCount: profile.samples.length,
        status: profile.status,
        voiceReady: Boolean(resolveVoiceId(req.user, profile)),
        profileSlot: slot,
      });
    } catch (err) {
      console.error('Voice sample delete error:', err);
      res.status(500).json({ error: err.message || 'Could not delete voice sample' });
    }
  });

  app.post('/api/voice/create', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    if (!isElevenLabsConfigured()) {
      return res.status(503).json({ error: 'Voice cloning is not configured on the server' });
    }

    try {
      const { profile, buffers } = await listVoiceSampleBuffers(req.user.id, slot);
      if (buffers.length < MAX_VOICE_SAMPLES) {
        return res.status(400).json({ error: `Record at least ${MAX_VOICE_SAMPLES} voice samples first` });
      }

      const voiceId = await createVoiceClone({
        name: `Lingu ${req.user.name} ${slot}`,
        description: `Personal voice profile ${slot} for ${req.user.name}`,
        samples: buffers,
      });

      const saved = await saveVoiceClone(req.user.id, slot, voiceId);
      res.json({
        ok: true,
        voiceReady: true,
        status: saved.status,
        sampleCount: saved.samples.length,
        profileSlot: slot,
      });
    } catch (err) {
      console.error('Voice clone error:', err);
      res.status(500).json({ error: err.message || 'Could not create voice profile' });
    }
  });

  app.get('/api/languages', requireAppAuth, (_req, res) => {
    res.json(getLanguagesList());
  });

  app.post('/api/transcribe', requireAppAuth, converseRateLimit, upload.single('audio'), async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();

    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    const mimeType = req.file.mimetype || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    try {
      const file = await toFile(req.file.buffer, `audio.${ext}`, { type: mimeType });
      const transcription = await transcribeAudio(openai, file, { lang1, lang2 });
      const rawText = transcription.text?.trim();

      if (!rawText) {
        return res.status(400).json({ error: 'No speech detected' });
      }

      res.json({ rawText });
    } catch (err) {
      console.error('Transcribe error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  app.post('/api/converse', requireAppAuth, converseRateLimit, upload.single('audio'), async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();
    const context = parseConversationContext(req.body.context);

    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    const mimeType = req.file.mimetype || 'audio/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    try {
      const file = await toFile(req.file.buffer, `audio.${ext}`, { type: mimeType });
      const transcription = await transcribeAudio(openai, file, { lang1, lang2 });
      const rawText = transcription.text?.trim();

      if (!rawText) {
        return res.status(400).json({ error: 'No speech detected' });
      }

      await pipeTranslationStream(res, openai, rawText, lang1, lang2, context);
    } catch (err) {
      console.error('Converse error:', err);
      if (res.headersSent) {
        res.write(`${JSON.stringify({ event: 'error', error: formatApiError(err) })}\n`);
        res.end();
      } else {
        res.status(500).json({ error: formatApiError(err) });
      }
    }
  });

  app.post('/api/translate', requireAppAuth, converseRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();
    const context = parseConversationContext(req.body.context);
    const rawText = String(req.body.text || '').trim();

    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!rawText) {
      return res.status(400).json({ error: 'Text is required' });
    }

    try {
      await pipeTranslationStream(res, openai, rawText, lang1, lang2, context);
    } catch (err) {
      console.error('Translate error:', err);
      if (res.headersSent) {
        res.write(`${JSON.stringify({ event: 'error', error: formatApiError(err) })}\n`);
        res.end();
      } else {
        res.status(500).json({ error: formatApiError(err) });
      }
    }
  });

  app.post('/api/speak', requireAppAuth, speakRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const { text, lang } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const langCode = lang ? String(lang).toLowerCase().trim() : null;

    try {
      const slot = requireProfileSlot(req, res);
      if (slot == null) return;
      const voiceProfile = await getVoiceProfile(req.user.id, slot);
      const voiceId = resolveVoiceId(req.user, voiceProfile);
      const useClone = Boolean(voiceId) && supportsClonedVoice(langCode);

      if (req.body.voiceMode === 'clone' && supportsClonedVoice(langCode) && !voiceId) {
        return res.status(400).json({ error: 'Personal voice not ready — set up your voice profile first' });
      }

      const buffer = await generateSpeech(openai, text, langCode, useClone ? voiceId : null);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.set('X-Voice-Mode', useClone ? 'clone' : 'default');
      res.send(buffer);
    } catch (err) {
      console.error('TTS error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  // Local production server only (not used on Vercel)
  if (process.env.VERCEL !== '1') {
    const distPath = path.join(__dirname, '..', 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}
