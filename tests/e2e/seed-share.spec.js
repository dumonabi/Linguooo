// @ts-check
// Seed side channels, modeled on bip.lol: QR, sound (ggwave), binary grid
// and the emoji-wrapped Base58 code.
import { test, expect } from '@playwright/test';
import QRCode from 'qrcode';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';

// Base58 of the 16 zero entropy bytes behind "abandon ×11 about".
const BASE58 = '1111111111111111';

// Mirror of the app's emoji wrapping (variation selectors, one per byte).
function encodeEmoji(text) {
  let out = '\u{1F60A}';
  for (const byte of Buffer.from(text, 'utf8')) {
    out += String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16);
  }
  return out;
}

function decodeEmoji(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xfe00 && cp <= 0xfe0f) bytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) bytes.push(cp - 0xe0100 + 16);
  }
  return Buffer.from(bytes).toString('utf8');
}

// A fake ggwave engine injected before the app loads; the app skips loading
// the real WASM build when window.ggwave_factory already exists.
const FAKE_GGWAVE = (decodePayload) => `
  (() => {
    let decodeCalls = 0;
    window.ggwave_factory = async () => ({
      getDefaultParameters: () => ({}),
      init: () => 1,
      encode: () => new Int8Array(4096 * 4),
      decode: () => {
        decodeCalls += 1;
        if (${JSON.stringify(Boolean(decodePayload))} && decodeCalls >= 3) {
          return new TextEncoder().encode(${JSON.stringify(decodePayload || '')});
        }
        return null;
      },
      ProtocolId: { GGWAVE_PROTOCOL_AUDIBLE_FAST: 2 },
    });
  })();
`;

test.beforeEach(async ({ page }) => {
  await setupApiMocks(page, { authRequired: true });
  await resetClientState(page);
});

test('an emoji hiding the Base58 code is accepted in the text box', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();

  const input = page.locator('#auth-passphrase-input');
  await input.fill(encodeEmoji(BASE58));
  await input.blur();
  // The box normalizes to the Base58 code itself.
  await expect(input).toHaveValue(BASE58);
});

test('the binary grid builds the phrase bit by bit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();

  const binary = page.locator('#auth-seed-binary');
  await page.locator('#auth-seed-binary-toggle').click();
  await expect(binary).toBeVisible();
  await expect(binary.locator('.auth-bin-cell')).toHaveCount(12 * 11);

  // "about" is index 3: bits …011 at the end of the last row.
  await binary.locator('[data-row="11"][data-bit="9"]').click();
  await binary.locator('[data-row="11"][data-bit="10"]').click();
  await expect(binary.locator('.auth-bin-num[data-row="11"]')).toHaveText('3');

  await binary.locator('[data-action="use"]').click();
  await expect(page.locator('#auth-passphrase-input')).toHaveValue(BASE58);
  await expect(binary).toBeHidden();
});

test('a grid failing the checksum reports guidance instead of applying', async ({ page }) => {
  await page.goto('/');
  await page.locator('#auth-seed-binary-toggle').click();

  const binary = page.locator('#auth-seed-binary');
  // Only the last bit set → word 12 = index 1, which breaks the checksum.
  await binary.locator('[data-row="11"][data-bit="10"]').click();
  await binary.locator('[data-action="use"]').click();

  await expect(page.locator('#auth-error')).toContainText('checksum');
  await expect(page.locator('#auth-passphrase-input')).toHaveValue('');
});

test('registration offers QR, sound and emoji sharing of the phrase', async ({ page }) => {
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
      configurable: true,
    });
  });
  await page.addInitScript({ content: FAKE_GGWAVE(null) });

  await page.goto('/');
  await page.locator('[data-auth-tab="register"]').click();
  await page.locator('#auth-super-password').fill('test-admin-password');
  await page.locator('#auth-register-form button[type="submit"]').click();
  await expect(page.locator('#auth-recovery-reveal')).toBeVisible();

  // QR: toggles a generated image.
  await page.locator('#auth-reveal-qr-btn').click();
  const qrImg = page.locator('#auth-reveal-qr');
  await expect(qrImg).toBeVisible();
  await expect(qrImg).toHaveAttribute('src', /^data:image/);
  await page.locator('#auth-reveal-qr-btn').click();
  await expect(qrImg).toBeHidden();

  // Emoji: copies a smiley that hides the Base58 code.
  await page.locator('#auth-reveal-emoji-btn').click();
  await expect.poll(() => page.evaluate(() => window.__copied.length)).toBeGreaterThan(0);
  const copied = await page.evaluate(() => window.__copied.at(-1));
  expect(copied.startsWith('\u{1F60A}')).toBe(true);
  expect(decodeEmoji(copied)).toBe(BASE58);

  // Sound: plays the chirp and re-enables without surfacing an error.
  await page.locator('#auth-reveal-sound-btn').click();
  await expect(page.locator('#auth-reveal-sound-btn')).toBeEnabled({ timeout: 10_000 });
  await expect(page.locator('#auth-error')).toBeHidden();
});

test('a QR photo of the code fills the sign-in box', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();

  await page.locator('#auth-seed-qr-toggle').click();
  await expect(page.locator('#auth-seed-scan')).toBeVisible();

  const png = await QRCode.toBuffer(BASE58, { width: 512, margin: 1 });
  await page.locator('#auth-seed-qr-file').setInputFiles({
    name: 'seed-qr.png',
    mimeType: 'image/png',
    buffer: png,
  });

  await expect(page.locator('#auth-passphrase-input')).toHaveValue(BASE58, { timeout: 10_000 });
  await expect(page.locator('#auth-tool-status')).toContainText('Code received');
});

test('a photo without a valid code reports it and keeps the panel open', async ({ page }) => {
  await page.goto('/');
  await page.locator('#auth-seed-qr-toggle').click();
  await expect(page.locator('#auth-seed-scan')).toBeVisible();

  // A QR that decodes fine but does not carry a seed code.
  const png = await QRCode.toBuffer('https://example.com', { width: 256, margin: 1 });
  await page.locator('#auth-seed-qr-file').setInputFiles({
    name: 'not-a-seed.png',
    mimeType: 'image/png',
    buffer: png,
  });

  await expect(page.locator('#auth-tool-status')).toContainText('No valid code', { timeout: 10_000 });
  await expect(page.locator('#auth-seed-scan')).toBeVisible();
  await expect(page.locator('#auth-passphrase-input')).toHaveValue('');
});

test('active tools hide the text box and deselecting brings it back', async ({ page }) => {
  await page.addInitScript({ content: FAKE_GGWAVE(null) });
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();

  const input = page.locator('#auth-passphrase-input');
  await expect(input).toBeVisible();

  // Binary grid: open hides the box, close restores it.
  await page.locator('#auth-seed-binary-toggle').click();
  await expect(input).toBeHidden();
  await page.locator('#auth-seed-binary-toggle').click();
  await expect(input).toBeVisible();

  // QR scan panel.
  await page.locator('#auth-seed-qr-toggle').click();
  await expect(input).toBeHidden();
  await page.locator('#auth-seed-qr-toggle').click();
  await expect(input).toBeVisible();

  // Sound listening.
  await page.locator('#auth-seed-sound').click();
  await expect(page.locator('#auth-seed-sound')).toHaveClass(/is-listening/);
  await expect(input).toBeHidden();
  await page.locator('#auth-seed-sound').click();
  await expect(input).toBeVisible();

  // Switching directly between tools keeps the box hidden.
  await page.locator('#auth-seed-binary-toggle').click();
  await expect(input).toBeHidden();
  await page.locator('#auth-seed-qr-toggle').click();
  await expect(page.locator('#auth-seed-binary')).toBeHidden();
  await expect(input).toBeHidden();
  await page.locator('#auth-seed-qr-toggle').click();
  await expect(input).toBeVisible();
});

test('listening decodes a sound code into the sign-in box', async ({ page }) => {
  await page.addInitScript({ content: FAKE_GGWAVE(BASE58) });
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);

  await page.goto('/');
  await expect(page.locator('#auth-gate')).toBeVisible();

  const soundBtn = page.locator('#auth-seed-sound');
  await soundBtn.click();
  await expect(soundBtn).toHaveClass(/is-listening/);
  await expect(page.locator('#auth-tool-status')).toContainText('Listening');

  await expect(page.locator('#auth-passphrase-input')).toHaveValue(BASE58, { timeout: 15_000 });
  await expect(soundBtn).not.toHaveClass(/is-listening/);
  await expect(page.locator('#auth-tool-status')).toContainText('Code received');
});
