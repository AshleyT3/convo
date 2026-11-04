import { useEffect, useRef } from "react";
import type { Speaker, Turn } from "../engine/types.ts";

interface Props {
  turns: Turn[];
  speakers: Speaker[];
  generatingId?: string;
  speechOn: boolean;
  empty: React.ReactNode;
}

/**
 * One shared timeline, with each speaker in their own lane (left/right for two;
 * staggered lanes if more speakers are ever added).
 */
export function Transcript({ turns, speakers, generatingId, speechOn, empty }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const n = Math.max(1, speakers.length);
  const lastLine = [...turns].reverse().find((t) => (t.kind ?? "line") === "line");

  return (
    <div className="transcript" ref={box} onScroll={onScroll} aria-live="polite">
      {!turns.length && <div className="empty">{empty}</div>}
      {turns.map((t) => {
        if (t.kind === "scene") {
          return (
            <div key={t.id} className="scene-marker">
              {t.text}
            </div>
          );
        }
        if (t.kind === "note") {
          return (
            <div key={t.id} className="note">
              {t.speakerId === "moderator" ? <b>You (moderator): </b> : null}
              {t.text}
            </div>
          );
        }
        const idx = Math.max(0, speakers.findIndex((s) => s.id === t.speakerId));
        const sp = speakers[idx];
        const offset = n > 1 ? (idx * 25) / (n - 1) : 0;
        const waiting = !t.text && generatingId === t.speakerId && t === lastLine;
        return (
          <div
            key={t.id}
            className={`bubble-row ${idx === n - 1 && n > 1 ? "right" : ""}`}
            style={{ marginLeft: `${offset}%`, "--accent": sp?.color } as React.CSSProperties}
          >
            <div className={`bubble ${t.speaking ? "is-speaking" : ""}`}>
              <div className="who">{sp?.name ?? "?"}</div>
              {waiting ? <span className="typing"><i /><i /><i /></span> : <BubbleText turn={t} speechOn={speechOn} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BubbleText({ turn, speechOn }: { turn: Turn; speechOn: boolean }) {
  const { text, spokenChars, speaking } = turn;
  // Before the voices catch up, upcoming text is shown dimmed.
  if (!speechOn && !speaking) {
    return (
      <p>
        <span>{text.slice(0, spokenChars)}</span>
        <span className="pending">{text.slice(spokenChars)}</span>
      </p>
    );
  }
  const [a, b] = speaking ?? [spokenChars, spokenChars];
  return (
    <p>
      <span>{text.slice(0, a)}</span>
      {b > a && <mark>{text.slice(a, b)}</mark>}
      <span className="pending">{text.slice(b)}</span>
    </p>
  );
}
