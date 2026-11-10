// Core data model. Speakers are a list (not "left"/"right") so the app can grow
// beyond two voices later without reshaping anything.

export interface Speaker {
  id: string;
  name: string;
  /** Free-text personality, e.g. "a dry-witted skeptic who wants evidence". */
  persona: string;
  /** Browser voice URI (from speechSynthesis.getVoices()). Empty = auto-pick. */
  voiceURI: string;
  rate: number; // 0.5 – 2
  pitch: number; // 0 – 2
  color: string; // accent color for the UI
}

/**
 * A "scene attribute": a living fact about the world the speakers are in.
 * Read fresh on every turn, so adding/removing/toggling takes effect next turn.
 * Past lines are never rewritten: what was said stays said.
 */
export interface SceneFact {
  id: string;
  text: string;
  enabled: boolean;
  /** "all" = everyone knows it; otherwise a speaker id = that speaker's secret. */
  scope: string;
  /** Line index at which the fact expires (timed facts). Undefined = permanent. */
  expiresAt?: number;
}

export function factActive(f: SceneFact, lineCount: number): boolean {
  return f.enabled && f.text.trim() !== "" && (f.expiresAt === undefined || lineCount < f.expiresAt);
}

export type ModeId = "debate" | "collaborate" | "chat" | "improv" | "interview";

export type ReplyLength = "short" | "medium" | "long";

export interface Turn {
  id: string;
  speakerId: string;
  /** Full cleaned text produced so far (may run ahead of speech). */
  text: string;
  /** Number of characters of `text` already spoken aloud (for highlighting). */
  spokenChars: number;
  /** [start, end) of the sentence being spoken right now, if any. */
  speaking?: [number, number];
  done: boolean;
  /** Stopped before all of it was spoken; it will never be, so any unspoken text stays visible. */
  interrupted?: boolean;
  /**
   * "line" = a speaker's line; "note" = moderator/referee text the speakers also see;
   * "scene" = display-only marker (fact added/removed), never sent to the model.
   */
  kind?: "line" | "note" | "scene";
  /** Exactly what the model was given for this line (for the advanced prompt viewer). */
  prompt?: { role: "system" | "user" | "assistant"; content: string }[];
  /** Sampling settings used for this line. */
  params?: { temperature: number; maxTokens: number };
}

export interface ConversationSettings {
  subject: string;
  mode: ModeId;
  replyLength: ReplyLength;
  temperature: number;
  /** 0 = endless. */
  turnLimit: number;
  /** How many recent turns each speaker sees verbatim; older ones get summarised. */
  contextTurns: number;
  /** Ask a hidden referee every N turns whether the conversation has concluded. 0 = off. */
  refereeEvery: number;
  /** Nudge speakers away from agreement loops with hidden moderator notes. */
  antiLoop: boolean;
  speech: boolean;
  /** While speaking, reveal each sentence when its voice starts (instead of as soon as it's written). */
  revealWithSpeech: boolean;
  /** Show behind-the-scenes tools (e.g. the prompt viewer). */
  advanced?: boolean;
}

export type RunStatus = "idle" | "running" | "paused" | "finished" | "error";
