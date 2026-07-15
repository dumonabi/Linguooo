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
