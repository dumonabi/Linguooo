export const CATALAN_FLAG_SVG = `<svg class="flag-svg flag-catalan" viewBox="0 0 27 18" aria-hidden="true"><rect fill="#FCDD09" width="27" height="18"/><rect fill="#DA121A" y="2" height="2" width="27"/><rect fill="#DA121A" y="6" height="2" width="27"/><rect fill="#DA121A" y="10" height="2" width="27"/><rect fill="#DA121A" y="14" height="2" width="27"/></svg>`;

export function renderFlag(lang, className = 'flag-icon') {
  if (!lang) return '<span class="flag-emoji">🌐</span>';
  if (lang.customFlag === 'catalan') {
    return `<span class="${className}">${CATALAN_FLAG_SVG}</span>`;
  }
  return `<span class="flag-emoji ${className}">${lang.flag || '🌐'}</span>`;
}

export function createLangPicker(container, { languages, value, onChange, placeholder }) {
  let isOpen = false;
  let query = '';
  let selectedCode = value || '';

  const root = document.createElement('div');
  root.className = 'lang-picker';

  const inputWrap = document.createElement('div');
  inputWrap.className = 'lang-picker-input-wrap';

  const flagSlot = document.createElement('span');
  flagSlot.className = 'lang-picker-flag';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'lang-picker-input';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const list = document.createElement('ul');
  list.className = 'lang-picker-list';
  list.hidden = true;

  inputWrap.append(flagSlot, input);
  root.append(inputWrap, list);
  container.appendChild(root);

  function findLang(code) {
    return languages.find((l) => l.code === code);
  }

  function updateInputDisplay() {
    const lang = findLang(selectedCode);
    flagSlot.innerHTML = lang ? renderFlag(lang) : '<span class="flag-emoji">🌐</span>';
    if (!isOpen) {
      input.value = lang ? lang.name : '';
      input.placeholder = lang ? '' : placeholder;
    }
  }

  function filteredLanguages() {
    const q = query.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
  }

  function renderList() {
    const items = filteredLanguages();
    list.innerHTML = items
      .map(
        (l) => `
      <li class="lang-picker-option${l.code === selectedCode ? ' selected' : ''}" data-code="${l.code}" role="option">
        ${renderFlag(l)}
        <span class="lang-picker-name">${l.name}</span>
      </li>`
      )
      .join('');

    list.hidden = items.length === 0 && !query;
  }

  function open() {
    isOpen = true;
    query = '';
    input.value = '';
    input.placeholder = 'Search language…';
    list.hidden = false;
    renderList();
  }

  function close() {
    isOpen = false;
    query = '';
    list.hidden = true;
    updateInputDisplay();
  }

  function select(code) {
    if (!code || code === selectedCode) {
      close();
      return;
    }
    selectedCode = code;
    close();
    onChange(code);
  }

  input.addEventListener('focus', open);

  input.addEventListener('input', () => {
    query = input.value;
    if (!isOpen) isOpen = true;
    list.hidden = false;
    renderList();
  });

  input.addEventListener('keydown', (e) => {
    const options = [...list.querySelectorAll('.lang-picker-option')];
    if (e.key === 'Escape') {
      close();
      input.blur();
    } else if (e.key === 'Enter' && options.length) {
      e.preventDefault();
      select(options[0].dataset.code);
    } else if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      options[0].focus();
    }
  });

  list.addEventListener('click', (e) => {
    const opt = e.target.closest('.lang-picker-option');
    if (opt) select(opt.dataset.code);
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });

  function setValue(code) {
    selectedCode = code || '';
    updateInputDisplay();
  }

  updateInputDisplay();

  return { setValue, getValue: () => selectedCode };
}
