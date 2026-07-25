import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

// The transcription (compose box) and the translated messages share one
// reading size: 0.8 × the density size, with line boxes of exactly one
// tenth of the smaller screen dimension.

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

test('on a square screen 10 line boxes span exactly the screen height', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await prepareApp(page);

  const { fontSize, lineHeight } = await measureComposeText(page);
  expect(fontSize).toBeCloseTo((720 / 13.5) * 0.8, 1);
  expect(lineHeight * 10).toBeCloseTo(720, 1);
});

test('landscape screens keep the square-screen glyph size and line height', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await prepareApp(page);

  const { fontSize, lineHeight } = await measureComposeText(page);
  // Same metrics as the 720px square: the height rules, not the width.
  expect(fontSize).toBeCloseTo((720 / 13.5) * 0.8, 1);
  expect(lineHeight * 10).toBeCloseTo(720, 1);
});

test('portrait screens fit 30 characters across the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);

  const { fontSize, lineHeight } = await measureComposeText(page);
  expect(fontSize).toBeCloseTo((390 / 13.5) * 0.8, 1);
  expect(lineHeight * 10).toBeCloseTo(390, 1);

  // 30 glyphs at 0.5625em each fill the width exactly.
  expect(30 * 0.5625 * fontSize).toBeCloseTo(390, 0);
});

test('the transcription and the translation render with identical text metrics', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareApp(page);

  await page.locator('#dictation-input').fill('hola');
  await page.locator('#dictation-translate').click();
  await expect(page.locator('.message-translated-text')).not.toHaveText('', { timeout: 8000 });

  const metrics = await page.evaluate(() => {
    const pick = (el) => {
      const s = getComputedStyle(el);
      return { fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight) };
    };
    return {
      compose: pick(document.querySelector('#dictation-input')),
      translated: pick(document.querySelector('.message-translated-text')),
    };
  });
  expect(metrics.compose.fontSize).toBeCloseTo(metrics.translated.fontSize, 1);
  expect(metrics.compose.lineHeight).toBeCloseTo(metrics.translated.lineHeight, 1);
});

test('language bar rects fit at least 8 characters even on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 690 });
  await prepareApp(page);

  const fits = await page.evaluate(() => {
    // The bar shows the language name inside the picker input; measure how
    // wide 8 glyphs render with its exact font and compare to its width.
    const input = document.querySelector('#lang-picker-1 .lang-picker-bar-input');
    if (!input) return null;
    const s = getComputedStyle(input);
    const probe = document.createElement('span');
    probe.textContent = 'mmmmmmmm'; // 8 monospace glyphs
    probe.style.fontFamily = s.fontFamily;
    probe.style.fontSize = s.fontSize;
    probe.style.fontWeight = s.fontWeight;
    probe.style.letterSpacing = s.letterSpacing;
    probe.style.whiteSpace = 'pre';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const textWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const padding = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
    return { textWidth, available: input.clientWidth - padding };
  });
  expect(fits).not.toBeNull();
  expect(fits.textWidth).toBeLessThanOrEqual(fits.available + 1);
});
