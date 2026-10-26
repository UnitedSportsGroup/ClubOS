// ── Rambo, the club's own assistant — the chat's pure rules ──────────────────
//
// Daniel, 2026-10-26 (night): "I want to make Rambo a separate thing on the
// side … at the top of every single workspace … look exactly like ChatGPT and
// Claude, where it has your different chats … 'Tell me how many under-4 to 8s
// I have right now' … 'how many players are in the roll but have not paid yet'."
//
// One assistant, three doors: the Knowledge Base tab (where he started), the
// Mailer's builder (Ask → Rambo), and now his own page with a prompt box on
// the home dashboard. Every door spends the same per-person daily allowance
// (users.mailer_ai_daily_limit — the column kept its name, the meaning widened
// to "Rambo prompts a day"), and every prompt is a logged, priced API call.

import { MAILER_AI_DEFAULT_DAILY_LIMIT, mailerAiDailyLimitFor } from "./mailer-ai";

export const RAMBO_DEFAULT_MODEL = "claude-sonnet-5-5";
export const RAMBO_DEFAULT_DAILY_LIMIT = MAILER_AI_DEFAULT_DAILY_LIMIT;
/** A chat's name is at most this long — the sidebar list has one line. */
export const RAMBO_TITLE_MAX = 80;
export const RAMBO_QUESTION_MAX = 4000;

/** The per-person cap, shared by every Rambo surface. 0 = switched off. */
export const ramboDailyLimitFor = mailerAiDailyLimitFor;

/** A chat is named after its first question: the first sentence, or the first
 *  ~60 characters cut at a word, with a trailing "?" kept because the chat IS
 *  the question. "New chat" until then. */
export function ramboTitleFrom(question: string): string {
  const one = (question || "").replace(/\s+/g, " ").trim();
  if (!one) return "New chat";
  const sentence = one.split(/(?<=[.?!])\s/)[0];
  const base = sentence.length <= 64 ? sentence : one.slice(0, 64).replace(/\s+\S*$/, "");
  const cleaned = base.replace(/[.\s]+$/, "");
  return (cleaned || one.slice(0, 64)).slice(0, RAMBO_TITLE_MAX);
}

/** Clean a title typed by the person. Blank falls back to "New chat". */
export function ramboCleanTitle(raw: unknown): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, RAMBO_TITLE_MAX);
  return t || "New chat";
}

/** The starters on an empty chat — Daniel's own examples, the questions staff
 *  actually walk over to someone's desk to ask. */
export const RAMBO_STARTERS = [
  "How many U4–U8 players do we have this term?",
  "Break them down by age: 3, 4, 5, 6, 7 and 8 year olds",
  "How many of them also came to a holiday camp?",
  "Who is on the roll but hasn't paid yet?",
  "What percentage of the pre-academy has paid for this term?",
  "How does United Prints size a pull-up banner?",
] as const;

export interface RamboUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** "Today" is a New Zealand day. The same clause the Mailer's cap uses. */
export const NZ_TODAY_SQL = "(now() AT TIME ZONE 'Pacific/Auckland')::date";
