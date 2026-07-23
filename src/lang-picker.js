import { createTypingCaret, measureCharCell, measureCompactCharCell, positionBlockCaret, positionCompactCaret } from './caret-style.js';
import {
  buildLanguageSquareHtml,
  formatLanguageFlagHtml,
  getLanguageDisplayName,
  getLanguageFlag,
} from './language-flags.js';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LANGUAGE_ROW_SIZE = 3;

function groupItemsInRows(items, rowSize) {
  const rows = [];
  for (let index = 0; index < items.length; index += rowSize) {
    rows.push({
      capacity: rowSize,
      items: items.slice(index, index + rowSize),
    });
  }
  return rows;
}

export function buildNumberedSquareHtml(label, { extraClass = '' } = {}) {
  const className = ['lang-picker-square', extraClass].filter(Boolean).join(' ');
  return `
    <span class="${className}">
      <span class="lang-picker-square-label">${escapeHtml(String(label))}</span>
    </span>
  `.trim();
}

function buildEditableSquareOptionHtml(key, value, maxLength) {
  return `
    <div class="lang-picker-bar-field lang-picker-square-option-edit-field">
      <div class="lang-picker-square lang-picker-square-option-edit-square is-editing">
        <div class="compose-caret-mirror lang-picker-caret-mirror" aria-hidden="true"></div>
        <span class="compose-caret lang-picker-caret" aria-hidden="true" hidden></span>
        <input
          type="text"
          class="lang-picker-bar-input lang-picker-square-option-edit-input"
          data-edit-key="${escapeHtml(String(key))}"
          value="${escapeHtml(String(value))}"
          maxlength="${maxLength}"
          autocomplete="off"
          spellcheck="false"
          aria-label="Edit user name"
        />
      </div>
    </div>
  `.trim();
}

function renderSquareOption(lang, selectedCode, { highlightSelected = true } = {}) {
  const isSelected = highlightSelected && lang.code === selectedCode;
  return `
    <button
      type="button"
      class="lang-picker-square-option${isSelected ? ' selected' : ''}"
      data-code="${escapeHtml(lang.code)}"
      role="option"
      aria-label="${escapeHtml(lang.name)}"
      aria-selected="${isSelected ? 'true' : 'false'}"
    >
      ${buildLanguageSquareHtml(lang.code, lang.name)}
    </button>
  `.trim();
}

const LANGUAGE_SEARCH_ALIASES = {
  th: ['thai', 'tailand', 'tailandés', 'tailandes', 'ไทย'],
  zh: ['chinese', 'chino', 'mandarin', '中文'],
  ja: ['japanese', 'japonés', 'japones', '日本語'],
  ko: ['korean', 'coreano', '한국어'],
  ar: ['arabic', 'árabe', 'arabe', 'عربي'],
  es: ['spanish', 'español', 'espanol', 'castellano'],
  en: ['english', 'inglés', 'ingles'],
  pt: ['portuguese', 'portugués', 'portugues'],
  fr: ['french', 'francés', 'frances'],
  de: ['german', 'alemán', 'aleman'],
  it: ['italian', 'italiano'],
  ru: ['russian', 'ruso'],
  hi: ['hindi'],
  vi: ['vietnamese', 'vietnamita'],
};

const langPickerRegistry = [];
const openCirclePanels = new Set();
const MAX_BAR_DROPDOWN_OPTIONS = 12;
const BAR_SEARCH_MAX_CHARS = 8;

function clampCaretHorizontal(caret, frameEl, padding = 3) {
  const width = frameEl.clientWidth;
  const caretWidth = parseFloat(caret.style.width) || 8;
  const left = Math.max(padding, Math.min(parseFloat(caret.style.left) || 0, width - caretWidth - padding));
  caret.style.left = `${left}px`;
}

function positionBarSearchCaret(caret, { input, frame, mirror, markerRect, style }) {
  const fieldRect = frame.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  const { lineHeight, fontSize } = measureCompactCharCell(mirror, style);

  positionCompactCaret(caret, {
    left: markerRect.left - fieldRect.left,
    fieldTop: fieldRect.top,
    inputTop: inputRect.top,
    inputHeight: inputRect.height,
    lineHeight,
    fontSize,
  });
}

function languageMatchesQuery(lang, q) {
  const code = lang.code.toLowerCase();
  const name = lang.name.toLowerCase();
  const nameFirst = name.charAt(0);

  if (name.startsWith(q)) return true;

  if (code.startsWith(q)) {
    // ISO codes like es/el share a leading "e" with English but names start with S/G.
    // Allow code prefix only for 2+ chars, or when code and name share the same first letter.
    if (q.length >= 2 || code.charAt(0) === nameFirst) return true;
  }

  const aliases = LANGUAGE_SEARCH_ALIASES[lang.code];
  if (!aliases) return false;

  // Aliases must prefix-match and start with the same letter as the language name
  // (avoids "i" matching English via "ingles", etc.).
  return aliases.some((alias) => alias.startsWith(q) && alias.charAt(0) === nameFirst);
}

window.addEventListener('lingo:close-lang-pickers', () => {
  closeAllCirclePanels();
});

function closeAllCirclePanels(except = null) {
  for (const close of openCirclePanels) {
    if (close !== except) close();
  }
}

export function hideAllLangPickerCarets() {
  for (const entry of langPickerRegistry) {
    entry.hideCaret?.();
  }
}

export function createLangPicker(container, options = {}) {
  return createBarSearchLangPicker(container, options);
}

function createBarSearchLangPicker(container, {
  languages: initialLanguages = [],
  value,
  onChange,
  onFocusEdit,
  closeProfileOnOpen = true,
  placeholder = '',
} = {}) {
  let languages = [...initialLanguages];
  let selectedCode = value || '';
  let closePanel = () => {};

  const root = document.createElement('div');
  root.className = 'lang-picker lang-picker--square lang-picker--in-bar lang-picker--search';

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'lang-picker-bar-field';

  const frame = document.createElement('div');
  frame.className = 'lang-picker-square';

  const mirror = document.createElement('div');
  mirror.className = 'compose-caret-mirror lang-picker-caret-mirror';
  mirror.setAttribute('aria-hidden', 'true');

  const caret = document.createElement('span');
  caret.className = 'compose-caret lang-picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lang-picker-bar-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', 'Search language');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-haspopup', 'listbox');
  input.maxLength = BAR_SEARCH_MAX_CHARS;

  const dropdown = document.createElement('div');
  dropdown.className = 'lang-picker-bar-dropdown';
  dropdown.hidden = true;

  const list = document.createElement('div');
  list.className = 'lang-picker-square-grid';
  list.setAttribute('role', 'listbox');

  dropdown.append(list);
  frame.append(mirror, caret, input);
  fieldWrap.append(frame);
  root.append(fieldWrap, dropdown);
  container.appendChild(root);

  const entry = {
    hideCaret() {
      caret.hidden = true;
      frame.classList.remove('is-editing');
    },
  };
  langPickerRegistry.push(entry);
  const typingCaret = createTypingCaret(caret);

  function findLang(code) {
    return languages.find((l) => l.code === code);
  }

  function filteredLanguages() {
    const q = input.value.trim().toLowerCase();
    if (!q) return [];
    const sorted = [...languages].sort((a, b) => a.name.localeCompare(b.name));
    return sorted.filter((lang) => languageMatchesQuery(lang, q));
  }

  function positionDropdown() {
    const anchor = root.closest('.user-profile-voice-lang-anchor')
      || document.querySelector('.language-bar');
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom}px`;
  }

  function syncCaret() {
    const focused = document.activeElement === input;
    frame.classList.toggle('is-editing', focused);

    if (!focused) {
      caret.hidden = true;
      typingCaret.reset();
      return;
    }

    caret.hidden = false;
    // The mirror's text metrics track the input via CSS
    // (.lang-picker-bar-field .lang-picker-caret-mirror).
    const style = getComputedStyle(input);

    const caretPos = input.selectionStart ?? input.value.length;
    const textBefore = input.value.slice(0, caretPos);
    const textAfter = input.value.slice(caretPos);

    mirror.replaceChildren();
    mirror.append(document.createTextNode(textBefore));
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.append(marker);
    if (textAfter) mirror.append(document.createTextNode(textAfter));

    const markerRect = marker.getBoundingClientRect();

    positionBarSearchCaret(caret, { input, frame, mirror, markerRect, style });
    clampCaretHorizontal(caret, frame);
  }

  function renderDropdown() {
    const items = filteredLanguages();
    const show = items.length > 0 && items.length <= MAX_BAR_DROPDOWN_OPTIONS;
    dropdown.toggleAttribute('hidden', !show);
    input.setAttribute('aria-expanded', String(show));

    if (!show) {
      list.innerHTML = '';
      return;
    }

    const visible = items.slice(0, MAX_BAR_DROPDOWN_OPTIONS);
    const rows = groupItemsInRows(visible, LANGUAGE_ROW_SIZE);
    list.innerHTML = rows
      .map(({ capacity, items: rowItems }) => `
        <div
          class="lang-picker-square-row lang-picker-square-row--${capacity}"
          role="presentation"
        >
          ${rowItems.map((lang) => renderSquareOption(lang, selectedCode, { highlightSelected: false })).join('')}
        </div>
      `)
      .join('');
    positionDropdown();
  }

  function showSelectedDisplay() {
    const lang = findLang(selectedCode);
    input.value = lang ? getLanguageDisplayName(lang.code, lang.name) : '';
    input.placeholder = lang ? '' : placeholder;
    frame.classList.remove('is-editing');
    dropdown.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    list.innerHTML = '';
    syncCaret();
  }

  function setDropdownOpen(open) {
    if (open && closeProfileOnOpen) {
      window.dispatchEvent(new CustomEvent('lingo:close-profile-menu'));
    }
    if (open) {
      closeAllCirclePanels(closePanel);
      positionDropdown();
    } else {
      dropdown.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  }

  closePanel = () => {
    showSelectedDisplay();
    input.blur();
  };

  function beginEditing() {
    hideAllLangPickerCarets();
    onFocusEdit?.();
    setDropdownOpen(true);
    input.value = '';
    input.placeholder = '';
    renderDropdown();
    requestAnimationFrame(() => {
      input.setSelectionRange(0, 0);
      syncCaret();
    });
  }

  function select(code) {
    if (!code) return;
    if (code !== selectedCode) {
      selectedCode = code;
      onChange(code);
    }
    showSelectedDisplay();
    input.blur();
  }

  input.addEventListener('focus', () => {
    beginEditing();
  });

  input.addEventListener('input', () => {
    renderDropdown();
    typingCaret.pulse();
    syncCaret();
  });

  input.addEventListener('keydown', (e) => {
    typingCaret.pulse();
    const options = [...list.querySelectorAll('.lang-picker-square-option')];
    if (e.key === 'Escape') {
      closePanel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options.length) {
        select(options[0].dataset.code);
      } else {
        closePanel();
      }
    }
  });

  input.addEventListener('keyup', syncCaret);
  input.addEventListener('click', () => {
    typingCaret.pulse();
    syncCaret();
  });
  input.addEventListener('select', syncCaret);

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) {
        showSelectedDisplay();
      }
    }, 120);
  });

  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });

  list.addEventListener('click', (e) => {
    const option = e.target.closest('.lang-picker-square-option');
    if (option) select(option.dataset.code);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target) && !dropdown.contains(event.target)) {
      closePanel();
    }
  });

  window.addEventListener('resize', () => {
    if (!dropdown.hidden) positionDropdown();
  });

  window.addEventListener('scroll', () => {
    if (!dropdown.hidden) positionDropdown();
  }, true);

  openCirclePanels.add(closePanel);

  function setValue(code) {
    selectedCode = code || '';
    showSelectedDisplay();
  }

  function setLanguages(nextLanguages) {
    languages = Array.isArray(nextLanguages) ? [...nextLanguages] : [];
    if (selectedCode && !findLang(selectedCode)) {
      selectedCode = languages[0]?.code || '';
      if (selectedCode) onChange(selectedCode);
    }
    showSelectedDisplay();
    if (document.activeElement === input) renderDropdown();
  }

  showSelectedDisplay();

  return { setValue, getValue: () => selectedCode, setLanguages };
}

export function createCollapsibleNumberedSquareGrid(container, {
  count = 11,
  items = null,
  value = null,
  open = false,
  panelContainer = null,
  onOpenChange,
  getTriggerHtml,
  onChange,
  onOptionAction,
  onOptionActivate,
  customOptions = {},
  getOptionEditValue = null,
  onOptionEditSave = null,
  maxEditLength = 48,
  signal = null,
} = {}) {
  let selected = value;
  let expanded = open;
  let editingKey = null;
  let menuItems = items;
  const optionEditEnabled = typeof getOptionEditValue === 'function' && typeof onOptionEditSave === 'function';
  const listenOpts = signal ? { signal } : undefined;

  const root = document.createElement('div');
  root.className = 'lang-picker-collapsible-numbered-grid lang-picker-collapsible-numbered-grid--square';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lang-picker-collapsible-user-trigger lang-picker-collapsible-square-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const panel = document.createElement('div');
  panel.className = 'lang-picker-collapsible-user-panel lang-picker-collapsible-square-panel';
  panel.hidden = !expanded;

  const list = document.createElement('div');
  list.className = 'lang-picker-square-grid';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'User options');

  panel.append(list);
  root.append(trigger);
  container.appendChild(root);
  (panelContainer || root).appendChild(panel);

  function getMenuItems() {
    if (Array.isArray(menuItems) && menuItems.length) return menuItems;
    return Array.from({ length: count }, (_, index) => ({ key: index + 1 }));
  }

  function resolveMenuItem(key) {
    const normalized = String(key);
    const fromItems = getMenuItems().find((item) => String(item.key) === normalized);
    if (fromItems) return fromItems;
    const numeric = Number(normalized);
    return customOptions[numeric] || customOptions[normalized] || null;
  }

  function parseOptionKey(rawKey) {
    if (rawKey === 'add') return 'add';
    const numeric = Number(rawKey);
    if (Number.isNaN(numeric)) return null;
    return numeric;
  }

  function syncTrigger() {
    trigger.innerHTML = getTriggerHtml?.({ selected, expanded }) ?? '';
    trigger.setAttribute('aria-expanded', String(expanded));
    trigger.setAttribute(
      'aria-label',
      selected ? `User ${selected}, ${expanded ? 'collapse' : 'expand'} menu` : `User menu, ${expanded ? 'collapse' : 'expand'}`,
    );
    root.classList.toggle('is-expanded', expanded);
  }

  function setExpanded(next) {
    if (!next && editingKey !== null) {
      finishEditing(true);
    }
    expanded = next;
    panel.hidden = !expanded;
    if (panelContainer) panelContainer.hidden = !expanded;
    syncTrigger();
    if (expanded) renderList();
    onOpenChange?.(expanded);
  }

  function clampGridEditCaret(caret, frameEl, padding = 3) {
    const width = frameEl.clientWidth;
    const caretWidth = parseFloat(caret.style.width) || 8;
    const left = Math.max(padding, Math.min(parseFloat(caret.style.left) || 0, width - caretWidth - padding));
    caret.style.left = `${left}px`;
  }

  function syncGridEditCaret(input, frame, mirror, caret, typingCaret) {
    const focused = document.activeElement === input;
    frame.classList.toggle('is-editing', focused);

    if (!focused) {
      caret.hidden = true;
      typingCaret.reset();
      return;
    }

    caret.hidden = false;
    // The mirror's text metrics track the input via CSS
    // (.lang-picker-square-option-edit-square .lang-picker-caret-mirror).
    const style = getComputedStyle(input);

    const caretPos = input.selectionStart ?? input.value.length;
    const textBefore = input.value.slice(0, caretPos);
    const textAfter = input.value.slice(caretPos);

    mirror.replaceChildren();
    mirror.append(document.createTextNode(textBefore));
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.append(marker);
    if (textAfter) mirror.append(document.createTextNode(textAfter));

    const fieldRect = frame.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const { lineHeight, fontSize } = measureCompactCharCell(mirror, style);

    positionCompactCaret(caret, {
      left: markerRect.left - fieldRect.left,
      fieldTop: fieldRect.top,
      inputTop: inputRect.top,
      inputHeight: inputRect.height,
      lineHeight,
      fontSize,
    });
    clampGridEditCaret(caret, frame);
    typingCaret.pulse();
  }

  function renderList() {
    const menuItems = getMenuItems();
    const rows = groupItemsInRows(menuItems.map((item) => item.key), LANGUAGE_ROW_SIZE);
    list.innerHTML = rows
      .map(({ capacity, items: rowItems }) => `
        <div
          class="lang-picker-square-row lang-picker-square-row--${capacity}"
          role="presentation"
        >
          ${rowItems.map((key) => {
            const item = resolveMenuItem(key) || { key };
            const ariaLabel = item.ariaLabel ?? String(key);
            const symbol = item.symbol;
            const isSelected = String(selected) === String(key);
            const isEditing = optionEditEnabled && editingKey !== null && String(editingKey) === String(key);
            if (isEditing) {
              const editValue = getOptionEditValue(key) ?? symbol ?? String(key);
              return `
            <div
              class="lang-picker-square-option selected is-editing"
              data-value="${escapeHtml(String(key))}"
              role="option"
              aria-label="${escapeHtml(ariaLabel)}"
              aria-selected="true"
            >
              ${buildEditableSquareOptionHtml(key, editValue, maxEditLength)}
            </div>
          `;
            }
            const innerHtml = item.html ?? buildNumberedSquareHtml(symbol ?? key);
            return `
            <button
              type="button"
              class="lang-picker-square-option${isSelected ? ' selected' : ''}${item.menuClass ? ` ${item.menuClass}` : ''}"
              data-value="${escapeHtml(String(key))}"
              role="option"
              aria-label="${escapeHtml(ariaLabel)}"
              aria-selected="${isSelected ? 'true' : 'false'}"
            >
              ${innerHtml}
            </button>
          `;
          }).join('')}
        </div>
      `)
      .join('');
    list.hidden = menuItems.length === 0;
    bindEditInput();
  }

  function bindEditInput() {
    if (editingKey === null) return;
    const input = list.querySelector('.lang-picker-square-option-edit-input');
    const frame = list.querySelector('.lang-picker-square-option-edit-square');
    const mirror = list.querySelector('.lang-picker-square-option-edit-square .lang-picker-caret-mirror');
    const caret = list.querySelector('.lang-picker-square-option-edit-square .lang-picker-caret');
    if (!input || !frame || !mirror || !caret || input.dataset.bound === '1') return;
    input.dataset.bound = '1';

    const typingCaret = createTypingCaret(caret);
    const syncCaret = () => syncGridEditCaret(input, frame, mirror, caret, typingCaret);

    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finishEditing(true);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        editingKey = null;
        renderList();
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        if (editingKey !== null && document.activeElement !== input) {
          finishEditing(true);
        }
      }, 0);
    });

    ['input', 'keyup', 'click', 'select'].forEach((eventName) => {
      input.addEventListener(eventName, syncCaret);
    });

    window.requestAnimationFrame(() => {
      input.focus();
      const len = input.value.length;
      try {
        input.setSelectionRange(len, len);
      } catch {
        // ignore if unsupported
      }
      syncCaret();
    });
  }

  function finishEditing(save) {
    if (editingKey === null) return;
    const key = editingKey;
    const input = list.querySelector('.lang-picker-square-option-edit-input');
    const value = input?.value ?? '';
    editingKey = null;
    if (save) {
      onOptionEditSave?.(key, value);
    }
    renderList();
    syncTrigger();
  }

  function startEditing(rawKey) {
    if (!optionEditEnabled) {
      onOptionActivate?.(rawKey);
      return;
    }
    const next = parseOptionKey(rawKey);
    if (next === null || next === 'add') return;
    if (String(selected) !== String(next)) {
      selected = next;
      onChange?.(next);
    }
    editingKey = next;
    renderList();
    syncTrigger();
  }

  function isEventInsidePicker(event) {
    const target = event.target;
    if (root.contains(target)) return true;
    if (panelContainer?.contains(target)) return true;
    return false;
  }

  function select(rawKey) {
    if (editingKey !== null) {
      finishEditing(true);
    }
    const next = parseOptionKey(rawKey);
    if (next === null) return;
    if (onOptionAction?.(next)) {
      return;
    }
    selected = next;
    onChange?.(next);
    renderList();
    syncTrigger();
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    setExpanded(!expanded);
  }, listenOpts);

  list.addEventListener('click', (event) => {
    event.stopPropagation();
    if (event.target.closest('.lang-picker-square-option-edit-input')) return;

    const option = event.target.closest('.lang-picker-square-option');
    if (!option) return;
    const rawKey = option.dataset.value;
    if (rawKey === 'add') {
      select(rawKey);
      return;
    }

    const next = parseOptionKey(rawKey);
    if (next === null) return;

    if (String(selected) === String(next)) {
      if (optionEditEnabled && String(editingKey) !== String(next)) {
        startEditing(rawKey);
      } else if (!optionEditEnabled) {
        onOptionActivate?.(next);
      }
      return;
    }

    select(rawKey);
  }, listenOpts);

  list.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  }, listenOpts);

  document.addEventListener('pointerdown', (event) => {
    if (!expanded) return;
    if (isEventInsidePicker(event)) return;
    if (event.target.closest('#user-profile-grid-back, #user-profile-voice-samples-back')) return;
    if (editingKey !== null) {
      finishEditing(true);
    }
    setExpanded(false);
  }, listenOpts);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation();
      setExpanded(false);
      trigger.focus();
    }
  }, listenOpts);

  syncTrigger();
  if (panelContainer) panelContainer.hidden = !expanded;
  if (expanded) renderList();

  return {
    setValue: (next) => {
      selected = next;
      renderList();
      syncTrigger();
    },
    getValue: () => selected,
    refresh: () => {
      renderList();
      syncTrigger();
    },
    setItems: (nextItems) => {
      menuItems = nextItems;
      renderList();
      syncTrigger();
    },
    refreshTrigger: syncTrigger,
    setExpanded,
    isExpanded: () => expanded,
    close: () => setExpanded(false),
    startOptionEdit: (rawKey) => startEditing(rawKey),
    finishOptionEdit: () => finishEditing(true),
    isOptionEditing: () => editingKey !== null,
  };
}
