import { test, expect } from '@playwright/test';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const ANA = { id: 'contact-1', name: 'Ana', code: 'Friend12' };

// Mirror of the app's emoji wrapping: one invisible variation selector per
// byte of the code, appended after the smiley.
function encodeCodeAsEmoji(code) {
  let out = '\u{1F60A}';
  for (const byte of Buffer.from(code, 'utf8')) {
    out += String.fromCodePoint(byte < 16 ? 0xfe00 + byte : 0xe0100 + byte - 16);
  }
  return out;
}

function decodeEmojiCode(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xfe00 && cp <= 0xfe0f) bytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) bytes.push(cp - 0xe0100 + 16);
  }
  return Buffer.from(bytes).toString('utf8');
}

async function prepareApp(page, apiOptions = {}) {
  await resetClientState(page);
  const mocks = await setupApiMocks(page, apiOptions);
  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();
  return mocks;
}

test.describe('chat with contacts', () => {
  test('the strip defaults to translate-only with an add button', async ({ page }) => {
    await prepareApp(page);

    const direct = page.locator('.contact-square-direct');
    await expect(direct).toBeVisible();
    await expect(direct).toHaveClass(/is-active/);
    await expect(page.locator('.contact-square-add')).toBeVisible();
    await expect(page.locator('#chat-thread')).toBeHidden();
  });

  test('adding a contact by code lists it and opens the chat', async ({ page }) => {
    await prepareApp(page);

    await page.locator('.contact-square-add').click();
    const overlay = page.locator('#chat-add-overlay');
    await expect(overlay).toBeVisible();
    await expect(page.locator('#chat-my-code')).toHaveText('MyCode11');

    await page.locator('#chat-add-code').fill('Friend12');
    await page.locator('#chat-add-submit').click();

    await expect(overlay).toBeHidden();
    const anaSquare = page.locator('.contact-square', { hasText: 'Ana' });
    await expect(anaSquare).toBeVisible();
    await expect(anaSquare).toHaveClass(/is-active/);
    await expect(page.locator('#chat-thread')).toBeVisible();
    await expect(page.locator('#chat-thread')).toContainText('No messages with Ana yet');
  });

  test('the emoji button copies a smiley with the code hidden inside', async ({ page }) => {
    await resetClientState(page);
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
        configurable: true,
      });
    });
    await setupApiMocks(page);
    await page.goto('/');
    await expect(page.locator('#compose-mic')).toBeVisible();

    await page.locator('.contact-square-add').click();
    await expect(page.locator('#chat-my-code')).toHaveText('MyCode11');
    await page.locator('#chat-my-code-emoji').click();

    const copied = await page.evaluate(() => window.__copied.at(-1));
    expect(copied.startsWith('\u{1F60A}')).toBe(true);
    expect(decodeEmojiCode(copied)).toBe('MyCode11');
  });

  test('pasting an emoji-wrapped code adds the contact', async ({ page }) => {
    await prepareApp(page);

    await page.locator('.contact-square-add').click();
    await page.locator('#chat-add-code').fill(encodeCodeAsEmoji('Friend12'));
    await page.locator('#chat-add-submit').click();

    await expect(page.locator('#chat-add-overlay')).toBeHidden();
    const anaSquare = page.locator('.contact-square', { hasText: 'Ana' });
    await expect(anaSquare).toBeVisible();
    await expect(anaSquare).toHaveClass(/is-active/);
  });

  test('an unknown code shows the server error', async ({ page }) => {
    await prepareApp(page);

    await page.locator('.contact-square-add').click();
    await page.locator('#chat-add-code').fill('Nobody99');
    await page.locator('#chat-add-submit').click();

    await expect(page.locator('#toast')).toContainText('No user found with that code');
    await expect(page.locator('#chat-add-overlay')).toBeVisible();
  });

  test('sending a draft in chat mode posts the message translated to lang2', async ({ page }) => {
    await prepareApp(page, { chat: { contacts: [ANA] } });

    await page.locator('.contact-square', { hasText: 'Ana' }).click();
    await expect(page.locator('#chat-thread')).toBeVisible();

    const input = page.locator('#dictation-input');
    await input.fill('hola amigo');
    const sendBtn = page.locator('#dictation-translate');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toHaveAttribute('title', 'Send to Ana');

    await sendBtn.click();

    const bubble = page.locator('.chat-msg.is-mine .chat-msg-text');
    await expect(bubble).toHaveText('[es] hola amigo');
    await expect(input).toHaveValue('');
    // No translation card in chat mode.
    await expect(page.locator('.message-card')).toHaveCount(0);
  });

  test('incoming messages appear via polling and play in the sender voice', async ({ page }) => {
    const mocks = await prepareApp(page, { chat: { contacts: [ANA] } });

    await page.locator('.contact-square', { hasText: 'Ana' }).click();
    await expect(page.locator('#chat-thread')).toBeVisible();

    mocks.chat.pushIncoming({
      from: ANA.id,
      to: 'test-user',
      text: 'สวัสดีครับ',
      sourceText: 'hola',
      sourceLang: 'es',
      targetLang: 'th',
    });

    const bubble = page.locator('.chat-msg.is-theirs');
    await expect(bubble).toBeVisible({ timeout: 10_000 });
    await expect(bubble.locator('.chat-msg-text')).toHaveText('สวัสดีครับ');

    const speakRequest = page.waitForRequest((req) =>
      req.url().includes('/api/speak')
      && req.method() === 'POST'
      && req.postDataJSON()?.speakerId === ANA.id
    );
    await bubble.locator('.chat-msg-play').click();
    const req = await speakRequest;
    expect(req.postDataJSON().lang).toBe('th');
    expect(req.postDataJSON().text).toBe('สวัสดีครับ');
  });

  test('translate-only mode still translates without sending anything', async ({ page }) => {
    const mocks = await prepareApp(page, { chat: { contacts: [ANA] } });

    await page.locator('.contact-square', { hasText: 'Ana' }).click();
    await expect(page.locator('#chat-thread')).toBeVisible();

    await page.locator('.contact-square-direct').click();
    await expect(page.locator('#chat-thread')).toBeHidden();

    const input = page.locator('#dictation-input');
    await input.fill('hola');
    const translateBtn = page.locator('#dictation-translate');
    await expect(translateBtn).toHaveAttribute('title', 'Translate');
    await translateBtn.click();

    await expect(page.locator('.message-translated-text')).not.toHaveText('', { timeout: 8000 });
    expect(mocks.chat.sendCount).toBe(0);
  });
});
