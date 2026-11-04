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

/**
 * Removes <think>…</think> blocks from a token stream (some "thinking" models put
 * their reasoning inline). Handles tags split across chunks. Never speak thoughts.
 */
export class ThinkStripper {
  private buf = "";
  private inThink = false;
  private trimNext = false;

  push(piece: string): string {
    this.buf += piece;
    let out = "";
    for (;;) {
      if (!this.inThink && this.trimNext) {
        this.buf = this.buf.replace(/^\s+/, "");
        if (this.buf) this.trimNext = false;
      }
      if (this.inThink) {
        const end = this.buf.indexOf("</think>");
        if (end < 0) {
          this.buf = this.buf.slice(-8); // keep a possible partial closing tag
          return out;
        }
        this.buf = this.buf.slice(end + 8);
        this.inThink = false;
        this.trimNext = true;
      } else {
        const start = this.buf.indexOf("<think>");
        if (start >= 0) {
          out += this.buf.slice(0, start);
          this.buf = this.buf.slice(start + 7);
          this.inThink = true;
          continue;
        }
        // Hold back a trailing "<", "<th"… in case a tag is arriving.
        const lt = this.buf.lastIndexOf("<");
        const hold = lt >= 0 && "<think>".startsWith(this.buf.slice(lt)) ? this.buf.length - lt : 0;
        out += this.buf.slice(0, this.buf.length - hold);
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
    }
  }
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
