import { useState } from "react";
import type { Speaker } from "../engine/types.ts";
import { previewVoice, type VoiceInfo } from "../voice/browserSpeech.ts";

interface Props {
  speaker: Speaker;
  voices: VoiceInfo[];
  speaking: boolean;
  thinking: boolean;
  side: string; // e.g. "For" / "Against" in a debate
  onChange: (s: Speaker) => void;
}

export function SpeakerCard({ speaker, voices, speaking, thinking, side, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Speaker>) => onChange({ ...speaker, ...patch });
  const state = speaking ? "speaking" : thinking ? "thinking" : "";

  return (
    <section className={`card ${state}`} style={{ "--accent": speaker.color } as React.CSSProperties}>
      <div className="card-head">
        <div className="avatar" aria-hidden>
          {speaker.name.trim().charAt(0).toUpperCase() || "?"}
          <span className="ring" />
        </div>
        <div className="card-title">
          <input
            className="name"
            value={speaker.name}
            maxLength={24}
            aria-label="Speaker name"
            onChange={(e) => set({ name: e.target.value })}
          />
          <div className="status-line">
            {side && <span className="side">{side}</span>}
            {speaking ? <span className="live">speaking</span> : thinking ? <span className="dots">thinking</span> : null}
          </div>
        </div>
        <button className="icon-btn" title="Edit personality and voice" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "−" : "✎"}
        </button>
      </div>

      <label className="field voice-field">
        <span>Voice</span>
        <select value={speaker.voiceURI} onChange={(e) => set({ voiceURI: e.target.value })}>
          {!voices.length && <option value="">No voices available</option>}
          {voices.map((v) => (
            <option key={v.uri} value={v.uri}>
              {v.name.replace(/^Microsoft /, "")} · {v.lang}
            </option>
          ))}
        </select>
        <button className="icon-btn" title="Hear this voice" onClick={() => previewVoice(speaker)} disabled={!voices.length}>
          ▶
        </button>
      </label>

      {open && (
        <div className="card-more">
          <label className="field stack">
            <span>Personality</span>
            <textarea
              rows={3}
              value={speaker.persona}
              placeholder="e.g. a grumpy pirate who secretly loves poetry"
              onChange={(e) => set({ persona: e.target.value })}
            />
          </label>
          <div className="row2">
            <label className="field stack">
              <span>Speed {speaker.rate.toFixed(2)}×</span>
              <input type="range" min={0.6} max={1.6} step={0.05} value={speaker.rate} onChange={(e) => set({ rate: +e.target.value })} />
            </label>
            <label className="field stack">
              <span>Pitch {speaker.pitch.toFixed(2)}</span>
              <input type="range" min={0.5} max={1.5} step={0.05} value={speaker.pitch} onChange={(e) => set({ pitch: +e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>Colour</span>
            <input type="color" value={speaker.color} onChange={(e) => set({ color: e.target.value })} />
          </label>
        </div>
      )}
    </section>
  );
}
