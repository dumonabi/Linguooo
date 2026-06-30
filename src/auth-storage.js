const DB_NAME = 'lingu-auth';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readSessionStorage(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionStorage(key, value) {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeWebStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export async function initAuthStorage() {
  const keys = [];
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => {
        keys.push(...(req.result || []));
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    // IndexedDB unavailable — localStorage only
  }

  for (const key of keys) {
    if (typeof key !== 'string') continue;
    try {
      const value = await idbGet(key);
      if (value != null) memory.set(key, String(value));
    } catch {
      // ignore per-key errors
    }
  }

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith('lingo-') || memory.has(key)) continue;
      const value = readLocalStorage(key);
      if (value != null) {
        memory.set(key, value);
        void persistKey(key, value);
      }
    }
  } catch {
    // ignore storage enumeration errors
  }

  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith('lingo-') || memory.has(key)) continue;
      const value = readSessionStorage(key);
      if (value != null) {
        memory.set(key, value);
        void persistKey(key, value);
      }
    }
  } catch {
    // ignore storage enumeration errors
  }
}

export function readPersistedValue(key) {
  if (memory.has(key)) return memory.get(key);
  return readLocalStorage(key) || readSessionStorage(key);
}

export async function persistKey(key, value) {
  memory.set(key, value);
  writeLocalStorage(key, value);
  writeSessionStorage(key, value);
  try {
    await idbSet(key, value);
  } catch {
    // IndexedDB optional
  }
}

export async function removeKey(key) {
  memory.delete(key);
  removeWebStorage(key);
  try {
    await idbDelete(key);
  } catch {
    // ignore
  }
}
