// Kaldi-compatible 80-dim log mel filterbank features, as expected by the
// 3D-Speaker eres2net speaker-embedding model (16 kHz, 25 ms frames with
// 10 ms shift, povey window, dither off, snip-edges, samples kept in [-1,1]
// per normalize_samples=1, plus per-utterance mean subtraction per its
// feature_normalize_type=global-mean).
//
// Pure JS with no DOM dependencies so the exact same code runs in the
// browser (voice matching) and in node (threshold calibration script) —
// bit-identical features on both sides is what makes the cosine threshold
// transferable.

const SAMPLE_RATE = 16000;
const FRAME_LENGTH = 400; // 25 ms
const FRAME_SHIFT = 160; // 10 ms
const FFT_SIZE = 512;
const NUM_BINS = 80;
const LOW_FREQ = 20;
const HIGH_FREQ = SAMPLE_RATE / 2;
const PREEMPH = 0.97;
const LOG_EPS = 1.1920929e-7; // float32 epsilon, kaldi's log floor

function melScale(freq) {
  return 1127 * Math.log(1 + freq / 700);
}

let cachedWindow = null;

function poveyWindow() {
  if (cachedWindow) return cachedWindow;
  const win = new Float32Array(FRAME_LENGTH);
  const a = (2 * Math.PI) / (FRAME_LENGTH - 1);
  for (let i = 0; i < FRAME_LENGTH; i++) {
    win[i] = Math.pow(0.5 - 0.5 * Math.cos(a * i), 0.85);
  }
  cachedWindow = win;
  return win;
}

let cachedMelBanks = null;

// Triangular mel filters over the 257 FFT magnitude bins. Stored sparse
// (first bin + weights) exactly like kaldi computes them.
function melBanks() {
  if (cachedMelBanks) return cachedMelBanks;

  const numFftBins = FFT_SIZE / 2 + 1;
  const fftBinWidth = SAMPLE_RATE / FFT_SIZE;
  const melLow = melScale(LOW_FREQ);
  const melHigh = melScale(HIGH_FREQ);
  const melDelta = (melHigh - melLow) / (NUM_BINS + 1);

  const banks = [];
  for (let bin = 0; bin < NUM_BINS; bin++) {
    const left = melLow + bin * melDelta;
    const center = left + melDelta;
    const right = center + melDelta;

    let firstIndex = -1;
    const weights = [];
    for (let i = 0; i < numFftBins; i++) {
      const mel = melScale(fftBinWidth * i);
      if (mel > left && mel < right) {
        const weight = mel <= center
          ? (mel - left) / (center - left)
          : (right - mel) / (right - center);
        if (firstIndex === -1) firstIndex = i;
        weights.push(weight);
      } else if (firstIndex !== -1) {
        break;
      }
    }
    banks.push({ firstIndex, weights });
  }
  cachedMelBanks = banks;
  return banks;
}

// In-place iterative radix-2 FFT (real input packed in re/im arrays).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * @param {Float32Array} samples mono 16 kHz audio in [-1, 1]
 * @returns {{ frames: Float32Array, numFrames: number }} row-major
 *   [numFrames x 80] log mel features. Empty when audio is shorter than
 *   one frame.
 */
export function computeFbankFeatures(samples) {
  if (!samples || samples.length < FRAME_LENGTH) {
    return { frames: new Float32Array(0), numFrames: 0 };
  }

  const numFrames = 1 + Math.floor((samples.length - FRAME_LENGTH) / FRAME_SHIFT);
  const win = poveyWindow();
  const banks = melBanks();
  const out = new Float32Array(numFrames * NUM_BINS);

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const frame = new Float32Array(FRAME_LENGTH);
  const power = new Float32Array(FFT_SIZE / 2 + 1);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * FRAME_SHIFT;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      frame[i] = samples[offset + i];
    }

    // Remove DC offset.
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) mean += frame[i];
    mean /= FRAME_LENGTH;
    for (let i = 0; i < FRAME_LENGTH; i++) frame[i] -= mean;

    // Pre-emphasis (kaldi order: after DC removal, before windowing).
    for (let i = FRAME_LENGTH - 1; i > 0; i--) {
      frame[i] -= PREEMPH * frame[i - 1];
    }
    frame[0] -= PREEMPH * frame[0];

    for (let i = 0; i < FRAME_LENGTH; i++) {
      re[i] = frame[i] * win[i];
      im[i] = 0;
    }
    re.fill(0, FRAME_LENGTH);
    im.fill(0, FRAME_LENGTH);

    fft(re, im);
    for (let i = 0; i <= FFT_SIZE / 2; i++) {
      power[i] = re[i] * re[i] + im[i] * im[i];
    }

    const row = f * NUM_BINS;
    for (let b = 0; b < NUM_BINS; b++) {
      const { firstIndex, weights } = banks[b];
      let energy = 0;
      for (let k = 0; k < weights.length; k++) {
        energy += weights[k] * power[firstIndex + k];
      }
      out[row + b] = Math.log(Math.max(energy, LOG_EPS));
    }
  }

  // Global mean normalization (per dimension over the utterance).
  for (let b = 0; b < NUM_BINS; b++) {
    let sum = 0;
    for (let f = 0; f < numFrames; f++) sum += out[f * NUM_BINS + b];
    const avg = sum / numFrames;
    for (let f = 0; f < numFrames; f++) out[f * NUM_BINS + b] -= avg;
  }

  return { frames: out, numFrames };
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export const FBANK_SAMPLE_RATE = SAMPLE_RATE;
export const FBANK_NUM_BINS = NUM_BINS;
