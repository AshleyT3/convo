import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Conversation, type ConversationState } from "./engine/conversation.ts";
import { MODES, SCENE_PRESETS, SUBJECT_IDEAS, TWIST_IDEAS, cleanTwist, modeById, twistMessages } from "./engine/prompts.ts";
import type { ConversationSettings, ModeId, SceneFact, Speaker } from "./engine/types.ts";
import { complete } from "./llm/types.ts";
import { ScenePanel, type NewFact } from "./components/ScenePanel.tsx";
import { PromptViewer } from "./components/PromptViewer.tsx";
import { OpenAiCompatBackend, listServerModels } from "./llm/openaiCompat.ts";
import type { LlmBackend } from "./llm/types.ts";
import { Footer } from "./components/Footer.tsx";
import { ModelLicenseLine } from "./components/ModelLicenseLine.tsx";
import { BROWSER_MODELS, DEFAULT_PHONE_MODEL, WebLlmBackend, browserModelById, loadBrowserModel, loadedBrowserModel, webGpuSupported } from "./llm/webllm.ts";
import { getGpuInfo, isMobileDevice, servedLocally, type GpuInfo } from "./state/device.ts";
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
const mobile = isMobileDevice();
const local = servedLocally();

export function App() {
  const [speakers, setSpeakers] = useState<Speaker[]>(() => loadSaved("speakers", DEFAULT_SPEAKERS));
  const [settings, setSettings] = useState<ConversationSettings>(() => loadSaved("settings", DEFAULT_SETTINGS));
  const [backend, setBackend] = useState<BackendSettings>(() => {
    const loaded = loadSaved("backend", DEFAULT_BACKEND);
    // A model that was removed from the list (e.g. for licensing) falls back to the default.
    const saved = browserModelById(loaded.browserModel) ? loaded : { ...loaded, browserModel: DEFAULT_BACKEND.browserModel };
    if (saved.chosen) return saved;
    // Phones can't run a model server themselves: start them in the browser with a small model.
    if (mobile) return { ...saved, kind: "browser", browserModel: DEFAULT_PHONE_MODEL };
    // On a public website, don't touch localhost until the visitor asks (browsers show a
    // permission prompt for that). Start in the browser instead.
    if (!local) return { ...saved, kind: "browser" };
    return saved;
  });
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [notice, setNotice] = useState("");
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [state, setState] = useState<ConversationState>(EMPTY);
  const [server, setServer] = useState<ServerStatus>({ state: "unknown", models: [], message: "" });
  const [browser, setBrowser] = useState<BrowserLoad>({ state: "idle", progress: 0, text: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [curveball, setCurveball] = useState("");
  const [facts, setFacts] = useState<SceneFact[]>(() => loadSaved<SceneFact[]>("facts", []));
  const [twisting, setTwisting] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const convo = useRef<Conversation | null>(null);
  const speech = useMemo(() => new BrowserSpeech(), []);

  // Persist preferences (best effort).
  useEffect(() => save("speakers", speakers), [speakers]);
  useEffect(() => save("settings", settings), [settings]);
  useEffect(() => save("backend", backend), [backend]);
  useEffect(() => save("facts", facts), [facts]);

  // Live edits apply from the next turn.
  useEffect(() => convo.current?.update(speakers, settings, facts), [speakers, settings, facts]);

  // Voices: load, then give each speaker a distinct default if theirs is missing.
  useEffect(() => {
    // Browsers report voices in stages (local first, online ones later), so a
    // saved voice may simply not have arrived yet. Fill empty slots right away,
    // but only replace a missing saved voice once the list has had time to settle.
    let latest: VoiceInfo[] = [];
    const assign = (list: VoiceInfo[], replaceMissing: boolean) => {
      if (!list.length) return;
      setSpeakers((sp) => {
        const defaults = defaultVoices(list, sp.length);
        const valid = new Set(list.map((v) => v.uri));
        let changed = false;
        const next = sp.map((s, i) => {
          if (s.voiceURI && (valid.has(s.voiceURI) || !replaceMissing)) return s;
          changed = true;
          return { ...s, voiceURI: defaults[i] };
        });
        return changed ? next : sp;
      });
    };
    const apply = (list: VoiceInfo[]) => {
      latest = list;
      setVoices(list);
      assign(list, false);
    };
    void loadVoices().then(apply);
    const settle = setTimeout(() => assign(latest, true), 4000);
    const off = onVoicesChanged(apply);
    return () => {
      clearTimeout(settle);
      off();
    };
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

  useEffect(() => {
    void getGpuInfo().then(setGpu);
  }, []);

  // First run on a desktop without a model server: quietly fall back to in-browser AI.
  useEffect(() => {
    if (backend.chosen || backend.kind !== "server" || server.state !== "down" || !gpu?.webgpu) return;
    setBackend((b) => ({ ...b, kind: "browser" }));
    setNotice("No local model server found, so Convo will run a small AI right in your browser (a one-time download). Open ⚙ to change.");
  }, [backend.chosen, backend.kind, server.state, gpu]);

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
    // First run in browser mode: download/load the model right here (progress shows on
    // the main page), then carry straight on into the conversation.
    if (backend.kind === "browser" && loadedBrowserModel() !== backend.browserModel) {
      if (browser.state === "loading") return;
      if (!(await loadBrowser())) return;
    }
    speech.cancel();
    let f = facts;
    if (fresh || !convo.current) {
      // Timed facts carry their remaining lines into the new conversation.
      const used = convo.current?.lineCount() ?? 0;
      f = facts
        .filter((x) => x.expiresAt === undefined || x.expiresAt > used)
        .map((x) => (x.expiresAt === undefined ? x : { ...x, expiresAt: x.expiresAt - used }));
      setFacts(f);
      convo.current?.stop();
      convo.current = new Conversation(makeBackend(), speech, speakers, s, setState);
    }
    convo.current.setBackend(makeBackend());
    convo.current.update(speakers, s, f);
    void convo.current.start();
  };

  // ---------------------------------------------------------------- scene facts

  const lineCount = state.turns.filter((t) => (t.kind ?? "line") === "line").length;
  const live = state.turns.length > 0 && !!convo.current;
  const whoKnows = (scope: string) =>
    scope === "all" ? "" : ` (only ${speakers.find((x) => x.id === scope)?.name ?? "?"} knows)`;

  const applyFacts = (next: SceneFact[]) => {
    setFacts(next);
    convo.current?.update(speakers, settings, next); // don't wait for the effect
  };

  const addFact = (n: NewFact) => {
    const used = convo.current?.lineCount() ?? 0;
    const fact: SceneFact = {
      id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: n.text,
      enabled: true,
      scope: n.scope,
      expiresAt: n.lines > 0 ? used + n.lines : undefined,
    };
    applyFacts([...facts, fact]);
    if (live) {
      const c = convo.current!;
      c.marker(`${n.announce ? "📢 Breaking news" : "🌍 New fact"}${whoKnows(n.scope)}: ${n.text}${n.lines ? ` · for ${n.lines} lines` : ""}`);
      c.sceneEvent(n.text, n.scope, n.announce ? "news" : "reminder");
    }
  };

  const toggleFact = (id: string) => {
    const f = facts.find((x) => x.id === id);
    if (!f) return;
    applyFacts(facts.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)));
    if (live) {
      convo.current!.marker(`🌍 Fact switched ${f.enabled ? "off" : "on"}: ${f.text}`);
      if (!f.enabled) convo.current!.sceneEvent(f.text, f.scope, "reminder");
    }
  };

  const removeFact = (id: string, retcon: boolean) => {
    const f = facts.find((x) => x.id === id);
    if (!f) return;
    applyFacts(facts.filter((x) => x.id !== id));
    if (live) {
      convo.current!.marker(`${retcon ? "↩ Retcon, no longer true" : "🌍 Fact removed"}: ${f.text}`);
      if (retcon) convo.current!.sceneEvent(f.text, f.scope, "retcon");
    }
  };

  const addPreset = (name: string) => {
    const preset = SCENE_PRESETS.find((x) => x.name === name);
    if (!preset) return;
    const have = new Set(facts.map((x) => x.text.toLowerCase()));
    const fresh = preset.facts.filter((t) => !have.has(t.toLowerCase()));
    const added: SceneFact[] = fresh.map((text, i) => ({
      id: `f${Date.now().toString(36)}${i}`,
      text,
      enabled: true,
      scope: "all",
    }));
    applyFacts([...facts, ...added]);
    if (live && added.length) {
      convo.current!.marker(`🎭 Scene: ${preset.name}`);
      convo.current!.sceneEvent(`The scene has changed: ${fresh.join("; ")}`, "all", "news");
    }
  };

  const clearFacts = () => {
    applyFacts([]);
    if (live) convo.current!.marker("🌍 Scene cleared");
  };

  const twist = async (opts: Omit<NewFact, "text">) => {
    const existing = facts.map((f) => f.text);
    const fallback = () => {
      const pool = TWIST_IDEAS.filter((t) => !existing.includes(t));
      return pool[Math.floor(Math.random() * pool.length)] ?? TWIST_IDEAS[0];
    };
    let text = "";
    // The in-browser engine can only do one thing at a time; don't interrupt a running show.
    const canAsk = backend.kind === "server" ? server.state === "ok" : loadedBrowserModel() === backend.browserModel && !running;
    if (canAsk) {
      setTwisting(true);
      try {
        const raw = await complete(makeBackend(), twistMessages(settings.subject, existing), {
          temperature: 1.1,
          maxTokens: 500,
          signal: AbortSignal.timeout(20000),
        });
        text = cleanTwist(raw);
      } catch {
        /* fall back below */
      } finally {
        setTwisting(false);
      }
    }
    if (!text || text.length > 140) text = fallback();
    addFact({ ...opts, text });
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
    ["speakers", "settings", "backend", "facts"].forEach(forget);
    setFacts([]);
    setSpeakers(DEFAULT_SPEAKERS.map((s, i) => ({ ...s, voiceURI: defaultVoices(voices, DEFAULT_SPEAKERS.length)[i] ?? "" })));
    setSettings(DEFAULT_SETTINGS);
    setBackend(mobile ? { ...DEFAULT_BACKEND, kind: "browser", browserModel: DEFAULT_PHONE_MODEL } : local ? DEFAULT_BACKEND : { ...DEFAULT_BACKEND, kind: "browser" });
  };

  // Keyboard: Space = pause/resume (when not typing), Esc = stop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      if (e.key === "Escape") {
        if (inspectId) setInspectId(null);
        else if (showSettings) setShowSettings(false);
        else convo.current?.stop();
      } else if (e.key === " " && !typing && running) {
        e.preventDefault();
        if (state.status === "paused") convo.current?.resume();
        else convo.current?.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, state.status, showSettings, inspectId]);

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

  const cantRunHere = gpu !== null && !gpu.webgpu && (backend.kind === "browser" || server.state === "down");
  const problem = cantRunHere ? (
    <div className="banner">
      <span>
        <b>This device can't run AI on its own.</b> The browser doesn't support WebGPU
        {backend.kind === "server" ? " and no model server answered" : ""}. Try a recent Chrome or Edge on a computer
        {mobile ? "" : ", or run Ollama / llama.cpp and pick it in ⚙ Settings"}.
      </span>
      <span className="banner-actions">
        <button className="btn small ghost" onClick={() => setShowSettings(true)}>Settings</button>
      </span>
    </div>
  ) : backend.kind === "server" && server.state === "down" && (backend.chosen || !gpu?.webgpu)
      ? (
          <div className="banner">
            <span>Can't reach a local model server at <code>{backend.baseUrl}</code>.</span>
            <span className="banner-actions">
              <button className="btn small" onClick={() => void testServer()}>Retry</button>
              {webGpuSupported && (
                <button className="btn small primary" onClick={() => { setBackend({ ...backend, kind: "browser", chosen: true }); setShowSettings(true); }}>
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
      {/* Control deck: sized to its content; scrolls on its own only if it would squeeze the chat. */}
      <div className="deck">
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
      {notice && !problem && (
        <div className="banner info">
          <span>{notice}</span>
          <span className="banner-actions">
            <button className="btn small ghost" onClick={() => setShowSettings(true)}>Settings</button>
            <button className="btn small ghost" onClick={() => setNotice("")} aria-label="Dismiss">✕</button>
          </span>
        </div>
      )}
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
            <button className="btn primary big" onClick={() => void start(true)} disabled={browser.state === "loading"}>
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

      <ScenePanel
        facts={facts}
        speakers={speakers}
        lineCount={lineCount}
        live={live}
        twisting={twisting}
        onAdd={addFact}
        onToggle={toggleFact}
        onRemove={removeFact}
        onTwist={(o) => void twist(o)}
        onPreset={addPreset}
        onClear={clearFacts}
      />

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
      </div>

      <main className="stage">
        <Transcript
          turns={state.turns}
          speakers={speakers}
          generatingId={state.generatingId}
          speechOn={settings.speech}
          onInspect={settings.advanced ? (t) => setInspectId(t.id) : undefined}
          empty={
            <>
              <p className="big-hint">Pick a topic and a mode, then press <b>Start</b>.</p>
              <p className="muted">{modeById(settings.mode).blurb} Tap ✎ on a card to give someone a personality.</p>
            </>
          }
        />

        {backend.kind === "browser" && browser.state === "loading" && (
          <div className="loading-card" role="status">
            <div className="loading-head">
              <b>Getting {BROWSER_MODELS.find((m) => m.id === backend.browserModel)?.label ?? "the AI"} ready…</b>
              <span>{Math.round(browser.progress * 100)}%</span>
            </div>
            <progress value={browser.progress} max={1} />
            <p className="muted small">
              {browser.text.includes("cache")
                ? "Loading from your browser's cache."
                : `One-time download (about ${BROWSER_MODELS.find((m) => m.id === backend.browserModel)?.sizeGB ?? "a few"} GB). Next time it starts in seconds.`}{" "}
              The conversation starts automatically when it's ready.
            </p>
            <ModelLicenseLine id={backend.browserModel} />
          </div>
        )}
        {backend.kind === "browser" && browser.state === "error" && (
          <div className="banner error">
            <span>Couldn't load the in-browser AI: {browser.text}</span>
            <button className="btn small" onClick={() => setShowSettings(true)}>Settings</button>
          </div>
        )}

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
          <button
            className="icon-btn"
            title="Pin it: make this a lasting scene fact (announced) instead of a one-time remark"
            disabled={!curveball.trim()}
            onClick={() => {
              addFact({ text: curveball.trim(), scope: "all", announce: true, lines: 0 });
              setCurveball("");
            }}
          >
            📌
          </button>
          <span className="stats">
            {state.status === "paused" ? "paused · space to resume" : running ? "space = pause · esc = stop" : ""}
            {state.lastWordsPerSec ? ` · ${state.lastWordsPerSec.toFixed(0)} words/s` : ""}
          </span>
        </div>
      </main>

      {inspectId && (() => {
        // Looked up live, so the reply text keeps filling in while it streams.
        const t = state.turns.find((x) => x.id === inspectId);
        return t?.prompt ? <PromptViewer turn={t} speakers={speakers} onClose={() => setInspectId(null)} /> : null;
      })()}

      {showSettings && (
        <SettingsPanel
          backend={backend}
          settings={settings}
          server={server}
          browser={browser}
          onBackend={(b) => {
            setBackend({ ...b, chosen: true });
            setNotice("");
          }}
          mobile={mobile}
          local={local}
          gpu={gpu}
          onSettings={setSettings}
          onTestServer={() => void testServer()}
          onLoadBrowser={() => void loadBrowser()}
          onResetAll={resetAll}
          onClose={() => setShowSettings(false)}
        />
      )}

      <Footer license={backend.kind === "browser" ? browserModelById(backend.browserModel)?.license : undefined} />
    </div>
  );
}
