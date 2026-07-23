import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

// The reading text scales with the smaller screen dimension: 24 characters
// across on square/portrait screens, and a line box of exactly one eighth of
// that dimension, so 8 lines of text always span it — also in landscape.

async function measureComposeText(page) {
  return page.evaluate(() => {
    const ta = document.querySelector('#dictation-input');
    const style = getComputedStyle(ta);
    return {
      fontSize: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
    };
  });
}

async function prepareApp(page) {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page);
  await page.goto('/');
  await expect(page.locator('#dictation-input')).toBeVisible();
}

test('on a square screen 8 line boxes span exactly the screen height', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await prepareApp(page);

  const { fontSize, lineHeight } = await measureComposeText(page);
  expect(fontSize).toBeCloseTo(720 / 13.5, 1);
  expect(lineHeight * 8).toBeCloseTo(720, 1);
});

test('landscape screens keep the square-screen glyph size and 8-line height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await prepareApp(page);

  const { fontSize, lineHeight } = await measureComposeText(page);
  // Same metrics as the 720px square: the height rules, not the width.
  expect(fontSize).toBeCloseTo(720 / 13.5, 1);
  expect(lineHeight * 8).toBeCloseTo(720, 1);
});

test('portrait screens fit 24 characters across the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);

  const { fontSize, lineHeight } = await measureComposeText(page);
  expect(fontSize).toBeCloseTo(390 / 13.5, 1);
  expect(lineHeight * 8).toBeCloseTo(390, 1);

  // 24 glyphs at 0.5625em each fill the width exactly.
  expect(24 * 0.5625 * fontSize).toBeCloseTo(390, 0);
});
