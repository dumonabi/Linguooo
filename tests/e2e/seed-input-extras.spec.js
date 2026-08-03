// @ts-check
import { test, expect } from '@playwright/test';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

test.beforeEach(async ({ page }) => {
  await setupApiMocks(page, { authRequired: true });
  await resetClientState(page);

  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();
});

test('the removed input options (numeric keypad, dictation mic) are gone', async ({ page }) => {
  await expect(page.locator('#auth-seed-mic')).toHaveCount(0);
  await expect(page.locator('#auth-seed-numeric-toggle')).toHaveCount(0);
  // The remaining tools: binary grid, QR scan and sound listen.
  await expect(page.locator('#auth-seed-binary-toggle')).toBeVisible();
  await expect(page.locator('#auth-seed-qr-toggle')).toBeVisible();
  await expect(page.locator('#auth-seed-sound')).toBeVisible();
});

test('signing in with the Base58 code works', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  // Base58 of the 16 zero entropy bytes behind "abandon ×11 about": each
  // zero byte encodes as a leading "1".
  await input.fill('1111111111111111');
  await input.blur();
  // The code is the canonical form — blur leaves it as-is.
  await expect(input).toHaveValue('1111111111111111');

  await page.locator('#auth-signin-form button[type="submit"]').click();
  await expect(page.locator('#auth-gate')).toBeHidden();
});

test('a legacy Base64 code normalizes to the Base58 code on blur', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');
  // Base64 of the same 16 zero entropy bytes, the pre-Base58 backup form.
  await input.fill('AAAAAAAAAAAAAAAAAAAAAA==');
  await input.blur();
  await expect(input).toHaveValue('1111111111111111');
});

test('words and numbers are not recognized — only the Base58 code', async ({ page }) => {
  const input = page.locator('#auth-passphrase-input');

  // The 12 words themselves are left untouched and rejected on submit.
  await input.fill('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  await input.blur();
  await expect(input).toHaveValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  await page.locator('#auth-signin-form button[type="submit"]').click();
  await expect(page.locator('#auth-error')).toContainText('Base58');
  await expect(page.locator('#auth-gate')).toBeVisible();

  // Same for the decimal numbers form.
  await input.fill('0 0 0 0 0 0 0 0 0 0 0 3');
  await input.blur();
  await expect(input).toHaveValue('0 0 0 0 0 0 0 0 0 0 0 3');
  await page.locator('#auth-signin-form button[type="submit"]').click();
  await expect(page.locator('#auth-error')).toContainText('Base58');
});

test('registration reveals only the Base58 code with its copy button', async ({ page }) => {
  await page.locator('[data-auth-tab="register"]').click();
  await page.locator('#auth-super-password').fill('test-admin-password');
  await page.locator('#auth-register-form button[type="submit"]').click();

  await expect(page.locator('#auth-mnemonic-code')).toHaveText('1111111111111111');
  await expect(page.locator('#auth-copy-code')).toBeVisible();

  // The numbers block is gone.
  await expect(page.locator('#auth-mnemonic-numbers')).toHaveCount(0);
});
