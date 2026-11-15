// SIU Performance Hub — check-in FORMS. One engine, many forms.
//
// Daniel, 2026-11-14 (with Rowan's Smartabase Loom open): "it actually shows
// all the questions that were on this check-in and what they were using. Let's
// go ahead and just copy all of those to start off with as the base template,
// and then we can customise from there."
//
//  🔴 A form is DATA (perf_forms.definition), never a page. The player's phone,
//     staff "enter for athlete", the report columns and the readiness flag all
//     read the SAME definition, so editing a question changes all four at once.
//  🔴 SI_UNITED_CHECK_IN is Rowan's Smartabase form, question for question, in
//     his words (read off the Loom of 15 Jan 2026). It is the seed and the
//     "reset to template" target — never edited to taste here; edit the copy in
//     the Forms screen instead.
//  🔴 Answers are checked on the SERVER against the definition (validateAnswers).
//     Rowan's Loom shows a "required" sleep answer missing from a saved
//     Smartabase entry — here a required question cannot be skipped by anything.
//  🔴 Blank is not zero: an unanswered question is ABSENT from the answers.
//  🔴 Question ids are a contract: answers, report columns and saved reports key
//     on them. Renaming a LABEL is free; an id is never reused for a different
//     question.
//
// Pure — no imports — so the browser and the server share it byte for byte.

export type QuestionType = "choice" | "multi" | "scale" | "body" | "text" | "calc";

export interface Option { value: string; label: string }

export interface FlagRule {
  /** choice/multi: the answer is (or includes) one of these. */
  in?: string[];
  /** scale: the answer is at or below / at or above. */
  lte?: number;
  gte?: number;
  /** body: at least this many areas. */
  minCount?: number;
  level: "red" | "amber";
  /** What the coach reads. `{value}` is replaced with the answer. */
  reason: string;
}

export interface Question {
  id: string;
  label: string;
  /** Short column header for the report. Defaults to the label. */
  short?: string;
  help?: string;
  type: QuestionType;
  options?: Option[];
  min?: number;
  max?: number;
  step?: number;
  /** scale: words under particular numbers ({"1":"Very light", …}). */
  marks?: Record<string, string>;
  required?: boolean;
  /** Only asked when another question's answer is (or includes) one of these. */
  showIf?: { q: string; in: string[] };
  /** calc: how the value is worked out from other answers. */
  calc?: { kind: "product"; of: [string, string] };
  flags?: FlagRule[];
  /** Hidden from the form and the report, answers kept. Never deleted. */
  hidden?: boolean;
}

export interface Section { id: string; title: string; questions: Question[] }

export interface FormDef {
  key: string;
  title: string;
  intro?: string;
  sections: Section[];
  /**
   * Which answers feed the training-load engine (perf_rpe → ACWR). The load
   * belongs to the day it was done: "yesterday" for Rowan's morning form.
   */
  load?: { rpe: string; minutes: string; activity?: string; day: "yesterday" | "today" };
}

export type AnswerValue = string | string[] | number;
export type Answers = Record<string, AnswerValue>;

// ─────────────────────────────────────────────────────────────────────────────
// The body map — Smartabase's own region names, as Rowan's report prints them
// ("Right Posterior Lower Leg Foot", "Left Upper Leg", "Right Pelvis").
// ─────────────────────────────────────────────────────────────────────────────

export interface BodyRegion { key: string; label: string; view: "front" | "back"; side: "left" | "right" | "centre"; part: string }

const FRONT_PARTS = ["Shoulder", "Chest", "Abdomen", "Pelvis", "Upper Arm", "Lower Arm / Hand", "Upper Leg", "Knee", "Lower Leg / Foot"];
const BACK_PARTS = ["Shoulder", "Upper Back", "Lower Back", "Pelvis", "Upper Arm", "Lower Arm / Hand", "Upper Leg", "Knee", "Lower Leg / Foot"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export const BODY_REGIONS: BodyRegion[] = [
  { key: "head", label: "Head", view: "front", side: "centre", part: "Head" },
  { key: "neck", label: "Neck", view: "front", side: "centre", part: "Neck" },
  ...FRONT_PARTS.flatMap((p) => (["left", "right"] as const).map((s): BodyRegion => ({
    key: `${s}_${slug(p)}`, label: `${s === "left" ? "Left" : "Right"} ${p}`, view: "front", side: s, part: p,
  }))),
  { key: "posterior_head", label: "Posterior Head", view: "back", side: "centre", part: "Head" },
  { key: "posterior_neck", label: "Posterior Neck", view: "back", side: "centre", part: "Neck" },
  ...BACK_PARTS.flatMap((p) => (["left", "right"] as const).map((s): BodyRegion => ({
    key: `${s}_posterior_${slug(p)}`, label: `${s === "left" ? "Left" : "Right"} Posterior ${p}`, view: "back", side: s, part: p,
  }))),
];
const REGION = new Map(BODY_REGIONS.map((r) => [r.key, r]));
export const regionLabel = (k: string) => REGION.get(k)?.label ?? k;

// ─────────────────────────────────────────────────────────────────────────────
// Rowan's form — "SI United Check In", Smartabase, January 2026.
// ─────────────────────────────────────────────────────────────────────────────

export const SI_UNITED_CHECK_IN: FormDef = {
  key: "si-united-check-in",
  title: "SI United Check In",
  intro: "Every morning. Takes a minute. Only SIU performance staff see your answers.",
  load: { rpe: "session_rpe", minutes: "session_minutes", activity: "yesterday", day: "yesterday" },
  sections: [
    {
      id: "professionalism",
      title: "Professionalism, Team, Ambition",
      questions: [
        {
          id: "am_well", label: "Am I well?", type: "choice", required: true,
          options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No, something to report" }],
          flags: [{ in: ["no"], level: "amber", reason: "Not well" }],
        },
        {
          id: "illness_symptoms", label: "What illness symptoms are you feeling?", short: "Illness symptoms", type: "text",
          showIf: { q: "am_well", in: ["no"] },
        },
        {
          id: "ready", label: "How ready am I to perform?", short: "Ready", type: "scale", min: 0, max: 10, step: 1, required: true,
          flags: [{ lte: 3, level: "red", reason: "Ready {value}/10" }, { lte: 5, level: "amber", reason: "Ready {value}/10" }],
        },
        {
          id: "sleep_job", label: "Did sleep do its job?", short: "Sleep", type: "choice", required: true,
          options: [
            { value: "well_below", label: "Well below normal" }, { value: "below", label: "Below normal" },
            { value: "normal", label: "Normal" }, { value: "above", label: "Above normal" }, { value: "well_above", label: "Well above normal" },
          ],
          flags: [{ in: ["well_below"], level: "amber", reason: "Sleep well below normal" }, { in: ["below"], level: "amber", reason: "Sleep below normal" }],
        },
        {
          id: "sleep_modification", label: "Anything to modify?", short: "Sleep modification", type: "text",
          help: "Anything that got in the way of your sleep, or that you want to change.",
          showIf: { q: "sleep_job", in: ["well_below", "below"] },
        },
        {
          id: "areas", label: "Areas I'm managing", short: "Areas", type: "body", help: "Tightness, injury, strain etc",
          flags: [{ minCount: 3, level: "amber", reason: "Managing {value} areas" }],
        },
        {
          id: "yesterday", label: "What did I do yesterday?", short: "Yesterday", type: "multi", help: "Record the type of exertion from yesterday",
          options: [{ value: "football", label: "Football" }, { value: "rehab_prehab", label: "Rehab/Prehab" }, { value: "rest", label: "Rest" }],
        },
      ],
    },
    {
      id: "training",
      title: "My Training, My Team",
      questions: [
        {
          id: "session_rpe", label: "Session RPE", type: "scale", min: 0, max: 10, step: 1,
          marks: { "1": "Very Light", "3": "Moderate", "5": "Hard", "7": "Very Hard", "10": "Maximal" },
          help: "How hard did I think the intensity was overall?",
        },
        {
          id: "session_minutes", label: "Session Minutes", short: "Minutes", type: "scale", min: 0, max: 140, step: 5,
          help: "How many minutes did I train or play?",
        },
        { id: "football_load", label: "Football Load", type: "calc", calc: { kind: "product", of: ["session_rpe", "session_minutes"] } },
        {
          id: "help_others", label: "Anything that would help others this week?", short: "Help others", type: "choice",
          options: [
            { value: "all_set", label: "We're all set" }, { value: "more_recovery", label: "More recovery" },
            { value: "tactical_clarity", label: "Tactical clarity" }, { value: "team_communication", label: "Team communication" },
            { value: "something_else", label: "Something else" },
          ],
        },
        { id: "other_ideas", label: "Other ideas", type: "text", showIf: { q: "help_others", in: ["something_else"] } },
      ],
    },
  ],
};

export const FORM_TEMPLATES: FormDef[] = [SI_UNITED_CHECK_IN];

// ─────────────────────────────────────────────────────────────────────────────
// Reading a form
// ─────────────────────────────────────────────────────────────────────────────

export const allQuestions = (f: FormDef): Question[] => f.sections.flatMap((s) => s.questions);
export const liveQuestions = (f: FormDef): Question[] => allQuestions(f).filter((q) => !q.hidden);

const asList = (v: AnswerValue | undefined): string[] => (v == null ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

/** Is this question asked, given the answers so far? */
export function isShown(q: Question, answers: Answers): boolean {
  if (q.hidden) return false;
  if (!q.showIf) return true;
  const got = asList(answers[q.showIf.q]);
  return got.some((g) => q.showIf!.in.includes(g));
}

export function calcValue(q: Question, answers: Answers): number | null {
  if (q.type !== "calc" || !q.calc) return null;
  const [a, b] = q.calc.of.map((id) => answers[id]);
  if (typeof a !== "number" || typeof b !== "number") return null;
  return Math.round(a * b * 100) / 100;
}

/** Human words for one answer, the way the report prints it. */
export function answerText(q: Question, v: AnswerValue | undefined): string {
  if (v == null || (Array.isArray(v) && v.length === 0)) return "";
  if (q.type === "body") return asList(v).map(regionLabel).join(", ");
  if (q.type === "choice" || q.type === "multi") {
    const label = (x: string) => q.options?.find((o) => o.value === x)?.label ?? x;
    return asList(v).map(label).join(", ");
  }
  if (q.type === "scale" && typeof v === "number" && q.marks?.[String(v)]) return `${v} · ${q.marks[String(v)]}`;
  return String(v);
}

/** A number for sorting a column: scale/calc by value, choice by option order, body by count. */
export function answerSortKey(q: Question, v: AnswerValue | undefined): number | string | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (q.type === "choice") { const i = q.options?.findIndex((o) => o.value === v) ?? -1; return i >= 0 ? i : String(v); }
  if (q.type === "body" || q.type === "multi") return asList(v).length;
  return String(v).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Checking answers — the server's word, never the phone's.
// ─────────────────────────────────────────────────────────────────────────────

export class AnswerError extends Error { constructor(public questionId: string, msg: string) { super(msg); } }

/**
 * Returns the cleaned answers (unknown keys dropped, answers to questions that
 * are not shown dropped, calcs worked out here) or throws AnswerError naming
 * the first question that is wrong.
 */
export function validateAnswers(f: FormDef, raw: unknown): Answers {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Answers = {};
  const qs = liveQuestions(f);
  // Two passes so a showIf can depend on a question later in the list.
  for (const q of qs) {
    if (q.type === "calc") continue;
    const v = input[q.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    switch (q.type) {
      case "choice": {
        const s = String(v);
        if (!q.options?.some((o) => o.value === s)) throw new AnswerError(q.id, `"${q.label}": choose one of the options.`);
        out[q.id] = s; break;
      }
      case "multi": {
        const list = Array.from(new Set((Array.isArray(v) ? v : [v]).map(String)));
        if (list.some((s) => !q.options?.some((o) => o.value === s))) throw new AnswerError(q.id, `"${q.label}": choose from the options.`);
        out[q.id] = list; break;
      }
      case "body": {
        const list = Array.from(new Set((Array.isArray(v) ? v : [v]).map(String)));
        if (list.some((s) => !REGION.has(s))) throw new AnswerError(q.id, `"${q.label}": that body area isn't on the map.`);
        out[q.id] = list; break;
      }
      case "scale": {
        const n = Number(v);
        const min = q.min ?? 0, max = q.max ?? 10;
        if (!Number.isFinite(n) || n < min || n > max) throw new AnswerError(q.id, `"${q.label}" is ${min} to ${max}.`);
        out[q.id] = n; break;
      }
      case "text": {
        const s = String(v).trim().slice(0, 1000);
        if (s) out[q.id] = s; break;
      }
    }
  }
  for (const q of qs) {
    const shown = isShown(q, out);
    if (!shown) { delete out[q.id]; continue; }
    if (q.type === "calc") { const c = calcValue(q, out); if (c != null) out[q.id] = c; continue; }
    if (q.required && out[q.id] == null) throw new AnswerError(q.id, `"${q.label}" is required.`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the coach should look at — same shape as wellnessFlag in performance.ts.
// ─────────────────────────────────────────────────────────────────────────────

export function formFlag(f: FormDef, answers: Answers): { level: "red" | "amber" | null; reasons: string[] } {
  let level: "red" | "amber" | null = null;
  const reasons: string[] = [];
  for (const q of liveQuestions(f)) {
    const v = answers[q.id];
    if (v == null || !q.flags?.length) continue;
    // First matching rule per question wins (rules are listed worst first).
    for (const r of q.flags) {
      let hit = false; let shown = typeof v === "number" ? String(v) : answerText(q, v);
      if (r.in) hit = asList(v).some((x) => r.in!.includes(x));
      else if (r.minCount != null) { const n = asList(v).length; hit = n >= r.minCount; shown = String(n); }
      else if (typeof v === "number") hit = (r.lte == null || v <= r.lte) && (r.gte == null || v >= r.gte);
      if (!hit) continue;
      if (r.level === "red" || level == null) level = r.level;
      reasons.push(r.reason.replace("{value}", shown));
      break;
    }
  }
  return { level, reasons };
}

/** The session the form describes, for the load engine. Null when there is none. */
export function formLoad(f: FormDef, answers: Answers, entryDate: string): { date: string; rpe: number; minutes: number; kind: "training" | "other" } | null {
  if (!f.load) return null;
  const rpe = answers[f.load.rpe], minutes = answers[f.load.minutes];
  if (typeof rpe !== "number" || typeof minutes !== "number" || minutes <= 0) return null;
  const did = f.load.activity ? asList(answers[f.load.activity]) : [];
  const [y, m, d] = entryDate.split("-").map(Number);
  const date = f.load.day === "yesterday" ? new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10) : entryDate;
  return { date, rpe: Math.round(rpe), minutes: Math.min(300, Math.round(minutes)), kind: did.length && !did.includes("football") ? "other" : "training" };
}

/** Structural check on a form someone edited. Returns a sentence, or null when fine. */
export function formProblem(f: unknown): string | null {
  const x = f as FormDef;
  if (!x || typeof x !== "object" || typeof x.title !== "string" || !x.title.trim()) return "The form needs a title.";
  if (!Array.isArray(x.sections) || !x.sections.length) return "The form needs at least one section.";
  const ids = new Set<string>();
  for (const s of x.sections) {
    if (!s || typeof s.title !== "string" || !Array.isArray(s.questions)) return "Every section needs a title and questions.";
    for (const q of s.questions) {
      if (!q || typeof q.id !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(q.id)) return "A question has a bad id.";
      if (ids.has(q.id)) return `Two questions share the id "${q.id}".`;
      ids.add(q.id);
      if (typeof q.label !== "string" || !q.label.trim()) return "Every question needs a wording.";
      if (!["choice", "multi", "scale", "body", "text", "calc"].includes(q.type)) return `"${q.label}" has an unknown type.`;
      if ((q.type === "choice" || q.type === "multi") && (!Array.isArray(q.options) || q.options.length < 2)) return `"${q.label}" needs at least two options.`;
      if (q.options && new Set(q.options.map((o) => o.value)).size !== q.options.length) return `"${q.label}" has two options with the same value.`;
      if (q.type === "scale" && !(Number(q.max) > Number(q.min ?? 0))) return `"${q.label}" needs a top number above its bottom number.`;
    }
  }
  for (const q of allQuestions(x)) {
    if (q.showIf && !ids.has(q.showIf.q)) return `"${q.label}" depends on a question that isn't on the form.`;
    if (q.calc && q.calc.of.some((id) => !ids.has(id))) return `"${q.label}" works out from a question that isn't on the form.`;
  }
  return null;
}

/** A fresh, unused question id from a wording ("Sleep quality" → "sleep_quality", or "_2"). */
export function newQuestionId(f: FormDef, label: string): string {
  const base = (label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "question").replace(/^[^a-z]/, "q");
  const used = new Set(allQuestions(f).map((q) => q.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}
