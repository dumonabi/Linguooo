import { createTypingCaret, measureCharCell, measureCompactCharCell, positionBlockCaret, positionCompactCaret } from './caret-style.js';
import {
  buildLanguageCircleHtml,
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

const WATCH_ROW_SIZES = [3, 4];
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

function buildNumberedCircleHtml(number, { symbol } = {}) {
  const label = symbol ?? String(number);
  const labelClass = symbol ? ' lang-picker-circle-label--symbol' : '';
  return `
    <span class="lang-picker-circle">
      <span class="lang-picker-circle-bg lang-picker-circle-bg--empty" aria-hidden="true"></span>
      <span class="lang-picker-circle-label${labelClass}">${escapeHtml(label)}</span>
    </span>
  `.trim();
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

function groupLanguagesForWatchGrid(items) {
  const rows = [];
  let index = 0;
  let patternIndex = 0;
  while (index < items.length) {
    const capacity = WATCH_ROW_SIZES[patternIndex % WATCH_ROW_SIZES.length];
    rows.push({
      capacity,
      items: items.slice(index, index + capacity),
    });
    index += capacity;
    patternIndex += 1;
  }
  return rows;
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
  const { charWidth, lineHeight, fontSize } = measureCompactCharCell(mirror, style);

  positionCompactCaret(caret, {
    left: markerRect.left - fieldRect.left,
    fieldTop: fieldRect.top,
    inputTop: inputRect.top,
    inputHeight: inputRect.height,
    charWidth,
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
  if (options.circle && options.inBar) {
    return createBarSearchLangPicker(container, options);
  }
  if (options.circle) {
    return createCircleLangPicker(container, options);
  }
  return createClassicLangPicker(container, options);
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
    const style = getComputedStyle(input);
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.font = style.font;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.textAlign = style.textAlign;
    mirror.style.padding = style.padding;
    mirror.style.border = 'none';
    mirror.style.boxSizing = style.boxSizing;

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

function createCircleLangPicker(container, {
  languages: initialLanguages = [],
  value,
  onChange,
  onFocusEdit,
  closeProfileOnOpen = true,
  inBar = false,
} = {}) {
  let languages = [...initialLanguages];
  let selectedCode = value || '';
  let closePanel = () => {};

  const root = document.createElement('div');
  root.className = `lang-picker lang-picker--square${inBar ? ' lang-picker--in-bar' : ''}`;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lang-picker-square-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const panel = document.createElement('div');
  panel.className = 'lang-picker-square-panel';
  panel.hidden = true;

  const list = document.createElement('div');
  list.className = 'lang-picker-square-grid';
  list.setAttribute('role', 'listbox');

  panel.append(list);
  root.append(trigger, panel);
  container.appendChild(root);

  langPickerRegistry.push({});

  function findLang(code) {
    return languages.find((l) => l.code === code);
  }

  function sortedLanguages() {
    return [...languages].sort((a, b) => a.name.localeCompare(b.name));
  }

  function syncTrigger() {
    const lang = findLang(selectedCode);
    trigger.innerHTML = lang
      ? buildLanguageSquareHtml(lang.code, lang.name)
      : buildLanguageSquareHtml('', '', { extraClass: 'lang-picker-square--empty' });
    trigger.setAttribute('aria-label', lang?.name || 'Choose language');
  }

  function setPanelOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      if (closeProfileOnOpen) {
        window.dispatchEvent(new CustomEvent('lingo:close-profile-menu'));
      }
      closeAllCirclePanels(closePanel);
      renderList();
    }
  }

  closePanel = () => setPanelOpen(false);

  function renderList() {
    const items = sortedLanguages();
    const rows = groupItemsInRows(items, LANGUAGE_ROW_SIZE);
    list.innerHTML = rows
      .map(({ capacity, items: rowItems }) => `
        <div
          class="lang-picker-square-row lang-picker-square-row--${capacity}"
          role="presentation"
        >
          ${rowItems.map((lang) => renderSquareOption(lang, selectedCode)).join('')}
        </div>
      `)
      .join('');
    list.hidden = items.length === 0;
  }

  function select(code) {
    if (!code) return;
    if (code !== selectedCode) {
      selectedCode = code;
      onChange(code);
    }
    syncTrigger();
    setPanelOpen(false);
    trigger.focus();
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    onFocusEdit?.();
    setPanelOpen(panel.hidden);
  });

  list.addEventListener('click', (event) => {
    const option = event.target.closest('.lang-picker-square-option');
    if (option) select(option.dataset.code);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) setPanelOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopPropagation();
      setPanelOpen(false);
      trigger.focus();
    }
  });

  openCirclePanels.add(closePanel);

  function setValue(code) {
    selectedCode = code || '';
    syncTrigger();
  }

  function setLanguages(nextLanguages) {
    languages = Array.isArray(nextLanguages) ? [...nextLanguages] : [];
    if (selectedCode && !findLang(selectedCode)) {
      selectedCode = languages[0]?.code || '';
      if (selectedCode) onChange(selectedCode);
    }
    syncTrigger();
    if (!panel.hidden) renderList();
  }

  syncTrigger();

  return { setValue, getValue: () => selectedCode, setLanguages };
}

export function createNumberedCirclePicker(container, {
  count = 20,
  value = null,
  onChange,
  onOptionAction,
  onFocusEdit,
  triggerHtml = '',
  getTriggerHtml = null,
  customOptions = {},
} = {}) {
  let selected = value;
  let closePanel = () => {};

  const root = document.createElement('div');
  root.className = 'lang-picker lang-picker--circle';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lang-picker-circle-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const panel = document.createElement('div');
  panel.className = 'lang-picker-circle-panel';
  panel.hidden = true;

  const list = document.createElement('div');
  list.className = 'lang-picker-circle-grid';
  list.setAttribute('role', 'listbox');

  panel.append(list);
  root.append(trigger, panel);
  container.appendChild(root);

  function syncTrigger() {
    trigger.innerHTML = getTriggerHtml?.() ?? triggerHtml;
    trigger.setAttribute('aria-label', selected ? `User menu, option ${selected}` : 'User menu');
  }

  function setPanelOpen(open) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      closeAllCirclePanels(closePanel);
      renderList();
    }
  }

  closePanel = () => setPanelOpen(false);

  function renderList() {
    const menuNumbers = Array.from({ length: count }, (_, index) => index + 1);
    const rows = groupLanguagesForWatchGrid(menuNumbers);
    list.innerHTML = rows
      .map(({ capacity, items: rowItems }) => `
        <div
          class="lang-picker-circle-row lang-picker-circle-row--${capacity}"
          role="presentation"
        >
          ${rowItems.map((number) => {
            const option = customOptions[number];
            const ariaLabel = option?.ariaLabel ?? String(number);
            const symbol = option?.symbol;
            const innerHtml = option?.html ?? buildNumberedCircleHtml(number, { symbol });
            return `
            <button
              type="button"
              class="lang-picker-circle-option${number === selected ? ' selected' : ''}"
              data-value="${number}"
              role="option"
              aria-label="${escapeHtml(ariaLabel)}"
              aria-selected="${number === selected ? 'true' : 'false'}"
            >
              ${innerHtml}
            </button>
          `;
          }).join('')}
        </div>
      `)
      .join('');
    list.hidden = menuNumbers.length === 0;
  }

  function select(number) {
    const next = Number(number);
    if (!next) return;
    if (onOptionAction?.(next)) {
      setPanelOpen(false);
      trigger.focus();
      return;
    }
    selected = next;
    onChange?.(next);
    syncTrigger();
    setPanelOpen(false);
    trigger.focus();
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    onFocusEdit?.();
    setPanelOpen(panel.hidden);
  });

  list.addEventListener('click', (event) => {
    const option = event.target.closest('.lang-picker-circle-option');
    if (option) select(option.dataset.value);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) setPanelOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopPropagation();
      setPanelOpen(false);
      trigger.focus();
    }
  });

  openCirclePanels.add(closePanel);
  syncTrigger();

  return {
    setValue: (next) => {
      selected = next;
      syncTrigger();
      if (!panel.hidden) renderList();
    },
    getValue: () => selected,
    refreshTrigger: syncTrigger,
    close: closePanel,
  };
}

export function createCollapsibleNumberedCircleGrid(container, {
  count = 20,
  items = null,
  value = null,
  open = false,
  panelContainer = null,
  onOpenChange,
  getTriggerHtml,
  onChange,
  onOptionAction,
  customOptions = {},
} = {}) {
  let selected = value;
  let expanded = open;

  const root = document.createElement('div');
  root.className = 'lang-picker-collapsible-numbered-grid';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'lang-picker-collapsible-user-trigger lang-bar-circle-slot';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const panel = document.createElement('div');
  panel.className = 'lang-picker-collapsible-user-panel';
  panel.hidden = !expanded;

  const list = document.createElement('div');
  list.className = 'lang-picker-circle-grid';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'User options');

  panel.append(list);
  root.append(trigger);
  container.appendChild(root);
  (panelContainer || root).appendChild(panel);

  function getMenuItems() {
    if (Array.isArray(items) && items.length) return items;
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
    expanded = next;
    panel.hidden = !expanded;
    if (panelContainer) panelContainer.hidden = !expanded;
    syncTrigger();
    if (expanded) renderList();
    onOpenChange?.(expanded);
  }

  function renderList() {
    const menuItems = getMenuItems();
    const rows = groupLanguagesForWatchGrid(menuItems.map((item) => item.key));
    list.innerHTML = rows
      .map(({ capacity, items: rowItems }) => `
        <div
          class="lang-picker-circle-row lang-picker-circle-row--${capacity}"
          role="presentation"
        >
          ${rowItems.map((key) => {
            const item = resolveMenuItem(key) || { key };
            const ariaLabel = item.ariaLabel ?? String(key);
            const symbol = item.symbol;
            const innerHtml = item.html ?? buildNumberedCircleHtml(key, { symbol });
            const isSelected = String(selected) === String(key);
            return `
            <button
              type="button"
              class="lang-picker-circle-option${isSelected ? ' selected' : ''}${item.menuClass ? ` ${item.menuClass}` : ''}"
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
  }

  function isEventInsidePicker(event) {
    const target = event.target;
    if (root.contains(target)) return true;
    if (panelContainer?.contains(target)) return true;
    return false;
  }

  function select(rawKey) {
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
  });

  list.addEventListener('click', (event) => {
    event.stopPropagation();
    const option = event.target.closest('.lang-picker-circle-option');
    if (option) select(option.dataset.value);
  });

  list.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('pointerdown', (event) => {
    if (expanded && !isEventInsidePicker(event)) {
      setExpanded(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) {
      event.stopPropagation();
      setExpanded(false);
      trigger.focus();
    }
  });

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
    refreshTrigger: syncTrigger,
    setExpanded,
    isExpanded: () => expanded,
    close: () => setExpanded(false),
  };
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
    const style = getComputedStyle(input);
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.font = style.font;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.textAlign = style.textAlign;
    mirror.style.padding = style.padding;
    mirror.style.border = 'none';
    mirror.style.boxSizing = style.boxSizing;

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
    const { charWidth, lineHeight, fontSize } = measureCompactCharCell(mirror, style);

    positionCompactCaret(caret, {
      left: markerRect.left - fieldRect.left,
      fieldTop: fieldRect.top,
      inputTop: inputRect.top,
      inputHeight: inputRect.height,
      charWidth,
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

export function createInlineNumberedCircleGrid(container, {
  count = 20,
  value = null,
  onChange,
  onOptionAction,
  customOptions = {},
} = {}) {
  let selected = value;

  const root = document.createElement('div');
  root.className = 'lang-picker-inline-numbered-grid';

  const list = document.createElement('div');
  list.className = 'lang-picker-circle-grid';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'User options');

  root.append(list);
  container.appendChild(root);

  function renderList() {
    const menuNumbers = Array.from({ length: count }, (_, index) => index + 1);
    const rows = groupLanguagesForWatchGrid(menuNumbers);
    list.innerHTML = rows
      .map(({ capacity, items: rowItems }) => `
        <div
          class="lang-picker-circle-row lang-picker-circle-row--${capacity}"
          role="presentation"
        >
          ${rowItems.map((number) => {
            const option = customOptions[number];
            const ariaLabel = option?.ariaLabel ?? String(number);
            const symbol = option?.symbol;
            const innerHtml = option?.html ?? buildNumberedCircleHtml(number, { symbol });
            return `
            <button
              type="button"
              class="lang-picker-circle-option${number === selected ? ' selected' : ''}"
              data-value="${number}"
              role="option"
              aria-label="${escapeHtml(ariaLabel)}"
              aria-selected="${number === selected ? 'true' : 'false'}"
            >
              ${innerHtml}
            </button>
          `;
          }).join('')}
        </div>
      `)
      .join('');
    list.hidden = menuNumbers.length === 0;
  }

  function select(number) {
    const next = Number(number);
    if (!next) return;
    if (onOptionAction?.(next)) {
      return;
    }
    selected = next;
    onChange?.(next);
    renderList();
  }

  list.addEventListener('click', (event) => {
    const option = event.target.closest('.lang-picker-circle-option');
    if (option) select(option.dataset.value);
  });

  renderList();

  return {
    setValue: (next) => {
      selected = next;
      renderList();
    },
    getValue: () => selected,
    refresh: renderList,
  };
}

function createClassicLangPicker(container, {
  languages: initialLanguages = [],
  value,
  onChange,
  placeholder = '',
  onFocusEdit,
} = {}) {
  let languages = [...initialLanguages];
  let selectedCode = value || '';

  const root = document.createElement('div');
  root.className = 'lang-picker';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'lang-picker-input-wrap';

  const field = document.createElement('div');
  field.className = 'lang-picker-field';

  const selectedRow = document.createElement('div');
  selectedRow.className = 'lang-picker-selected-row';
  selectedRow.setAttribute('aria-hidden', 'true');

  const selectedName = document.createElement('span');
  selectedName.className = 'lang-picker-selected-name';

  const selectedFlag = document.createElement('span');
  selectedFlag.className = 'lang-picker-flag';
  selectedFlag.setAttribute('aria-hidden', 'true');

  selectedRow.append(selectedName, selectedFlag);

  const mirror = document.createElement('div');
  mirror.className = 'compose-caret-mirror lang-picker-caret-mirror';
  mirror.setAttribute('aria-hidden', 'true');

  const caret = document.createElement('span');
  caret.className = 'compose-caret lang-picker-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lang-picker-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = placeholder;

  const list = document.createElement('ul');
  list.className = 'lang-picker-list';
  list.hidden = true;

  field.append(selectedRow, mirror, caret, input);
  inputWrap.append(field);
  root.append(inputWrap, list);
  container.appendChild(root);

  const entry = {
    hideCaret() {
      caret.hidden = true;
      inputWrap.classList.remove('is-editing');
      field.classList.remove('is-editing');
    },
  };
  langPickerRegistry.push(entry);
  const typingCaret = createTypingCaret(caret);

  function pulseTypingCaret() {
    typingCaret.pulse();
  }

  function findLang(code) {
    return languages.find((l) => l.code === code);
  }

  function filteredLanguages() {
    const q = input.value.trim().toLowerCase();
    const sorted = [...languages].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return sorted;
    return sorted.filter((lang) => languageMatchesQuery(lang, q));
  }

  function renderList() {
    const items = filteredLanguages();
    list.innerHTML = items
      .map((l) => {
        const label = getLanguageDisplayName(l.code, l.name);
        return `
      <li class="lang-picker-option${l.code === selectedCode ? ' selected' : ''}" data-code="${l.code}" role="option" aria-label="${escapeHtml(l.name)}">
        <span class="lang-picker-name">${escapeHtml(label)}</span>
        ${formatLanguageFlagHtml(l.code)}
      </li>`;
      })
      .join('');
    list.hidden = items.length === 0;
  }

  function syncSelectedRow() {
    const lang = findLang(selectedCode);
    selectedName.textContent = lang ? getLanguageDisplayName(lang.code, lang.name) : '';
    const flag = lang ? getLanguageFlag(lang.code) : '';
    selectedFlag.textContent = flag;
    selectedFlag.classList.toggle('lang-picker-flag--empty', !flag);
  }

  function syncCaret() {
    const focused = document.activeElement === input;
    inputWrap.classList.toggle('is-editing', focused);
    field.classList.toggle('is-editing', focused);
    inputWrap.classList.toggle('is-empty', !input.value);
    syncSelectedRow();

    if (!focused) {
      caret.hidden = true;
      typingCaret.reset();
      return;
    }

    caret.hidden = false;

    const style = getComputedStyle(input);
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.font = style.font;
    mirror.style.fontSize = style.fontSize;
    mirror.style.fontFamily = style.fontFamily;
    mirror.style.fontWeight = style.fontWeight;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.letterSpacing = style.letterSpacing;
    mirror.style.textAlign = style.textAlign;
    mirror.style.padding = '0';
    mirror.style.border = 'none';
    mirror.style.boxSizing = style.boxSizing;

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
    const fieldRect = field.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const { charWidth, lineHeight, fontSize } = measureCompactCharCell(mirror, style);

    positionCompactCaret(caret, {
      left: markerRect.left - fieldRect.left,
      fieldTop: fieldRect.top,
      inputTop: inputRect.top,
      inputHeight: inputRect.height,
      charWidth,
      lineHeight,
      fontSize,
    });
  }

  function showSelectedDisplay() {
    const lang = findLang(selectedCode);
    input.value = lang ? getLanguageDisplayName(lang.code, lang.name) : '';
    input.placeholder = lang ? '' : placeholder;
    inputWrap.classList.remove('is-editing');
    field.classList.remove('is-editing');
    list.hidden = true;
    syncCaret();
  }

  function beginEditing() {
    hideAllLangPickerCarets();
    onFocusEdit?.();
    input.value = '';
    input.placeholder = '';
    renderList();
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
    renderList();
    pulseTypingCaret();
    syncCaret();
  });

  input.addEventListener('keydown', (e) => {
    pulseTypingCaret();
    const options = [...list.querySelectorAll('.lang-picker-option')];
    if (e.key === 'Escape') {
      showSelectedDisplay();
      input.blur();
    } else if (e.key === 'Enter' && options.length) {
      e.preventDefault();
      select(options[0].dataset.code);
    } else if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      options[0].focus();
    }
  });

  input.addEventListener('keyup', () => {
    pulseTypingCaret();
    syncCaret();
  });
  input.addEventListener('click', () => {
    pulseTypingCaret();
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
    const opt = e.target.closest('.lang-picker-option');
    if (opt) select(opt.dataset.code);
  });

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
    if (document.activeElement === input) renderList();
  }

  showSelectedDisplay();

  return { setValue, getValue: () => selectedCode, setLanguages };
}
