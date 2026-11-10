import { useEffect, useState } from "react";
import type { ConversationSettings } from "../engine/types.ts";
import { SERVER_PRESETS } from "../llm/openaiCompat.ts";
import { BROWSER_MODELS, isBrowserModelCached, webGpuSupported } from "../llm/webllm.ts";
import type { BackendSettings } from "../state/defaults.ts";
import type { GpuInfo } from "../state/device.ts";
import { ModelLicenseLine } from "./ModelLicenseLine.tsx";

export interface ServerStatus {
  state: "unknown" | "checking" | "ok" | "down";
  models: string[];
  message: string;
}

export interface BrowserLoad {
  state: "idle" | "loading" | "ready" | "error";
  progress: number;
  text: string;
}

interface Props {
  backend: BackendSettings;
  settings: ConversationSettings;
  server: ServerStatus;
  browser: BrowserLoad;
  onBackend: (b: BackendSettings) => void;
  onSettings: (s: ConversationSettings) => void;
  onTestServer: () => void;
  onLoadBrowser: () => void;
  onResetAll: () => void;
  onClose: () => void;
  mobile: boolean;
  gpu: GpuInfo | null;
  /** Page is served from this machine / LAN (no permission prompt for local servers). */
  local: boolean;
}

export function SettingsPanel(p: Props) {
  const { backend: b, settings: s } = p;
  const setB = (patch: Partial<BackendSettings>) => p.onBackend({ ...b, ...patch });
  const setS = (patch: Partial<ConversationSettings>) => p.onSettings({ ...s, ...patch });
  const [cached, setCached] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (b.kind !== "browser" || !webGpuSupported) return;
    let alive = true;
    void Promise.all(BROWSER_MODELS.map(async (m) => [m.id, await isBrowserModelCached(m.id)] as const)).then(
      (pairs) => alive && setCached(Object.fromEntries(pairs)),
    );
    return () => {
      alive = false;
    };
  }, [b.kind, p.browser.state]);

  return (
    <div className="drawer-wrap" onClick={p.onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Settings">
        <header className="drawer-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close settings">✕</button>
        </header>

        <h3>Where the AI runs</h3>
        <div className="choice-cards">
          <button className={`choice ${b.kind === "server" ? "on" : ""}`} onClick={() => setB({ kind: "server" })}>
            {p.mobile ? (
              <>
                <b>Model server on your network</b>
                <small>Advanced: a computer on your Wi-Fi running llama.cpp, Ollama or LM Studio.</small>
              </>
            ) : (
              <>
                <b>Local model server</b>
                <small>llama.cpp, Ollama or LM Studio on your computer. Bigger, smarter models.</small>
              </>
            )}
          </button>
          <button
            className={`choice ${b.kind === "browser" ? "on" : ""}`}
            onClick={() => setB({ kind: "browser" })}
            disabled={!webGpuSupported}
            title={webGpuSupported ? "" : "Needs WebGPU (recent Chrome or Edge)"}
          >
            <b>In this browser</b>
            <small>{webGpuSupported ? "Nothing to install. Downloads a small model once." : "Not available: this browser lacks WebGPU."}</small>
          </button>
        </div>

        {b.kind === "server" ? (
          <div className="group">
            {!p.local && !p.mobile && (
              <p className="muted small">
                Because this page comes from a website, your browser will ask whether it may "access other apps and
                services on this device". Allow it so Convo can reach the model server on your computer. Convo only
                connects to the address below.
              </p>
            )}
            {p.mobile && (
              <p className="muted small">
                A phone can't run the server itself. Start it on a computer with <code>--host 0.0.0.0</code> (Ollama:{" "}
                <code>OLLAMA_HOST=0.0.0.0</code>) and enter that computer's address below, e.g.{" "}
                <code>http://192.168.1.20:8080/v1</code>. This only works if this page is also opened from your own network,
                not from a public website.
              </p>
            )}
            <div className="chips">
              {SERVER_PRESETS.map((x) => (
                <button key={x.baseUrl} className={`chip ${b.baseUrl === x.baseUrl ? "on" : ""}`} onClick={() => setB({ baseUrl: x.baseUrl, model: "" })}>
                  {x.label}
                </button>
              ))}
            </div>
            <label className="field stack">
              <span>Server URL (OpenAI-compatible)</span>
              <input value={b.baseUrl} onChange={(e) => setB({ baseUrl: e.target.value })} spellCheck={false} />
            </label>
            <label className="field stack">
              <span>Model</span>
              {p.server.models.length ? (
                <select value={b.model} onChange={(e) => setB({ model: e.target.value })}>
                  {p.server.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input value={b.model} placeholder="e.g. llama3.2 (Ollama needs a name)" onChange={(e) => setB({ model: e.target.value })} />
              )}
            </label>
            <details>
              <summary>API key (usually not needed)</summary>
              <input type="password" value={b.apiKey} onChange={(e) => setB({ apiKey: e.target.value })} />
            </details>
            <div className="row-actions">
              <button className="btn" onClick={p.onTestServer}>Test connection</button>
              <span className={`pill ${p.server.state}`}>{p.server.message || p.server.state}</span>
            </div>
            <details className="help">
              <summary>How do I run a local model server?</summary>
              <p><b>Ollama</b> (easiest): install from ollama.com, then run <code>ollama pull llama3.2</code>. Choose the Ollama preset above and pick the model.</p>
              <p><b>llama.cpp</b>: <code>llama-server -m your-model.gguf -ngl 99 -c 8192 --jinja</code>, then use the llama.cpp preset.</p>
              <p><b>LM Studio</b>: load a model and start its local server, then use the LM Studio preset.</p>
              <p>Opening this page from a website (not your own computer)? Ollama may need <code>OLLAMA_ORIGINS=*</code> set so the browser is allowed to talk to it.</p>
            </details>
          </div>
        ) : (
          <div className="group">
            <div className="model-list">
              {[...BROWSER_MODELS]
                // On phones, list the phone-friendly models first.
                .sort((x, y) => (p.mobile ? Number(!!y.phone) - Number(!!x.phone) : 0))
                .map((m) => {
                  const unsupported = !!m.needsF16 && p.gpu !== null && !p.gpu.f16;
                  const note = unsupported
                    ? "Not supported by this device's GPU"
                    : p.mobile && !m.phone
                      ? `${m.note} · probably too big for a phone`
                      : m.note;
                  return (
                    <label key={m.id} className={`model ${b.browserModel === m.id ? "on" : ""} ${unsupported ? "disabled" : ""}`}>
                      <input
                        type="radio"
                        name="bm"
                        checked={b.browserModel === m.id}
                        disabled={unsupported}
                        onChange={() => setB({ browserModel: m.id })}
                      />
                      <span className="m-name">
                        {m.label}
                        {m.phone && <span className="m-tag">📱 phone-friendly</span>}
                      </span>
                      <span className="m-note">{note}</span>
                      <span className="m-lic"><ModelLicenseLine id={m.id} compact /></span>
                      <span className="m-size">{cached[m.id] ? "downloaded" : `${m.sizeGB} GB`}</span>
                    </label>
                  );
                })}
            </div>
            <div className="row-actions">
              <button className="btn" onClick={p.onLoadBrowser} disabled={p.browser.state === "loading"}>
                {p.browser.state === "ready" ? "Loaded ✓" : cached[b.browserModel] ? "Load model" : "Download & load"}
              </button>
              {p.browser.state === "loading" && <progress value={p.browser.progress} max={1} />}
            </div>
            {p.browser.text && <p className="muted small">{p.browser.text}</p>}
            <label className="toggle">
              <input type="checkbox" checked={!!b.gentleGpu} onChange={(e) => setB({ gentleGpu: e.target.checked })} />
              <span>
                Go easy on the GPU (for screen recording): the model pauses between words so OBS and other recorders don't
                drop frames. Sounds the same; text appears a little slower.
              </span>
            </label>
            <p className="muted small">
              Models are downloaded from their public hosts, not from this site. Downloading a model means accepting its
              license (linked under each model).
            </p>
          </div>
        )}

        <h3>Conversation</h3>
        <div className="group">
          <label className="field">
            <span>Reply length</span>
            <select value={s.replyLength} onChange={(e) => setS({ replyLength: e.target.value as ConversationSettings["replyLength"] })}>
              <option value="short">Short (1–2 sentences)</option>
              <option value="medium">Medium (2–4 sentences)</option>
              <option value="long">Long (a paragraph)</option>
            </select>
          </label>
          <label className="field">
            <span>Turns</span>
            <select value={s.turnLimit} onChange={(e) => setS({ turnLimit: +e.target.value })}>
              {[6, 10, 16, 24, 40].map((n) => (
                <option key={n} value={n}>{n} lines</option>
              ))}
              <option value={0}>Endless ∞</option>
            </select>
          </label>
          <label className="field">
            <span>Referee</span>
            <select value={s.refereeEvery} onChange={(e) => setS({ refereeEvery: +e.target.value })}>
              <option value={0}>Off</option>
              <option value={4}>Check every 4 lines</option>
              <option value={6}>Check every 6 lines</option>
              <option value={10}>Check every 10 lines</option>
            </select>
          </label>
          <p className="muted small">The referee is a hidden extra AI call that ends the show once the speakers reach agreement, a conclusion, or start going in circles.</p>
          <label className="field">
            <span>Creativity {s.temperature.toFixed(2)}</span>
            <input type="range" min={0.2} max={1.5} step={0.05} value={s.temperature} onChange={(e) => setS({ temperature: +e.target.value })} />
          </label>
          <label className="field">
            <span>Memory (recent lines)</span>
            <input type="number" min={4} max={40} value={s.contextTurns} onChange={(e) => setS({ contextTurns: Math.max(4, +e.target.value || 8) })} />
          </label>
          <p className="muted small">Older lines are condensed into a running summary, so endless conversations never run out of room.</p>
          <label className="toggle">
            <input type="checkbox" checked={s.antiLoop} onChange={(e) => setS({ antiLoop: e.target.checked })} />
            <span>Spice it up: secret moderator nudges that stop "I totally agree" loops</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={s.speech} onChange={(e) => setS({ speech: e.target.checked })} />
            <span>Speak out loud</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={s.revealWithSpeech}
              disabled={!s.speech}
              onChange={(e) => setS({ revealWithSpeech: e.target.checked })}
            />
            <span>Show text as it's spoken (otherwise text appears as soon as it's written, ahead of the voice)</span>
          </label>
          <p className="muted small">Tip: Microsoft Edge offers many extra natural-sounding voices.</p>
        </div>

        <h3>Advanced</h3>
        <div className="group">
          <label className="toggle">
            <input type="checkbox" checked={!!s.advanced} onChange={(e) => setS({ advanced: e.target.checked })} />
            <span>Enable advanced features: a 🔍 on each line shows exactly what the model was given (the behind-the-scenes prompt)</span>
          </label>
        </div>

        <div className="row-actions end">
          <button className="btn ghost" onClick={p.onResetAll}>Reset everything to defaults</button>
        </div>
      </aside>
    </div>
  );
}
