// ─────────────────────────────────────────────────────────────────────────────
// The CUGC timetable — what a "class" is, and which children are on its roll.
//
// A gymnastics programme sells OPTIONS ("Ages 5–7 · once a week"), but a coach
// takes the roll for a CLASS ("Tuesday 4:00–5:30pm"). Those are different
// things and the gap between them is where the roll had to start:
//
//   🔴 One option attends MORE THAN ONE class. "Ages 5–7 · twice a week" is
//      stored on the registration as a single string like "Tuesday + Saturday",
//      which is not the name of any class. That child belongs on two rolls, and
//      a roll built by matching the stored string to a class label would have
//      silently left them off both.
//
//   🔴 The timetable CHANGES BY TERM. Every class carries the terms it runs
//      in, and every question ("which classes", "what can I pick", "which roll
//      is this child on") is asked of one term.
//
//   🔴 One option offers a CHOICE of classes. GymPlay's "1–2 sessions per week"
//      named three in Term 3 and six in Term 4; the family picks one and it is
//      stored. A child whose pick
//      was never recorded (one live row, 2026-09-20) is on NO roll — they are
//      an unanswered question, not a child who attends all three. The tab shows
//      them by name so somebody can ask.
// ─────────────────────────────────────────────────────────────────────────────

/** One physical class on the timetable. */
export type CugcClass = {
  /** Stable key. Rides in URLs and is stored on every attendance row, so it
   *  must never be regenerated from a label a human might reword. */
  id: string;
  /** What a family and a coach read. Matched against the registration's stored
   *  `session_time`, so it is a contract with existing data. */
  label: string;
  /** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`. */
  weekday: number;
  /** 24-hour "HH:MM", for ordering a day's classes. */
  start: string;
  end: string;
  /** The terms this class runs in, by term id (`shared/cugc-terms.ts`).
   *
   *  🔴 REQUIRED, and never "every term" by omission. The timetable changes
   *  term to term — Term 4 2026 added four GymPlay days and a Thursday
   *  GymBasics and dropped the Saturday 10:30 GymPlay — and a class assumed to
   *  run in a term it never ran in shows on that term's roll as a class nobody
   *  marked: red, "past and not taken", for a session that never happened.
   *  A new term therefore starts with NO classes until a human writes them
   *  down, and `check:cugc-terms` fails until they do. */
  terms: string[];
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The timetable, per programme slug.
 *
 * Every entry is transcribed from the club's own term sheet — none is invented.
 * Term 3 2026 from the live cugc.co.nz option times; Term 4 2026 from the
 * club's email "Gymnastics sessions - to open for registration for Term 4"
 * (22 Sep 2026). **Competitive Stream is deliberately absent**: its published
 * times read "Thursday" and "Tuesday or Thursday, + Saturday", and an "or" is
 * not a timetable. It is invite-only, has never sold through this flow and has
 * zero registrations, so it does not appear on the roll until a human writes
 * its real classes down.
 *
 * 🔴 A class that stops running is RETIRED by narrowing its `terms`, never
 * deleted: its id is on every attendance row ever taken for it.
 */
const T3 = "t3-2026";
const T4 = "t4-2026";

export const CUGC_CLASSES: Record<string, CugcClass[]> = {
  gymplay: [
    { id: "gymplay-mon-1530", label: "Monday 3:30–4:15pm", weekday: 1, start: "15:30", end: "16:15", terms: [T4] },
    { id: "gymplay-tue-1600", label: "Tuesday 4:00–4:45pm", weekday: 2, start: "16:00", end: "16:45", terms: [T4] },
    { id: "gymplay-wed-1600", label: "Wednesday 4:00–4:45pm", weekday: 3, start: "16:00", end: "16:45", terms: [T3, T4] },
    { id: "gymplay-thu-1545", label: "Thursday 3:45–4:30pm", weekday: 4, start: "15:45", end: "16:30", terms: [T4] },
    { id: "gymplay-fri-1600", label: "Friday 4:00–4:45pm", weekday: 5, start: "16:00", end: "16:45", terms: [T4] },
    { id: "gymplay-sat-0930", label: "Saturday 9:30–10:15am", weekday: 6, start: "09:30", end: "10:15", terms: [T3, T4] },
    // Not on the Term 4 sheet.
    { id: "gymplay-sat-1030", label: "Saturday 10:30–11:15am", weekday: 6, start: "10:30", end: "11:15", terms: [T3] },
  ],
  gymbasics: [
    { id: "gymbasics-tue-1600", label: "Tuesday 4:00–5:30pm", weekday: 2, start: "16:00", end: "17:30", terms: [T3, T4] },
    { id: "gymbasics-thu-1600", label: "Thursday 4:00–5:30pm", weekday: 4, start: "16:00", end: "17:30", terms: [T4] },
    { id: "gymbasics-sat-0900", label: "Saturday 9:00–10:30am", weekday: 6, start: "09:00", end: "10:30", terms: [T3, T4] },
    // The Term 3 8+ class. From Term 4 the same Friday slot is its own
    // programme, GymSkills 8+ — a new class id so each term's roll files
    // under the programme it was sold as.
    { id: "gymbasics-fri-1600", label: "Friday 4:00–5:00pm", weekday: 5, start: "16:00", end: "17:00", terms: [T3] },
  ],
  gymskills: [
    { id: "gymskills-fri-1600", label: "Friday 4:00–5:00pm", weekday: 5, start: "16:00", end: "17:00", terms: [T4] },
  ],
};

/**
 * Which classes each purchasable option covers, keyed `"<slug>|<option label>"`.
 *
 * `perWeek` is how many of those classes a family CHOOSES:
 *   1 → pick one (GymPlay, GymBasics once a week, GymSkills);
 *   2 → pick two different days (GymBasics twice a week).
 *
 * 🔴 The choices are DERIVED per term from the classes that actually run in
 * it, never listed by hand. In Term 3 GymBasics ran Tuesday and Saturday, so
 * "twice a week" had exactly one choice ("Tuesday + Saturday") and a blank was
 * unambiguous. Term 4 added Thursday, so it has three — and the old rule
 * ("twice a week attends everything named") would have put a Tuesday +
 * Thursday child on all three rolls.
 *
 * GymPlay's option is called "1–2 sessions per week" but the enrol form has
 * always recorded ONE chosen class, so it is `perWeek: 1` — a second weekly
 * session is arranged with the club, not through checkout.
 *
 * Keys for options no longer sold ("gymbasics|Ages 8+ · once a week") STAY:
 * every Term 3 registration that bought one still needs its roll.
 */
export const CUGC_OPTION_CLASSES: Record<string, { classIds: string[]; perWeek: 1 | 2 }> = {
  "gymplay|1–2 sessions per week": {
    classIds: [
      "gymplay-mon-1530", "gymplay-tue-1600", "gymplay-wed-1600", "gymplay-thu-1545",
      "gymplay-fri-1600", "gymplay-sat-0930", "gymplay-sat-1030",
    ],
    perWeek: 1,
  },
  "gymbasics|Ages 5–7 · once a week": {
    classIds: ["gymbasics-tue-1600", "gymbasics-thu-1600", "gymbasics-sat-0900"],
    perWeek: 1,
  },
  "gymbasics|Ages 5–7 · twice a week": {
    classIds: ["gymbasics-tue-1600", "gymbasics-thu-1600", "gymbasics-sat-0900"],
    perWeek: 2,
  },
  // Term 3 only — sold as GymSkills from Term 4.
  "gymbasics|Ages 8+ · once a week": {
    classIds: ["gymbasics-fri-1600"],
    perWeek: 1,
  },
  "gymskills|Once a week": {
    classIds: ["gymskills-fri-1600"],
    perWeek: 1,
  },
};

export function optionKey(programSlug: string, optionLabel: string): string {
  return `${programSlug}|${optionLabel}`;
}

export function classById(id: string): CugcClass | null {
  for (const list of Object.values(CUGC_CLASSES)) {
    const hit = list.find((c) => c.id === id);
    if (hit) return hit;
  }
  return null;
}

export function classRunsInTerm(c: CugcClass, termId: string): boolean {
  return c.terms.includes(termId);
}

/** Every class, ordered by day then start time — only those running in
 *  `termId` when one is given. */
export function allClasses(termId?: string): (CugcClass & { programSlug: string })[] {
  return Object.entries(CUGC_CLASSES)
    .flatMap(([programSlug, list]) => list.map((c) => ({ ...c, programSlug })))
    .filter((c) => !termId || classRunsInTerm(c, termId))
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export type OptionChoice = {
  /** What the family picks and what is stored as `session_time`. */
  label: string;
  classIds: string[];
};

/**
 * 🔴 THE ONE DECIDER for "what can a family choose for this option in this
 * term" — the enrol form's list, the server's check of what came back, and
 * the roll's reading of a stored choice all come from here.
 *
 * A one-class choice is labelled with the class ("Tuesday 4:00–5:30pm"). A
 * two-class choice is labelled with the two days ("Tuesday + Saturday"),
 * which is how the club has always written it and what every Term 3
 * twice-a-week row already stores; if two choices would share that label (two
 * classes on one weekday) the full class labels are used instead.
 */
export function optionChoices(programSlug: string, optionLabel: string, termId: string): OptionChoice[] {
  const entry = CUGC_OPTION_CLASSES[optionKey(programSlug, optionLabel)];
  if (!entry) return [];
  const running = entry.classIds
    .map((id) => classById(id))
    .filter((c): c is CugcClass => !!c && classRunsInTerm(c, termId))
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));

  if (entry.perWeek === 1) return running.map((c) => ({ label: c.label, classIds: [c.id] }));

  const pairs: { a: CugcClass; b: CugcClass }[] = [];
  for (let i = 0; i < running.length; i++) {
    for (let j = i + 1; j < running.length; j++) {
      // Twice a week means two DIFFERENT days.
      if (running[i].weekday !== running[j].weekday) pairs.push({ a: running[i], b: running[j] });
    }
  }
  const dayLabel = (p: { a: CugcClass; b: CugcClass }) => `${WEEKDAY_NAMES[p.a.weekday]} + ${WEEKDAY_NAMES[p.b.weekday]}`;
  const ambiguous = new Set(pairs.map(dayLabel)).size !== pairs.length;
  return pairs.map((p) => ({
    label: ambiguous ? `${p.a.label} + ${p.b.label}` : dayLabel(p),
    classIds: [p.a.id, p.b.id],
  }));
}

/** The timetable strings for an option in a term — derived, so the roll and
 *  the page a family reads can never describe different classes. */
export function optionTimes(programSlug: string, optionLabel: string, termId: string): string[] {
  return optionChoices(programSlug, optionLabel, termId).map((c) => c.label);
}

export type RollPlacement =
  | { placed: true; classIds: string[]; reason?: undefined }
  | { placed: false; reason: "no-timetable" | "not-recorded"; classIds: string[] };

/**
 * 🔴 THE ONE DECIDER for "which rolls is this child on".
 *
 * Read against the term the REGISTRATION is for (the term stamped on the row),
 * because a choice means different classes in different terms.
 *
 * Order matters. The stored `session_time` is the family's own choice and wins
 * whenever it names a real choice. Only when it does not do we fall back to
 * what the option itself implies — and only when the option leaves no room for
 * doubt.
 */
export function classesForRegistration(
  programSlug: string,
  optionLabel: string,
  sessionTime: string | null | undefined,
  termId: string,
): RollPlacement {
  const choices = optionChoices(programSlug, optionLabel, termId);
  if (choices.length === 0) return { placed: false, reason: "no-timetable", classIds: [] };

  // 1. They named a choice. Compare on the trimmed label — the stored strings
  //    come from the same config, but a stray space must not lose a child.
  const named = (sessionTime ?? "").trim();
  if (named) {
    const exact = choices.find((c) => c.label.trim() === named);
    if (exact) return { placed: true, classIds: [...exact.classIds] };
  }

  // 2. There was only ever one thing to choose (a single Friday class; Term
  //    3's "Tuesday + Saturday"), so a blank is not ambiguous.
  if (choices.length === 1) return { placed: true, classIds: [...choices[0].classIds] };

  // 3. A choice existed and nobody recorded it. NOT every class — that would
  //    invent an attendance expectation for a real child.
  return { placed: false, reason: "not-recorded", classIds: [] };
}

/**
 * Every date a class falls on inside a term, as `YYYY-MM-DD`.
 *
 * Walks the calendar from the term's own start — never by stepping 7 days from
 * "today", which drifts, and never through a local `Date`, which moves a date
 * across midnight. Both ends inclusive, because a class runs on the last day.
 */
export function classDatesInTerm(weekday: number, startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return out;

  // Step forward to the first matching weekday, then a week at a time.
  const firstOffset = (weekday - new Date(start).getUTCDay() + 7) % 7;
  for (let t = start + firstOffset * 86_400_000; t <= end; t += 7 * 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
