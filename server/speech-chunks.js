// Keep in sync with src/speech-chunks.js
//
// Long texts are synthesized in two parts so playback can start as soon as
// the first sentence/clause is ready while the rest generates in background.

const SPLIT_MIN_TOTAL = 180;
const HEAD_WINDOW = 160;
const MIN_TAIL = 40;

const SENTENCE_ENDS = ['. ', '! ', '? ', '。', '！', '？', '…', '\n'];
const CLAUSE_ENDS = [', ', '; ', ': ', '，', '、', '；', '：'];

function firstBoundary(window, marks, minIndex) {
  let best = -1;
  for (const mark of marks) {
    const idx = window.indexOf(mark, minIndex);
    if (idx < 0) continue;
    const end = idx + mark.length;
    best = best < 0 ? end : Math.min(best, end);
  }
  return best;
}

export function splitSpeechText(text) {
  const full = String(text || '').trim();
  if (full.length < SPLIT_MIN_TOTAL) return { head: full, tail: '' };

  const window = full.slice(0, HEAD_WINDOW);

  let cut = firstBoundary(window, SENTENCE_ENDS, 12);
  if (cut < 0) cut = firstBoundary(window, CLAUSE_ENDS, 60);
  if (cut < 0) {
    const space = window.lastIndexOf(' ');
    if (space >= 80) cut = space + 1;
  }
  if (cut < 0) return { head: full, tail: '' };

  const head = full.slice(0, cut).trim();
  const tail = full.slice(cut).trim();
  if (!head || tail.length < MIN_TAIL) return { head: full, tail: '' };

  return { head, tail };
}
