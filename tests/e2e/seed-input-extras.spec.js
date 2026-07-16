// @ts-check
import { test, expect } from '@playwright/test';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

test.beforeEach(async ({ page }) => {
  await setupApiMocks(page, { authRequired: true });
  await resetClientState(page);

  // Deterministic SpeechRecognition mock: exposes the created instance so the
  // test can feed it fabricated results.
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      constructor() {
        window.__seedRecognition = this;
        this.started = false;
      }

      start() {
        this.started = true;
      }

      stop() {
        this.started = false;
        this.onend?.();
      }
    }
    // @ts-ignore
    window.SpeechRecognition = FakeSpeechRecognition;
    window.__emitSeedSpeech = (transcript) => {
      const rec = window.__seedRecognition;
      if (!rec?.onresult) return false;
      rec.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript }], { isFinal: true })],
      });
      return true;
    };
  });

  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
});

test('phone keypad enters letters with multi-tap cycling', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  const keypad = page.locator('#auth-seed-keypad');

  await expect(keypad).toBeHidden();
  await page.locator('#auth-seed-keypad-toggle').click();
  await expect(keypad).toBeVisible();

  const abcKey = keypad.locator('[data-letters="abc"]');

  // First tap inserts "a"; a quick second tap cycles it to "b".
  await abcKey.click();
  await expect(input).toHaveValue('a');
  await abcKey.click();
  await expect(input).toHaveValue('b');

  // After the commit window the same key starts a new letter.
  await page.waitForTimeout(1100);
  await abcKey.click();
  await expect(input).toHaveValue('ba');

  // Tapping a different key commits immediately and appends its letter.
  await keypad.locator('[data-letters="def"]').click();
  await expect(input).toHaveValue('bad');

  await keypad.locator('[data-action="backspace"]').click();
  await expect(input).toHaveValue('ba');

  await keypad.locator('[data-action="space"]').click();
  await expect(input).toHaveValue('ba ');

  await page.locator('#auth-seed-keypad-toggle').click();
  await expect(keypad).toBeHidden();
});

test('binary grid wizard builds the phrase word by word', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  const binary = page.locator('#auth-seed-binary');
  const next = binary.locator('[data-action="next"]');
  const preview = binary.locator('.auth-bit-preview');
  const filler = binary.locator('.auth-bit-filler');

  // "abandon ×11 + about" is a valid mnemonic: words 1–11 all zeros (index 0),
  // word 12 = index 3 ("about") = last two squares filled.
  await page.locator('#auth-seed-binary-toggle').click();
  await expect(binary).toBeVisible();
  await expect(next).toHaveText('1 of 12 ›');

  // An untouched word shows no preview — "0 abandon" only appears after it
  // has been confirmed with next.
  await expect(preview).toHaveText('');
  await expect(filler).toHaveText('');
  await next.click();
  await binary.locator('[data-action="back"]').click();
  await expect(preview).toHaveText('abandon');
  await expect(filler).toHaveText('0');

  // Advance to the last word leaving the previous ones at 0 ("abandon").
  for (let i = 0; i < 11; i += 1) await next.click();
  await expect(next).toHaveText('Use phrase');

  await binary.locator('.auth-bit').nth(9).click();
  await binary.locator('.auth-bit').nth(10).click();
  // The word appears above the grid; the number fills the free frame.
  await expect(preview).toHaveText('about');
  await expect(filler).toHaveText('3');

  await next.click();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
  await expect(binary).toBeHidden();

  // An invalid checksum is rejected with an explanation. Reopening on a full
  // phrase lands on the last word ("Use phrase").
  await page.locator('#auth-seed-binary-toggle').click();
  await expect(next).toHaveText('Use phrase');
  await binary.locator('.auth-bit').nth(10).click();
  await next.click();
  await expect(page.locator('#auth-error')).toContainText('checksum');
  await expect(binary).toBeVisible();
});

test('binary grid pre-fills from typed words and can step back', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  await input.fill('about zoo');
  await page.locator('#auth-seed-binary-toggle').click();

  // Two words typed: the wizard opens on word 3, still empty.
  const binary = page.locator('#auth-seed-binary');
  const next = binary.locator('[data-action="next"]');
  const back = binary.locator('[data-action="back"]');
  const preview = binary.locator('.auth-bit-preview');
  await expect(next).toHaveText('3 of 12 ›');
  await expect(preview).toHaveText('');
  await expect(binary.locator('.auth-bit.is-on')).toHaveCount(0);

  await back.click();
  await expect(next).toHaveText('2 of 12 ›');
  await expect(preview).toHaveText('zoo');
  await expect(binary.locator('.auth-bit-filler')).toHaveText('2047');
  await expect(binary.locator('.auth-bit.is-on')).toHaveCount(11);

  await back.click();
  await expect(next).toHaveText('1 of 12 ›');
  await expect(preview).toHaveText('about');
  await expect(binary.locator('.auth-bit-filler')).toHaveText('3');
  await expect(back).toBeDisabled();
});

test('numeric pad enters each word by its number', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  const numeric = page.locator('#auth-seed-numeric');
  const next = numeric.locator('[data-action="next"]');
  const value = numeric.locator('.auth-num-value');
  const word = numeric.locator('.auth-num-word');

  await page.locator('#auth-seed-numeric-toggle').click();
  await expect(numeric).toBeVisible();
  await expect(next).toHaveText('1 of 12 ›');
  await expect(value).toHaveText('');
  await expect(word).toHaveText('');

  // Type 2047 → zoo; a digit that would exceed the max index is ignored;
  // delete removes digit by digit down to blank.
  await numeric.locator('[data-digit="2"]').click();
  await numeric.locator('[data-digit="0"]').click();
  await numeric.locator('[data-digit="4"]').click();
  await numeric.locator('[data-digit="7"]').click();
  await expect(value).toHaveText('2047');
  await expect(word).toHaveText('zoo');
  await numeric.locator('[data-digit="1"]').click();
  await expect(value).toHaveText('2047');
  await numeric.locator('[data-action="delete"]').click();
  await expect(value).toHaveText('204');
  await numeric.locator('[data-action="delete"]').click();
  await numeric.locator('[data-action="delete"]').click();
  await numeric.locator('[data-action="delete"]').click();
  await expect(value).toHaveText('');
  await expect(word).toHaveText('');

  // Confirm 0 ("abandon") for words 1-11, then 3 ("about") for word 12.
  for (let i = 0; i < 11; i += 1) await next.click();
  await expect(next).toHaveText('Use phrase');
  await numeric.locator('[data-digit="3"]').click();
  await expect(word).toHaveText('about');
  await next.click();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
  await expect(numeric).toBeHidden();
});

test('tapping squares or digits scrolls the word preview toward the top', async ({ page }) => {
  // Watch-sized viewport: the pad fills the screen, so entering values must
  // pull the word preview up to keep it visible.
  await page.setViewportSize({ width: 205, height: 251 });
  await page.locator('#auth-seed-numeric-toggle').click();
  const displayBefore = (await page.locator('.auth-num-display').boundingBox())?.y ?? 0;
  await page.locator('[data-digit="1"]').click();
  await expect
    .poll(async () => (await page.locator('.auth-num-display').boundingBox())?.y ?? 999)
    .toBeLessThan(Math.min(displayBefore, 60));

  await page.locator('#auth-seed-binary-toggle').click();
  await page.locator('#auth-seed-binary .auth-bit').first().click();
  await expect
    .poll(async () => (await page.locator('.auth-bit-preview').boundingBox())?.y ?? 999)
    .toBeLessThan(60);
});

test('watch-sized screens swap the textarea for a single-line input', async ({ page }) => {
  await page.setViewportSize({ width: 205, height: 251 });
  await page.reload();
  const input = page.locator('#auth-passphrase-input');
  await expect(input).toBeVisible();
  // watchOS Quickboard mishandles textareas (opens without the current
  // value); a single-line input works, so the element is swapped on watch.
  expect(await input.evaluate((el) => el.tagName)).toBe('INPUT');

  // The other input methods still work through the swapped element.
  await page.locator('#auth-seed-keypad-toggle').click();
  await page.locator('[data-letters="abc"]').click();
  await expect(input).toHaveValue('a');
});

test('voice dictation appends words snapped to the BIP39 wordlist', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  const micBtn = page.locator('#auth-seed-mic');

  await expect(micBtn).toBeVisible();
  await micBtn.click();
  await expect(micBtn).toHaveClass(/is-listening/);

  // "abilty" is a typo the recognizer could produce; "xyzzy" matches nothing.
  const emitted = await page.evaluate(() =>
    window.__emitSeedSpeech('abandon Abilty xyzzyq zoo'));
  expect(emitted).toBe(true);

  await expect(input).toHaveValue('abandon ability zoo ');

  await micBtn.click();
  await expect(micBtn).not.toHaveClass(/is-listening/);
});

test('a speech service that never delivers audio reports guidance instead of hanging', async ({ page }) => {
  // Simulate watchOS: the constructor exists but no events ever fire.
  const micBtn = page.locator('#auth-seed-mic');
  await micBtn.click();
  await expect(micBtn).toHaveClass(/is-listening/);

  await expect(page.locator('#auth-error')).toContainText('dictation', { timeout: 8000 });
  await expect(micBtn).not.toHaveClass(/is-listening/);
});

test('system-dictated text is snapped to a clean phrase on blur', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  await input.fill('Abandon, abandon abandon Abandon abandon abandon abandon abandon abandon abandon abandon about.');
  await input.blur();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
});
