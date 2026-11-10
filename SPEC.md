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
- [ ] **Bug: long unbroken text overflows its chat box.** A moderator line with no spaces runs past the note's edge and off the side of the chat. Likely fix: let `.note` wrap anywhere, as chat bubbles do, and check `.scene-marker` too.
- [ ] **Bug: the Memory setting is awkward to type into.** Clearing the box snaps it straight back (to 8), so you can't just replace the number: typing 4 needs tricks like making "48" and deleting the 8. On phones, without arrow buttons, that's the only way. Likely fix: allow the box to be empty while typing and apply the minimum of 4 when you leave it.

### Backlog
- **Copy and paste a whole scenario as markdown.** Sections: `# Topic`, `# Scene items`, and one per speaker (`# Entity1`, `# Entity2`). Pasting applies only the sections present, so a partial paste changes only those. Reuse the scene-item line format. To settle first: whether a pasted topic or speaker replaces the current one mid-conversation, extra speakers, and voices missing on the other person's device.

### Done
- [x] **Recover from a lost GPU:** when a driver reset takes the model down, Convo says so, discards the dead engine, and loads the model again on the next Start or Keep going. A line that hadn't produced any words is dropped, so that speaker keeps their turn.
- [x] **Phone layout:** at 720 px and narrower, one page-long scroll with a fixed bar for Start, Pause and Stop, a fixed curveball box once a show exists, and ↑ Setup and ↓ Latest jumps. The chat only follows new lines when you're already at the latest one.
- [x] **A topic is required:** Start with an empty topic asks for one or for 🎲, so the topic is always the visitor's choice.
- [x] **Stop, then Keep going:** a stopped reply keeps its unspoken text visible, dimmed, instead of hiding it behind dots. A reply stopped before any words is removed, so that speaker keeps their turn.
- [x] **Copy and paste scene items:** 📋 Copy takes all items, one per line, with `[off]` and `[only Name]` labels. Pasting several lines (or one labelled line) into the "Add a fact" box adds a union: a match, ignoring case and spacing, is skipped and the existing item is unchanged. New items take the box's current dropdowns unless labelled; `[only Name]` with an unknown name also uses the dropdown. Timers aren't copied.
- [x] **Edit a scene item in place:** ✎ on the left of the chip. Enter or clicking away saves; Esc cancels without stopping the show. Mid-conversation, the new text applies from the next turn, the transcript shows "Fact changed: old → new", and the speakers aren't told.
- [x] **Show text as it's spoken:** a setting under "Speak out loud", on by default. Each sentence appears when its voice starts, with typing dots until then. If the show stops, unspoken text is shown dimmed.
- [x] **Mark cloud voices** "· online" in the voice picker. Defaults now prefer local voices over Chrome's Google voices, which pause every sentence for a network round trip; Natural voices still come first.
- [x] **Go easy on the GPU (for screen recording):** an in-browser-models option, off by default. WebLLM computes a token only when asked for the next chunk, so Convo idles between chunks for about as long as the last one took (15–200 ms), giving OBS GPU gaps to render frames.
- [x] **Speak a spaced dash as a comma,** because some voices hold a dash too long. The text on screen keeps the dash.
