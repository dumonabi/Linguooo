// PRO voice sample collection for Professional Voice Cloning: the samples
// page gains a PRO mode with long reading passages (recording only — no
// uploads) that accumulate toward the 30-minute PVC minimum, then everything
// is submitted to ElevenLabs in one step.
import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const PRO_MIN_MS = 1_800_000;
const PRO_MAX_MS = 10_800_000;

function buildProfileBody(proState) {
  return {
    status: 'none',
    sampleCount: 0,
    samples: [],
    voiceReady: false,
    elevenlabsConfigured: true,
    minSamples: 6,
    maxSamples: 6,
    canRecordMore: true,
    totalDurationMs: 0,
    targetDurationMs: 90000,
    proSampleCount: proState.count,
    proTotalDurationMs: proState.ms,
    proMinTotalMs: PRO_MIN_MS,
    proMaxTotalMs: PRO_MAX_MS,
    pvcSubmitted: proState.submitted,
    proSamples: [],
  };
}

async function openProSamplesPage(page) {
  await page.goto('/');
  await expect(page.locator('#user-profile-trigger')).toBeVisible();
  await page.locator('#user-profile-trigger').click();
  await page.locator('#user-profile-samples-btn').click();
  await expect(page.locator('#user-profile-voice-samples-page')).toBeVisible();
  await page.locator('#user-voice-mode-toggle').click();
  await expect(page.locator('#user-voice-mode-toggle')).toHaveClass(/is-pro/);
}

test.beforeEach(async ({ page }) => {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page);
});

test('PRO mode presents long reading passages and no upload option', async ({ page }) => {
  const proState = { count: 0, ms: 0, submitted: false };
  await page.route('**/api/voice/profile*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildProfileBody(proState)),
  }));

  await openProSamplesPage(page);

  // Long-form passage: an order of magnitude longer than the fast-clone
  // prompts, so reaching 30 minutes takes few takes.
  const promptText = await page.locator('.user-profile-prompt-text').textContent();
  expect(promptText.length).toBeGreaterThan(800);

  // Uploads were removed: recording is the only way to add pro audio.
  await expect(page.locator('#user-voice-pro-upload-btn')).toHaveCount(0);
  await expect(page.locator('#user-voice-pro-file-input')).toHaveCount(0);

  await expect(page.locator('#user-voice-pro-submit-btn')).toBeDisabled();
  await expect(page.locator('.user-profile-pro-remaining')).toContainText('30');

  // The prompt advances through different passages as takes accumulate
  // (the profile is re-fetched after every saved take).
  proState.count = 1;
  proState.ms = 150_000;
  await openProSamplesPage(page);
  const secondPrompt = await page.locator('.user-profile-prompt-text').textContent();
  expect(secondPrompt.length).toBeGreaterThan(800);
  expect(secondPrompt).not.toBe(promptText);
});

test('reaching 30 minutes unlocks submission to ElevenLabs', async ({ page }) => {
  const proState = { count: 14, ms: 32 * 60_000, submitted: false };
  let createBody = null;

  await page.route('**/api/voice/profile*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildProfileBody(proState)),
  }));

  await page.route('**/api/voice/pro-create*', (route) => {
    createBody = route.request().postDataJSON();
    proState.submitted = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        pvcVoiceId: 'pvc-test-voice',
        proSampleCount: proState.count,
        proTotalDurationMs: proState.ms,
        proMinTotalMs: PRO_MIN_MS,
        proMaxTotalMs: PRO_MAX_MS,
        pvcSubmitted: true,
      }),
    });
  });

  await openProSamplesPage(page);

  await expect(page.locator('.user-profile-samples-progress--pro')).toContainText('32:00 / 30:00');

  const submitBtn = page.locator('#user-voice-pro-submit-btn');
  await expect(submitBtn).toBeEnabled();
  await submitBtn.click();

  await expect(page.locator('#toast')).toContainText('Samples sent to ElevenLabs', { timeout: 8000 });
  expect(createBody?.language).toBeTruthy();
  await expect(page.locator('.user-profile-pro-submitted')).toBeVisible();
});
