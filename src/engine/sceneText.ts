// Scene items as plain text, for copy and paste: one item per line, with optional
// labels so an item's state survives a round trip:
//
//   you are on a private lab network
//   [off] you found a hidden door
//   [only Ada] the butler did it

import { factActive, type SceneFact, type Speaker } from "./types.ts";

export interface ParsedFact {
  text: string;
  enabled: boolean;
  /** Speaker id for a secret. Undefined = no label, or a name nobody here has; the caller decides. */
  scope?: string;
}

const LABEL = /^\[(off|only\s+[^\]]+)\]\s*/i;
const LIST_MARKER = /^\s*(?:[-*•–—]|\d+[.)])\s+/;

/** All items, including switched-off and expired ones. Timers aren't copied. */
export function factsToText(facts: SceneFact[], speakers: Speaker[], lineCount: number): string {
  return facts
    .map((f) => {
      const owner = speakers.find((s) => s.id === f.scope)?.name;
      const off = factActive(f, lineCount) ? "" : "[off] ";
      return `${off}${owner ? `[only ${owner}] ` : ""}${f.text}`;
    })
    .join("\n");
}

/** Should a paste become scene items, rather than ordinary text in the box? */
export function isFactList(raw: string): boolean {
  const t = raw.trim();
  return /\n/.test(t) || LABEL.test(t);
}

export function parseFactList(raw: string, speakers: Speaker[]): ParsedFact[] {
  const out: ParsedFact[] = [];
  for (const line of raw.split(/\r?\n/)) {
    let text = line.replace(LIST_MARKER, "").trim();
    let enabled = true;
    let scope: string | undefined;
    for (let m = LABEL.exec(text); m; m = LABEL.exec(text)) {
      if (/^off$/i.test(m[1])) {
        enabled = false;
      } else {
        const name = m[1].replace(/^only\s+/i, "").trim().toLowerCase();
        scope = speakers.find((s) => s.name.trim().toLowerCase() === name)?.id;
      }
      text = text.slice(m[0].length);
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text) out.push({ text, enabled, scope });
  }
  return out;
}

/** Two items match if their text does, ignoring case, spacing and labels. */
export function factKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
