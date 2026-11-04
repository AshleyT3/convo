# Convo

**Two AIs. One topic. Out loud.**

Pick a subject, press **Start**, and two AI characters debate, collaborate, chat or improvise with each other, each speaking in its own voice. It's free and private: the AI runs on your own computer, and the voices are the ones built into your browser and operating system.

It's a novelty, and also a neat way to *see* what language models do: the same model weights, prompted from two seats, playing off each other one turn at a time.

## Two ways to run the AI

| | In your browser | Local model server |
|---|---|---|
| Install | Nothing | Ollama, llama.cpp or LM Studio |
| Models | Small (0.4 to 5 GB, downloaded once) | Anything your machine can run |
| Needs | Chrome or Edge with WebGPU | Any modern browser |
| Feel | Quick, often charmingly naive | Smarter, sharper banter |

Open **⚙ Settings** in the app to choose.

### Using a local model server
- **Ollama:** install from ollama.com and run `ollama pull llama3.2`. In Convo, choose the *Ollama* preset and pick the model.
- **llama.cpp:** `llama-server -m model.gguf -ngl 99 -c 8192 --jinja`, then choose the *llama.cpp* preset.
- **LM Studio:** start its local server, then choose the *LM Studio* preset.

If you open Convo from a website rather than from `localhost`, Ollama may need `OLLAMA_ORIGINS=*` set before the browser is allowed to talk to it.

## Voices
Convo uses the browser's built-in speech (the Web Speech API). Every browser supports it, but the voice list differs:
- **Microsoft Edge on Windows** has dozens of very natural "Online (Natural)" voices. This is the best experience.
- **Chrome** uses your OS voices plus a few Google voices.
- **macOS and Safari** have good built-in system voices.
- **Linux** voices are often robotic (espeak).

Each speaker card has a voice picker, ▶ to preview, and ✎ for personality, speed, pitch and colour.

## Features
- Modes: **Debate**, **Collaborate**, **Casual chat**, **Improv scene**, **Interview**.
- 🎲 random topics; leave the subject empty for a surprise.
- Streaming text with the spoken sentence highlighted. The next line is written while the current one is spoken, so there's no dead air.
- **Moderator curveballs:** type a line mid-conversation and both speakers react to it. Press 📌 to make it a lasting scene fact instead.
- **🌍 Scene: living world facts.** Add facts to the speakers' world at any time ("all sparkling water is cold", "it's the year 3000"). They shape every reply from the next turn on. Each fact can be:
  - **Quiet** (simply true) or **📢 announced** (breaking news they react to);
  - known to **everyone**, or a **🔒 secret** only one speaker knows;
  - **forever**, or **timed** (true for the next N lines);
  - **switched off** (click it), **removed quietly** (×), or **retconned** (↩: they're told it's no longer true).
  What was already said stays said; facts only shape what comes next.
  - **🎲 Twist** lets the AI invent a fact, and **🎭 Presets** load whole worlds (pirate cove, year 3000, zombie apocalypse…).
- **Endless mode** with a rolling summary, so long conversations never overflow the model's memory.
- **Referee (optional):** a hidden judge that ends the show when the speakers agree, conclude, or go in circles, and names a debate winner.
- **Anti-loop nudges:** secret per-turn moderator notes that keep models from collapsing into "great point, I agree!"
- Keyboard: <kbd>Space</kbd> pause/resume, <kbd>Esc</kbd> stop.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run smoke      # headless test conversation against http://127.0.0.1:8080/v1
```

Project layout:

```
src/engine/   conversation loop, prompts (modes, nudges, referee, summary), text utils
src/llm/      model backends: OpenAI-compatible server, in-browser WebLLM
src/voice/    all speech code (Web Speech API) behind a small interface
src/components/  UI
```

`src/engine/prompts.ts` is where the personality of the app lives. Tune it freely.

## Deploy (free static hosting)
`npm run build` produces a fully static `dist/` folder. On **Cloudflare Pages**, set the build command to `npm run build` and the output directory to `dist`. Any static host works.

## License
MIT
