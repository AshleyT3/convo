import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Conversation, type ConversationState } from "./engine/conversation.ts";
import { MODES, SUBJECT_IDEAS, modeById } from "./engine/prompts.ts";
import type { ConversationSettings, ModeId, Speaker } from "./engine/types.ts";
import { OpenAiCompatBackend, listServerModels } from "./llm/openaiCompat.ts";
import type { LlmBackend } from "./llm/types.ts";
import { WebLlmBackend, loadBrowserModel, loadedBrowserModel, webGpuSupported } from "./llm/webllm.ts";
import { SettingsPanel, type BrowserLoad, type ServerStatus } from "./components/SettingsPanel.tsx";
import { SpeakerCard } from "./components/SpeakerCard.tsx";
import { Transcript } from "./components/Transcript.tsx";
import {
  DEFAULT_BACKEND,
  DEFAULT_SETTINGS,
  DEFAULT_SPEAKERS,
  type BackendSettings,
  forget,
  loadSaved,
  save,
} from "./state/defaults.ts";
import { BrowserSpeech, defaultVoices, loadVoices, onVoicesChanged, speechSupported, type VoiceInfo } from "./voice/browserSpeech.ts";

const EMPTY: ConversationState = { status: "idle", turns: [], summary: "" };

export function App() {
  const [speakers, setSpeakers] = useState<Speaker[]>(() => loadSaved("speakers", DEFAULT_SPEAKERS));
  const [settings, setSettings] = useState<ConversationSettings>(() => loadSaved("settings", DEFAULT_SETTINGS));
  const [backend, setBackend] = useState<BackendSettings>(() => loadSaved("backend", DEFAULT_BACKEND));
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [state, setState] = useState<ConversationState>(EMPTY);
  const [server, setServer] = useState<ServerStatus>({ state: "unknown", models: [], message: "" });
  const [browser, setBrowser] = useState<BrowserLoad>({ state: "idle", progress: 0, text: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [curveball, setCurveball] = useState("");

  const convo = useRef<Conversation | null>(null);
  const speech = useMemo(() => new BrowserSpeech(), []);

  // Persist preferences (best effort).
  useEffect(() => save("speakers", speakers), [speakers]);
  useEffect(() => save("settings", settings), [settings]);
  useEffect(() => save("backend", backend), [backend]);

  // Live edits apply from the next turn.
  useEffect(() => convo.current?.update(speakers, settings), [speakers, settings]);

  // Voices: load, then give each speaker a distinct default if theirs is missing.
  useEffect(() => {
    const apply = (list: VoiceInfo[]) => {
      setVoices(list);
      if (!list.length) return;
      setSpeakers((sp) => {
        const defaults = defaultVoices(list, sp.length);
        const valid = new Set(list.map((v) => v.uri));
        let changed = false;
        const next = sp.map((s, i) => {
          if (s.voiceURI && valid.has(s.voiceURI)) return s;
          changed = true;
          return { ...s, voiceURI: defaults[i] };
        });
        return changed ? next : sp;
      });
    };
    void loadVoices().then(apply);
    return onVoicesChanged(apply);
  }, []);

  // ---------------------------------------------------------------- backends

  const testServer = useCallback(async (b: BackendSettings = backend) => {
    setServer((s) => ({ ...s, state: "checking", message: "checking…" }));
    try {
      const models = await listServerModels(b, AbortSignal.timeout(4000));
      setServer({ state: "ok", models, message: models.length ? `connected · ${models.length} model${models.length > 1 ? "s" : ""}` : "connected" });
      if (models.length && !models.includes(b.model)) setBackend((x) => ({ ...x, model: models[0] }));
      return true;
    } catch {
      setServer({ state: "down", models: [], message: "can't reach server" });
      return false;
    }
  }, [backend]);

  // Check the server once on start and whenever its URL changes.
  useEffect(() => {
    if (backend.kind === "server") void testServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.kind, backend.baseUrl]);

  const loadBrowser = useCallback(async (): Promise<boolean> => {
    setBrowser({ state: "loading", progress: 0, text: "Starting…" });
    try {
      await loadBrowserModel(backend.browserModel, (p) => setBrowser({ state: "loading", progress: p.progress, text: p.text }));
      setBrowser({ state: "ready", progress: 1, text: "Model loaded and ready." });
      return true;
    } catch (e) {
      setBrowser({ state: "error", progress: 0, text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }, [backend.browserModel]);

  useEffect(() => {
    setBrowser((b) => (loadedBrowserModel() === backend.browserModel ? { ...b, state: "ready" } : { state: "idle", progress: 0, text: "" }));
  }, [backend.browserModel]);

  const makeBackend = (): LlmBackend =>
    backend.kind === "browser"
      ? new WebLlmBackend(backend.browserModel)
      : new OpenAiCompatBackend({ baseUrl: backend.baseUrl, model: backend.model, apiKey: backend.apiKey });

  // ---------------------------------------------------------------- controls

  const running = state.status === "running" || state.status === "paused";
  const hasTurns = state.turns.length > 0;

  const start = async (fresh: boolean) => {
    let s = settings;
    if (!s.subject.trim()) {
      s = { ...s, subject: SUBJECT_IDEAS[Math.floor(Math.random() * SUBJECT_IDEAS.length)] };
      setSettings(s);
    }
    if (backend.kind === "browser" && loadedBrowserModel() !== backend.browserModel) {
      setShowSettings(true);
      if (!(await loadBrowser())) return;
      setShowSettings(false);
    }
    speech.cancel();
    if (fresh || !convo.current) {
      convo.current?.stop();
      convo.current = new Conversation(makeBackend(), speech, speakers, s, setState);
    }
    convo.current.setBackend(makeBackend());
    convo.current.update(speakers, s);
    void convo.current.start();
  };

  const stop = () => convo.current?.stop();
  const clear = () => {
    convo.current?.stop();
    convo.current = null;
    setState(EMPTY);
  };

  const surprise = () => {
    const pick = SUBJECT_IDEAS.filter((x) => x !== settings.subject);
    setSettings({ ...settings, subject: pick[Math.floor(Math.random() * pick.length)] });
  };

  const sendCurveball = () => {
    if (!curveball.trim()) return;
    if (!convo.current) return;
    convo.current.addModeratorNote(curveball);
    setCurveball("");
  };

  const resetAll = () => {
    clear();
    ["speakers", "settings", "backend"].forEach(forget);
    setSpeakers(DEFAULT_SPEAKERS.map((s, i) => ({ ...s, voiceURI: defaultVoices(voices, DEFAULT_SPEAKERS.length)[i] ?? "" })));
    setSettings(DEFAULT_SETTINGS);
    setBackend(DEFAULT_BACKEND);
  };

  // Keyboard: Space = pause/resume (when not typing), Esc = stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (e.key === "Escape") {
        if (showSettings) setShowSettings(false);
        else convo.current?.stop();
      } else if (e.key === " " && !typing && running) {
        e.preventDefault();
        if (state.status === "paused") convo.current?.resume();
        else convo.current?.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, state.status, showSettings]);

  // ---------------------------------------------------------------- view

  const speakingId = state.turns.find((t) => t.speaking)?.speakerId;
  const sideLabel = (i: number) => {
    if (settings.mode === "debate") return i % 2 === 0 ? "For" : "Against";
    if (settings.mode === "interview") return i === 0 ? "Host" : "Guest";
    return "";
  };
  const backendLabel =
    backend.kind === "browser"
      ? `${backend.browserModel.split("-q4")[0]} · in browser`
      : `${backend.model || "local model"} · ${backend.baseUrl.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "")}`;
  const backendOk = backend.kind === "browser" ? browser.state === "ready" || webGpuSupported : server.state === "ok";

  const problem =
    backend.kind === "server" && server.state === "down"
      ? (
          <div className="banner">
            <span>Can't reach a local model server at <code>{backend.baseUrl}</code>.</span>
            <span className="banner-actions">
              <button className="btn small" onClick={() => void testServer()}>Retry</button>
              {webGpuSupported && (
                <button className="btn small primary" onClick={() => { setBackend({ ...backend, kind: "browser" }); setShowSettings(true); }}>
                  Run in browser instead
                </button>
              )}
              <button className="btn small ghost" onClick={() => setShowSettings(true)}>Settings</button>
            </span>
          </div>
        )
      : null;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden><i /><i /></span>
          <div>
            <h1>Convo</h1>
            <p className="tag">Two AIs. One topic. Out loud.</p>
          </div>
        </div>
        <button className="backend-pill" onClick={() => setShowSettings(true)} title="Model settings">
          <span className={`dot ${backendOk ? "ok" : "bad"}`} />
          <span className="bp-text">{backendLabel}</span>
          <span aria-hidden>⚙</span>
        </button>
      </header>

      {problem}
      {!speechSupported && <div className="banner">This browser can't speak aloud. The conversation will still play as text.</div>}

      <div className="controls">
        <div className="subject">
          <input
            value={settings.subject}
            placeholder="What should they talk about? (leave empty for a surprise)"
            onChange={(e) => setSettings({ ...settings, subject: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && !running && void start(true)}
            aria-label="Subject"
          />
          <button className="icon-btn big" title="Surprise me" onClick={surprise}>🎲</button>
        </div>
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={settings.mode === m.id}
              className={`chip ${settings.mode === m.id ? "on" : ""}`}
              title={m.blurb}
              onClick={() => setSettings({ ...settings, mode: m.id as ModeId })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="buttons">
          {!running && (
            <button className="btn primary big" onClick={() => void start(true)}>
              ▶ {hasTurns ? "New conversation" : "Start"}
            </button>
          )}
          {!running && hasTurns && state.status !== "error" && (
            <button className="btn big" onClick={() => void start(false)}>Keep going</button>
          )}
          {state.status === "running" && <button className="btn big" onClick={() => convo.current?.pause()}>❚❚ Pause</button>}
          {state.status === "paused" && <button className="btn primary big" onClick={() => convo.current?.resume()}>▶ Resume</button>}
          {running && <button className="btn big danger" onClick={stop}>■ Stop</button>}
          {!running && hasTurns && <button className="btn ghost" onClick={clear}>Clear</button>}
        </div>
      </div>

      <main className="stage">
        <div className="cards" style={{ gridTemplateColumns: `repeat(${speakers.length}, 1fr)` }}>
          {speakers.map((sp, i) => (
            <SpeakerCard
              key={sp.id}
              speaker={sp}
              voices={voices}
              side={sideLabel(i)}
              speaking={speakingId === sp.id}
              thinking={state.generatingId === sp.id && speakingId !== sp.id}
              onChange={(next) => setSpeakers((all) => all.map((x) => (x.id === next.id ? next : x)))}
            />
          ))}
        </div>

        <Transcript
          turns={state.turns}
          speakers={speakers}
          generatingId={state.generatingId}
          speechOn={settings.speech}
          empty={
            <>
              <p className="big-hint">Pick a topic and a mode, then press <b>Start</b>.</p>
              <p className="muted">{modeById(settings.mode).blurb} Tap ✎ on a card to give someone a personality.</p>
            </>
          }
        />

        {state.error && (
          <div className="banner error">
            <span>Something went wrong: {state.error}</span>
            <button className="btn small" onClick={() => setShowSettings(true)}>Settings</button>
          </div>
        )}

        <div className="footer-bar">
          <input
            value={curveball}
            disabled={!hasTurns}
            placeholder={hasTurns ? "Throw in a curveball as the moderator… (Enter)" : "Once they're talking, you can butt in here"}
            onChange={(e) => setCurveball(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendCurveball()}
            aria-label="Moderator message"
          />
          <span className="stats">
            {state.status === "paused" ? "paused · space to resume" : running ? "space = pause · esc = stop" : ""}
            {state.lastWordsPerSec ? ` · ${state.lastWordsPerSec.toFixed(0)} words/s` : ""}
          </span>
        </div>
      </main>

      {showSettings && (
        <SettingsPanel
          backend={backend}
          settings={settings}
          server={server}
          browser={browser}
          onBackend={setBackend}
          onSettings={setSettings}
          onTestServer={() => void testServer()}
          onLoadBrowser={() => void loadBrowser()}
          onResetAll={resetAll}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
