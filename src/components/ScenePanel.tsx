import { useEffect, useRef, useState } from "react";
import { SCENE_PRESETS } from "../engine/prompts.ts";
import { factsToText, isFactList, parseFactList, type ParsedFact } from "../engine/sceneText.ts";
import { factActive, type SceneFact, type Speaker } from "../engine/types.ts";

export interface NewFact {
  text: string;
  scope: string;
  announce: boolean;
  lines: number; // 0 = permanent
}

interface Props {
  facts: SceneFact[];
  speakers: Speaker[];
  lineCount: number;
  live: boolean; // a conversation exists (markers/retcons make sense)
  twisting: boolean;
  onAdd: (f: NewFact) => void;
  onPaste: (items: ParsedFact[], opts: Omit<NewFact, "text">) => { added: number; skipped: number };
  onEdit: (id: string, text: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string, retcon: boolean) => void;
  onTwist: (opts: Omit<NewFact, "text">) => void;
  onPreset: (name: string) => void;
  onClear: () => void;
}

/**
 * "Scene attributes": living facts about the speakers' world. Add, switch off,
 * or remove them at any time; they shape every prompt from the next turn on.
 */
export function ScenePanel(p: Props) {
  const [text, setText] = useState("");
  const [scope, setScope] = useState("all");
  const [announce, setAnnounce] = useState(false);
  const [lines, setLines] = useState(0);
  // On phones, start collapsed unless there's already a scene, to leave room for the conversation.
  const [open, setOpen] = useState(() => p.facts.length > 0 || typeof window === "undefined" || window.innerWidth > 720);

  const nameOf = (id: string) => p.speakers.find((s) => s.id === id)?.name ?? "?";
  const add = () => {
    const t = text.trim();
    if (!t) return;
    p.onAdd({ text: t, scope, announce, lines });
    setText("");
  };
  const activeCount = p.facts.filter((f) => factActive(f, p.lineCount)).length;

  // A short confirmation after copying or pasting.
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const copyAll = async () => {
    const n = p.facts.length;
    try {
      await navigator.clipboard.writeText(factsToText(p.facts, p.speakers, p.lineCount));
      setStatus(`Copied ${n} item${n === 1 ? "" : "s"}. Paste them into the box below, one per line.`);
    } catch {
      setStatus("Couldn't copy: this browser blocked the clipboard.");
    }
  };

  // A paste of several lines (or a labelled line) adds items; anything else is ordinary typing.
  const pasteList = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const raw = e.clipboardData.getData("text");
    if (!isFactList(raw)) return;
    e.preventDefault();
    const { added, skipped } = p.onPaste(parseFactList(raw, p.speakers), { scope, announce, lines });
    setStatus(`Added ${added} item${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} already here` : ""}.`);
  };

  // Editing one item in place. `closing` stops the blur from unmounting saving a second time, or after Esc.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const closing = useRef(false);
  const startEdit = (f: SceneFact) => {
    closing.current = false;
    setEditing({ id: f.id, draft: f.text });
  };
  const finishEdit = (save: boolean) => {
    if (closing.current || !editing) return;
    closing.current = true;
    const text = editing.draft.replace(/\s+/g, " ").trim();
    const before = p.facts.find((f) => f.id === editing.id)?.text;
    if (save && text && text !== before) p.onEdit(editing.id, text);
    setEditing(null);
  };

  return (
    <section className="scene" aria-label="Scene">
      <div className="scene-head">
        <button className="scene-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span aria-hidden>🌍</span> Scene
          <span className="count">{p.facts.length ? `${activeCount} active` : "no facts yet"}</span>
          <span className="caret" aria-hidden>{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="scene-tools">
            <select
              value=""
              aria-label="Add a scene preset"
              onChange={(e) => {
                if (e.target.value) p.onPreset(e.target.value);
              }}
            >
              <option value="">🎭 Presets…</option>
              {SCENE_PRESETS.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
            {p.facts.length > 0 && (
              <button className="btn small ghost" title="Copy all items as a list, one per line" onClick={() => void copyAll()}>📋 Copy</button>
            )}
            {p.facts.length > 0 && (
              <button className="btn small ghost" onClick={p.onClear}>Clear</button>
            )}
          </div>
        )}
      </div>

      {open && (
        <>
          {p.facts.length > 0 ? (
            <ul className="facts">
              {p.facts.map((f) => {
                const expired = f.expiresAt !== undefined && p.lineCount >= f.expiresAt;
                const left = f.expiresAt !== undefined && !expired ? f.expiresAt - p.lineCount : 0;
                const secret = f.scope !== "all";
                const color = secret ? p.speakers.find((s) => s.id === f.scope)?.color : undefined;
                const state = expired ? "expired" : f.enabled ? "on" : "off";
                if (editing?.id === f.id) {
                  return (
                    <li key={f.id} className="fact editing" style={color ? ({ "--accent": color } as React.CSSProperties) : undefined}>
                      {secret && <span className="secret" title={`Only ${nameOf(f.scope)} knows this`}>🔒 {nameOf(f.scope)}</span>}
                      <textarea
                        className="fact-edit"
                        rows={2}
                        autoFocus
                        value={editing.draft}
                        aria-label="Edit scene fact"
                        title="Enter saves, Esc cancels"
                        onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
                        onChange={(e) => setEditing({ id: f.id, draft: e.target.value })}
                        onBlur={() => finishEdit(true)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            finishEdit(true);
                          } else if (e.key === "Escape") {
                            e.stopPropagation(); // Esc would otherwise stop the show too
                            finishEdit(false);
                          }
                        }}
                      />
                    </li>
                  );
                }
                return (
                  <li key={f.id} className={`fact ${state}`} style={color ? ({ "--accent": color } as React.CSSProperties) : undefined}>
                    <button className="fact-x" title="Edit this fact's text" aria-label="Edit" onClick={() => startEdit(f)}>✎</button>
                    {secret && <span className="secret" title={`Only ${nameOf(f.scope)} knows this`}>🔒 {nameOf(f.scope)}</span>}
                    <button
                      className="fact-text"
                      title={expired ? "Expired" : f.enabled ? "Click to switch off (keeps it in the list)" : "Click to switch back on"}
                      onClick={() => p.onToggle(f.id)}
                      disabled={expired}
                    >
                      {f.text}
                    </button>
                    {left > 0 && <span className="timer" title="Lines until this fact expires">⏳{left}</span>}
                    {expired && <span className="timer">expired</span>}
                    {p.live && !expired && f.enabled && (
                      <button className="fact-x" title="Retcon: tell them it's no longer true, then remove it" onClick={() => p.onRemove(f.id, true)}>↩</button>
                    )}
                    <button className="fact-x" title="Remove quietly" onClick={() => p.onRemove(f.id, false)}>×</button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small scene-hint">
              Change their world, even mid-conversation: "it's the year 3000", "all sparkling water is cold", or a secret only one of them knows.
            </p>
          )}

          <div className="fact-add">
            <input
              value={text}
              placeholder="Add a fact about their world… (Enter)"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              onPaste={pasteList}
              aria-label="New scene fact"
            />
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Who knows it" title="Who knows this fact">
              <option value="all">Everyone knows</option>
              {p.speakers.map((s) => (
                <option key={s.id} value={s.id}>🔒 Only {s.name}</option>
              ))}
            </select>
            <button
              className={`btn small toggle-btn ${announce ? "on" : ""}`}
              onClick={() => setAnnounce(!announce)}
              title={announce ? "Announced: they'll be told it just happened and react" : "Quietly: it's simply true; they may or may not mention it"}
            >
              {announce ? "📢 Announce" : "🤫 Quietly"}
            </button>
            <select value={lines} onChange={(e) => setLines(+e.target.value)} aria-label="How long" title="How long it stays true">
              <option value={0}>Forever</option>
              {[2, 4, 6, 10].map((n) => (
                <option key={n} value={n}>For {n} lines</option>
              ))}
            </select>
            <button className="btn small primary" onClick={add} disabled={!text.trim()}>Add</button>
            <button
              className="btn small"
              onClick={() => p.onTwist({ scope, announce, lines })}
              disabled={p.twisting}
              title="Let the AI invent a twist"
            >
              {p.twisting ? "…" : "🎲 Twist"}
            </button>
          </div>
          {status && <p className="muted small" role="status">{status}</p>}
        </>
      )}
    </section>
  );
}
