import { readText, writeText } from './persistent-store.js';

const REGISTRY_KEY = 'users/registry.json';

let cachedUsers = null;
let loadPromise = null;

async function loadFromStore() {
  const raw = await readText(REGISTRY_KEY);
  if (!raw) {
    cachedUsers = [];
    return cachedUsers;
  }
  try {
    const parsed = JSON.parse(raw);
    cachedUsers = Array.isArray(parsed) ? parsed : [];
  } catch {
    cachedUsers = [];
  }
  return cachedUsers;
}

export async function ensureUserRegistryLoaded() {
  if (cachedUsers) return cachedUsers;
  if (!loadPromise) loadPromise = loadFromStore();
  return loadPromise;
}

export function getCachedUserRegistry() {
  return cachedUsers ? [...cachedUsers] : [];
}

export async function readUserRegistry() {
  await ensureUserRegistryLoaded();
  return [...cachedUsers];
}

async function persistUsers(users) {
  cachedUsers = users;
  await writeText(REGISTRY_KEY, `${JSON.stringify(users, null, 2)}\n`);
}

export async function addStoredUser(record) {
  const users = await readUserRegistry();
  users.push(record);
  await persistUsers(users);
  return record;
}

export async function updateStoredUser(id, patch) {
  const users = await readUserRegistry();
  const index = users.findIndex((user) => user.id === id);
  if (index < 0) return null;

  const next = { ...users[index], ...patch, id: users[index].id };
  users[index] = next;
  await persistUsers(users);
  return next;
}
