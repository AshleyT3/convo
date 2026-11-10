import { useEffect, useRef, useState } from "react";
import type { Speaker, Turn } from "../engine/types.ts";
import { phoneLayout } from "../state/device.ts";

interface Props {
  turns: Turn[];
  speakers: Speaker[];
  generatingId?: string;
  speechOn: boolean;
  /** Hide each sentence until its voice starts (only while the show is live). */
  reveal: boolean;
  empty: React.ReactNode;
  /** Changes each time the show is started, so the view goes back to following the chat. */
  followKey: number;
  /** When set, lines get a 🔍 button that opens the prompt viewer. */
  onInspect?: (t: Turn) => void;
}

/** Phone layout: how far the end of the chat is below the visible area (above the curveball bar). */
function pageGap(el: HTMLElement): number {
  const bar = document.querySelector(".footer-bar")?.getBoundingClientRect().height ?? 0;
  return el.getBoundingClientRect().bottom - (window.innerHeight - bar - 8);
}

/**
 * One shared timeline, with each speaker in their own lane (left/right for two;
 * staggered lanes if more speakers are ever added).
 */
export function Transcript({ turns, speakers, generatingId, speechOn, reveal, empty, followKey, onInspect }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const touching = useRef(false);
  const hasTurns = turns.length > 0;
  const [away, setAway] = useState(false); // phone layout: scrolled away from the latest line

  // A new show, or pressing Start or Keep going, goes back to following the chat.
  const firstId = turns[0]?.id;
  useEffect(() => {
    stick.current = true;
  }, [followKey, firstId]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!phoneLayout()) {
      if (stick.current) el.scrollTop = el.scrollHeight;
      setAway(false);
      return;
    }
    // Never move the page under a finger, or while someone is up in the setup area.
    if (stick.current && hasTurns && !touching.current) {
      const gap = pageGap(el);
      if (gap > 0) window.scrollBy(0, gap);
    }
    setAway(hasTurns && !stick.current);
  });

  // Phone layout: the page scrolls rather than the chat box, so watch the page.
  useEffect(() => {
    const onPageScroll = () => {
      const el = box.current;
      if (!el || !phoneLayout()) return;
      stick.current = pageGap(el) < 80;
      setAway(hasTurns && !stick.current);
    };
    const onTouchStart = () => { touching.current = true; };
    const onTouchEnd = () => { touching.current = false; };
    window.addEventListener("scroll", onPageScroll, { passive: true });
    window.addEventListener("resize", onPageScroll);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("scroll", onPageScroll);
      window.removeEventListener("resize", onPageScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [hasTurns]);

  const onScroll = () => {
    const el = box.current;
    if (el && !phoneLayout()) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const jumpToLatest = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    window.scrollBy(0, pageGap(el));
    setAway(false);
  };

  const n = Math.max(1, speakers.length);
  const lastLine = [...turns].reverse().find((t) => (t.kind ?? "line") === "line");

  return (
    <>
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
        const hideUnspoken = reveal && speechOn && !t.interrupted;
        // Revealing with speech: nothing spoken yet means nothing to show but the dots.
        if (hideUnspoken && !t.speaking && !t.spokenChars && t.text) {
          return (
            <div
              key={t.id}
              className={`bubble-row ${idx === n - 1 && n > 1 ? "right" : ""}`}
              style={{ marginLeft: `${offset}%`, "--accent": sp?.color } as React.CSSProperties}
            >
              <div className="bubble">
                <div className="who">{sp?.name ?? "?"}</div>
                <span className="typing"><i /><i /><i /></span>
              </div>
            </div>
          );
        }
        const waiting = !t.text && generatingId === t.speakerId && t === lastLine;
        return (
          <div
            key={t.id}
            className={`bubble-row ${idx === n - 1 && n > 1 ? "right" : ""}`}
            style={{ marginLeft: `${offset}%`, "--accent": sp?.color } as React.CSSProperties}
          >
            <div className={`bubble ${t.speaking ? "is-speaking" : ""}`}>
              <div className="who">
                {sp?.name ?? "?"}
                {onInspect && t.prompt && (
                  <button className="inspect" title="See exactly what the model was given for this line" onClick={() => onInspect(t)}>
                    🔍
                  </button>
                )}
              </div>
              {waiting ? <span className="typing"><i /><i /><i /></span> : <BubbleText turn={t} speechOn={speechOn} hideUnspoken={hideUnspoken} />}
            </div>
          </div>
        );
      })}
    </div>
    {away && <button className="btn small jump-latest" onClick={jumpToLatest}>↓ Latest</button>}
    </>
  );
}

function BubbleText({ turn, speechOn, hideUnspoken }: { turn: Turn; speechOn: boolean; hideUnspoken: boolean }) {
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
      {!hideUnspoken && <span className="pending">{text.slice(b)}</span>}
    </p>
  );
}
