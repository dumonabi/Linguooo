// On-demand my-voice (v3) audio: for languages the fast flash model cannot
// clone (e.g. Thai), a button next to each translation fetches a render of
// that exact text in the user's instant-clone voice without touching the
// fast audio path.
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
  // The button shows the my-voice symbol.
  await expect(proBtn.locator('svg')).toBeVisible();
  await expect(proBtn).toHaveAttribute('title', 'My voice (slower)');

  await proBtn.click();
  await expect(proBtn).toHaveClass(/is-playing/, { timeout: 8000 });

  const v3Requests = speakRequests.filter((body) => body.quality === 'v3');
  expect(v3Requests.length).toBe(1);
  expect(v3Requests[0].text).toBe('สวัสดีเพื่อน');
  expect(v3Requests[0].lang).toBe('th');
  // The fast audio path never uses the slow model.
  expect(speakRequests.every((body) => !body.quality || body.quality === 'v3')).toBe(true);

  // A second press stops playback; a third replays from the cached blob
  // without another network request.
  await proBtn.click();
  await expect(proBtn).not.toHaveClass(/is-playing/);
  await proBtn.click();
  await expect(proBtn).toHaveClass(/is-playing/, { timeout: 8000 });
  expect(speakRequests.filter((body) => body.quality === 'v3').length).toBe(1);
});

test('flash-set languages never show the premium button', async ({ page }) => {
  // English is cloned by the fast model already, so there is nothing extra
  // to offer — no premium button.
  await setupApiMocks(page, {
    user: { voiceReady: true, voiceSampleCount: 6, voiceStatus: 'ready' },
    voiceProfile: { status: 'ready', sampleCount: 6, voiceReady: true, elevenlabsConfigured: true },
  });

  await page.route('**/api/speak', async (route) => route.fulfill({
    status: 200,
    contentType: 'audio/mpeg',
    body: Buffer.from(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
  }));

  await translateOnce(page);

  await expect(page.locator('.message-card .listen-btn')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.message-card .pro-audio-btn')).toBeHidden();
});

test('the v3 voice option still appears when the fast audio generation fails', async ({ page }) => {
  // The my-voice button generates its own audio on demand, so a broken fast
  // (generic-voice) render must not hide the user's-voice option.
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

  const speakRequests = [];
  await page.route('**/api/speak', async (route) => {
    const body = route.request().postDataJSON();
    speakRequests.push(body);
    if (body.quality === 'v3') {
      return route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: Buffer.from(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
      });
    }
    // The fast generic-voice generation fails.
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'TTS failed' }),
    });
  });

  await translateOnce(page);

  const proBtn = page.locator('.message-card .pro-audio-btn');
  await expect(proBtn).toBeVisible({ timeout: 8000 });
  // Without the fast audio there is nothing to play or share.
  await expect(page.locator('.message-card .listen-btn')).toBeHidden();

  await proBtn.click();
  await expect(proBtn).toHaveClass(/is-playing/, { timeout: 8000 });
  expect(speakRequests.filter((body) => body.quality === 'v3').length).toBe(1);
});

test('sharing audio prefers the own-voice render over the generic fast audio', async ({ page }) => {
  // Thai + instant clone: the share button must ship the v3 (my voice)
  // render, not the generic fast audio.
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

  await page.addInitScript(() => {
    window.__sharedFiles = [];
    navigator.share = (data) => {
      window.__sharedFiles.push((data.files || []).map((f) => f.name));
      return Promise.resolve();
    };
    navigator.canShare = () => true;
  });

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

  const shareBtn = page.locator('.message-card .share-audio-btn');
  await expect(shareBtn).toBeVisible({ timeout: 8000 });
  await shareBtn.click();

  await expect.poll(async () => page.evaluate(() => window.__sharedFiles.length)).toBe(1);
  const v3Requests = speakRequests.filter((body) => body.quality === 'v3');
  expect(v3Requests.length).toBe(1);
  expect(v3Requests[0].text).toBe('สวัสดีเพื่อน');
});

test('an expired share gesture keeps the audio and the next tap shares it instantly', async ({ page }) => {
  // Generating the own-voice render can outlive the browser's transient
  // activation window: navigator.share then throws NotAllowedError. The app
  // must keep the prepared file and share it on the next tap without
  // regenerating the audio.
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

  await page.addInitScript(() => {
    window.__sharedFiles = [];
    window.__shareCalls = 0;
    navigator.share = (data) => {
      window.__shareCalls += 1;
      if (window.__shareCalls === 1) {
        const err = new Error('The request is not allowed by the user agent or the platform in the current context');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      window.__sharedFiles.push((data.files || []).map((f) => f.name));
      return Promise.resolve();
    };
    navigator.canShare = () => true;
  });

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

  const shareBtn = page.locator('.message-card .share-audio-btn');
  await expect(shareBtn).toBeVisible({ timeout: 8000 });
  await shareBtn.click();

  // First tap: activation expired, the user is told to tap again.
  await expect(page.locator('#toast')).toContainText('tap the share button again', { timeout: 8000 });
  await expect.poll(async () => page.evaluate(() => window.__shareCalls)).toBe(1);

  await shareBtn.click();
  await expect.poll(async () => page.evaluate(() => window.__sharedFiles.length)).toBe(1);
  // The second tap reuses the cached file: exactly one v3 render in total.
  expect(speakRequests.filter((body) => body.quality === 'v3').length).toBe(1);
});

test('sharing falls back to the fast audio when there is no personal voice', async ({ page }) => {
  await page.addInitScript(() => {
    window.__sharedFiles = [];
    navigator.share = (data) => {
      window.__sharedFiles.push((data.files || []).map((f) => f.name));
      return Promise.resolve();
    };
    navigator.canShare = () => true;
  });

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

  const shareBtn = page.locator('.message-card .share-audio-btn');
  await expect(shareBtn).toBeVisible({ timeout: 8000 });
  await shareBtn.click();

  await expect.poll(async () => page.evaluate(() => window.__sharedFiles.length)).toBe(1);
  // No premium render exists for this profile — only fast-quality requests.
  expect(speakRequests.every((body) => !body.quality)).toBe(true);
});

test('a missing personal voice surfaces the server guidance instead of falling back', async ({ page }) => {
  // The client believes the voice is ready but the server disagrees (e.g.
  // the samples were reset) — the guidance must reach the user, no fallback.
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

  await page.route('**/api/speak', async (route) => {
    const body = route.request().postDataJSON();
    if (body.quality === 'v3') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Personal voice not ready — set up your voice profile first' }),
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

  await expect(page.locator('#toast')).toContainText('Personal voice not ready', { timeout: 8000 });
  await expect(proBtn).not.toHaveClass(/is-playing/);
});
