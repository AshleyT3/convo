// Zero-install backend: runs a small model inside the browser on the GPU via
// WebGPU (WebLLM). The first run downloads the model (cached afterwards).
// The library is imported lazily so people using a local server never load it.

import { ThinkStripper, type ChatMessage, type ChatOptions, type LlmBackend } from "./types.ts";

export interface BrowserModel {
  id: string;
  label: string;
  sizeGB: number;
  note: string;
  /** Small enough to be a reasonable bet on a phone. */
  phone?: boolean;
  /** Needs the WebGPU "shader-f16" feature. */
  needsF16?: boolean;
  /** A "thinking" model: thinking is switched off and stripped. */
  thinking?: boolean;
  license: ModelLicense;
}

export interface ModelLicense {
  name: string;
  url: string;
  /** Use policy users must follow (Llama AUP, Gemma prohibited-use policy). */
  policyUrl?: string;
  /** Llama licence: products must display "Built with Llama". */
  builtWithLlama?: boolean;
}

const LLAMA_32: ModelLicense = {
  name: "Llama 3.2 Community License",
  url: "https://www.llama.com/llama3_2/license/",
  policyUrl: "https://www.llama.com/llama3_2/use-policy/",
  builtWithLlama: true,
};
const LLAMA_31: ModelLicense = {
  name: "Llama 3.1 Community License",
  url: "https://www.llama.com/llama3_1/license/",
  policyUrl: "https://www.llama.com/llama3_1/use-policy/",
  builtWithLlama: true,
};
const GEMMA: ModelLicense = {
  name: "Gemma Terms of Use",
  url: "https://ai.google.dev/gemma/terms",
  policyUrl: "https://ai.google.dev/gemma/prohibited_use_policy",
};
const APACHE: ModelLicense = { name: "Apache 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" };
const MIT: ModelLicense = { name: "MIT", url: "https://opensource.org/license/mit" };

// Only models whose licences allow use in a free, possibly donation-supported app.
export const BROWSER_MODELS: BrowserModel[] = [
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", sizeGB: 2.3, note: "Recommended: good balance", license: LLAMA_32 },
  { id: "gemma-2-2b-it-q4f16_1-MLC", label: "Gemma 2 2B", sizeGB: 1.9, note: "Chatty, light", license: GEMMA },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", sizeGB: 0.9, note: "Fast and a bit naive", phone: true, license: LLAMA_32 },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", sizeGB: 0.4, note: "Tiny. Expect glorious nonsense", phone: true, license: APACHE },
  { id: "Phi-3.5-mini-instruct-q4f16_1-MLC", label: "Phi 3.5 mini", sizeGB: 3.7, note: "Smarter, heavier", license: MIT },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC", label: "Llama 3.1 8B", sizeGB: 5.0, note: "Most robust large model. Strong GPU", license: LLAMA_31 },
  { id: "Qwen3-8B-q4f16_1-MLC", label: "Qwen3 8B", sizeGB: 5.7, note: "Newest and sharpest. Strong GPU", thinking: true, license: APACHE },
  { id: "gemma-2-9b-it-q4f16_1-MLC", label: "Gemma 2 9B", sizeGB: 6.4, note: "Largest. Great banter. Strong GPU", needsF16: true, license: GEMMA },
  { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 7B", sizeGB: 5.1, note: "Large, solid. Strong GPU", license: APACHE },
];

export function browserModelById(id: string): BrowserModel | undefined {
  return BROWSER_MODELS.find((m) => m.id === id);
}

export const DEFAULT_DESKTOP_MODEL = "Llama-3.2-3B-Instruct-q4f16_1-MLC";
export const DEFAULT_PHONE_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";

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
    let finished = false;
    const thinking = BROWSER_MODELS.find((m) => m.id === this.id)?.thinking;
    const strip = new ThinkStripper();
    try {
      const stream = await e.chat.completions.create({
        messages: adaptMessages(this.id, messages),
        stream: true,
        temperature: opts.temperature ?? 0.9,
        max_tokens: Math.min(opts.maxTokens ?? 400, 600),
        stop: opts.stop?.slice(0, 4),
        ...(thinking ? { extra_body: { enable_thinking: false } } : {}),
      });
      for await (const chunk of stream) {
        if (opts.signal?.aborted) return;
        const piece = strip.push(chunk.choices[0]?.delta?.content ?? "");
        if (piece) yield piece;
      }
      finished = true;
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      // Consumer stopped early (e.g. length cap): stop generating on the GPU too.
      if (!finished) e.interruptGenerate();
    }
  }
}
