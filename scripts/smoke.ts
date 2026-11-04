// Headless smoke test: runs a short conversation against a local OpenAI-compatible
// server and prints it. No browser, no voices.
//   node scripts/smoke.ts [baseUrl] [mode] [turns] [subject...]

import { Conversation, type Speech } from "../src/engine/conversation.ts";
import { OpenAiCompatBackend } from "../src/llm/openaiCompat.ts";
import type { ConversationSettings, ModeId, Speaker } from "../src/engine/types.ts";

const [baseUrl = "http://127.0.0.1:8080/v1", mode = "debate", turns = "6", ...subj] = process.argv.slice(2);

const speakers: Speaker[] = [
  { id: "a", name: "Ada", persona: "a sharp, upbeat optimist who loves big ideas", voiceURI: "", rate: 1, pitch: 1, color: "" },
  { id: "b", name: "Theo", persona: "a dry-witted skeptic who wants evidence", voiceURI: "", rate: 1, pitch: 1, color: "" },
];
const settings: ConversationSettings = {
  subject: subj.join(" ") || "Pineapple belongs on pizza",
  mode: mode as ModeId,
  replyLength: "short",
  temperature: 0.9,
  turnLimit: Number(turns),
  contextTurns: 6,
  refereeEvery: 4,
  antiLoop: true,
  speech: true,
};
const quiet: Speech = { speak: async () => {}, pause() {}, resume() {}, cancel() {} };

const printed = new Set<string>();
const t0 = Date.now();
const convo = new Conversation(new OpenAiCompatBackend({ baseUrl }), quiet, speakers, settings, (st) => {
  for (const t of st.turns) {
    if (!t.done || printed.has(t.id)) continue;
    printed.add(t.id);
    const who = speakers.find((s) => s.id === t.speakerId)?.name ?? t.speakerId;
    console.log(`\n${who.toUpperCase()}: ${t.text}`);
  }
  if (st.status === "error") console.error("ERROR:", st.error);
});
await convo.start();
const st = convo.getState();
console.log(`\n--- ${st.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s, ~${st.lastWordsPerSec?.toFixed(0)} words/s; summary: ${st.summary || "(none)"}`);
