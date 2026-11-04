// Backend for any OpenAI-compatible server: llama.cpp `llama-server`, Ollama (/v1),
// LM Studio, vLLM, etc. Uses plain fetch + Server-Sent Events, so it works in the
// browser and in Node.

import { ThinkStripper, type ChatMessage, type ChatOptions, type LlmBackend } from "./types.ts";

export interface OpenAiCompatConfig {
  baseUrl: string; // e.g. http://127.0.0.1:8080/v1
  model?: string; // llama-server ignores it; Ollama/LM Studio need it
  apiKey?: string;
}

export const SERVER_PRESETS = [
  { label: "llama.cpp (llama-server)", baseUrl: "http://127.0.0.1:8080/v1" },
  { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function headers(cfg: OpenAiCompatConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

/** Lists model ids the server reports (also serves as a connection test). */
export async function listServerModels(cfg: OpenAiCompatConfig, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${trimBase(cfg.baseUrl)}/models`, { headers: headers(cfg), signal });
  if (!res.ok) throw new Error(`Server answered ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  return (body.data ?? []).map((m) => m.id);
}

export class OpenAiCompatBackend implements LlmBackend {
  readonly label: string;
  private readonly cfg: OpenAiCompatConfig;

  constructor(cfg: OpenAiCompatConfig) {
    this.cfg = cfg;
    this.label = `${cfg.model || "local model"} @ ${trimBase(cfg.baseUrl).replace(/^https?:\/\//, "")}`;
  }

  async *chat(messages: ChatMessage[], opts: ChatOptions = {}): AsyncIterable<string> {
    const body: Record<string, unknown> = {
      model: this.cfg.model || "local",
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.9,
      max_tokens: opts.maxTokens ?? 400,
      // Reasoning models (e.g. gpt-oss) think before answering; keep that short.
      // llama-server passes this to the chat template; other servers ignore it.
      chat_template_kwargs: { reasoning_effort: "low" },
    };
    if (opts.stop?.length) body.stop = opts.stop.slice(0, 4);

    const res = await fetch(`${trimBase(this.cfg.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: headers(this.cfg),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`Model server error ${res.status}: ${text.slice(0, 300)}`);
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const strip = new ThinkStripper();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          let chunk: { choices?: { delta?: { content?: string | null } }[]; error?: { message?: string } };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (chunk.error) throw new Error(chunk.error.message ?? "Model server error");
          const piece = strip.push(chunk.choices?.[0]?.delta?.content ?? "");
          if (piece) yield piece;
        }
      }
    } finally {
      // Also stops the server-side generation if the consumer bailed out early.
      reader.cancel().catch(() => {});
    }
  }
}
