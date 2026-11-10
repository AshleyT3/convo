# Convo

**Two AIs. One topic. Out loud.**

Pick a subject, press **Start**, and two AI characters debate, collaborate, chat or improvise with each other, each speaking in its own voice. It's free: the AI runs on your own device, and the voices are the ones built into your browser and operating system. No accounts, no API keys, no server costs.

It's a novelty, and also a neat way to *see* what language models do: the same model weights, prompted from two seats, playing off each other one turn at a time.

## Two ways to run the AI

| | In your browser | Local model server |
|---|---|---|
| Install | Nothing | Ollama, llama.cpp or LM Studio |
| Models | Small (0.4 to 5 GB, downloaded once) | Anything your machine can run |
| Needs | Chrome or Edge with WebGPU | Any modern browser |
| Feel | Quick, often charmingly naive | Smarter, sharper banter |

Open **⚙ Settings** in the app to choose. On first visit Convo picks for you:
- **Desktop:** it tries a local server first, then falls back to in-browser AI.
- **Phones:** in-browser with a small model. A phone can't run a model server itself, but it can use one on a computer on the same Wi-Fi (advanced; see Settings).

In-browser models range from SmolLM2 360M (tiny, silly) through Llama 3.2 3B (the default) to Llama 3.1 8B, Qwen3 8B and Gemma 2 9B, which need a strong GPU.

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

Each speaker card has a voice picker, ▶ to preview, and ✎ for personality, speed, pitch and color.

## Features
- Modes: **Debate**, **Collaborate**, **Casual chat**, **Improv scene**, **Interview**.
- 🎲 random topics; leave the subject empty for a surprise.
- Streaming text with the spoken sentence highlighted. The next line is written while the current one is spoken, so there's no dead air.
- **Moderator curveballs:** type a line mid-conversation and both speakers react to it. Press 📌 to make it a lasting scene fact instead.
- **🌍 Scene: living world facts.** Add facts to the speakers' world at any time ("all sparkling water is cold", "it's the year 3000"). They shape every reply from the next turn on. Each fact can be:
  - **Quiet** (simply true) or **📢 announced** (breaking news they react to);
  - known to **everyone**, or a **🔒 secret** only one speaker knows;
  - **forever**, or **timed** (true for the next N lines);
  - **switched off** (click it), **edited** (✎), **removed quietly** (×), or **retconned** (↩: they're told it's no longer true).
  - **📋 Copied** as a list, one per line, and **pasted** back into the "Add a fact" box. Items already in the scene are skipped.
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
`npm run build` produces a fully static `dist/` folder that any static host can serve, at a domain root or under any path.

**Cloudflare Worker at `yourdomain.com/convo`** (config included):
1. In `wrangler.jsonc`, replace `example.com` with your domain. The domain must be a zone in your Cloudflare account.
2. Run `npx wrangler login` once.
3. Run `npm run deploy`. This builds into `cf-site/convo/` and deploys a static-assets Worker on the route `yourdomain.com/convo*`.

`npm run build:cf && npm run preview:cf` serves the same build locally at `http://localhost:4173/convo/`.

Notes:
- Redirect Rules run before Workers. If an existing redirect catches every path on the domain, exclude `/convo` from it.
- The domain needs a proxied (orange-cloud) DNS record for Worker routes to take effect.

## Advanced: see behind the curtain
Tick **⚙ Settings → Advanced** and each line gets a 🔍 button. It shows exactly what the model was given for that line:
- the setup (persona, rules, world facts, secrets);
- the other speakers' lines as "user" messages and the speaker's own as "assistant";
- the hidden per-turn direction.

## Privacy
The conversation is generated on your device: in your browser, or by the model server you point it at. Convo has no backend and collects nothing.
- In-browser models are downloaded once from their public model hosts, then cached by your browser.
- **Voices:** local system voices run on your device. "Online" or "Natural" voices (Microsoft Edge) and Google voices (Chrome) are cloud voices: the browser sends the spoken text to Microsoft or Google to synthesise it. Pick a local voice if that matters to you.

## Model licenses
Convo doesn't host or distribute model weights; the browser downloads them from their public hosts. Each model has its own license, linked in ⚙ Settings, and downloading one means accepting it.

| In-browser models | License |
|---|---|
| Llama 3.2 1B / 3B, Llama 3.1 8B | Llama Community License and Acceptable Use Policy. **Built with Llama** |
| Gemma 2 2B / 9B | Gemma Terms of Use and Prohibited Use Policy |
| Qwen3 8B, Qwen 2.5 7B, SmolLM2 360M | Apache 2.0 |
| Phi 3.5 mini | MIT |

Only models whose licenses allow use in a free, donation-supported app are included.

## Credits
- [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0) for in-browser models, [React](https://react.dev) and [Vite](https://vite.dev).
- Models are made by their publishers: Meta (Llama), Alibaba (Qwen), Google (Gemma), Microsoft (Phi) and Hugging Face (SmolLM).

## Support
Convo is free. If it made you laugh, you can support its maker at [Buy Me a Coffee](https://buymeacoffee.com/ashleypurringtech) or [Ko-fi](https://ko-fi.com/ashleypurringtech), or subscribe on [YouTube](https://www.youtube.com/@AshleyPurringTech). Forking? Your own links go in `src/site.ts`.

All product names and trademarks are the property of their respective owners and are used here only to identify compatible software. Convo is an independent project, not affiliated with or endorsed by any of them.

## License
MIT. See [LICENSE](LICENSE).
