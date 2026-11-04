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
  const langScore = (v: VoiceInfo) => (v.lang.toLowerCase().startsWith(lang) ? 1 : 0);
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

export class BrowserSpeech implements Speech {
  private live = new Set<{ u: SpeechSynthesisUtterance; finish: () => void }>();

  speak(text: string, speaker: Speaker): Promise<void> {
    if (!speechSupported || !text.trim()) return Promise.resolve();
    const synth = window.speechSynthesis;
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voice = synth.getVoices().find((v) => v.voiceURI === speaker.voiceURI);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = speaker.rate;
      u.pitch = speaker.pitch;
      const started = Date.now();
      let watchdog: ReturnType<typeof setInterval> | undefined;
      const entry = {
        u,
        finish: () => {
          if (watchdog) clearInterval(watchdog);
          this.live.delete(entry);
          resolve();
        },
      };
      // Keep a reference: some browsers drop events for garbage-collected utterances.
      this.live.add(entry);
      u.onend = entry.finish;
      u.onerror = entry.finish;
      // Some browsers occasionally never fire `end`; don't let the show hang.
      watchdog = setInterval(() => {
        if (Date.now() - started > 1500 && !synth.speaking && !synth.pending) entry.finish();
      }, 500);
      synth.speak(u);
    });
  }

  pause() {
    if (speechSupported) window.speechSynthesis.pause();
  }

  resume() {
    if (speechSupported) window.speechSynthesis.resume();
  }

  cancel() {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    for (const e of [...this.live]) e.finish();
  }
}

/** Speaks a short sample so users can audition a voice. */
export function previewVoice(speaker: Speaker) {
  const s = new BrowserSpeech();
  s.cancel();
  void s.speak(`Hi, I'm ${speaker.name}. This is how I sound.`, speaker);
}
