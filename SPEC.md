# Convo — design spec (v1)

## Goal
A dead-simple, open-source, zero-cost novelty: two AI characters talk to each other about a user-chosen subject, out loud, each in a distinct voice, using local AI. No installs for the in-browser path, no config files, no command line for end users.

## Decisions
- **Platform:** a static web app (Vite + React + TypeScript), hosted free (e.g. Cloudflare Pages). Cross-platform by default.
- **AI backends** sit behind `LlmBackend` (`src/llm/types.ts`):
  - an OpenAI-compatible local server (llama.cpp / Ollama / LM Studio);
  - in-browser WebLLM over WebGPU (lazy-loaded, runs in a worker).
- **Voice:** the Web Speech API, isolated in `src/voice/browserSpeech.ts`. The engine only sees the `Speech` interface: `speak`, `pause`, `resume`, `cancel`.
- **Speakers are a list**, not left/right. The UI renders N lanes (2 for v1) on one shared timeline.

## Conversation model
- **One model, many seats.** Each turn, the request is rebuilt from the current speaker's point of view:
  - `system` holds the persona, mode role, rules and running summary;
  - the speaker's own lines go in as `assistant`;
  - everyone else's lines go in as `user`, tagged `[Name]: …`.
- **Hidden moderator note** appended to the last user message: anti-loop nudges, a forced "don't just agree" when agreement phrases are detected, and a closing-line instruction on the final round.
- **Context bound:** recent N lines are sent verbatim; older ones are folded into a rolling summary (an extra model call).
- **Referee (optional):** every N lines, a JSON verdict `{concluded, reason, winner}`. A conclusion ends the show.
- **Pipelining:** replies stream, are cut into sentences and queued to speech. Turn N+1 is generated while turn N is spoken, but never more than one turn ahead.

## Scene (living world facts)
- `SceneFact {text, enabled, scope: "all" | speakerId, expiresAt?}` lives in the App and is persisted. It's passed to the engine on every change.
- **Each turn:** active facts are rendered into the system prompt. Shared ones go under "World facts"; facts scoped to the current speaker go under "Secrets only you know".
- **One-time events** (announce, retcon, reminder for a newly added quiet fact) are queued per speaker and delivered once, inside that speaker's next hidden note. Urgent ones replace the random nudge.
- **Transcript markers** use `kind: "scene"` turns, which are display-only and never sent to the model.
- **Past output is immutable:** facts only affect future prompts.

## Future ideas (not in v1)
- Game rules: "win by civil agreement", scoring, "force endless" constructs.
- More than two speakers, and floating speaker windows.
- Better local TTS (e.g. Piper) behind the same `Speech` interface; a native desktop shell.
- Save/share transcripts; export audio for videos.

## To do
- [ ] **Test on real devices:** a phone (Android Chrome, iPhone Safari), desktop Safari and Firefox. Check layout, voices and the in-browser model fallback.
- [ ] **Test the big in-browser models** (Llama 3.1 8B, Qwen3 8B, Gemma 2 9B, Qwen 2.5 7B; 5 to 6.4 GB downloads each) on a strong GPU: load time, speed and quality.
- [ ] **README screenshot or GIF** of a live conversation (can come from the YouTube video).
- [ ] **Pin Wrangler as a dev dependency** (`npm install -D wrangler`), so `npm run deploy` stops asking to download it.

### Done
- [x] **Show text as it's spoken:** a setting under "Speak out loud", on by default. Each sentence appears when its voice starts, with typing dots until then. If the show stops, unspoken text is shown dimmed.
- [x] **Mark cloud voices** "· online" in the voice picker. Defaults now prefer local voices over Chrome's Google voices, which pause every sentence for a network round trip; Natural voices still come first.
- [x] **Speak a spaced dash as a comma,** because some voices hold a dash too long. The text on screen keeps the dash.
