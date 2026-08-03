// Hiding short strings inside an emoji (Paul Butler's technique, as used by
// tip.lol): Unicode variation selectors are invisible characters that
// survive copy/paste, so appending one per payload byte after a visible
// emoji yields what looks like a single glyph but carries the data.
//
// Byte mapping: 0x00-0x0F -> VS1-16 (U+FE00-U+FE0F), 0x10-0xFF -> VS17-256
// (U+E0100-U+E01EF).

const VS_START = 0xfe00;
const VS_SUPPLEMENT_START = 0xe0100;

function byteToSelector(byte) {
  return String.fromCodePoint(byte < 16 ? VS_START + byte : VS_SUPPLEMENT_START + byte - 16);
}

function selectorToByte(codePoint) {
  if (codePoint >= VS_START && codePoint <= 0xfe0f) return codePoint - VS_START;
  if (codePoint >= VS_SUPPLEMENT_START && codePoint <= 0xe01ef) return codePoint - VS_SUPPLEMENT_START + 16;
  return null;
}

export function hideTextInEmoji(text, emoji = '\u{1F60A}') {
  let out = emoji;
  for (const byte of new TextEncoder().encode(String(text || ''))) {
    out += byteToSelector(byte);
  }
  return out;
}

// Extracts the hidden string from an emoji-wrapped payload, or returns null
// when the text carries no variation selectors. No validation beyond UTF-8;
// callers check the decoded value against their own format.
export function revealTextFromEmoji(text) {
  const bytes = [];
  for (const ch of String(text || '')) {
    const byte = selectorToByte(ch.codePointAt(0));
    if (byte != null) bytes.push(byte);
  }
  if (!bytes.length) return null;
  try {
    return new TextDecoder().decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}
