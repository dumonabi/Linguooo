// Automatic pro-voice sample collection: dictations that match the owner's
// voiceprint (checked on-device against the instant-clone samples) are
// uploaded to the PRO sample bank in the background; anything else stays out.
// The on-device model cannot run against the fake test audio, so the specs
// inject the similarity score through the window.__voiceMatchTestSimilarity
// hook that voice-match.js exposes for exactly this purpose.
import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const READY_VOICE = {
  user: { voiceReady: true, voiceSampleCount: 6, voiceStatus: 'ready' },
  voiceProfile: { status: 'ready', sampleCount: 6, voiceReady: true, elevenlabsConfigured: true },
};

// The collector ignores clips under 4 s, so the dictation has to run at
// least that long before being accepted.
async function dictateLongClip(page) {
  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();
  await page.locator('#compose-mic').click();
  await expect(page.locator('#recording-send')).toBeEnabled();
  await page.waitForTimeout(4300);
  await page.locator('#recording-send').click();
  await expect(page.locator('#dictation-input')).not.toHaveValue('', { timeout: 8000 });
}

test.beforeEach(async ({ page }) => {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
});

test('a dictation matching the voiceprint is auto-added to the pro samples', async ({ page }) => {
  await page.addInitScript(() => { window.__voiceMatchTestSimilarity = 0.9; });
  const { voice } = await setupApiMocks(page, READY_VOICE);

  await dictateLongClip(page);

  await expect.poll(() => voice.proSampleRequests.length, { timeout: 8000 }).toBe(1);
  expect(voice.proSampleRequests[0].auto).toBe(true);
});

test('a dictation from a different voice is not collected', async ({ page }) => {
  await page.addInitScript(() => { window.__voiceMatchTestSimilarity = 0.2; });
  const { voice } = await setupApiMocks(page, READY_VOICE);

  await dictateLongClip(page);

  // Give the background collector time to (incorrectly) fire.
  await page.waitForTimeout(1500);
  expect(voice.proSampleRequests).toHaveLength(0);
});

test('clips are not collected when the profile toggle is off', async ({ page }) => {
  await page.addInitScript(() => {
    window.__voiceMatchTestSimilarity = 0.9;
    localStorage.setItem('lingo-voice-auto-collect:test-user:1', '0');
  });
  const { voice } = await setupApiMocks(page, READY_VOICE);

  await dictateLongClip(page);

  await page.waitForTimeout(1500);
  expect(voice.proSampleRequests).toHaveLength(0);
});

test('short clips are ignored even when the voice matches', async ({ page }) => {
  await page.addInitScript(() => { window.__voiceMatchTestSimilarity = 0.9; });
  const { voice } = await setupApiMocks(page, READY_VOICE);

  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();
  await page.locator('#compose-mic').click();
  await expect(page.locator('#recording-send')).toBeEnabled();
  await page.waitForTimeout(900);
  await page.locator('#recording-send').click();
  await expect(page.locator('#dictation-input')).not.toHaveValue('', { timeout: 8000 });

  await page.waitForTimeout(1500);
  expect(voice.proSampleRequests).toHaveLength(0);
});

test('without a ready voice profile nothing is collected', async ({ page }) => {
  await page.addInitScript(() => { window.__voiceMatchTestSimilarity = 0.9; });
  const { voice } = await setupApiMocks(page);

  await dictateLongClip(page);

  await page.waitForTimeout(1500);
  expect(voice.proSampleRequests).toHaveLength(0);
});
