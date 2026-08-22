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
  getUserById,
  publicUserProfile,
} from './users.js';
import {
  addContactPair,
  appendChatMessage,
  contactCodeForUser,
  findUserByContactCode,
  getContacts,
  getMessages,
  isContact,
  lastMessageInfo,
  normalizeContactCode,
  setContactAlias,
} from './chat-store.js';
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
  supportsV3OnlyVoice,
} from './elevenlabs-languages.js';
import { waitUntil } from '@vercel/functions';
import { headIsStable, splitSpeechText } from './speech-chunks.js';
import { createSessionToken } from './session-token.js';
import { isPersistentBlobEnabled, readBuffer, readText, writeBuffer, writeText } from './persistent-store.js';
import { BASE_VOICE_PROMPTS_EN } from './voice-prompt-texts.js';
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

// A 2-minute recording transcribes to ~2,700 chars; its translation can need
// 800+ output tokens in token-dense scripts (Thai, Hindi, CJK). 1,600
// leaves ample headroom — you only pay for tokens actually generated.
const TRANSLATION_MAX_TOKENS = 1600;

// ---- Draft improvement (magic wand) ----
// Each mode is a rewrite instruction applied to the user's draft before
// translation. Rewrites always stay in the original language.
const IMPROVE_PROMPTS = {
  simplify:
    'Rewrite the text so it is simpler and easier to understand: shorter sentences, common words, no filler. Keep the meaning, the facts and the tone of address (formal/informal) intact.',
  fix:
    'Correct only the spelling, grammar and punctuation errors in the text. Do not rephrase, reorder or change the wording beyond what fixing the errors requires.',
  formal:
    'Rewrite the text in a polite, formal register suitable for a professional message. Keep the meaning and all facts intact, and do not add new content.',
};

// ---- Voice-sample reading prompts in any language ----
// Translated once per language from the English sources, then cached both
// in memory and in the persistent store.
const voicePromptsCache = new Map();
const voicePromptsPending = new Map();

function voicePromptsStoreKey(lang) {
  return `voice-prompts/${lang}-v1.json`;
}

async function translatePromptText(openai, text, languageName) {
  const completion = await withRetry(() =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 2400,
      messages: [
        {
          role: 'system',
          content: `You translate scripts meant to be read aloud for voice recording. Translate the user's text into ${languageName}. Keep the same tone, energy and approximate length, and make it sound like natural spoken ${languageName} that is pleasant to read out loud. Return only the translation, nothing else.`,
        },
        { role: 'user', content: text },
      ],
    })
  );
  return completion.choices[0]?.message?.content?.trim() || '';
}

async function buildVoicePromptsForLang(openai, lang) {
  const languageName = LANGUAGE_NAMES[lang];
  const prompts = await Promise.all(
    BASE_VOICE_PROMPTS_EN.map((text) => translatePromptText(openai, text, languageName)),
  );
  if (prompts.some((text) => !text)) {
    throw new Error(`Prompt translation for ${lang} came back incomplete`);
  }
  return { prompts };
}

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

// gpt-4o-mini-tts silently truncates the audio of long inputs (it returns a
// 200 with the end of the text missing — a known model bug). Keeping each
// request short makes truncation very unlikely, and MP3 buffers concatenate
// cleanly, so long texts are synthesized as several chunks in parallel.
const OPENAI_TTS_CHUNK_CHARS = 500;
const OPENAI_TTS_SENTENCE_ENDS = ['. ', '! ', '? ', '。', '！', '？', '\n'];

function lastSpeechBoundary(window) {
  let best = -1;
  for (const mark of OPENAI_TTS_SENTENCE_ENDS) {
    const idx = window.lastIndexOf(mark);
    if (idx >= 0) best = Math.max(best, idx + mark.length);
  }
  return best;
}

function splitForOpenAiTts(text) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > OPENAI_TTS_CHUNK_CHARS) {
    const window = rest.slice(0, OPENAI_TTS_CHUNK_CHARS);
    let cut = lastSpeechBoundary(window);
    if (cut < OPENAI_TTS_CHUNK_CHARS * 0.4) {
      // No usable sentence end (e.g. Thai, which separates phrases with
      // plain spaces): fall back to the last space, then to a hard cut.
      const space = window.lastIndexOf(' ');
      cut = space >= OPENAI_TTS_CHUNK_CHARS * 0.4 ? space + 1 : OPENAI_TTS_CHUNK_CHARS;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function generateSpeechBuffer(openai, input, lang, voiceId = null, { v3 = false } = {}) {
  // The v3 path is explicit and never falls back to another voice:
  // if the generation fails, the caller sees the error.
  if (v3) {
    return generateClonedSpeech(input, voiceId, lang, { v3: true });
  }

  if (voiceId && isElevenLabsConfigured() && supportsClonedVoice(lang)) {
    return generateClonedSpeech(input, voiceId, lang);
  }

  const chunks = splitForOpenAiTts(input);
  const buffers = await Promise.all(chunks.map((chunk) =>
    withRetry(() =>
      openai.audio.speech.create({
        model: 'gpt-4o-mini-tts',
        voice: 'nova',
        input: chunk,
        instructions: 'Speak at a natural, slightly brisk pace.',
        response_format: 'mp3',
      }),
      2
    ).then(async (speech) => Buffer.from(await speech.arrayBuffer()))
  ));
  return buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
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

function generateSpeech(openai, text, lang, voiceId = null, { v3 = false } = {}) {
  const input = prepareTextForSpeech(text, lang);
  if (!input) {
    return Promise.reject(new Error('No speakable text'));
  }

  const cacheKey = ttsCacheKey(input, lang, voiceId, v3 ? 'v3' : 'fast');
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

    const buffer = await generateSpeechBuffer(openai, input, lang, voiceId, { v3 });
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

  app.get('/api/languages', requireAppAuth, (_req, res) => {
    res.json(getLanguagesList());
  });

  // Reading prompts for voice samples in any supported language. Spanish,
  // Thai and English ship hand-written with the client; every other language
  // is machine-translated from the English source texts on first request and
  // cached persistently, so the translation cost is paid once per language.
  app.get('/api/voice/prompts', requireAppAuth, async (req, res) => {
    const lang = String(req.query.lang || 'en').toLowerCase().trim();
    if (!LANGUAGE_NAMES[lang]) {
      return res.status(400).json({ error: 'Unsupported language' });
    }
    if (lang === 'en') {
      return res.json({ ok: true, lang, prompts: BASE_VOICE_PROMPTS_EN });
    }

    const cached = voicePromptsCache.get(lang);
    if (cached) {
      return res.json({ ok: true, lang, ...cached });
    }

    try {
      const persisted = await readText(voicePromptsStoreKey(lang));
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (Array.isArray(parsed?.prompts)) {
          const data = { prompts: parsed.prompts };
          voicePromptsCache.set(lang, data);
          return res.json({ ok: true, lang, ...data });
        }
      }

      const openai = requireOpenAI(res);
      if (!openai) return;

      let pending = voicePromptsPending.get(lang);
      if (!pending) {
        pending = buildVoicePromptsForLang(openai, lang)
          .finally(() => voicePromptsPending.delete(lang));
        voicePromptsPending.set(lang, pending);
      }
      const data = await pending;

      voicePromptsCache.set(lang, data);
      const persist = writeText(voicePromptsStoreKey(lang), JSON.stringify(data))
        .catch((err) => console.warn('Voice prompts persist failed:', err?.message));
      waitUntil(persist);

      res.json({ ok: true, lang, ...data });
    } catch (err) {
      console.error('Voice prompts error:', err);
      res.status(502).json({ error: 'Could not prepare the reading texts for this language' });
    }
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

  // Rewrites the draft text with GPT before translating: simplify it, fix
  // errors only, or shift it to a formal register. Always answers in the
  // same language the text was written in.
  app.post('/api/improve', requireAppAuth, converseRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const text = String(req.body?.text || '').trim();
    const mode = String(req.body?.mode || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }
    if (text.length > 8000) {
      return res.status(400).json({ error: 'Text is too long to improve' });
    }
    const instruction = IMPROVE_PROMPTS[mode];
    if (!instruction) {
      return res.status(400).json({ error: 'Unknown improvement mode' });
    }

    try {
      const completion = await withRetry(() =>
        openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          max_tokens: TRANSLATION_MAX_TOKENS,
          messages: [
            {
              role: 'system',
              content: `${instruction} Always respond in the same language the text is written in. Return only the rewritten text, with no quotes, labels or commentary.`,
            },
            { role: 'user', content: text },
          ],
        })
      );
      const improved = completion.choices[0]?.message?.content?.trim();
      if (!improved) {
        return res.status(502).json({ error: 'The model returned an empty rewrite' });
      }
      res.json({ ok: true, text: improved, mode });
    } catch (err) {
      console.error('Improve error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  // ---- Contacts & one-to-one chat ----
  //
  // Users share a short public contact code; adding it creates a mutual
  // contact. Messages are translated at send time into the language the
  // SENDER selected (lang2), so the receiver always sees the sender's
  // chosen language, as text or on-demand audio in the sender's voice.

  app.get('/api/contacts', requireAppAuth, async (req, res) => {
    try {
      const entries = await getContacts(req.user.id);
      const contacts = [];
      for (const entry of entries) {
        const user = await getUserById(entry.id);
        if (!user) continue;
        const last = await lastMessageInfo(req.user.id, entry.id);
        contacts.push({
          id: user.id,
          // The alias chosen when adding the contact wins over the profile name.
          name: entry.alias || user.name,
          code: contactCodeForUser(user.id),
          lastMessageId: last?.id ?? null,
          lastMessageFrom: last?.from ?? null,
          lastMessageAt: last?.createdAt ?? null,
        });
      }
      res.json({ code: contactCodeForUser(req.user.id), userId: req.user.id, contacts });
    } catch (err) {
      console.error('Contacts list error:', err);
      res.status(500).json({ error: 'Could not load contacts' });
    }
  });

  app.post('/api/contacts', requireAppAuth, async (req, res) => {
    const code = normalizeContactCode(req.body?.code);
    const alias = String(req.body?.name || '').trim().slice(0, 24) || null;
    if (!code) {
      return res.status(400).json({ error: 'Invalid contact code' });
    }
    if (code === contactCodeForUser(req.user.id)) {
      return res.status(400).json({ error: 'That is your own code' });
    }
    try {
      const target = await findUserByContactCode(code);
      if (!target) {
        return res.status(404).json({ error: 'No user found with that code' });
      }
      await addContactPair(req.user.id, target.id, alias);
      res.json({ ok: true, contact: { id: target.id, name: alias || target.name, code } });
    } catch (err) {
      console.error('Add contact error:', err);
      const status = err.code === 'CONTACT_LIMIT' ? 400 : 500;
      res.status(status).json({ error: err.message || 'Could not add contact' });
    }
  });

  // Rename a contact for the caller only. An empty name reverts to the
  // contact's profile name.
  app.patch('/api/contacts/:id', requireAppAuth, async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    const alias = String(req.body?.name || '').trim().slice(0, 24) || null;
    try {
      const ok = await setContactAlias(req.user.id, targetId, alias);
      if (!ok) {
        return res.status(404).json({ error: 'Not one of your contacts' });
      }
      const user = await getUserById(targetId);
      res.json({
        ok: true,
        contact: { id: targetId, name: alias || user?.name || 'Contact', code: contactCodeForUser(targetId) },
      });
    } catch (err) {
      console.error('Rename contact error:', err);
      res.status(500).json({ error: 'Could not rename contact' });
    }
  });

  app.post('/api/chat/send', requireAppAuth, converseRateLimit, async (req, res) => {
    const openai = requireOpenAI(res);
    if (!openai) return;

    const to = String(req.body?.to || '').trim();
    const rawText = String(req.body?.text || '').trim();
    const lang1 = String(req.body?.lang1 || '').toLowerCase().trim();
    const lang2 = String(req.body?.lang2 || '').toLowerCase().trim();

    if (!rawText) {
      return res.status(400).json({ error: 'Text is required' });
    }
    if (rawText.length > 8000) {
      return res.status(400).json({ error: 'Message is too long' });
    }
    if (!validateLanguagePair(lang1, lang2, res)) return;
    if (!(await isContact(req.user.id, to))) {
      return res.status(403).json({ error: 'Not one of your contacts' });
    }

    try {
      const preDetected = detectLanguageInPair(rawText, lang1, lang2);
      let accumulated = '';
      await translateTextStream(openai, rawText, lang1, lang2, [], (chunk) => {
        accumulated += chunk;
      }, { detected: preDetected });
      const t = finalizeTranslation(rawText, accumulated, lang1, lang2, preDetected);

      // Same rule as the translator above the chat: the message is delivered
      // in the OTHER language of the pair — writing in lang1 delivers lang2
      // and writing in lang2 delivers lang1 (undetected text targets lang1,
      // mirroring buildTranslationUserMessage).
      const deliveredLang = t.detectedLanguage === lang1 ? lang2 : lang1;
      const deliveredText = t.translatedText;
      if (!deliveredText?.trim()) {
        return res.status(502).json({ error: 'Translation failed — try again' });
      }

      const message = await appendChatMessage({
        from: req.user.id,
        to,
        text: deliveredText,
        sourceText: t.sourceText,
        sourceLang: t.detectedLanguage,
        targetLang: deliveredLang,
      });
      res.json({ ok: true, message });
    } catch (err) {
      console.error('Chat send error:', err);
      res.status(500).json({ error: formatApiError(err) });
    }
  });

  app.get('/api/chat/messages', requireAppAuth, async (req, res) => {
    const withId = String(req.query.with || '').trim();
    const after = String(req.query.after || '').trim() || null;
    if (!withId) {
      return res.status(400).json({ error: 'Contact id is required' });
    }
    if (!(await isContact(req.user.id, withId))) {
      return res.status(403).json({ error: 'Not one of your contacts' });
    }
    try {
      const messages = await getMessages(req.user.id, withId, { after });
      res.set('Cache-Control', 'no-store');
      res.json({ messages });
    } catch (err) {
      console.error('Chat messages error:', err);
      res.status(500).json({ error: 'Could not load messages' });
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
      // Chat audio plays in the SENDER's voice: a receiver may request the
      // audio of a contact's message via speakerId. Only contacts qualify.
      const speakerId = String(req.body.speakerId || '').trim() || null;
      let voiceOwner = req.user;
      let ownerSlot;
      let voiceProfile;
      if (speakerId && speakerId !== req.user.id) {
        if (!(await isContact(req.user.id, speakerId))) {
          return res.status(403).json({ error: 'Not one of your contacts' });
        }
        const speaker = await getUserById(speakerId);
        if (!speaker) {
          return res.status(404).json({ error: 'Speaker not found' });
        }
        voiceOwner = speaker;
        ownerSlot = 1;
        voiceProfile = await getVoiceProfile(speakerId, ownerSlot);
      } else {
        ownerSlot = requireProfileSlot(req, res);
        if (ownerSlot == null) return;
        voiceProfile = await getVoiceProfile(req.user.id, ownerSlot);
      }

      // On-demand v3 audio: the user's instant clone on eleven_v3, the only
      // model that speaks languages outside the flash set (e.g. Thai) in
      // their voice. Slow, so it is never generated automatically.
      if (req.body.quality === 'v3') {
        if (!isElevenLabsConfigured()) {
          return res.status(503).json({ error: 'Voice service not configured' });
        }
        if (!supportsV3OnlyVoice(langCode)) {
          return res.status(400).json({ error: 'This language does not use the v3 voice' });
        }
        const v3VoiceId = resolveVoiceId(voiceOwner, voiceProfile);
        if (!v3VoiceId) {
          return res.status(409).json({ error: 'Personal voice not ready — set up your voice profile first' });
        }

        const buffer = await generateSpeech(openai, text, langCode, v3VoiceId, { v3: true });
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'private, max-age=3600');
        res.set('X-Voice-Mode', 'v3');
        return res.send(buffer);
      }

      // Fast path: always produce audio. If the cloned voice was requested
      // but is missing on this slot, or its generation keeps failing, fall
      // back to the default voice instead of erroring — otherwise a client/
      // server mismatch leaves the translation with no audio at all. The
      // my-voice button is the strict "my voice or an explanation" path.
      const voiceId = resolveVoiceId(voiceOwner, voiceProfile);
      let useClone = Boolean(voiceId) && supportsClonedVoice(langCode);

      let buffer;
      try {
        buffer = await generateSpeech(openai, text, langCode, useClone ? voiceId : null);
      } catch {
        try {
          // A shared warm-up promise may have died with a frozen serverless
          // instance; retry once with a fresh generation.
          buffer = await generateSpeech(openai, text, langCode, useClone ? voiceId : null);
        } catch (err) {
          if (!useClone) throw err;
          useClone = false;
          buffer = await generateSpeech(openai, text, langCode, null);
        }
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
