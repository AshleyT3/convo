// Prompt design: modes, per-speaker system prompts, hidden moderator nudges,
// the referee and the rolling summary. This file is "the product" — tune freely.

import type { ChatMessage } from "../llm/types.ts";
import type { ConversationSettings, ModeId, ReplyLength, SceneFact, Speaker, Turn } from "./types.ts";

export interface ModeDef {
  id: ModeId;
  label: string;
  blurb: string;
  /** Role instructions for the speaker at `index` among `count` speakers. */
  role(index: number, count: number, subject: string): string;
  nudges: string[];
}

export const MODES: ModeDef[] = [
  {
    id: "debate",
    label: "Debate",
    blurb: "Opposite sides. Nobody gives in easily.",
    role: (i, _n, subject) =>
      i % 2 === 0
        ? `This is a debate. You argue FOR the subject (the "yes" side): "${subject}". Defend it with conviction.`
        : `This is a debate. You argue AGAINST the subject (the "no" side): "${subject}". Attack it with conviction.`,
    nudges: [
      "Find the weakest part of their last argument and attack it directly.",
      "Bring in a vivid concrete example or a short story that supports your side.",
      "Ask them one pointed question they will struggle to answer.",
      "Concede one small point gracefully, then hit back harder somewhere else.",
      "Reframe the whole question in a way that favours your side.",
      "Use a bit of humour at their argument's expense, then make your point.",
    ],
  },
  {
    id: "collaborate",
    label: "Collaborate",
    blurb: "Build something together, one idea at a time.",
    role: (_i, _n, subject) =>
      `You are collaborating with the others to explore and build on: "${subject}". Add your own ideas, refine theirs, and push back when something won't work.`,
    nudges: [
      "Add one specific new idea that nobody has mentioned yet.",
      "Point out a practical problem with the current idea, then propose a fix.",
      "Combine two earlier ideas into something better.",
      "Make the idea more concrete: who, what, how, or a quick example.",
      "Take the idea somewhere bolder or more surprising.",
    ],
  },
  {
    id: "chat",
    label: "Casual chat",
    blurb: "Two friends talking. Tangents welcome.",
    role: (_i, _n, subject) =>
      `You are having a relaxed, friendly conversation, starting from the topic: "${subject}". Tangents and opinions are welcome.`,
    nudges: [
      "Share a short, personal-sounding anecdote related to what was just said.",
      "Take the conversation on a fun tangent.",
      "Disagree a little with something they said, in a friendly way.",
      "Ask them a curious follow-up question.",
      "Bring up a surprising fact or a strong opinion.",
    ],
  },
  {
    id: "improv",
    label: "Improv scene",
    blurb: "Yes-and. Commit to the bit.",
    role: (_i, _n, subject) =>
      `You are performing an improvised comedy scene. The premise: "${subject}". Stay in the scene, accept what your partner establishes ("yes, and"), and add something new and funny each time.`,
    nudges: [
      "Escalate: raise the stakes of the scene.",
      "Introduce an unexpected complication.",
      "Reveal a surprising secret about your character.",
      "Call back to something funny from earlier in the scene.",
      "Heighten whatever is most absurd right now.",
    ],
  },
  {
    id: "interview",
    label: "Interview",
    blurb: "One asks, the other is the 'expert'.",
    role: (i, _n, subject) =>
      i === 0
        ? `You are a sharp, curious interviewer hosting a show about: "${subject}". Ask one question at a time, follow up on interesting answers, and challenge vague ones.`
        : `You are a confident (possibly overconfident) expert guest being interviewed about: "${subject}". Answer with colourful detail and strong opinions.`,
    nudges: [
      "Interviewer: ask a follow-up that digs deeper. Guest: give a surprising specific detail.",
      "Interviewer: challenge something that sounded vague. Guest: double down with an example.",
      "Interviewer: change direction to a new angle. Guest: share a memorable anecdote.",
    ],
  },
];

export function modeById(id: ModeId): ModeDef {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

const LENGTH_TEXT: Record<ReplyLength, string> = {
  short: "Keep each reply to one or two sentences.",
  medium: "Keep each reply to two to four sentences.",
  long: "Keep each reply to a short paragraph of four to six sentences.",
};

/** Token budget: answer length plus headroom for models that "think" first. */
export function maxTokensFor(len: ReplyLength): number {
  return { short: 160, medium: 280, long: 450 }[len] + 400;
}

export const SUBJECT_IDEAS = [
  "Is a hot dog a sandwich?",
  "Cats make better roommates than dogs",
  "Pineapple belongs on pizza",
  "Should humans try to live on Mars?",
  "Time travel would ruin everything",
  "The best invention of all time",
  "Breakfast is the most overrated meal",
  "Robots should be allowed to vote",
  "Design the perfect theme park",
  "Two pirates arguing over a treasure map that turns out to be a menu",
  "Are we living in a simulation?",
  "Invent a new holiday and plan the celebration",
  "Is it ever OK to recline your airplane seat?",
  "The ocean is scarier than space",
  "A detective interviewing a suspicious houseplant",
  "Should homework be banned?",
  "What makes a joke funny?",
  "Plan a heist to steal the moon",
  "Socks with sandals: fashion or crime?",
  "Is a sense of humour a sign of intelligence?",
];

export interface ScenePreset {
  name: string;
  facts: string[];
}

export const SCENE_PRESETS: ScenePreset[] = [
  { name: "Pirate cove", facts: ["Everyone here is a pirate", "Gold doubloons are the only currency", "A parrot is listening and repeats everything"] },
  { name: "Year 3000", facts: ["It is the year 3000", "Robots run the government", "Nobody has seen a real tree in centuries"] },
  { name: "Medieval court", facts: ["You are nobles at a medieval royal court", "The king is listening and easily offended", "Dragons are real and somewhat common"] },
  { name: "Zombie apocalypse", facts: ["A zombie apocalypse started last week", "You are hiding in an abandoned supermarket", "Supplies are running low"] },
  { name: "Live cooking show", facts: ["You are contestants on a live TV cooking show", "There are 3 minutes left on the clock", "The judges can hear everything"] },
  { name: "Opposite day", facts: ["It is Opposite Day: everyone must mean the opposite of what they say", "Breaking the rule is punishable by tickling"] },
  { name: "Underwater city", facts: ["You live in a city at the bottom of the ocean", "Sharks are your neighbours", "Bubbles are the local currency"] },
];

/** Fallbacks for the 🎲 twist button when no model call is possible. */
export const TWIST_IDEAS = [
  "Gravity is optional on Tuesdays, and today is Tuesday",
  "Everyone can hear each other's thoughts",
  "All birds are government drones",
  "It has been raining jelly beans all morning",
  "The moon is made of cheese and is slowly getting smaller",
  "Every lie told makes your nose grow",
  "Cats can talk but choose not to",
  "The internet was shut down an hour ago",
  "Everyone just won the lottery",
  "Time runs backwards after midnight",
  "Shoes have been outlawed",
  "A giant octopus is watching through the window",
];

export function twistMessages(subject: string, existing: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You invent surprising, funny 'world facts' that change the world a conversation takes place in. Reply with ONE fact only, under 15 words, no quotes, no explanation.",
    },
    {
      role: "user",
      content: `The conversation is about: "${subject || "anything"}".${existing.length ? ` Facts already true: ${existing.join("; ")}.` : ""} Invent one new world fact that would make it more fun.`,
    },
  ];
}

export function cleanTwist(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0]
    ?.replace(/^[-*•\d.)\s]+/, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/^(world )?fact:\s*/i, "")
    .trim() ?? "";
}

function factLines(facts: SceneFact[], speakerId: string): { shared: string[]; secret: string[] } {
  return {
    shared: facts.filter((f) => f.scope === "all").map((f) => f.text.trim()),
    secret: facts.filter((f) => f.scope === speakerId).map((f) => f.text.trim()),
  };
}

export function systemPrompt(
  speakers: Speaker[],
  index: number,
  settings: ConversationSettings,
  summary: string,
  facts: SceneFact[] = [],
): string {
  const me = speakers[index];
  const others = speakers.filter((_, i) => i !== index);
  const mode = modeById(settings.mode);
  const otherList = others.map((o) => `${o.name} (${o.persona || "no description"})`).join(", ");
  const lines = [
    `You are ${me.name}. Your personality: ${me.persona || "yourself"}.`,
    `You are talking out loud with ${otherList}.`,
    mode.role(index, speakers.length, settings.subject || "anything you like"),
    "",
    "Rules:",
    `- Speak only as ${me.name}. Never write lines for anyone else and never start with your own name.`,
    "- Your words will be read aloud by text-to-speech: plain spoken sentences only. No markdown, lists, headings, emojis, asterisks or stage directions.",
    `- ${LENGTH_TEXT[settings.replyLength]}`,
    "- React to what was just said, then move the conversation forward. Don't repeat earlier points.",
    "- Don't open with compliments like \"great point\" or \"I love that\".",
    "- Stay in character.",
  ];
  const { shared, secret } = factLines(facts, me.id);
  if (shared.length) {
    lines.push(
      "",
      "World facts. These are absolutely true in this world, even where they contradict real life. Let them shape what you say and believe, but don't just recite them:",
      ...shared.map((f) => `- ${f}`),
    );
  }
  if (secret.length) {
    lines.push(
      "",
      "Secrets only you know. The others don't know these. Let them influence you; hint at them if it's fun, but don't simply announce them:",
      ...secret.map((f) => `- ${f}`),
    );
  }
  if (summary) lines.push("", `Summary of the earlier conversation: ${summary}`);
  return lines.join("\n");
}

/** Messages from `speakers[index]`'s point of view: own lines = assistant, others = user. */
export function buildMessages(
  speakers: Speaker[],
  index: number,
  settings: ConversationSettings,
  history: Turn[],
  summary: string,
  hiddenNote: string,
  facts: SceneFact[] = [],
): ChatMessage[] {
  const me = speakers[index];
  const nameOf = (id: string) => speakers.find((s) => s.id === id)?.name ?? "Moderator";
  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt(speakers, index, settings, summary, facts) }];
  const push = (role: "user" | "assistant", content: string) => {
    const last = msgs[msgs.length - 1];
    if (last.role === role) last.content += "\n\n" + content;
    else msgs.push({ role, content });
  };
  const first = speakers[0].name;
  push(
    "user",
    `[Moderator]: Welcome! Today's subject: "${settings.subject || "anything you like"}". ${first === me.name ? "You" : first} will speak first.`,
  );
  for (const t of history) {
    if (!t.text.trim() || t.kind === "scene") continue;
    if (t.kind === "note") push("user", `[Moderator]: ${t.text}`);
    else if (t.speakerId === me.id) push("assistant", t.text);
    else push("user", `[${nameOf(t.speakerId)}]: ${t.text}`);
  }
  if (msgs[msgs.length - 1].role === "assistant") push("user", "[Moderator]: Please continue.");
  const note = hiddenNote ? `Secret direction for ${me.name}, never say it or mention it: ${hiddenNote} ` : "";
  msgs[msgs.length - 1].content += `\n\n(${note}Now reply as ${me.name}, with only the words ${me.name} says out loud.)`;
  return msgs;
}

const AGREEMENT = /\b(i (completely |totally |fully )?agree|great point|good point|you'?re (absolutely |so )?right|exactly|absolutely|well said|i love that)\b/i;

/** Picks a hidden nudge for this turn (or "" for none). */
export function pickNudge(
  settings: ConversationSettings,
  history: Turn[],
  lineIndex: number,
  isFinalRound: boolean,
): string {
  const latest = [...history].reverse().find((t) => t.kind !== "scene");
  if (latest?.kind === "note" && latest.speakerId === "moderator") {
    return `The moderator just threw in: "${latest.text}". React to that directly and in character, and weave it into what you say.`;
  }
  if (isFinalRound) return "This is your final turn. Wrap up with a memorable closing line.";
  if (!settings.antiLoop || lineIndex < 2) return "";
  const lines = history.filter((t) => (t.kind ?? "line") === "line");
  const last = lines[lines.length - 1]?.text ?? "";
  const mode = modeById(settings.mode);
  if (AGREEMENT.test(last) && settings.mode !== "improv") {
    return settings.mode === "collaborate"
      ? "You two are agreeing too easily. Find a real flaw or a missing piece before adding to it."
      : "Don't just agree. Challenge something specific, or take the conversation in a new direction.";
  }
  // Nudge roughly every other turn so it doesn't feel scripted.
  if (lineIndex % 2 === 1 || Math.random() < 0.3) {
    return mode.nudges[Math.floor(Math.random() * mode.nudges.length)];
  }
  return "";
}

export function summaryMessages(speakers: Speaker[], previous: string, turns: Turn[]): ChatMessage[] {
  const nameOf = (id: string) => speakers.find((s) => s.id === id)?.name ?? "Moderator";
  const transcript = turns.map((t) => `${nameOf(t.speakerId)}: ${t.text}`).join("\n");
  return [
    {
      role: "system",
      content:
        "You write compact running summaries of conversations. Keep who said what, each person's positions, and any running jokes. 3 to 5 sentences, plain text.",
    },
    {
      role: "user",
      content: `${previous ? `Summary so far: ${previous}\n\n` : ""}New part of the conversation:\n${transcript}\n\nWrite the updated summary.`,
    },
  ];
}

export interface RefereeVerdict {
  concluded: boolean;
  reason: string;
  winner?: string;
}

export function refereeMessages(speakers: Speaker[], settings: ConversationSettings, turns: Turn[]): ChatMessage[] {
  const nameOf = (id: string) => speakers.find((s) => s.id === id)?.name ?? "Moderator";
  const transcript = turns
    .slice(-12)
    .map((t) => `${nameOf(t.speakerId)}: ${t.text}`)
    .join("\n");
  const winnerHint =
    settings.mode === "debate"
      ? ` If concluded, set "winner" to the name of whoever argued more convincingly (or "tie").`
      : "";
  return [
    {
      role: "system",
      content:
        `You are a neutral referee watching a ${modeById(settings.mode).label.toLowerCase()} about "${settings.subject}". ` +
        `Decide whether the conversation has reached a natural conclusion: real agreement, a clear resolution, or it is just going in circles.` +
        winnerHint +
        ` Respond with ONLY a JSON object like {"concluded": false, "reason": "one short sentence", "winner": null}.`,
    },
    { role: "user", content: `Recent conversation:\n${transcript}\n\nYour JSON verdict:` },
  ];
}

export function parseVerdict(raw: string): RefereeVerdict | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as { concluded?: unknown; reason?: unknown; winner?: unknown };
    return {
      concluded: v.concluded === true || v.concluded === "true",
      reason: typeof v.reason === "string" ? v.reason : "",
      winner: typeof v.winner === "string" && v.winner && v.winner !== "null" ? v.winner : undefined,
    };
  } catch {
    return null;
  }
}
