// Optional timing logs for tracking down stalls and GPU resets. Add ?diag to the page
// address to turn them on; without it, nothing here runs. Logs go to the browser console.

import type { ChatMessage, ChatOptions, LlmBackend } from "./types.ts";

export const diagOn = typeof location !== "undefined" && new URLSearchParams(location.search).has("diag");

const STALL_MS = 300;
const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
const log = (text: string) => console.log(`[diag ${((performance.now() - startedAt) / 1000).toFixed(1)}s] ${text}`);
let calls = 0;
let watching = false;

/** Times each stage of a model call. The messages and the reply pass through unchanged. */
export function withDiag(backend: LlmBackend): LlmBackend {
  return {
    label: backend.label,
    async *chat(messages: ChatMessage[], opts?: ChatOptions) {
      const id = ++calls;
      const chars = messages.reduce((n, m) => n + m.content.length, 0);
      log(`call ${id} start: ${messages.length} messages, ${chars} chars (~${Math.round(chars / 4)} tokens)`);
      const begun = performance.now();
      let waitingSince = begun;
      let firstPieceMs = 0;
      let slowestMs = 0;
      let pieces = 0;
      let outcome = "stopped early";
      try {
        for await (const piece of backend.chat(messages, opts)) {
          const now = performance.now();
          if (pieces === 0) {
            firstPieceMs = now - begun;
            log(`call ${id} first text after ${Math.round(firstPieceMs)} ms`);
          } else {
            slowestMs = Math.max(slowestMs, now - waitingSince);
          }
          pieces++;
          yield piece;
          waitingSince = performance.now(); // time spent in the app between pieces doesn't count
        }
        outcome = "finished";
      } catch (e) {
        const stage = pieces === 0 ? "before any text (prompt processing)" : `while streaming, after ${pieces} pieces`;
        outcome = `FAILED ${stage}: ${e instanceof Error ? e.message : String(e)}`;
        throw e;
      } finally {
        log(`call ${id} ${outcome}: ${pieces} pieces in ${Math.round(performance.now() - begun)} ms, first text ${Math.round(firstPieceMs)} ms, slowest gap ${Math.round(slowestMs)} ms`);
      }
    },
  };
}

/**
 * Reports freezes while the page is visible. A late timer means the UI thread was busy.
 * Late frames with on-time timers mean the UI thread was free but drawing was held up.
 */
export function startDiagWatch() {
  if (watching) return; // React's dev mode runs startup effects twice
  watching = true;
  let lastTick = performance.now();
  let lastFrame = performance.now();
  // Browsers slow timers and stop frames for hidden pages, so restart the clocks when visible again.
  document.addEventListener("visibilitychange", () => {
    lastTick = lastFrame = performance.now();
    log(`page ${document.hidden ? "hidden" : "visible"}`);
  });
  setInterval(() => {
    const now = performance.now();
    if (now - lastTick > STALL_MS && !document.hidden) log(`UI THREAD late by ${Math.round(now - lastTick)} ms`);
    lastTick = now;
  }, 100);
  const onFrame = () => {
    const now = performance.now();
    if (now - lastFrame > STALL_MS && !document.hidden) log(`FRAMES stalled for ${Math.round(now - lastFrame)} ms`);
    lastFrame = now;
    requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration >= STALL_MS) log(`long UI task: ${Math.round(e.duration)} ms`);
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch {
    /* not supported in this browser */
  }
  log("watching for stalls");
}
