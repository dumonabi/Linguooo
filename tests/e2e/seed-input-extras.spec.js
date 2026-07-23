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

test('numeric keypad wizard builds the phrase word by word', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  const numeric = page.locator('#auth-seed-numeric');
  const next = numeric.locator('[data-action="next"]');
  const display = numeric.locator('.auth-num-display');
  const key = (digit) => numeric.locator(`[data-digit="${digit}"]`);

  // "abandon ×11 + about" is a valid mnemonic: words 1-11 are number 0,
  // word 12 is number 3 ("about").
  await page.locator('#auth-seed-numeric-toggle').click();
  await expect(numeric).toBeVisible();
  await expect(next).toHaveText('1 of 12 ›');

  // The keypad has rows of 3 digits plus 0 and delete.
  await expect(numeric.locator('.auth-num-key')).toHaveCount(11);

  // An untouched word shows an empty display — confirming with next enters
  // it as 0, visible when stepping back.
  await expect(display).toHaveText('');
  await next.click();
  await numeric.locator('[data-action="back"]').click();
  await expect(display).toHaveText('0');

  // Advance to the last word leaving the previous ones at 0.
  for (let i = 0; i < 11; i += 1) await next.click();
  await expect(next).toHaveText('Use phrase');

  // Typing and deleting digits edits the current number (31 → 3).
  await key('3').click();
  await key('1').click();
  await expect(display).toHaveText('31');
  await numeric.locator('[data-action="delete"]').click();
  await expect(display).toHaveText('3');

  await next.click();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
  await expect(numeric).toBeHidden();

  // An invalid checksum is rejected with an explanation. Reopening on a full
  // phrase lands on the last word ("Use phrase").
  await page.locator('#auth-seed-numeric-toggle').click();
  await expect(next).toHaveText('Use phrase');
  await numeric.locator('[data-action="delete"]').click();
  await key('4').click();
  await next.click();
  await expect(page.locator('#auth-error')).toContainText('checksum');
  await expect(numeric).toBeVisible();
});

test('numeric wizard pre-fills from typed words or numbers and caps at 2047', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  await input.fill('about 2047');
  await page.locator('#auth-seed-numeric-toggle').click();

  // Two words entered (one as a word, one as a number): the wizard opens on
  // word 3, still empty.
  const numeric = page.locator('#auth-seed-numeric');
  const next = numeric.locator('[data-action="next"]');
  const back = numeric.locator('[data-action="back"]');
  const display = numeric.locator('.auth-num-display');
  await expect(next).toHaveText('3 of 12 ›');
  await expect(display).toHaveText('');

  // Digits that would exceed 2047 are ignored.
  await numeric.locator('[data-digit="2"]').click();
  await numeric.locator('[data-digit="0"]').click();
  await numeric.locator('[data-digit="4"]').click();
  await numeric.locator('[data-digit="8"]').click();
  await expect(display).toHaveText('204');
  await numeric.locator('[data-digit="7"]').click();
  await expect(display).toHaveText('2047');

  await back.click();
  await expect(next).toHaveText('2 of 12 ›');
  await expect(display).toHaveText('2047');

  await back.click();
  await expect(next).toHaveText('1 of 12 ›');
  await expect(display).toHaveText('3');
  await expect(back).toBeDisabled();
});

test('a phrase written as numbers is accepted in the text box', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  await input.fill('0 0 0 0 0 0 0 0 0 0 0 3');
  await input.blur();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
});

test('a phrase pasted as its Base58 code is accepted in the text box', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  // Base58 of the 16 zero entropy bytes behind "abandon ×11 about": each
  // zero byte encodes as a leading "1".
  await input.fill('1111111111111111');
  await input.blur();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
});

test('a legacy Base64 code is still accepted in the text box', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  // Base64 of the same 16 zero entropy bytes, the pre-Base58 backup form.
  await input.fill('AAAAAAAAAAAAAAAAAAAAAA==');
  await input.blur();
  await expect(input).toHaveValue(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about ',
  );
});

test('registration reveals the numbers and the Base58 code with separate copy buttons', async ({ page }) => {
  await page.locator('[data-auth-tab="register"]').click();
  await page.locator('#auth-super-password').fill('test-admin-password');
  await page.locator('#auth-register-form button[type="submit"]').click();

  const numbers = page.locator('#auth-mnemonic-numbers');
  const code = page.locator('#auth-mnemonic-code');
  await expect(numbers).toHaveText('0 0 0 0 0 0 0 0 0 0 0 3');
  await expect(code).toHaveText('1111111111111111');

  // Each block has its own copy button.
  await expect(page.locator('#auth-copy-numbers')).toBeVisible();
  await expect(page.locator('#auth-copy-code')).toBeVisible();
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
