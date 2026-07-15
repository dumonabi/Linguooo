import { test, expect, devices } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

test('compose caret and selection overlay line up with the text', async ({ page }) => {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page);

  await page.goto('/');
  const input = page.locator('#dictation-input');
  await expect(input).toBeVisible();

  await input.click();
  await input.fill('hola amigo como estas hoy quiero probar el cursor con varias lineas de texto largo');
  await input.press('End');
  await page.waitForTimeout(300);

  const geometry = await page.evaluate(() => {
    const ta = document.querySelector('#dictation-input');
    const caret = document.querySelector('#compose-caret');
    const mirror = document.querySelector('.compose-input-wrap > .compose-caret-mirror');
    const taRect = ta.getBoundingClientRect();
    const caretRect = caret.getBoundingClientRect();
    const mirrorStyle = getComputedStyle(mirror);
    const taStyle = getComputedStyle(ta);
    return {
      caretHidden: caret.hidden,
      caretInsideX: caretRect.left >= taRect.left && caretRect.right <= taRect.right + 2,
      caretInsideY: caretRect.top >= taRect.top && caretRect.bottom <= taRect.bottom + 2,
      fontMatches: mirrorStyle.font === taStyle.font,
      paddingMatches: mirrorStyle.padding === taStyle.padding,
      widthDelta: Math.abs(mirror.getBoundingClientRect().width - taRect.width),
    };
  });

  expect(geometry.caretHidden).toBe(false);
  expect(geometry.fontMatches).toBe(true);
  expect(geometry.paddingMatches).toBe(true);
  expect(geometry.widthDelta).toBeLessThan(1);
  expect(geometry.caretInsideX).toBe(true);
  expect(geometry.caretInsideY).toBe(true);

  await page.screenshot({ path: 'test-results/caret-after-css-migration.png' });
});

test('iOS selection overlay inherits textarea metrics from CSS', async ({ browser }) => {
  const ctx = await browser.newContext({
    ...devices['iPhone 12'],
    baseURL: 'http://localhost:5180',
  });
  const page = await ctx.newPage();
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page);

  await page.goto('/');
  const input = page.locator('#dictation-input');
  await expect(input).toBeVisible();

  await input.click();
  await input.fill('hola amigo como estas hoy');
  await page.evaluate(() => {
    const ta = document.querySelector('#dictation-input');
    ta.focus();
    ta.setSelectionRange(5, 10);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(200);

  const overlayState = await page.evaluate(() => {
    const overlay = document.querySelector('.compose-input-wrap > .compose-selection-mirror');
    if (!overlay || overlay.hidden) return { visible: false };
    const ta = document.querySelector('#dictation-input');
    const oStyle = getComputedStyle(overlay);
    const tStyle = getComputedStyle(ta);
    return {
      visible: true,
      fontMatches: oStyle.font === tStyle.font,
      paddingMatches: oStyle.padding === tStyle.padding,
      widthDelta: Math.abs(overlay.getBoundingClientRect().width - ta.getBoundingClientRect().width),
    };
  });

  expect(overlayState.visible).toBe(true);
  expect(overlayState.fontMatches).toBe(true);
  expect(overlayState.paddingMatches).toBe(true);
  expect(overlayState.widthDelta).toBeLessThan(1);

  await ctx.close();
});
