// The only thing the rest of the app knows about language models.
// Any backend (local OpenAI-compatible server, in-browser WebLLM, ...) implements this.

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export interface LlmBackend {
  /** Human-readable label, e.g. "llama.cpp @ 127.0.0.1:8080". */
  readonly label: string;
  /** Streams visible answer text (reasoning/thinking tokens are dropped). */
  chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
}

/** Collects a full streamed reply into one string. */
export async function complete(
  backend: LlmBackend,
  messages: ChatMessage[],
  opts?: ChatOptions,
): Promise<string> {
  let out = "";
  for await (const piece of backend.chat(messages, opts)) out += piece;
  return out;
}
