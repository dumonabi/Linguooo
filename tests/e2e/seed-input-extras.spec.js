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
  // The constructor exists but no events ever fire (broken speech service).
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
