import dotenv from 'dotenv';
import { createApp } from './app.js';
import { isElevenLabsConfigured } from './elevenlabs.js';

dotenv.config();

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Lingu.ooo server running at http://localhost:${PORT}`);
  if (isElevenLabsConfigured()) {
    console.log('ElevenLabs voice cloning: configured');
  } else {
    console.log('ElevenLabs voice cloning: NOT configured — add ELEVENLABS_API_KEY to .env');
  }
});
