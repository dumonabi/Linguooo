export const CARET_TYPING_IDLE_MS = 700;

export function measureCharCell(mirror, style) {
  const probe = document.createElement('span');
  probe.textContent = 'Mg';
  probe.setAttribute('aria-hidden', 'true');
  mirror.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const fontSize = parseFloat(style.fontSize) || 16;
  const computedLineHeight = parseFloat(style.lineHeight);
  const lineHeight = Math.max(
    Number.isFinite(computedLineHeight) ? computedLineHeight : 0,
    rect.height,
    fontSize * 1.12,
  );
  const charWidth = rect.width / 2 || fontSize * 0.58;

  return { charWidth, lineHeight, fontSize };
}

export function measureCompactCharCell(mirror, style) {
  const fontSize = parseFloat(style.fontSize) || 16;
  const previousLineHeight = mirror.style.lineHeight;
  mirror.style.lineHeight = '1.12';

  const probe = document.createElement('span');
  probe.textContent = 'Mg';
  probe.setAttribute('aria-hidden', 'true');
  mirror.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  mirror.style.lineHeight = previousLineHeight;

  const lineHeight = Math.max(rect.height, fontSize * 1.12);
  const charWidth = rect.width / 2 || fontSize * 0.58;

  return { charWidth, lineHeight, fontSize };
}

export function positionBlockCaret(caret, { left, top, charWidth, lineHeight, markerHeight }) {
  const blockHeight = Math.max(markerHeight ?? 0, lineHeight, 12);
  const blockWidth = charWidth * 0.75;

  caret.style.left = `${left}px`;
  caret.style.top = `${top}px`;
  caret.style.width = `${blockWidth}px`;
  caret.style.height = `${blockHeight}px`;
}

export function positionCompactCaret(caret, {
  left,
  fieldTop,
  inputTop,
  inputHeight,
  charWidth,
  lineHeight,
  fontSize,
}) {
  const blockHeight = Math.min(
    Math.max(lineHeight, fontSize * 1.05, 10),
    inputHeight * 0.92,
  );
  const blockWidth = Math.max(charWidth * 0.92, fontSize * 0.14, 3);
  const top = inputTop - fieldTop + (inputHeight - blockHeight) / 2;

  caret.style.left = `${left}px`;
  caret.style.top = `${top}px`;
  caret.style.width = `${blockWidth}px`;
  caret.style.height = `${blockHeight}px`;
}

export function createTypingCaret(caretEl) {
  let idleTimer = null;

  return {
    pulse() {
      if (!caretEl) return;
      caretEl.classList.add('is-typing');
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        caretEl.classList.remove('is-typing');
      }, CARET_TYPING_IDLE_MS);
    },
    reset() {
      clearTimeout(idleTimer);
      idleTimer = null;
      caretEl?.classList.remove('is-typing');
    },
  };
}
