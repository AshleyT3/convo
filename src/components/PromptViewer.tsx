import { useState } from "react";
import type { Speaker, Turn } from "../engine/types.ts";

interface Props {
  turn: Turn;
  speakers: Speaker[];
  onClose: () => void;
}

const ROLE_INFO = {
  system: { label: "Setup", hint: "system: who they are, the rules, the world" },
  user: { label: "Heard", hint: "user: what the others said to them" },
  assistant: { label: "Said earlier", hint: "assistant: their own previous lines" },
} as const;

/** Splits off the hidden per-turn direction so it can be highlighted. */
function splitHidden(content: string): [string, string] {
  const i = content.lastIndexOf("\n\n(");
  return i >= 0 && content.endsWith(")") ? [content.slice(0, i), content.slice(i + 2)] : [content, ""];
}

/**
 * "Behind the curtain": the exact messages the model received to produce one
 * line. Each turn is rebuilt from scratch from the shared transcript.
 */
export function PromptViewer({ turn, speakers, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const me = speakers.find((s) => s.id === turn.speakerId);
  const msgs = turn.prompt ?? [];
  const chars = msgs.reduce((n, m) => n + m.content.length, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ messages: msgs, ...turn.params }, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="drawer-wrap center" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Prompt viewer">
        <header className="drawer-head">
          <h2>What {me?.name ?? "the model"} was given</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted small">
          Each line starts from scratch: the app rebuilds this from the shared transcript and sends it to the model,
          which then writes the reply below. From {me?.name ?? "this speaker"}'s seat, the others' lines arrive as
          "user" messages and their own as "assistant". Text in amber is a secret direction only {me?.name ?? "they"} saw.
        </p>
        <div className="viewer-meta">
          <span>{msgs.length} messages</span>
          <span>~{Math.round(chars / 4).toLocaleString()} tokens</span>
          {turn.params && <span>creativity {turn.params.temperature}</span>}
          {turn.params && <span>max {turn.params.maxTokens} tokens</span>}
          <button className="btn small" onClick={() => void copy()}>{copied ? "Copied ✓" : "Copy as JSON"}</button>
        </div>

        <ol className="msgs">
          {msgs.map((m, i) => {
            const info = ROLE_INFO[m.role];
            const [body, hidden] = i === msgs.length - 1 && m.role === "user" ? splitHidden(m.content) : [m.content, ""];
            return (
              <li key={i} className={`msg ${m.role}`}>
                <div className="msg-role" title={info.hint}>
                  {info.label} <code>{m.role}</code>
                </div>
                <pre>
                  {body}
                  {hidden && (
                    <>
                      {"\n\n"}
                      <span className="hidden-note">{hidden}</span>
                    </>
                  )}
                </pre>
              </li>
            );
          })}
          <li className="msg reply">
            <div className="msg-role">Reply <code>model output</code></div>
            <pre>{turn.text || "…"}</pre>
          </li>
        </ol>
      </div>
    </div>
  );
}
