import type { ConversationSettings, Speaker } from "../engine/types.ts";

export type BackendKind = "server" | "browser";

export interface BackendSettings {
  kind: BackendKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  browserModel: string;
  /** True once the user picked a backend themselves; until then we auto-pick. */
  chosen: boolean;
}

export const DEFAULT_SPEAKERS: Speaker[] = [
  {
    id: "s1",
    name: "Ada",
    persona: "a sharp, upbeat optimist who loves big ideas and vivid examples",
    voiceURI: "",
    rate: 1.05,
    pitch: 1,
    color: "#f472b6",
  },
  {
    id: "s2",
    name: "Theo",
    persona: "a dry-witted skeptic who pokes holes in things and asks for evidence",
    voiceURI: "",
    rate: 1,
    pitch: 0.95,
    color: "#38bdf8",
  },
];

export const DEFAULT_SETTINGS: ConversationSettings = {
  subject: "",
  mode: "debate",
  replyLength: "short",
  temperature: 0.9,
  turnLimit: 16,
  contextTurns: 8,
  refereeEvery: 0,
  antiLoop: true,
  speech: true,
  revealWithSpeech: true,
};

export const DEFAULT_BACKEND: BackendSettings = {
  kind: "server",
  baseUrl: "http://127.0.0.1:8080/v1",
  model: "",
  apiKey: "",
  browserModel: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
  chosen: false,
};

// Persistence is a convenience only: everything works if storage is unavailable.
const PREFIX = "convo:";

export function loadSaved<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) return (Array.isArray(parsed) && parsed.length ? parsed : fallback) as T;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function forget(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
