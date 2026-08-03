// Contacts and one-to-one chat conversations.
//
// Every user has a short public contact code derived from their id — safe to
// share, grants nothing beyond being reachable in chat. Adding a contact is
// mutual: both sides see each other and can reply. Messages are stored
// already translated into the language the SENDER selected; the receiver
// sees exactly what the sender chose to deliver.

import crypto from 'crypto';
import { readText, writeText } from './persistent-store.js';
import { readUserRegistry } from './user-store.js';
import { getSuperUserRecord } from './bootstrap-user.js';

const CONTACTS_PREFIX = 'chat/contacts';
const CONVERSATIONS_PREFIX = 'chat/conversations';
const MAX_STORED_MESSAGES = 200;
const MAX_CONTACTS = 50;
// Chat messages are ephemeral: anything older than 48 hours is dropped on
// read and permanently removed on the next write to that conversation.
const MESSAGE_TTL_MS = 48 * 60 * 60 * 1000;

// Short caches so chat polling does not hammer Blob storage. Per-instance,
// which is fine: writes update the cache in place.
const contactsCache = new Map(); // userId -> { value, at }
const conversationCache = new Map(); // convKey -> { value, at }
const CONTACTS_TTL_MS = 10_000;
const CONVERSATION_TTL_MS = 3_000;

// Base58 (Bitcoin alphabet), same one the client uses for seed backups.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToBase58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      const value = digits[i] * 256 + carry;
      digits[i] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]];
  return out;
}

// 8 Base58 characters derived from the user id — deterministic, so no extra
// storage or migration is needed for existing accounts.
export function contactCodeForUser(userId) {
  const digest = crypto.createHash('sha256').update(`lingu-contact:${userId}`).digest();
  return bytesToBase58(digest).slice(0, 8);
}

export function normalizeContactCode(value) {
  const raw = String(value || '').trim();
  return /^[1-9A-HJ-NP-Za-km-z]{8}$/.test(raw) ? raw : null;
}

export async function findUserByContactCode(code) {
  const normalized = normalizeContactCode(code);
  if (!normalized) return null;
  // The bootstrap admin lives outside the stored registry but is reachable
  // by code like anyone else.
  const superUser = getSuperUserRecord();
  if (contactCodeForUser(superUser.id) === normalized) return superUser;
  const users = await readUserRegistry();
  return users.find((user) => contactCodeForUser(user.id) === normalized) || null;
}

// ---- Contacts ----

function contactsKey(userId) {
  return `${CONTACTS_PREFIX}/${userId}.json`;
}

async function readContacts(userId) {
  const cached = contactsCache.get(userId);
  if (cached && Date.now() - cached.at < CONTACTS_TTL_MS) return cached.value;
  let value = [];
  try {
    const raw = await readText(contactsKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) value = parsed;
  } catch {
    value = [];
  }
  contactsCache.set(userId, { value, at: Date.now() });
  return value;
}

async function writeContacts(userId, contacts) {
  contactsCache.set(userId, { value: contacts, at: Date.now() });
  await writeText(contactsKey(userId), `${JSON.stringify(contacts, null, 2)}\n`);
}

export async function getContacts(userId) {
  return readContacts(userId);
}

export async function isContact(userId, otherId) {
  if (!userId || !otherId || userId === otherId) return false;
  const contacts = await readContacts(userId);
  return contacts.some((entry) => entry.id === otherId);
}

async function addOneDirection(userId, otherId, alias = null) {
  const contacts = await readContacts(userId);
  if (contacts.some((entry) => entry.id === otherId)) return false;
  if (contacts.length >= MAX_CONTACTS) {
    const err = new Error('Contact list is full');
    err.code = 'CONTACT_LIMIT';
    throw err;
  }
  const entry = { id: otherId, addedAt: Date.now() };
  if (alias) entry.alias = alias;
  await writeContacts(userId, [...contacts, entry]);
  return true;
}

// Mutual: adding someone also makes you visible on their side so they can
// reply without exchanging codes twice. The alias is private to the adder —
// the other side sees the adder's real profile name.
export async function addContactPair(userId, otherId, alias = null) {
  await addOneDirection(userId, otherId, alias);
  await addOneDirection(otherId, userId);
}

// Renames a contact for this user only. An empty alias clears the custom
// name so the contact's profile name shows again. Returns false when the
// contact does not exist.
export async function setContactAlias(userId, otherId, alias) {
  const contacts = await readContacts(userId);
  const index = contacts.findIndex((entry) => entry.id === otherId);
  if (index < 0) return false;
  const entry = { ...contacts[index] };
  if (alias) entry.alias = alias;
  else delete entry.alias;
  const next = [...contacts];
  next[index] = entry;
  await writeContacts(userId, next);
  return true;
}

// ---- Conversations ----

function conversationKey(a, b) {
  const pair = [a, b].sort();
  return `${CONVERSATIONS_PREFIX}/${pair.join('~')}.json`;
}

function pruneExpired(messages) {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  return messages.filter((msg) => (msg.createdAt || 0) >= cutoff);
}

async function readConversation(a, b) {
  const key = conversationKey(a, b);
  const cached = conversationCache.get(key);
  if (cached && Date.now() - cached.at < CONVERSATION_TTL_MS) return cached.value;
  let value = { messages: [] };
  try {
    const raw = await readText(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.messages)) {
      value = { ...parsed, messages: pruneExpired(parsed.messages) };
    }
  } catch {
    value = { messages: [] };
  }
  conversationCache.set(key, { value, at: Date.now() });
  return value;
}

async function writeConversation(a, b, conversation) {
  const key = conversationKey(a, b);
  conversationCache.set(key, { value: conversation, at: Date.now() });
  await writeText(key, `${JSON.stringify(conversation)}\n`);
}

export async function appendChatMessage({ from, to, text, sourceText, sourceLang, targetLang }) {
  const conversation = await readConversation(from, to);
  const message = {
    id: `m-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    from,
    to,
    text,
    sourceText,
    sourceLang: sourceLang || null,
    targetLang: targetLang || null,
    createdAt: Date.now(),
  };
  const messages = [...pruneExpired(conversation.messages), message].slice(-MAX_STORED_MESSAGES);
  await writeConversation(from, to, { messages });
  return message;
}

// Messages after a cursor id (exclusive). Without a cursor, the latest chunk.
export async function getMessages(a, b, { after = null, limit = 50 } = {}) {
  const { messages } = await readConversation(a, b);
  if (!after) return messages.slice(-limit);
  const index = messages.findIndex((msg) => msg.id === after);
  // Unknown cursor (e.g. trimmed away): return the latest chunk so the
  // client can resynchronize instead of silently missing messages.
  if (index < 0) return messages.slice(-limit);
  return messages.slice(index + 1);
}

export async function lastMessageInfo(a, b) {
  const { messages } = await readConversation(a, b);
  const last = messages.at(-1);
  if (!last) return null;
  return { id: last.id, from: last.from, createdAt: last.createdAt };
}
