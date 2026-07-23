// PRO voice sample collection for Professional Voice Cloning: the samples
// page gains a PRO mode with long reading passages (recording only — no
// uploads) that accumulate toward the 30-minute PVC minimum, then everything
// is submitted to ElevenLabs, verified in-app by reading a captcha aloud,
// and trained — all without leaving the app.
import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const PRO_MIN_MS = 1_800_000;
const PRO_MAX_MS = 10_800_000;

// 1×1 transparent PNG, standing in for the ElevenLabs captcha image.
const CAPTCHA_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Lets tests fast-forward the perceived recording duration past the
// 8-second minimum clip length without actually waiting.
const TIME_SKEW_INIT_SCRIPT = `
  const realNow = Date.now.bind(Date);
  window.__timeSkewMs = 0;
  Date.now = () => realNow() + (window.__timeSkewMs || 0);
`;

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
    pvcVerified: Boolean(proState.verified),
    proVoiceReady: Boolean(proState.ready),
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

  await page.route('**/api/voice/pro-captcha*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, image: CAPTCHA_PNG_B64 }),
  }));

  await openProSamplesPage(page);

  await expect(page.locator('.user-profile-samples-progress--pro')).toContainText('32:00 / 30:00');

  const submitBtn = page.locator('#user-voice-pro-submit-btn');
  await expect(submitBtn).toBeEnabled();
  await submitBtn.click();

  await expect(page.locator('#toast')).toContainText('Samples sent', { timeout: 8000 });
  expect(createBody?.language).toBeTruthy();

  // Submission flows straight into the in-app verification step.
  await expect(page.locator('.user-profile-pro-captcha')).toBeVisible();
});

test('reading the captcha aloud verifies the voice and starts training in-app', async ({ page }) => {
  const proState = { count: 14, ms: 32 * 60_000, submitted: true, verified: false };
  let verifyRequest = null;

  await page.addInitScript(TIME_SKEW_INIT_SCRIPT);

  await page.route('**/api/voice/profile*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildProfileBody(proState)),
  }));

  await page.route('**/api/voice/pro-captcha*', (route) => {
    if (route.request().method() === 'POST') {
      verifyRequest = route.request();
      proState.verified = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, training: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, image: CAPTCHA_PNG_B64 }),
    });
  });

  await page.route('**/api/voice/pro-status*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, state: 'fine_tuning', progress: 0.42 }),
  }));

  await openProSamplesPage(page);

  // The captcha (lines the owner reads aloud) renders inside the app.
  await expect(page.locator('.user-profile-pro-captcha')).toBeVisible();

  // Record the reading with the usual mic controls.
  await page.locator('#user-voice-record-btn').click();
  await expect(page.locator('#user-voice-stop-btn')).toBeVisible();
  await page.evaluate(() => { window.__timeSkewMs = 15_000; });
  await page.locator('#user-voice-stop-btn').click();

  await expect(page.locator('#toast')).toContainText('Voice verified', { timeout: 8000 });
  expect(verifyRequest).not.toBeNull();

  // Training progress is reported in-app from then on.
  await expect(page.locator('.user-profile-pro-training')).toBeVisible();
  await expect(page.locator('.user-profile-pro-training-pct')).toHaveText('42%');
});

test('languages without built-in texts fetch translated reading prompts', async ({ page }) => {
  const proState = { count: 0, ms: 0, submitted: false };
  let promptsLang = null;

  await page.route('**/api/voice/profile*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildProfileBody(proState)),
  }));

  await page.route('**/api/voice/prompts*', (route) => {
    promptsLang = new URL(route.request().url()).searchParams.get('lang');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        lang: 'fr',
        prompts: ['Bonjour, ceci est ma voix en français.', 'Deuxième texte de lecture en français.'],
        proPrompts: ['Un long passage professionnel en français pour la voix PRO.'],
      }),
    });
  });

  // The voice language preference persists per user and slot; seed French,
  // which has no hand-written prompt set.
  await page.addInitScript(() => {
    localStorage.setItem('lingo-voice-lang:test-user:1', 'fr');
  });

  await page.goto('/');
  await expect(page.locator('#user-profile-trigger')).toBeVisible();
  await page.locator('#user-profile-trigger').click();
  await page.locator('#user-profile-samples-btn').click();
  await expect(page.locator('#user-profile-voice-samples-page')).toBeVisible();

  // The standard prompts arrive translated from the server.
  await expect(page.locator('.user-profile-prompt-text')).toContainText('Bonjour, ceci est ma voix en français.');
  expect(promptsLang).toBe('fr');

  // The PRO passages come from the same translated set.
  await page.locator('#user-voice-mode-toggle').click();
  await expect(page.locator('.user-profile-prompt-text')).toContainText('passage professionnel en français');
});

test('a trained voice is promoted and announced without visiting ElevenLabs', async ({ page }) => {
  const proState = { count: 14, ms: 32 * 60_000, submitted: true, verified: true };

  await page.route('**/api/voice/profile*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildProfileBody(proState)),
  }));

  await page.route('**/api/voice/pro-status*', (route) => {
    // The server promotes the voice to proVoiceId when ElevenLabs reports
    // it fine-tuned, and the profile reflects that on the next fetch.
    proState.ready = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, state: 'ready', progress: 1 }),
    });
  });

  await openProSamplesPage(page);

  await expect(page.locator('#toast')).toContainText('PRO voice is ready', { timeout: 8000 });
  await expect(page.locator('.user-profile-pro-submitted')).toContainText('PRO button');
});
