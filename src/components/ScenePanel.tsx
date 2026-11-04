import { useState } from "react";
import { SCENE_PRESETS } from "../engine/prompts.ts";
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
                return (
                  <li key={f.id} className={`fact ${state}`} style={color ? ({ "--accent": color } as React.CSSProperties) : undefined}>
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
        </>
      )}
    </section>
  );
}
