import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
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
  addProVoiceSample,
  addVoiceSample,
  clearAllProVoiceSamples,
  clearAllVoiceSamples,
  deleteProVoiceSample,
  deleteVoiceProfileSlot,
  deleteVoiceSample,
  getVoiceProfile,
  listProVoiceSampleBuffers,
  listVoiceSampleBuffers,
  MAX_VOICE_SAMPLES,
  PRO_MIN_TOTAL_MS,
  PRO_MAX_TOTAL_MS,
  resolveProVoiceId,
  resolveVoiceId,
  savePvcPendingVoice,
  saveProVoice,
  saveVoiceClone,
  validateProfileSlot,
  voiceProfileSummary,
} from './voice-store.js';
import {
  addPvcSamples,
  createPvcVoice,
  createVoiceClone,
  generateClonedSpeech,
  isElevenLabsConfigured,
  listProfessionalVoices,
} from './elevenlabs.js';
import {
  cloneVoiceLanguagesByModel,
  listCloneVoiceLanguageCodes,
  supportsClonedVoice,
  supportsProVoice,
} from './elevenlabs-languages.js';
import { waitUntil } from '@vercel/functions';
import { headIsStable, splitSpeechText } from './speech-chunks.js';
import { createSessionToken } from './session-token.js';
import { isPersistentBlobEnabled, readBuffer, writeBuffer } from './persistent-store.js';
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

// A 90s recording transcribes to ~2,000 chars; its translation can need
// 600+ output tokens in token-dense scripts (Thai, Hindi, CJK). 1,200
// leaves ample headroom — you only pay for tokens actually generated.
const TRANSLATION_MAX_TOKENS = 1200;

async function translateTextStream(openai, text, lang1, lang2, context, onDelta, { detected } = {}) {
  const userMessage = buildTranslationUserMessage(text, lang1, lang2, context, detected);

  const stream = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.25,
      max_tokens: TRANSLATION_MAX_TOKENS,
      stream: true,
      messages: [
        { role: 'system', content: buildStreamingSystemPrompt(lang1, lang2) },
        { role: 'user', content: userMessage },
      ],
    })
  );

  let finishReason = null;
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const delta = choice?.delta?.content || '';
    if (delta) onDelta(delta);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }
  return { truncated: finishReason === 'length' };
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

async function pipeTranslationStream(res, openai, rawText, lang1, lang2, context, { warmSpeech } = {}) {
  const writeLine = beginTranslationStream(res);

  const preDetected = detectLanguageInPair(rawText, lang1, lang2);
  const expectedTarget = preDetected ? (preDetected === lang1 ? lang2 : lang1) : null;

  // Sharing the likely target language up front lets the client prefetch
  // the first audio chunk while the translation is still streaming.
  writeLine({ event: 'transcript', rawText, ...(expectedTarget ? { targetLanguage: expectedTarget } : {}) });

  let accumulated = '';
  let headWarmed = false;
  const { truncated } = await translateTextStream(openai, rawText, lang1, lang2, context, (chunk) => {
    accumulated += chunk;
    writeLine({ event: 'delta', text: chunk });

    // Once enough text has streamed, the head chunk is deterministic —
    // start synthesizing it before the translation finishes.
    if (!headWarmed && warmSpeech && expectedTarget && headIsStable(accumulated)) {
      headWarmed = true;
      warmSpeech(splitSpeechText(accumulated).head, expectedTarget);
    }
  }, { detected: preDetected });

  if (truncated) {
    console.warn(`Translation hit the ${TRANSLATION_MAX_TOKENS}-token cap and was cut (input ${rawText.length} chars)`);
  }

  const translated = finalizeTranslation(rawText, accumulated, lang1, lang2, preDetected);

  if (!translated.translatedText) {
    writeLine({ event: 'error', error: 'Could not translate message' });
    res.end();
    return;
  }

  // Start TTS before the client asks for it so /api/speak hits a warm cache.
  if (warmSpeech && translated.targetLanguage) {
    warmSpeech(translated.translatedText, translated.targetLanguage);
  }

  writeLine({ event: 'done', rawText, ...translated, ...(truncated ? { truncated: true } : {}) });
  res.end();
}

function buildSpeechWarmer(openai, req) {
  return (text, lang) => {
    const warmPromise = (async () => {
      const slot = parseProfileSlot(req);
      const voiceProfile = await getVoiceProfile(req.user.id, slot);
      const voiceId = resolveVoiceId(req.user, voiceProfile);
      const useClone = Boolean(voiceId) && supportsClonedVoice(lang);
      const speakVoiceId = useClone ? voiceId : null;

      // Mirror the client's head/tail split so both chunks are cached and
      // the short head chunk is ready first.
      const { head, tail } = splitSpeechText(text);
      await generateSpeech(openai, head, lang, speakVoiceId);
      if (tail) await generateSpeech(openai, tail, lang, speakVoiceId);
    })().catch((err) => {
      console.error('TTS warm-up error:', err?.message || err);
    });

    // Keep the serverless instance alive until the warm-up finishes;
    // otherwise Vercel freezes the function as soon as the response ends.
    try {
      waitUntil(warmPromise);
    } catch {
      // Outside a Vercel request context (local dev) this is a no-op.
    }
  };
}

// Links a Professional Voice Clone created in the ElevenLabs dashboard to
// this profile without manual configuration: when the account has exactly
// one PVC voice, adopt and persist it. With several PVC voices the link is
// ambiguous, so ELEVENLABS_PRO_VOICE_ID must pick one.
async function discoverProVoice(userId, slot, voiceProfile = null) {
  try {
    const voices = await listProfessionalVoices();
    // Prefer the PVC voice this profile submitted itself; otherwise only
    // auto-link when the account has exactly one professional voice.
    const pendingId = voiceProfile?.pvcPendingVoiceId;
    const match = (pendingId && voices.find((voice) => voice.voiceId === pendingId))
      || (voices.length === 1 ? voices[0] : null);
    if (!match) return null;
    await saveProVoice(userId, slot, match.voiceId);
    return match.voiceId;
  } catch (err) {
    console.warn('Pro voice discovery failed:', err?.message || err);
    return null;
  }
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

function ttsCacheKey(text, lang, voiceId = null, quality = 'fast') {
  return `${quality}|${voiceId || 'default'}|${lang || ''}|${prepareTextForSpeech(text, lang)}`;
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

async function generateSpeechBuffer(openai, input, lang, voiceId = null, { pro = false } = {}) {
  // The pro path is explicit and never falls back to another voice: if the
  // PVC generation fails, the caller sees the error.
  if (pro) {
    return generateClonedSpeech(input, voiceId, lang, { pro: true });
  }

  if (voiceId && isElevenLabsConfigured() && supportsClonedVoice(lang)) {
    return generateClonedSpeech(input, voiceId, lang);
  }

  const speech = await withRetry(() =>
    openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'nova',
      input,
      instructions: 'Speak at a natural, slightly brisk pace.',
      response_format: 'mp3',
    }),
    2
  );
  return Buffer.from(await speech.arrayBuffer());
}

// Dedupes concurrent generations so a warm-up started at translation time
// and the client's /api/speak prefetch share a single TTS request.
const ttsPending = new Map();

// The in-memory cache is per serverless instance. On Vercel the /api/speak
// request often lands on a different instance than the /api/translate that
// warmed the audio, making the warm-up useless. A Blob-backed second level
// lets every instance reuse pre-generated audio (~0.1s read vs ~2s TTS).
function ttsBlobKey(cacheKey) {
  return `tts-cache/${crypto.createHash('sha256').update(cacheKey).digest('hex')}.mp3`;
}

function persistTtsBlob(cacheKey, buffer) {
  if (!isPersistentBlobEnabled()) return;
  const write = writeBuffer(ttsBlobKey(cacheKey), buffer, 'audio/mpeg').catch((err) => {
    console.warn('TTS blob write failed:', err?.message || err);
  });
  try {
    waitUntil(write);
  } catch {
    // Outside a Vercel request context (local dev) this is a no-op.
  }
}

async function readTtsBlob(cacheKey) {
  if (!isPersistentBlobEnabled()) return null;
  try {
    return await readBuffer(ttsBlobKey(cacheKey));
  } catch {
    return null;
  }
}

function generateSpeech(openai, text, lang, voiceId = null, { pro = false } = {}) {
  const input = prepareTextForSpeech(text, lang);
  if (!input) {
    return Promise.reject(new Error('No speakable text'));
  }

  const cacheKey = ttsCacheKey(input, lang, voiceId, pro ? 'pro' : 'fast');
  const cached = readTtsCache(cacheKey);
  if (cached) return Promise.resolve(cached);

  const pending = ttsPending.get(cacheKey);
  if (pending) return pending;

  const promise = (async () => {
    const blobHit = await readTtsBlob(cacheKey);
    if (blobHit?.length) {
      writeTtsCache(cacheKey, blobHit);
      return blobHit;
    }

    const buffer = await generateSpeechBuffer(openai, input, lang, voiceId, { pro });
    writeTtsCache(cacheKey, buffer);
    persistTtsBlob(cacheKey, buffer);
    return buffer;
  })().finally(() => {
    ttsPending.delete(cacheKey);
  });
  ttsPending.set(cacheKey, promise);
  return promise;
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
    proSamples: (voiceProfile.proSamples || []).map(({ id, createdAt, durationMs }) => ({
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
        sampleId: profile.samples.at(-1)?.id ?? null,
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

  // ---- Professional Voice Cloning (PVC) sample collection ----

  const proSamplesState = (profile) => {
    const proSamples = profile.proSamples || [];
    return {
      proSampleCount: proSamples.length,
      proTotalDurationMs: proSamples.reduce((sum, s) => sum + (Number(s.durationMs) || 0), 0),
      proMinTotalMs: PRO_MIN_TOTAL_MS,
      proMaxTotalMs: PRO_MAX_TOTAL_MS,
      pvcSubmitted: Boolean(profile.pvcPendingVoiceId),
    };
  };

  app.post('/api/voice/pro-samples', requireAppAuth, voiceSampleRateLimit, upload.single('audio'), async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ error: 'No audio received' });
    }

    try {
      const profile = await addProVoiceSample(req.user.id, slot, req.file.buffer, {
        mimeType: req.file.mimetype || 'audio/webm',
        durationMs: Number(req.body?.durationMs),
      });
      res.json({
        ok: true,
        sampleId: profile.proSamples.at(-1)?.id ?? null,
        profileSlot: slot,
        ...proSamplesState(profile),
      });
    } catch (err) {
      console.error('Pro sample upload error:', err);
      const status = err.code === 'SAMPLE_LIMIT' || err.code === 'DURATION_LIMIT' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Could not save pro sample' });
    }
  });

  app.delete('/api/voice/pro-samples', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    try {
      const profile = await clearAllProVoiceSamples(req.user.id, slot);
      res.json({ ok: true, profileSlot: slot, ...proSamplesState(profile) });
    } catch (err) {
      console.error('Pro samples reset error:', err);
      res.status(500).json({ error: err.message || 'Could not reset pro samples' });
    }
  });

  app.delete('/api/voice/pro-samples/:sampleId', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    try {
      const profile = await deleteProVoiceSample(req.user.id, slot, req.params.sampleId);
      if (!profile) {
        return res.status(404).json({ error: 'Sample not found' });
      }
      res.json({ ok: true, profileSlot: slot, ...proSamplesState(profile) });
    } catch (err) {
      console.error('Pro sample delete error:', err);
      res.status(500).json({ error: err.message || 'Could not delete pro sample' });
    }
  });

  // Creates the PVC voice on ElevenLabs and uploads every collected sample.
  // Verification (reading a captcha aloud) and training are finished in the
  // ElevenLabs dashboard; once trained, the PRO path links the voice
  // automatically via discoverProVoice.
  app.post('/api/voice/pro-create', requireAppAuth, async (req, res) => {
    const slot = requireProfileSlot(req, res);
    if (slot == null) return;
    if (!isElevenLabsConfigured()) {
      return res.status(503).json({ error: 'Voice cloning is not configured on the server' });
    }

    try {
      const { profile, buffers } = await listProVoiceSampleBuffers(req.user.id, slot);
      const totalMs = (profile.proSamples || []).reduce((sum, s) => sum + (Number(s.durationMs) || 0), 0);
      if (totalMs < PRO_MIN_TOTAL_MS) {
        const missingMin = Math.ceil((PRO_MIN_TOTAL_MS - totalMs) / 60_000);
        return res.status(400).json({
          error: `Professional cloning needs at least 30 minutes of audio — about ${missingMin} more minutes to go`,
        });
      }
      if (!buffers.length) {
        return res.status(400).json({ error: 'No pro samples found' });
      }

      const language = String(req.body?.language || 'en').toLowerCase().slice(0, 5);
      const voiceId = profile.pvcPendingVoiceId || await createPvcVoice({
        name: `Lingu ${req.user.name} ${slot} PRO`,
        language,
        description: `Professional voice profile ${slot} for ${req.user.name}`,
      });

      // ElevenLabs accepts multiple files per request, but keep each batch
      // modest so a single slow upload cannot exhaust the function timeout.
      const MAX_BATCH_BYTES = 20 * 1024 * 1024;
      const MAX_BATCH_FILES = 15;
      let batch = [];
      let batchBytes = 0;
      for (const sample of buffers) {
        if (batch.length && (batch.length >= MAX_BATCH_FILES || batchBytes + sample.buffer.length > MAX_BATCH_BYTES)) {
          await addPvcSamples(voiceId, batch);
          batch = [];
          batchBytes = 0;
        }
        batch.push(sample);
        batchBytes += sample.buffer.length;
      }
      if (batch.length) {
        await addPvcSamples(voiceId, batch);
      }

      const saved = await savePvcPendingVoice(req.user.id, slot, voiceId);
      res.json({
        ok: true,
        pvcVoiceId: voiceId,
        profileSlot: slot,
        ...proSamplesState(saved),
      });
    } catch (err) {
      console.error('PVC create error:', err);
      res.status(500).json({ error: err.message || 'Could not create professional voice' });
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

  // Mints a short-lived OpenAI Realtime credential so the browser can stream
  // mic audio directly to OpenAI and receive live transcription deltas. The
  // real API key never leaves the server; the ephemeral secret is bound to a
  // single transcription session and expires within minutes.
  app.post('/api/realtime-session', requireAppAuth, converseRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const lang1 = String(req.body.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body.lang2 || '').toLowerCase().trim();
    if (!validateLanguagePair(lang1, lang2, res)) return;

    try {
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 300 },
          session: {
            type: 'transcription',
            audio: {
              input: {
                noise_reduction: { type: 'near_field' },
                transcription: {
                  model: 'gpt-4o-mini-transcribe',
                  prompt: buildTranscriptionPrompt(lang1, lang2),
                },
                turn_detection: { type: 'server_vad', silence_duration_ms: 400 },
              },
            },
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.value) {
        console.error('Realtime session error:', response.status, data);
        return res.status(502).json({
          error: data?.error?.message || 'Could not start live transcription',
        });
      }

      res.json({ clientSecret: data.value, expiresAt: data.expires_at });
    } catch (err) {
      console.error('Realtime session error:', err);
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

      await pipeTranslationStream(res, openai, rawText, lang1, lang2, context, {
        warmSpeech: buildSpeechWarmer(openai, req),
      });
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
      await pipeTranslationStream(res, openai, rawText, lang1, lang2, context, {
        warmSpeech: buildSpeechWarmer(openai, req),
      });
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

      // On-demand pro audio: Professional Voice Clone on multilingual v2.
      // Never generated automatically and never a silent fallback — if the
      // PVC voice is missing the request fails with guidance instead.
      if (req.body.quality === 'pro') {
        if (!isElevenLabsConfigured()) {
          return res.status(503).json({ error: 'Voice service not configured' });
        }
        if (!supportsProVoice(langCode)) {
          return res.status(400).json({ error: 'Pro voice does not support this language yet' });
        }

        const proVoiceId = resolveProVoiceId(voiceProfile)
          || await discoverProVoice(req.user.id, slot, voiceProfile);
        if (!proVoiceId) {
          const message = voiceProfile?.pvcPendingVoiceId
            ? 'Pro voice is still training — finish verification in the ElevenLabs dashboard and try again once training completes'
            : 'Pro voice not ready — record or upload 30 minutes of audio in your profile\u2019s PRO section and submit it';
          return res.status(409).json({ error: message });
        }

        const buffer = await generateSpeech(openai, text, langCode, proVoiceId, { pro: true });
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'private, max-age=3600');
        res.set('X-Voice-Mode', 'pro');
        return res.send(buffer);
      }

      const voiceId = resolveVoiceId(req.user, voiceProfile);
      const useClone = Boolean(voiceId) && supportsClonedVoice(langCode);

      if (req.body.voiceMode === 'clone' && supportsClonedVoice(langCode) && !voiceId) {
        return res.status(400).json({ error: 'Personal voice not ready — set up your voice profile first' });
      }

      let buffer;
      try {
        buffer = await generateSpeech(openai, text, langCode, useClone ? voiceId : null);
      } catch {
        // A shared warm-up promise may have died with a frozen serverless
        // instance; retry once with a fresh generation.
        buffer = await generateSpeech(openai, text, langCode, useClone ? voiceId : null);
      }
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
