// Profile slot names sync across devices last-write-wins: every rename
// carries a timestamp, and on hydration the newest one — local or from the
// server — survives everywhere. Deletions (empty name with a fresh
// timestamp) propagate the same way.
import { test, expect } from '@playwright/test';
import { setupApiMocks, resetClientState } from './helpers/mock-api.js';

const NAME_KEY = 'lingo-profile-slot-name:test-user:1';
const NAME_AT_KEY = 'lingo-profile-slot-name:test-user:1:at';

test.beforeEach(async ({ page }) => {
  await resetClientState(page);
});

test('a rename made on another device replaces the stale local name', async ({ page }) => {
  // This device still has the old, untimestamped name.
  await page.addInitScript(() => {
    localStorage.setItem('lingo-profile-slot-name:test-user:1', 'Viejo');
  });
  await setupApiMocks(page, {
    profileSettings: {
      slotNames: { 1: 'Nuevo' },
      slotNamesUpdatedAt: { 1: Date.now() },
    },
  });

  await page.goto('/');
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('lingo-profile-slot-name:test-user:1')),
    { timeout: 8000 },
  ).toBe('Nuevo');
});

test('a fresher local rename survives hydration and reaches the server', async ({ page }) => {
  const localAt = Date.now();
  await page.addInitScript(([key, atKey, at]) => {
    localStorage.setItem(key, 'Mio');
    localStorage.setItem(atKey, String(at));
  }, [NAME_KEY, NAME_AT_KEY, localAt]);

  const { settings } = await setupApiMocks(page, {
    profileSettings: {
      slotNames: { 1: 'Nuevo' },
      slotNamesUpdatedAt: { 1: localAt - 60_000 },
    },
  });

  await page.goto('/');

  // The local rename is newer, so it must not be overwritten…
  await page.waitForTimeout(1500);
  expect(await page.evaluate(([key]) => localStorage.getItem(key), [NAME_KEY])).toBe('Mio');

  // …and hydration must push it so other devices get it too.
  await expect.poll(() => settings.stored.slotNames['1'], { timeout: 8000 }).toBe('Mio');
});

test('a name cleared on another device is cleared here too', async ({ page }) => {
  await page.addInitScript(([key, atKey]) => {
    localStorage.setItem(key, 'Viejo');
    localStorage.setItem(atKey, '1000');
  }, [NAME_KEY, NAME_AT_KEY]);

  await setupApiMocks(page, {
    profileSettings: {
      slotNames: {},
      slotNamesUpdatedAt: { 1: Date.now() },
    },
  });

  await page.goto('/');
  await expect.poll(
    () => page.evaluate(([key]) => localStorage.getItem(key), [NAME_KEY]),
    { timeout: 8000 },
  ).toBe('');
});
