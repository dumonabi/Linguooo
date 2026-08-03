// Sharing and receiving the recovery phrase through side channels, modeled
// on bip.lol: the canonical payload everywhere is the compact Base58 code
// (16 entropy bytes, ~22 characters).
//
// - QR: generated with `qrcode`, read with `jsqr` (camera loop or a photo).
// - Sound: ggwave (vendored at /public/ggwave.js, same build as bip.lol),
//   AUDIBLE_FAST protocol at 48kHz — one short chirp carries the code.
// - Emoji: the Base58 code hidden in a 😊 via variation selectors.
//
// Heavy libraries load lazily so the auth gate stays light until a share
// channel is actually used.

import { base58ToPhrase, phraseToBase58 } from './seed-input-extras.js';
import { hideTextInEmoji, revealTextFromEmoji } from './emoji-code.js';

// ---- emoji ----

export function phraseToEmoji(phrase) {
  const code = phraseToBase58(phrase);
  return code ? hideTextInEmoji(code) : '';
}

export function emojiToPhrase(value) {
  const hidden = revealTextFromEmoji(value);
  return hidden ? base58ToPhrase(hidden) : '';
}

// ---- QR ----

export async function seedQrDataUrl(phrase) {
  const code = phraseToBase58(phrase);
  if (!code) return '';
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(code, { width: 512, margin: 1 });
}

// Camera loop: draw frames on a canvas and let jsQR look for a code that
// decodes to a valid phrase. Returns { stop } — stop() also releases the
// camera.
export async function startSeedQrScan(videoEl, onPhrase) {
  const { default: jsQR } = await import('jsqr');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  });
  videoEl.srcObject = stream;
  videoEl.setAttribute('playsinline', 'true');
  await videoEl.play().catch(() => {});

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let raf = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    videoEl.srcObject = null;
    stream.getTracks().forEach((track) => track.stop());
  };

  const tick = () => {
    if (stopped) return;
    if (ctx && videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && videoEl.videoWidth) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      const phrase = result?.data ? base58ToPhrase(result.data) : '';
      if (phrase) {
        stop();
        onPhrase(phrase);
        return;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return { stop };
}

// Photo fallback (also the desktop path without a camera): try a few sizes,
// larger first, like bip.lol does.
export async function seedPhraseFromQrImage(file) {
  const { default: jsQR } = await import('jsqr');
  const bitmap = await createImageBitmap(file);
  try {
    for (const maxSide of [1600, 900, 500]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      const phrase = result?.data ? base58ToPhrase(result.data) : '';
      if (phrase) return phrase;
    }
  } finally {
    bitmap.close?.();
  }
  return '';
}

// ---- sound (ggwave) ----

const GGWAVE_SRC = '/ggwave.js';
const SOUND_PROTOCOL = 'GGWAVE_PROTOCOL_AUDIBLE_FAST';
const SOUND_VOLUME = 15;

let ggwaveScriptPromise = null;
let ggwaveModule = null;
let ggwaveInstance = null;
let audioCtx = null;

function loadGgwaveScript() {
  if (typeof window.ggwave_factory === 'function') return Promise.resolve();
  if (!ggwaveScriptPromise) {
    ggwaveScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GGWAVE_SRC;
      script.onload = () => resolve();
      script.onerror = () => {
        ggwaveScriptPromise = null;
        reject(new Error('Could not load the sound engine'));
      };
      document.head.appendChild(script);
    });
  }
  return ggwaveScriptPromise;
}

// Reinterpret a typed array's bytes as another typed array (the official
// ggwave-js pattern: Int8 waveform <-> Float32 audio samples).
function convertTypedArray(src, TargetType) {
  const buffer = new ArrayBuffer(src.byteLength);
  new src.constructor(buffer).set(src);
  return new TargetType(buffer);
}

async function initSound() {
  await loadGgwaveScript();
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx({ sampleRate: 48000 });
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (!ggwaveModule) ggwaveModule = await window.ggwave_factory();
  if (ggwaveInstance == null) {
    const params = ggwaveModule.getDefaultParameters();
    params.sampleRateInp = audioCtx.sampleRate;
    params.sampleRateOut = audioCtx.sampleRate;
    ggwaveInstance = ggwaveModule.init(params);
  }
  return { g: ggwaveModule, ctx: audioCtx };
}

// Plays the phrase's Base58 code as an audible chirp. Resolves when the
// sound finishes.
export async function playSeedSound(phrase) {
  const code = phraseToBase58(phrase);
  if (!code) throw new Error('No phrase to play');
  const { g, ctx } = await initSound();
  const waveform = g.encode(ggwaveInstance, code, g.ProtocolId[SOUND_PROTOCOL], SOUND_VOLUME);
  const samples = convertTypedArray(waveform, Float32Array);
  await new Promise((resolve) => {
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => resolve();
    src.start();
  });
}

// Listens on the microphone until a chirp decodes to a valid phrase, then
// stops itself and reports it. Returns { stop } for manual cancellation.
export async function listenForSeedSound(onPhrase) {
  const { g, ctx } = await initSound();
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  const micSource = ctx.createMediaStreamSource(micStream);
  // ScriptProcessor must stay connected to the destination to keep firing;
  // a zero-gain node prevents feedback.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    processor.disconnect();
    processor.onaudioprocess = null;
    micSource.disconnect();
    mute.disconnect();
    micStream.getTracks().forEach((track) => track.stop());
  };

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    const res = g.decode(ggwaveInstance, convertTypedArray(samples, Int8Array));
    if (res && res.length > 0) {
      const text = new TextDecoder('utf-8').decode(res);
      const phrase = base58ToPhrase(text);
      if (phrase) {
        stop();
        onPhrase(phrase);
      }
    }
  };

  micSource.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  return { stop };
}
