// The conversation loop. Environment-agnostic (no DOM): give it an LLM backend
// and a Speech implementation and it drives turns, speech pacing, pause/stop,
// the rolling summary and the referee.
//
// Pipelining: turn N is generated while turn N-1 is still being spoken, but we
// never run more than one turn ahead of the voices.

import { complete, type LlmBackend } from "../llm/types.ts";
import {
  buildMessages,
  maxTokensFor,
  parseVerdict,
  pickNudge,
  refereeMessages,
  summaryMessages,
} from "./prompts.ts";
import { cleanReply, mightBeNamePrefix, takeSentences } from "./text.ts";
import { factActive, type ConversationSettings, type RunStatus, type SceneFact, type Speaker, type Turn } from "./types.ts";

/** A one-time hidden message delivered to each listed speaker on their next turn. */
interface PendingNote {
  text: string;
  remaining: Set<string>;
  /** Urgent notes (news, retcons) replace the usual nudge; reminders don't. */
  urgent: boolean;
}

export type SceneEventStyle = "news" | "retcon" | "reminder";

/** What the engine needs from a voice layer. `speak` resolves when done or cancelled. */
export interface Speech {
  speak(text: string, speaker: Speaker): Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
}

export interface ConversationState {
  status: RunStatus;
  turns: Turn[];
  summary: string;
  error?: string;
  /** Which speaker is currently generating (thinking/typing). */
  generatingId?: string;
  /** Rough generation speed of the last turn, chars/sec → shown as words/sec. */
  lastWordsPerSec?: number;
}

let nextId = 0;
const uid = () => `t${Date.now().toString(36)}${(nextId++).toString(36)}`;

export class Conversation {
  private turns: Turn[] = [];
  private summary = "";
  /** Index into lines (non-note turns) up to which `summary` covers. */
  private summarizedLines = 0;
  private status: RunStatus = "idle";
  private error?: string;
  private generatingId?: string;
  private lastWordsPerSec?: number;
  private targetLines = 0;

  private abort?: AbortController;
  private stopped = false;
  private paused = false;
  private pauseWaiters: (() => void)[] = [];
  private speechChain: Promise<void> = Promise.resolve();
  private emitQueued = false;
  private facts: SceneFact[] = [];
  private pendingNotes: PendingNote[] = [];

  private backend: LlmBackend;
  private readonly speech: Speech;
  private speakers: Speaker[];
  private settings: ConversationSettings;
  private readonly onChange: (s: ConversationState) => void;

  constructor(
    backend: LlmBackend,
    speech: Speech,
    speakers: Speaker[],
    settings: ConversationSettings,
    onChange: (s: ConversationState) => void,
  ) {
    this.backend = backend;
    this.speech = speech;
    this.speakers = speakers;
    this.settings = settings;
    this.onChange = onChange;
  }

  /** Live-update personas/voices/settings; takes effect from the next turn. */
  update(speakers: Speaker[], settings: ConversationSettings, facts?: SceneFact[]) {
    this.speakers = speakers;
    this.settings = settings;
    if (facts) this.facts = facts;
  }

  /** Number of speaker lines so far (timed facts count against this). */
  lineCount(): number {
    return this.lines().length;
  }

  /**
   * Tells speakers about a scene change on their next turn (once each).
   * scope: "all" or a speaker id (a secret). Past lines are never rewritten.
   */
  sceneEvent(text: string, scope: string, style: SceneEventStyle) {
    const ids = scope === "all" ? this.speakers.map((s) => s.id) : [scope];
    const t = text.trim();
    if (!t || !ids.length) return;
    const msg =
      style === "news"
        ? scope === "all"
          ? `Breaking news, just now: "${t}". This is now true. React to it.`
          : `Something only you just found out: "${t}". This is now true. Let it change how you act, without simply announcing it.`
        : style === "retcon"
          ? `Correction: "${t}" is NOT true any more (it never really was). Adjust to that.`
          : `Remember this new fact about the world: "${t}".`;
    this.pendingNotes.push({ text: msg, remaining: new Set(ids), urgent: style !== "reminder" });
  }

  /** Display-only line in the transcript (never sent to the model). */
  marker(text: string) {
    this.turns.push({ id: uid(), speakerId: "scene", text, spokenChars: text.length, done: true, kind: "scene" });
    this.emit();
  }

  private takeNotesFor(speakerId: string): { text: string; urgent: boolean } {
    const mine = this.pendingNotes.filter((n) => n.remaining.has(speakerId));
    for (const n of mine) n.remaining.delete(speakerId);
    this.pendingNotes = this.pendingNotes.filter((n) => n.remaining.size > 0);
    return { text: mine.map((n) => n.text).join(" "), urgent: mine.some((n) => n.urgent) };
  }

  /** Swap the model (e.g. user changed settings) before continuing. */
  setBackend(backend: LlmBackend) {
    this.backend = backend;
  }

  getState(): ConversationState {
    return {
      status: this.status,
      turns: this.turns.map((t) => ({ ...t })),
      summary: this.summary,
      error: this.error,
      generatingId: this.generatingId,
      lastWordsPerSec: this.lastWordsPerSec,
    };
  }

  /** Starts (or continues after finishing) for up to `turnLimit` more lines. */
  async start(): Promise<void> {
    if (this.status === "running" || this.status === "paused") return;
    this.stopped = false;
    this.paused = false;
    this.error = undefined;
    const limit = this.settings.turnLimit;
    this.targetLines = limit > 0 ? this.lines().length + limit : Infinity;
    this.setStatus("running");
    try {
      await this.loop();
      if (!this.stopped) {
        await this.speechChain;
        this.setStatus("finished");
      }
    } catch (e) {
      if (this.stopped) return;
      this.error = e instanceof Error ? e.message : String(e);
      this.speech.cancel();
      this.setStatus("error");
    } finally {
      this.generatingId = undefined;
      this.emit();
    }
  }

  pause() {
    if (this.status !== "running") return;
    this.paused = true;
    this.speech.pause();
    this.setStatus("paused");
  }

  resume() {
    if (this.status !== "paused") return;
    this.paused = false;
    this.speech.resume();
    this.pauseWaiters.splice(0).forEach((r) => r());
    this.setStatus("running");
  }

  stop() {
    this.stopped = true;
    this.paused = false;
    this.abort?.abort();
    this.speech.cancel();
    this.pauseWaiters.splice(0).forEach((r) => r());
    // A line stopped before it had any words never happened, so that speaker keeps their turn.
    this.turns = this.turns.filter((t) => (t.kind ?? "line") !== "line" || t.text.trim());
    for (const t of this.turns) {
      t.speaking = undefined;
      t.done = true;
      if (t.spokenChars < t.text.length) t.interrupted = true;
    }
    this.generatingId = undefined;
    this.speechChain = Promise.resolve();
    if (this.status !== "idle") this.setStatus("finished");
  }

  /** Lets the user throw in a line as the moderator; speakers see it next turn. */
  addModeratorNote(text: string) {
    const t = text.trim();
    if (!t) return;
    this.turns.push({ id: uid(), speakerId: "moderator", text: t, spokenChars: t.length, done: true, kind: "note" });
    this.emit();
  }

  // ---------------------------------------------------------------- internals

  private lines(): Turn[] {
    return this.turns.filter((t) => (t.kind ?? "line") === "line");
  }

  private async loop() {
    let prevSpoken: Promise<void> = this.speechChain;
    while (!this.stopped && this.lines().length < this.targetLines) {
      await this.waitIfPaused();
      if (this.stopped) return;
      await this.maybeSummarize();
      if (this.stopped) return;

      const lineIndex = this.lines().length;
      const index = lineIndex % this.speakers.length;
      // (Wrapped in an object: returning the bare promise from an async function
      // would make us wait for the speech too, killing the pipelining.)
      const { spoken } = await this.generateTurn(index, lineIndex);
      if (this.stopped) return;

      // Stay at most one turn ahead of the voices.
      await prevSpoken;
      prevSpoken = spoken;

      const every = this.settings.refereeEvery;
      const n = this.lines().length;
      if (every > 0 && n >= 4 && n % every === 0 && n < this.targetLines) {
        if (await this.refereeSaysDone()) break;
      }
    }
  }

  /** Generates one line, queueing speech sentence-by-sentence. Returns a promise for when it's all spoken. */
  private async generateTurn(index: number, lineIndex: number): Promise<{ spoken: Promise<void> }> {
    const speaker = this.speakers[index];
    const s = this.settings;
    const remaining = this.targetLines - lineIndex;
    const isFinalRound = Number.isFinite(this.targetLines) && remaining <= this.speakers.length && s.turnLimit > 0;
    const visible = this.turnsSinceSummary();
    const nudge = pickNudge(s, this.turns, lineIndex, isFinalRound);
    const scene = this.takeNotesFor(speaker.id);
    // Scene news/retcons take priority over random nudges (but keep curveballs and closings).
    const keepNudge = !scene.urgent || /moderator just threw in|final turn/i.test(nudge);
    const note = [scene.text, keepNudge ? nudge : ""].filter(Boolean).join(" ");
    const facts = this.facts.filter((f) => factActive(f, lineIndex));
    const messages = buildMessages(this.speakers, index, s, visible, this.summary, note, facts);
    const names = this.speakers.map((sp) => sp.name);
    const stop = this.speakers
      .filter((_, i) => i !== index)
      .flatMap((o) => [`\n${o.name}:`, `[${o.name}]`])
      .concat(["[Moderator]"]);

    const maxTokens = maxTokensFor(s.replyLength);
    const turn: Turn = {
      id: uid(),
      speakerId: speaker.id,
      text: "",
      spokenChars: 0,
      done: false,
      kind: "line",
      prompt: messages,
      params: { temperature: s.temperature, maxTokens },
    };
    this.turns.push(turn);
    // Keep memory bounded in endless runs: only the last 60 lines keep their prompts.
    const withPrompts = this.turns.filter((t) => t.prompt);
    for (const old of withPrompts.slice(0, -60)) old.prompt = undefined;
    this.generatingId = speaker.id;
    this.emit();

    this.abort = new AbortController();
    let raw = "";
    let queued = 0;
    let firstTokenAt = 0;
    let spoken: Promise<void> = this.speechChain;

    // Hard cap: small models often ignore the length instruction and ramble.
    const maxSentences = { short: 3, medium: 5, long: 8 }[s.replyLength];
    let sentences = 0;
    const queueSentences = (final: boolean) => {
      for (const [a, b] of takeSentences(turn.text, queued, final)) {
        if (sentences >= maxSentences) return;
        queued = b;
        sentences++;
        spoken = this.enqueueSpeech(turn, speaker, a, b);
      }
    };
    let capped = false;

    for await (const piece of this.backend.chat(messages, {
      temperature: s.temperature,
      maxTokens,
      stop,
      signal: this.abort.signal,
    })) {
      if (this.stopped) break;
      if (!firstTokenAt) firstTokenAt = performance.now();
      raw += piece;
      if (mightBeNamePrefix(raw)) continue;
      turn.text = cleanReply(raw, names);
      queueSentences(false);
      this.emit();
      if (sentences >= maxSentences) {
        capped = true;
        break; // ends the stream (and the server-side generation)
      }
    }
    if (this.stopped) return { spoken };

    if (capped) {
      turn.text = turn.text.slice(0, queued).trimEnd();
    } else {
      turn.text = cleanReply(raw, names).trimEnd();
      if (!turn.text) turn.text = "…";
      queueSentences(true);
    }
    turn.done = true;
    this.generatingId = undefined;
    const secs = (performance.now() - firstTokenAt) / 1000;
    if (firstTokenAt && secs > 0.2) this.lastWordsPerSec = turn.text.split(/\s+/).length / secs;
    this.emit();
    return { spoken };
  }

  private enqueueSpeech(turn: Turn, speaker: Speaker, a: number, b: number): Promise<void> {
    this.speechChain = this.speechChain.then(async () => {
      await this.waitIfPaused();
      if (this.stopped) return;
      turn.speaking = [a, b];
      this.emit();
      if (this.settings.speech) {
        await this.speech.speak(turn.text.slice(a, b), speaker);
      } else {
        // Silent mode: pause roughly as long as reading takes, so it still feels like a conversation.
        await sleep(Math.min(4000, 30 * (b - a)));
      }
      if (this.stopped) return;
      turn.spokenChars = b;
      turn.speaking = undefined;
      this.emit();
    });
    return this.speechChain;
  }

  private turnsSinceSummary(): Turn[] {
    const lines = this.lines();
    const cutoff = lines[this.summarizedLines];
    if (!cutoff) return this.turns.filter((t) => t.kind === "note").slice(-3);
    const at = this.turns.indexOf(cutoff);
    return this.turns.slice(at).filter((t) => t.done || t.text);
  }

  /** Keeps context bounded for endless conversations. */
  private async maybeSummarize() {
    const lines = this.lines();
    const keep = Math.max(4, this.settings.contextTurns);
    if (lines.length - this.summarizedLines < keep + 4) return;
    const upTo = lines.length - keep;
    const chunk = lines.slice(this.summarizedLines, upTo);
    this.abort = new AbortController();
    const text = await complete(this.backend, summaryMessages(this.speakers, this.summary, chunk), {
      temperature: 0.3,
      maxTokens: 700,
      signal: this.abort.signal,
    });
    if (this.stopped) return;
    const clean = text.trim();
    if (clean) {
      this.summary = clean;
      this.summarizedLines = upTo;
    }
  }

  private async refereeSaysDone(): Promise<boolean> {
    this.abort = new AbortController();
    let raw = "";
    try {
      raw = await complete(this.backend, refereeMessages(this.speakers, this.settings, this.lines()), {
        temperature: 0.1,
        maxTokens: 600,
        signal: this.abort.signal,
      });
    } catch {
      return false; // a flaky referee never breaks the show
    }
    const v = parseVerdict(raw);
    if (!v?.concluded || this.stopped) return false;
    await this.speechChain;
    const winner = v.winner ? ` Winner: ${v.winner}.` : "";
    const text = `Referee: conversation concluded. ${v.reason}${winner}`;
    this.turns.push({ id: uid(), speakerId: "referee", text, spokenChars: text.length, done: true, kind: "note" });
    this.emit();
    return true;
  }

  private waitIfPaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((r) => this.pauseWaiters.push(r));
  }

  private setStatus(s: RunStatus) {
    this.status = s;
    this.emit();
  }

  /** Coalesces bursts of updates (token streaming) into one per microtask. */
  private emit() {
    if (this.emitQueued) return;
    this.emitQueued = true;
    queueMicrotask(() => {
      this.emitQueued = false;
      this.onChange(this.getState());
    });
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
