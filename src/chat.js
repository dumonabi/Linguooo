// One-to-one chat with contacts.
//
// The strip above the compose box picks who you are writing to: the first
// square is "translate only" (the classic mode, nothing is sent), the rest
// are contacts added by their public code (optionally under a chosen name).
// Messages follow the language bar exactly like the translator: written in
// one language of the pair, delivered in the other — and can be listened to
// in the sender's cloned voice. The server keeps them for 48 hours only.

import { $, escapeHtml } from './dom-utils.js';
import { apiFetch, getStoredUser } from './auth.js';
import { hideTextInEmoji, revealTextFromEmoji } from './emoji-code.js';

const POLL_MS = 4000;
const CONTACTS_POLL_MS = 20_000;
const SEEN_KEY = 'lingo-chat-seen';
const ACTIVE_KEY = 'lingo-chat-active';

const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>';
const TRANSLATE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75l1.13 3h2l-4.37-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';

let stripEl = null;
let threadEl = null;
let overlayEl = null;
let renameOverlayEl = null;
let renameTarget = null; // contact being renamed

let showToastFn = () => {};
let onModeChangeFn = () => {};

let myCode = '';
let myId = null;
let contacts = [];
let activeContact = null;
let messages = [];
let pollTimer = null;
let contactsTimer = null;
let pollBusy = false;
let chatPlayback = null; // { audio, messageId }
const audioUrlCache = new Map(); // messageId -> object URL

function myUserId() {
  return getStoredUser()?.id || myId;
}

// ---- emoji-wrapped codes ----
//
// Contact codes can travel hidden inside a 😊 (see emoji-code.js). Here we
// only add the contact-code validation on top of the generic wrapper.

export function encodeCodeAsEmoji(code, emoji = '\u{1F60A}') {
  return hideTextInEmoji(code, emoji);
}

// Returns the hidden code when the text carries one, null otherwise.
export function decodeEmojiCode(text) {
  const decoded = revealTextFromEmoji(text);
  return decoded && /^[1-9A-HJ-NP-Za-km-z]{8}$/.test(decoded) ? decoded : null;
}

// ---- seen tracking (client-side, per device) ----

function readSeenMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function markSeen(contactId, messageId) {
  if (!contactId || !messageId) return;
  const map = readSeenMap();
  map[contactId] = messageId;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch { /* storage full — the dot just reappears */ }
}

function hasUnread(contact) {
  if (!contact.lastMessageId) return false;
  if (contact.lastMessageFrom === myUserId()) return false;
  return readSeenMap()[contact.id] !== contact.lastMessageId;
}

// ---- public API ----

export function initChat({ showToast, onModeChange } = {}) {
  stripEl = $('#contact-strip');
  threadEl = $('#chat-thread');
  overlayEl = $('#chat-add-overlay');
  renameOverlayEl = $('#chat-rename-overlay');
  if (!stripEl || !threadEl) return;

  showToastFn = showToast || showToastFn;
  onModeChangeFn = onModeChange || onModeChangeFn;

  bindAddOverlay();
  bindRenameOverlay();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (activeContact) startPolling();
      void refreshContacts();
    } else {
      stopPolling();
    }
  });

  renderStrip();
  void refreshContacts().then(() => {
    const savedId = localStorage.getItem(ACTIVE_KEY);
    const saved = contacts.find((c) => c.id === savedId);
    if (saved) selectContact(saved);
  });
  contactsTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void refreshContacts();
  }, CONTACTS_POLL_MS);
}

export function isChatMode() {
  return Boolean(activeContact);
}

export function activeChatContact() {
  return activeContact;
}

// Sends the current draft to the active contact. The server applies the
// language bar like the translator does — written in one language of the
// pair, delivered in the other — so what comes back is what the receiver
// will see.
export async function sendChatMessage(text, { lang1, lang2 }) {
  if (!activeContact) throw new Error('No contact selected');
  const res = await apiFetch('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: activeContact.id, text, lang1, lang2 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not send the message');
  if (data.message) {
    messages.push(data.message);
    renderThread({ stick: true });
    markSeen(activeContact.id, data.message.id);
  }
  return data.message;
}

// ---- contacts ----

async function refreshContacts() {
  try {
    const res = await apiFetch('/api/contacts');
    if (!res.ok) return;
    const data = await res.json();
    myCode = data.code || myCode;
    myId = data.userId || myId;
    contacts = Array.isArray(data.contacts) ? data.contacts : [];
    // Keep the active contact pointing at the fresh entry so renames
    // (from this or another device) show up everywhere.
    if (activeContact) {
      const fresh = contacts.find((c) => c.id === activeContact.id);
      if (fresh) activeContact = fresh;
    }
    renderStrip();
  } catch { /* offline — keep the last known strip */ }
}

function selectContact(contact) {
  const changed = (contact?.id || null) !== (activeContact?.id || null);
  activeContact = contact || null;
  try {
    if (activeContact) localStorage.setItem(ACTIVE_KEY, activeContact.id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* non-critical */ }

  renderStrip();
  if (!changed) return;

  stopChatAudio();
  messages = [];
  if (activeContact) {
    threadEl.hidden = false;
    threadEl.innerHTML = '<p class="chat-thread-loading">Loading…</p>';
    void loadThread();
    startPolling();
  } else {
    threadEl.hidden = true;
    threadEl.innerHTML = '';
    stopPolling();
  }
  onModeChangeFn(activeContact);
}

function renderStrip() {
  if (!stripEl) return;
  stripEl.innerHTML = '';

  // "Translate only" — the classic mode: nothing is sent to anyone.
  const direct = document.createElement('button');
  direct.type = 'button';
  direct.className = 'contact-square contact-square-direct';
  direct.classList.toggle('is-active', !activeContact);
  direct.setAttribute('aria-label', 'Translate only');
  direct.title = 'Translate only';
  direct.innerHTML = `${TRANSLATE_SVG}<span class="contact-square-name">Only</span>`;
  direct.addEventListener('click', () => selectContact(null));
  stripEl.appendChild(direct);

  for (const contact of contacts) {
    const isActive = activeContact?.id === contact.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'contact-square';
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-label', isActive ? `Rename ${contact.name}` : `Chat with ${contact.name}`);
    btn.title = isActive ? `${contact.name} — tap to rename` : contact.name;
    btn.innerHTML = `
      <span class="contact-square-initial">${escapeHtml(contact.name.slice(0, 1).toUpperCase())}</span>
      <span class="contact-square-name">${escapeHtml(contact.name.slice(0, 8))}</span>
      ${hasUnread(contact) ? '<span class="contact-square-unread" aria-hidden="true"></span>' : ''}
    `;
    // Tapping the selected contact again opens the rename dialog; tapping
    // any other contact just switches the conversation.
    btn.addEventListener('click', () => {
      if (activeContact?.id === contact.id) openRenameOverlay(contact);
      else selectContact(contact);
    });
    stripEl.appendChild(btn);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'contact-square contact-square-add';
  add.setAttribute('aria-label', 'Add contact');
  add.title = 'Add contact';
  add.innerHTML = '<span class="contact-square-plus" aria-hidden="true">+</span>';
  add.addEventListener('click', openAddOverlay);
  stripEl.appendChild(add);
}

// ---- add-contact overlay ----

function bindAddOverlay() {
  if (!overlayEl) return;
  $('#chat-add-close', overlayEl)?.addEventListener('click', closeAddOverlay);
  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) closeAddOverlay();
  });

  $('#chat-my-code-copy', overlayEl)?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(myCode);
      showToastFn('Code copied');
    } catch {
      showToastFn('Could not copy');
    }
  });

  $('#chat-my-code-emoji', overlayEl)?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(encodeCodeAsEmoji(myCode));
      showToastFn('Emoji copied — your code is hidden inside it');
    } catch {
      showToastFn('Could not copy');
    }
  });

  const form = $('#chat-add-form', overlayEl);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#chat-add-code', overlayEl);
    const nameInput = $('#chat-add-name', overlayEl);
    const raw = input?.value.trim();
    if (!raw) return;
    // A pasted 😊 carries the code in invisible selectors — unwrap it.
    const code = decodeEmojiCode(raw) || raw;
    const name = nameInput?.value.trim() || '';
    const submitBtn = $('#chat-add-submit', overlayEl);
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await apiFetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not add contact');
      if (input) input.value = '';
      if (nameInput) nameInput.value = '';
      await refreshContacts();
      closeAddOverlay();
      const added = contacts.find((c) => c.id === data.contact?.id);
      if (added) selectContact(added);
      showToastFn(`${data.contact?.name || 'Contact'} added`);
    } catch (err) {
      showToastFn(err.message || 'Could not add contact');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ---- rename-contact overlay ----
//
// The alias lives only on your side (like the one chosen when adding);
// leaving the field empty goes back to the contact's profile name.

function bindRenameOverlay() {
  if (!renameOverlayEl) return;
  $('#chat-rename-close', renameOverlayEl)?.addEventListener('click', closeRenameOverlay);
  renameOverlayEl.addEventListener('click', (event) => {
    if (event.target === renameOverlayEl) closeRenameOverlay();
  });

  $('#chat-rename-form', renameOverlayEl)?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!renameTarget) return;
    const input = $('#chat-rename-input', renameOverlayEl);
    const name = input?.value.trim() || '';
    const saveBtn = $('#chat-rename-save', renameOverlayEl);
    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/contacts/${encodeURIComponent(renameTarget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not rename contact');
      await refreshContacts();
      closeRenameOverlay();
      // The "Send to X" button and the empty-thread text carry the name too.
      if (activeContact?.id === data.contact?.id) {
        onModeChangeFn(activeContact);
        renderThread();
      }
      showToastFn(`Saved as ${data.contact?.name || 'Contact'}`);
    } catch (err) {
      showToastFn(err.message || 'Could not rename contact');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

function openRenameOverlay(contact) {
  if (!renameOverlayEl || !contact) return;
  renameTarget = contact;
  const input = $('#chat-rename-input', renameOverlayEl);
  if (input) input.value = contact.name || '';
  renameOverlayEl.hidden = false;
  input?.focus();
  input?.select();
}

function closeRenameOverlay() {
  if (renameOverlayEl) renameOverlayEl.hidden = true;
  renameTarget = null;
}

function openAddOverlay() {
  if (!overlayEl) return;
  const codeEl = $('#chat-my-code', overlayEl);
  if (codeEl) codeEl.textContent = myCode || '········';
  overlayEl.hidden = false;
  $('#chat-add-code', overlayEl)?.focus();
}

function closeAddOverlay() {
  if (overlayEl) overlayEl.hidden = true;
}

// ---- thread ----

async function loadThread() {
  if (!activeContact) return;
  const contactId = activeContact.id;
  try {
    const res = await apiFetch(`/api/chat/messages?with=${encodeURIComponent(contactId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load messages');
    if (activeContact?.id !== contactId) return;
    messages = Array.isArray(data.messages) ? data.messages : [];
    renderThread({ stick: true });
    const last = messages.at(-1);
    if (last) markSeen(contactId, last.id);
  } catch (err) {
    if (activeContact?.id === contactId) {
      threadEl.innerHTML = `<p class="chat-thread-loading">${escapeHtml(err.message || 'Could not load messages')}</p>`;
    }
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { void pollNewMessages(); }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function pollNewMessages() {
  if (!activeContact || pollBusy || document.visibilityState !== 'visible') return;
  pollBusy = true;
  const contactId = activeContact.id;
  try {
    const after = messages.at(-1)?.id;
    const url = `/api/chat/messages?with=${encodeURIComponent(contactId)}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await apiFetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (activeContact?.id !== contactId) return;
    const incoming = (data.messages || []).filter((msg) => !messages.some((m) => m.id === msg.id));
    if (incoming.length) {
      messages.push(...incoming);
      renderThread({ stick: true });
      markSeen(contactId, messages.at(-1).id);
    }
  } catch { /* transient network error — next tick retries */ } finally {
    pollBusy = false;
  }
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function renderThread({ stick = false } = {}) {
  if (!threadEl || !activeContact) return;
  const me = myUserId();
  const nearBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 80;

  if (!messages.length) {
    threadEl.innerHTML = `<p class="chat-thread-loading">No messages with ${escapeHtml(activeContact.name)} yet — say hi. Messages disappear after 48 hours.</p>`;
    return;
  }

  threadEl.innerHTML = '<p class="chat-thread-note">Messages disappear after 48 hours</p>';
  for (const msg of messages) {
    const mine = msg.from === me;
    const item = document.createElement('div');
    item.className = `chat-msg ${mine ? 'is-mine' : 'is-theirs'}`;
    item.dataset.messageId = msg.id;
    item.innerHTML = `
      <div class="chat-msg-bubble">
        <p class="chat-msg-text">${escapeHtml(msg.text)}</p>
        <div class="chat-msg-meta">
          <button type="button" class="chat-msg-play" aria-label="Play message" title="Play">${PLAY_SVG}</button>
          <span class="chat-msg-time">${formatTime(msg.createdAt)}</span>
        </div>
      </div>
    `;
    item.querySelector('.chat-msg-play')?.addEventListener('click', (event) => {
      void playChatMessage(msg, event.currentTarget);
    });
    threadEl.appendChild(item);
  }

  if (stick || nearBottom) {
    threadEl.scrollTop = threadEl.scrollHeight;
  }
}

// ---- audio ----

function stopChatAudio() {
  if (!chatPlayback) return;
  try { chatPlayback.audio.pause(); } catch { /* already stopped */ }
  chatPlayback = null;
  refreshPlayButtons();
}

function refreshPlayButtons() {
  if (!threadEl) return;
  for (const btn of threadEl.querySelectorAll('.chat-msg-play')) {
    const id = btn.closest('.chat-msg')?.dataset.messageId;
    const playing = chatPlayback?.messageId === id;
    btn.innerHTML = playing ? STOP_SVG : PLAY_SVG;
    btn.classList.toggle('is-playing', playing);
  }
}

// Plays a message in the SENDER's voice (their clone when available). The
// server resolves the voice from speakerId, which must be a contact.
async function playChatMessage(msg, btn) {
  if (chatPlayback?.messageId === msg.id) {
    stopChatAudio();
    return;
  }
  stopChatAudio();

  btn.disabled = true;
  try {
    let url = audioUrlCache.get(msg.id);
    if (!url) {
      const res = await apiFetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg.text,
          lang: msg.targetLang,
          speakerId: msg.from,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not load the audio');
      }
      url = URL.createObjectURL(await res.blob());
      audioUrlCache.set(msg.id, url);
    }

    const audio = new Audio(url);
    chatPlayback = { audio, messageId: msg.id };
    audio.addEventListener('ended', () => {
      if (chatPlayback?.audio === audio) chatPlayback = null;
      refreshPlayButtons();
    });
    audio.addEventListener('error', () => {
      if (chatPlayback?.audio === audio) chatPlayback = null;
      refreshPlayButtons();
    });
    await audio.play();
    refreshPlayButtons();
  } catch (err) {
    showToastFn(err.message || 'Could not play the audio');
  } finally {
    btn.disabled = false;
  }
}
