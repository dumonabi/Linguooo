// Validates the JS fbank + CAM++ speaker-embedding pipeline against the
// sherpa-onnx sample speakers and prints the cosine similarity matrix.
// Same/different speaker scores guide the auto-collect threshold.
//
// Usage: node scripts/validate-voice-match.mjs /tmp/spk
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ort from 'onnxruntime-node';
import { computeFbankFeatures, cosineSimilarity, FBANK_NUM_BINS } from '../src/fbank.js';

const dir = process.argv[2] || '/tmp/spk';
const MODEL = new URL('../public/models/speaker-eres2net.onnx', import.meta.url).pathname;

function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a WAV file`);
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      data = buf.subarray(offset + 8, offset + 8 + size);
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt/data chunk`);
  if (fmt.format !== 1 || fmt.bitsPerSample !== 16) throw new Error(`${path}: expected PCM16`);
  if (fmt.sampleRate !== 16000) throw new Error(`${path}: expected 16kHz, got ${fmt.sampleRate}`);

  const total = Math.floor(data.length / 2);
  const perChannel = Math.floor(total / fmt.channels);
  const samples = new Float32Array(perChannel);
  for (let i = 0; i < perChannel; i++) {
    samples[i] = data.readInt16LE(i * 2 * fmt.channels) / 32768;
  }
  return samples;
}

async function embed(session, samples) {
  const { frames, numFrames } = computeFbankFeatures(samples);
  if (!numFrames) throw new Error('audio too short');
  const tensor = new ort.Tensor('float32', frames, [1, numFrames, FBANK_NUM_BINS]);
  const results = await session.run({ x: tensor });
  return Float32Array.from(results.embedding.data);
}

const session = await ort.InferenceSession.create(MODEL);
const files = readdirSync(dir).filter((f) => f.endsWith('.wav')).sort();
const embeddings = [];
for (const file of files) {
  const samples = readWav(join(dir, file));
  embeddings.push({ file, emb: await embed(session, samples) });
  console.log(`embedded ${file} (${(samples.length / 16000).toFixed(1)}s)`);
}

console.log('\nCosine similarity matrix:');
const pad = (s) => String(s).padEnd(26);
console.log(pad('') + embeddings.map((e) => e.file.slice(0, 12).padEnd(14)).join(''));
for (const a of embeddings) {
  let row = pad(a.file.slice(0, 24));
  for (const b of embeddings) {
    row += cosineSimilarity(a.emb, b.emb).toFixed(3).padEnd(14);
  }
  console.log(row);
}
