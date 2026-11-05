// All voice handling lives here. Uses the standard Web Speech API
// (window.speechSynthesis), which every major browser implements; only the
// list of voices differs (Edge on Windows has many great "Natural" voices).
// The rest of the app only sees: listVoices(), defaults, and the Speech interface.

import type { Speech } from "../engine/conversation.ts";
import type { Speaker } from "../engine/types.ts";

export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  local: boolean;
  gender: "female" | "male" | "unknown";
  /** Higher = nicer sounding (neural/natural voices first). */
  quality: number;
}

export const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

const FEMALE = /\b(female|woman|aria|jenny|zira|michelle|ava|emma|sonia|libby|samantha|karen|moira|tessa|fiona|victoria|susan|hazel|heera|natasha|clara|sara|jane|nancy|ana|elizabeth|catherine|linda|heather|kimberly|salli|joanna|ivy|kendra|amber|ashley|cora|monica|serena|allison|nicky|ellie|maisie|olivia|isabella|sophia|zoe|google us english|google uk english female)\b/i;
const MALE = /\b(male|man|guy|david|mark|andrew|brian|christopher|eric|ryan|thomas|daniel|alex|fred|george|james|richard|roger|steffan|william|liam|connor|davis|jason|tony|guy|matthew|joey|justin|kevin|russell|oliver|arthur|aaron|reed|rocko|eddy|ralph|google uk english male)\b/i;

function describe(v: SpeechSynthesisVoice): VoiceInfo {
  const n = v.name;
  const gender = MALE.test(n) && !/female/i.test(n) ? "male" : FEMALE.test(n) ? "female" : "unknown";
  let quality = 0;
  if (/natural|neural|premium|enhanced/i.test(n)) quality += 3;
  if (/online/i.test(n)) quality += 1;
  if (/google/i.test(n)) quality += 1;
  if (/espeak|robot/i.test(n)) quality -= 3;
  return { uri: v.voiceURI, name: n, lang: v.lang, local: v.localService, gender, quality };
}

/** Voices load asynchronously in some browsers (Chrome/Edge); wait briefly for them. */
export function loadVoices(): Promise<VoiceInfo[]> {
  if (!speechSupported) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(sortVoices(now.map(describe)));
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      resolve(sortVoices(synth.getVoices().map(describe)));
    };
    synth.addEventListener("voiceschanged", done);
    setTimeout(done, 2500);
  });
}

/** Re-reads the list whenever the browser reports a change (e.g. online voices arriving late). */
export function onVoicesChanged(cb: (v: VoiceInfo[]) => void): () => void {
  if (!speechSupported) return () => {};
  const h = () => cb(sortVoices(window.speechSynthesis.getVoices().map(describe)));
  window.speechSynthesis.addEventListener("voiceschanged", h);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", h);
}

function userLang(): string {
  return (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
}

function sortVoices(list: VoiceInfo[]): VoiceInfo[] {
  const lang = userLang();
  const full = (typeof navigator !== "undefined" ? navigator.language : "").toLowerCase();
  const langScore = (v: VoiceInfo) => {
    const l = v.lang.toLowerCase().replace("_", "-");
    return l === full ? 2 : l.startsWith(lang) ? 1 : 0;
  };
  return [...list].sort(
    (a, b) => langScore(b) - langScore(a) || b.quality - a.quality || a.name.localeCompare(b.name),
  );
}

/**
 * Picks distinct default voices: female for even slots, male for odd ones, in the
 * user's language, best quality first. Falls back to any distinct voices.
 */
export function defaultVoices(voices: VoiceInfo[], count: number): string[] {
  const lang = userLang();
  const pool = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const src = pool.length >= 2 ? pool : voices;
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const want = i % 2 === 0 ? "female" : "male";
    const pick =
      src.find((v) => v.gender === want && !used.has(v.uri)) ??
      src.find((v) => !used.has(v.uri)) ??
      src[0];
    if (pick) used.add(pick.uri);
    out.push(pick?.uri ?? "");
  }
  return out;
}

/**
 * Pause works the same with every voice: many voices (e.g. Chrome's online
 * ones) ignore speechSynthesis.pause(), so instead we cut the sentence off and
 * say it again from the start on resume.
 */
export class BrowserSpeech implements Speech {
  private current: { parts: string[]; index: number; speaker: Speaker; finish: () => void } | null = null;
  private paused = false;
  private attempt = 0;

  speak(text: string, speaker: Speaker): Promise<void> {
    if (!speechSupported || !text.trim()) return Promise.resolve();
    this.current?.finish();
    const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === speaker.voiceURI);
    return new Promise<void>((resolve) => {
      this.current = {
        parts: splitForVoice(text, voice),
        index: 0,
        speaker,
        finish: () => {
          this.current = null;
          this.attempt++;
          resolve();
        },
      };
      if (!this.paused) this.utter();
    });
  }

  private utter() {
    const cur = this.current;
    if (!cur) return;
    const synth = window.speechSynthesis;
    const my = ++this.attempt;
    const u = new SpeechSynthesisUtterance(cur.parts[cur.index]);
    const voice = synth.getVoices().find((v) => v.voiceURI === cur.speaker.voiceURI);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = cur.speaker.rate;
    u.pitch = cur.speaker.pitch;
    const started = Date.now();
    const done = () => {
      clearInterval(watchdog);
      // Ignore events from an utterance we cut off for pausing.
      if (my !== this.attempt || this.paused) return;
      if (++cur.index < cur.parts.length) this.utter();
      else cur.finish();
    };
    u.onend = done;
    u.onerror = done;
    // Some browsers occasionally never fire `end`; don't let the show hang.
    const watchdog = setInterval(() => {
      if (my !== this.attempt) clearInterval(watchdog);
      else if (Date.now() - started > 1500 && !synth.speaking && !synth.pending) done();
    }, 500);
    keepAlive.add(u); // some browsers drop events for garbage-collected utterances
    setTimeout(() => keepAlive.delete(u), 60_000);
    synth.speak(u);
  }

  pause() {
    if (!speechSupported || this.paused) return;
    this.paused = true;
    this.attempt++; // invalidate the in-flight utterance
    window.speechSynthesis.cancel();
  }

  resume() {
    if (!speechSupported || !this.paused) return;
    this.paused = false;
    this.utter();
  }

  cancel() {
    if (!speechSupported) return;
    this.paused = false;
    this.attempt++;
    window.speechSynthesis.cancel();
    this.current?.finish();
  }
}

const keepAlive = new Set<SpeechSynthesisUtterance>();

/**
 * Chrome's Google voices stop after ~15 seconds of speech, so long sentences are
 * split for those voices only, preferably at a comma or other clause break. Each
 * split costs a network round trip, so every other voice (local, or Edge's
 * Natural voices) gets the whole sentence.
 */
const GOOGLE_MAX_CHARS = 200;
function splitForVoice(text: string, voice: SpeechSynthesisVoice | undefined): string[] {
  if (!voice || voice.localService || !/^Google/i.test(voice.name)) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > GOOGLE_MAX_CHARS) {
    const cut = bestBreak(rest);
    if (cut <= 0) break;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  parts.push(rest);
  return parts;
}

/**
 * Where to pause in an over-long sentence, searching between a quarter of the way
 * in and the length limit, nearest the middle: after punctuation if possible,
 * then just before a joining word ("but", "and"…), and only then at any space.
 */
function bestBreak(text: string): number {
  const lo = Math.floor(text.length / 4);
  const hi = Math.min(GOOGLE_MAX_CHARS, text.length - 10);
  const mid = Math.min(text.length / 2, hi);
  const nearest = (re: RegExp, after: boolean) => {
    let best = -1;
    for (const m of text.matchAll(re)) {
      const at = after ? m.index + m[0].trimEnd().length : m.index;
      if (at >= lo && at <= hi && (best < 0 || Math.abs(at - mid) < Math.abs(best - mid))) best = at;
    }
    return best;
  };
  const punct = nearest(/[,;:](?=\s)|\s[-—–](?=\s)/g, true);
  if (punct > 0) return punct;
  // Strong joiners start a clause; "and"/"or" often just join two nouns, so they come last.
  const strong = nearest(/\s(?=(?:but|because|which|while|although|though|without|whereas|unless|since|so that|even if)\s)/gi, false);
  if (strong > 0) return strong;
  const weak = nearest(/\s(?=(?:and|or|so|when|where|if)\s)/gi, false);
  if (weak > 0) return weak;
  return nearest(/\s/g, false);
}

/** Speaks a short sample so users can audition a voice. */
export function previewVoice(speaker: Speaker) {
  const s = new BrowserSpeech();
  s.cancel();
  void s.speak(`Hi, I'm ${speaker.name}. This is how I sound.`, speaker);
}
