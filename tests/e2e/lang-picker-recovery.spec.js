import { test, expect } from '@playwright/test';
import { MEDIA_MOCK_INIT_SCRIPT } from './helpers/mock-media.js';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const FULL_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sw', name: 'Swahili' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'zh', name: 'Chinese' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ro', name: 'Romanian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'hi', name: 'Hindi' },
];

test('language search recovers the full list after a failed startup fetch', async ({ page }) => {
  await resetClientState(page);
  await page.addInitScript(MEDIA_MOCK_INIT_SCRIPT);
  await setupApiMocks(page);

  // First request fails (flaky mobile network); retries succeed.
  let languageRequests = 0;
  await page.route('**/api/languages', (route) => {
    languageRequests += 1;
    if (languageRequests === 1) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FULL_LANGUAGES),
    });
  });

  await page.goto('/');
  const search = page.getByLabel('Search language').first();
  await expect(search).toBeVisible();

  // Focusing the picker retries the fetch, so typing one letter must offer
  // every matching language, not just the offline fallback's single hit.
  await search.click();
  await search.fill('s');
  const options = page.locator('.lang-picker-bar-dropdown:not([hidden]) .lang-picker-square');
  await expect(options.first()).toBeVisible({ timeout: 5000 });
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(5);
});
