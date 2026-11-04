// Zero-install backend: runs a small model inside the browser on the GPU via
// WebGPU (WebLLM). The first run downloads the model (cached afterwards).
// The library is imported lazily so people using a local server never load it.

import type { ChatMessage, ChatOptions, LlmBackend } from "./types.ts";

export interface BrowserModel {
  id: string;
  label: string;
  sizeGB: number;
  note: string;
}

export const BROWSER_MODELS: BrowserModel[] = [
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", sizeGB: 2.3, note: "Recommended: good balance" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 3B", sizeGB: 2.5, note: "Good balance" },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B", sizeGB: 1.9, note: "Chatty, light" },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", sizeGB: 0.9, note: "Fast and a bit naive" },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", sizeGB: 0.4, note: "Tiny. Expect glorious nonsense" },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini", sizeGB: 3.7, note: "Smarter, heavier" },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 8B", sizeGB: 5.0, note: "Best quality, needs a strong GPU" },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 7B", sizeGB: 5.1, note: "Best quality, needs a strong GPU" },
];

export const webGpuSupported = typeof navigator !== "undefined" && "gpu" in navigator;

export interface LoadProgress {
  progress: number; // 0..1
  text: string;
}

type Engine = import("@mlc-ai/web-llm").WebWorkerMLCEngine;

let engine: Engine | null = null;
let loadedId = "";
let loading: Promise<Engine> | null = null;

export function loadedBrowserModel(): string {
  return loadedId;
}

export async function isBrowserModelCached(id: string): Promise<boolean> {
  try {
    const lib = await import("@mlc-ai/web-llm");
    return await lib.hasModelInCache(id);
  } catch {
    return false;
  }
}

/** Downloads (first time) and loads a model into the GPU. Safe to call repeatedly. */
export async function loadBrowserModel(id: string, onProgress: (p: LoadProgress) => void): Promise<void> {
  if (!webGpuSupported) throw new Error("This browser doesn't support WebGPU. Try a recent Chrome or Edge.");
  if (engine && loadedId === id) return;
  if (loading) await loading.catch(() => {});
  const lib = await import("@mlc-ai/web-llm");
  const report = (r: { progress: number; text: string }) => onProgress({ progress: r.progress, text: r.text });
  loading = (async () => {
    if (engine) {
      engine.setInitProgressCallback(report);
      await engine.reload(id);
      return engine;
    }
    const worker = new Worker(new URL("./webllm.worker.ts", import.meta.url), { type: "module" });
    return lib.CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: report });
  })();
  try {
    engine = await loading;
    loadedId = id;
  } finally {
    loading = null;
  }
}

/** Some model templates reject a system role; fold it into the first user turn. */
function adaptMessages(id: string, messages: ChatMessage[]): ChatMessage[] {
  if (!/gemma/i.test(id) || messages[0]?.role !== "system") return messages;
  const [sys, ...rest] = messages;
  const out = rest.map((m) => ({ ...m }));
  const firstUser = out.find((m) => m.role === "user");
  if (firstUser) firstUser.content = `${sys.content}\n\n${firstUser.content}`;
  return out;
}

export class WebLlmBackend implements LlmBackend {
  readonly label: string;
  private readonly id: string;

  constructor(id: string) {
    this.id = id;
    this.label = `${BROWSER_MODELS.find((m) => m.id === id)?.label ?? id} (in browser)`;
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    if (!engine || loadedId !== this.id) throw new Error("The in-browser model isn't loaded yet. Open settings and load it.");
    const e = engine;
    const onAbort = () => e.interruptGenerate();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const stream = await e.chat.completions.create({
        messages: adaptMessages(this.id, messages),
        stream: true,
        temperature: opts.temperature ?? 0.9,
        max_tokens: Math.min(opts.maxTokens ?? 400, 600),
        stop: opts.stop?.slice(0, 4),
      });
      for await (const chunk of stream) {
        if (opts.signal?.aborted) return;
        const piece = chunk.choices[0]?.delta?.content;
        if (piece) yield piece;
      }
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}
