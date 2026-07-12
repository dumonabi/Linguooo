import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const LONG_TRANSLATION = 'This is the first short sentence. And after it comes a much longer continuation that keeps adding content so the total translated text easily exceeds the splitting threshold used by the speech chunking logic in the application.';

test('chunked audio: long translations request head and tail separately', async ({ page }) => {
  const speakTexts = [];
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page, {
    onConverse: () => ({
      rawText: 'texto largo',
      detectedLanguage: 'es',
      sourceText: 'texto largo',
      translatedText: LONG_TRANSLATION,
      targetLanguage: 'en',
    }),
  });

  await page.route('**/api/speak', async (route) => {
    const body = route.request().postDataJSON();
    speakTexts.push(body.text);
    return route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.from(new Uint8Array([0xff, 0xfb, 0x90, 0x00])),
    });
  });

  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();

  await page.locator('#compose-mic').click();
  await page.waitForTimeout(550);
  await page.locator('#recording-send').click();
  await expect(page.locator('#dictation-input')).not.toHaveValue('', { timeout: 8000 });
  await page.locator('#dictation-translate').click();
  await expect(page.locator('.message-translated-text')).toContainText('first short sentence', { timeout: 8000 });

  await page.waitForTimeout(1500);

  console.log('speak request texts:', JSON.stringify(speakTexts));
  expect(speakTexts.length).toBeGreaterThanOrEqual(2);
  expect(speakTexts[0]).toBe('This is the first short sentence.');
  expect(speakTexts[0].length + speakTexts[1].length).toBeGreaterThanOrEqual(LONG_TRANSLATION.length - 2);

  const audioState = await page.evaluate(() => {
    const msgEl = document.querySelector('.message-card');
    return {
      hasCard: Boolean(msgEl),
      listenReady: Boolean(msgEl?.querySelector('.listen-btn.is-ready')),
    };
  });
  expect(audioState.listenReady).toBe(true);
});
