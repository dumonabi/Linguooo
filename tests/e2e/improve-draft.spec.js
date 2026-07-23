import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

async function prepareApp(page) {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page);
  await page.route('**/api/improve', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: `[${body.mode}] ${body.text}`, mode: body.mode }),
    });
  });
  await page.goto('/');
  await expect(page.locator('#compose-mic')).toBeVisible();
}

test.describe('Draft improvement (magic wands)', () => {
  test('both wands appear next to the translate button when there is text', async ({ page }) => {
    await prepareApp(page);

    const simplifyWand = page.locator('#improve-simplify');
    const formalWand = page.locator('#improve-formal');
    const translateBtn = page.locator('#dictation-translate');

    await expect(simplifyWand).toBeHidden();
    await expect(formalWand).toBeHidden();

    await page.locator('#dictation-input').fill('hola que tal');
    await expect(simplifyWand).toBeVisible();
    await expect(formalWand).toBeVisible();
    await expect(translateBtn).toBeVisible();
    await expect(page.locator('#compose-improve-undo')).toBeHidden();
  });

  test('the simplify wand rewrites the draft and undo restores the original', async ({ page }) => {
    await prepareApp(page);

    const input = page.locator('#dictation-input');
    const undoBtn = page.locator('#compose-improve-undo');
    await input.fill('texto muy complicado');

    await page.locator('#improve-simplify').click();
    await expect(input).toHaveValue('[simplify] texto muy complicado');
    await expect(undoBtn).toBeVisible();
    // The wands and the translate button stay available after a rewrite.
    await expect(page.locator('#improve-simplify')).toBeVisible();
    await expect(page.locator('#improve-formal')).toBeVisible();
    await expect(page.locator('#dictation-translate')).toBeVisible();

    await undoBtn.click();
    await expect(input).toHaveValue('texto muy complicado');
    await expect(undoBtn).toBeHidden();
  });

  test('the formal wand sends the formal mode to the API', async ({ page }) => {
    await prepareApp(page);

    const input = page.locator('#dictation-input');
    await input.fill('oye tio dime la hora');
    await page.locator('#improve-formal').click();
    await expect(input).toHaveValue('[formal] oye tio dime la hora');
  });

  test('a rewrite that changes nothing does not offer undo', async ({ page }) => {
    await prepareApp(page);
    await page.route('**/api/improve', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, text: body.text, mode: body.mode }),
      });
    });

    const input = page.locator('#dictation-input');
    await input.fill('texto perfecto');
    await page.locator('#improve-simplify').click();

    await expect(page.locator('#toast')).toContainText('no changes');
    await expect(input).toHaveValue('texto perfecto');
    await expect(page.locator('#compose-improve-undo')).toBeHidden();
  });

  test('a failed improvement keeps the draft and shows a toast', async ({ page }) => {
    await prepareApp(page);
    await page.route('**/api/improve', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Improve exploded' }),
      })
    );

    const input = page.locator('#dictation-input');
    await input.fill('mensaje original');
    await page.locator('#improve-simplify').click();

    await expect(page.locator('#toast')).toContainText('Improve exploded');
    await expect(input).toHaveValue('mensaje original');
    await expect(page.locator('#compose-improve-undo')).toBeHidden();
  });

  test('clearing the draft hides the wands and drops the undo history', async ({ page }) => {
    await prepareApp(page);

    const input = page.locator('#dictation-input');
    await input.fill('otro mensaje');
    await page.locator('#improve-formal').click();
    await expect(input).toHaveValue('[formal] otro mensaje');
    await expect(page.locator('#compose-improve-undo')).toBeVisible();

    await page.locator('#compose-new').click();
    await expect(input).toHaveValue('');
    await expect(page.locator('#improve-simplify')).toBeHidden();
    await expect(page.locator('#improve-formal')).toBeHidden();
    await expect(page.locator('#compose-improve-undo')).toBeHidden();

    await input.fill('nuevo texto');
    await expect(page.locator('#compose-improve-undo')).toBeHidden();
  });
});
