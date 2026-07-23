// On-demand Professional Voice Clone (PVC) audio: a PRO button next to each
// translation that fetches a high-fidelity render of that exact text without
// touching the fast audio path.
import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

async function translateOnce(page) {
  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();
  await page.locator('#compose-mic').click();
  await expect(page.locator('#recording-send')).toBeEnabled();
  await page.waitForTimeout(700);
  await page.locator('#recording-send').click();
  await expect(page.locator('#dictation-input')).not.toHaveValue('', { timeout: 8000 });
  await page.locator('#dictation-translate').click();
  await expect(page.locator('.message-translated-text')).not.toHaveText('', { timeout: 8000 });
}

test.beforeEach(async ({ page }) => {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  // The mocked speak responses are not decodable audio; replace Audio with a
  // stub that reports itself ready and plays, so the UI states can be
  // asserted without real decoding.
  await page.addInitScript(() => {
    class FakeAudio extends EventTarget {
      constructor() {
        super();
        this.paused = true;
        this.src = '';
        this.readyState = 4;
      }

      play() {
        this.paused = false;
        return Promise.resolve();
      }

      pause() {
        this.paused = true;
      }

      load() {}

      setAttribute() {}

      removeAttribute() {}
    }
    // @ts-ignore
    window.Audio = FakeAudio;
  });
  await setupApiMocks(page);
});

test('the PRO button requests pro-quality audio for that text on demand', async ({ page }) => {
  const speakRequests = [];
  await page.route('**/api/speak', async (route) => {
    speakRequests.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.from(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
    });
  });

  await translateOnce(page);

  const proBtn = page.locator('.message-card .pro-audio-btn');
  await expect(proBtn).toBeVisible({ timeout: 8000 });

  const fastRequests = speakRequests.length;
  expect(fastRequests).toBeGreaterThanOrEqual(1);
  expect(speakRequests.every((body) => body.quality !== 'pro')).toBe(true);

  await proBtn.click();
  await expect(proBtn).toHaveClass(/is-playing/, { timeout: 8000 });

  const proRequests = speakRequests.filter((body) => body.quality === 'pro');
  expect(proRequests.length).toBe(1);
  const translated = await page.locator('.message-translated-text').textContent();
  expect(proRequests[0].text).toBe(translated.trim());

  // A second press stops pro playback; a third replays from the cached blob
  // without another network request.
  await proBtn.click();
  await expect(proBtn).not.toHaveClass(/is-playing/);
  await proBtn.click();
  await expect(proBtn).toHaveClass(/is-playing/, { timeout: 8000 });
  expect(speakRequests.filter((body) => body.quality === 'pro').length).toBe(1);
});

test('languages outside the flash set offer on-demand v3 audio in the user voice', async ({ page }) => {
  // Thai cannot be cloned on the fast flash model; with a voice profile
  // ready, the premium button requests the slow eleven_v3 render instead.
  await setupApiMocks(page, {
    user: { voiceReady: true, voiceSampleCount: 6, voiceStatus: 'ready' },
    voiceProfile: { status: 'ready', sampleCount: 6, voiceReady: true, elevenlabsConfigured: true },
    onConverse: () => ({
      rawText: 'hola amigo',
      detectedLanguage: 'es',
      sourceText: 'hola amigo',
      translatedText: 'สวัสดีเพื่อน',
      targetLanguage: 'th',
    }),
  });

  // Registered after setupApiMocks so it takes precedence for /api/speak.
  const speakRequests = [];
  await page.route('**/api/speak', async (route) => {
    speakRequests.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.from(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
    });
  });

  await translateOnce(page);

  const proBtn = page.locator('.message-card .pro-audio-btn');
  await expect(proBtn).toBeVisible({ timeout: 8000 });

  await proBtn.click();
  await expect(proBtn).toHaveClass(/is-playing/, { timeout: 8000 });

  const v3Requests = speakRequests.filter((body) => body.quality === 'v3');
  expect(v3Requests.length).toBe(1);
  expect(v3Requests[0].text).toBe('สวัสดีเพื่อน');
  expect(v3Requests[0].lang).toBe('th');
  // The fast audio path never uses the slow model.
  expect(speakRequests.some((body) => body.quality === 'pro')).toBe(false);
});

test('a missing pro voice surfaces the server guidance instead of falling back', async ({ page }) => {
  await page.route('**/api/speak', async (route) => {
    const body = route.request().postDataJSON();
    if (body.quality === 'pro') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Pro voice not ready — create a Professional Voice Clone in ElevenLabs (Creator plan) and it will be linked automatically' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.from(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
    });
  });

  await translateOnce(page);

  const proBtn = page.locator('.message-card .pro-audio-btn');
  await expect(proBtn).toBeVisible({ timeout: 8000 });
  await proBtn.click();

  await expect(page.locator('#toast')).toContainText('Pro voice not ready', { timeout: 8000 });
  await expect(proBtn).not.toHaveClass(/is-playing/);
});
