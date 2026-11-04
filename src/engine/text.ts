// Text helpers: cleaning model output for display/speech, and sentence chunking
// so speech can start before the whole reply has been generated.

const EMOJI = /\p{Extended_Pictographic}️?/gu;

/**
 * Cleans a (possibly partial) streamed reply. Must be "append-stable": cleaning a
 * longer prefix never changes characters already produced for a shorter one, so
 * spoken-offset bookkeeping stays valid while streaming.
 */
export function cleanReply(raw: string, speakerNames: string[]): string {
  let s = raw;
  // Drop a leading "Name:" / "[Name]:" / "**Name:**" the model may echo.
  const names = speakerNames.map(escapeRe).join("|");
  if (names) {
    s = s.replace(new RegExp(`^\\s*[*_]*\\[?\\s*(?:${names})\\s*\\]?[*_]*\\s*:\\s*`, "i"), "");
  }
  s = s
    .replace(/[*_`#]+/g, "") // markdown emphasis / headings / code
    .replace(EMOJI, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n");
  return s.replace(/^\s+/, "");
}

/** While streaming, the first few chars might be a name prefix still arriving. */
export function mightBeNamePrefix(raw: string): boolean {
  return raw.length < 40 && /^\s*[*_]*\[?[\p{L} .'-]*\]?[*_]*$/u.test(raw);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds complete sentences in `text` starting at `from`. Returns [start, end)
 * ranges. If `final`, the trailing remainder is returned as a last chunk.
 * Very long sentences are split at a comma/space (some browsers cut off long
 * utterances).
 */
export function takeSentences(text: string, from: number, final: boolean): [number, number][] {
  const out: [number, number][] = [];
  const boundary = /[.!?…]+["'”’)\]]*(?=\s)|\n/g;
  boundary.lastIndex = from;
  let start = from;
  let m: RegExpExecArray | null;
  while ((m = boundary.exec(text))) {
    const end = m.index + m[0].length;
    pushChunk(text, start, end, out);
    start = end;
  }
  if (!final && text.length - start > 240) {
    // A runaway sentence: speak up to the last comma/space so far.
    const cut = Math.max(text.lastIndexOf(", ", text.length - 1), text.lastIndexOf(" ", text.length - 1));
    if (cut > start + 40) {
      pushChunk(text, start, cut + 1, out);
      start = cut + 1;
    }
  }
  if (final && start < text.length) pushChunk(text, start, text.length, out);
  return out;
}

function pushChunk(text: string, start: number, end: number, out: [number, number][]) {
  if (text.slice(start, end).trim()) out.push([start, end]);
  else if (out.length) out[out.length - 1][1] = end; // fold whitespace into previous
}
