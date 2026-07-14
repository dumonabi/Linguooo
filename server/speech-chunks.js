// Keep in sync with src/speech-chunks.js
//
// Long texts are synthesized in two parts so playback can start as soon as
// the first sentence/clause is ready while the rest generates in background.

const SPLIT_MIN_TOTAL = 60;
const HEAD_WINDOW = 160;
const MIN_TAIL = 25;
const MIN_SENTENCE_BOUNDARY = 12;
const MIN_CLAUSE_BOUNDARY = 40;

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

// Earliest sentence or clause boundary in the head window. Boundaries stream
// in order, so once one is seen it can never be superseded by an earlier one —
// which makes the cut stable for mid-stream synthesis.
function earliestCut(window) {
  const sentence = firstBoundary(window, SENTENCE_ENDS, MIN_SENTENCE_BOUNDARY);
  const clause = firstBoundary(window, CLAUSE_ENDS, MIN_CLAUSE_BOUNDARY);
  if (sentence < 0) return clause;
  if (clause < 0) return sentence;
  return Math.min(sentence, clause);
}

export function splitSpeechText(text) {
  const full = String(text || '').trim();
  if (full.length < SPLIT_MIN_TOTAL) return { head: full, tail: '' };

  const window = full.slice(0, HEAD_WINDOW);

  let cut = earliestCut(window);
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

// True once the head chunk of a *partial* streaming text is guaranteed to
// match the head of the final text, so it is safe to synthesize early. A
// boundary cut is stable as soon as it is seen; the whitespace fallback is
// only stable once the whole search window has streamed in.
export function headIsStable(partialText) {
  const partial = String(partialText || '').trim();
  if (!splitSpeechText(partial).tail) return false;
  if (earliestCut(partial.slice(0, HEAD_WINDOW)) >= 0) return true;
  return partial.length >= HEAD_WINDOW + MIN_TAIL;
}
