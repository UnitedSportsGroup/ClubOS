// ─────────────────────────────────────────────────────────────────────────────
// The CUGC timetable — what a "class" is, and which children are on its roll.
//
// A gymnastics programme sells OPTIONS ("Ages 5–7 · once a week"), but a coach
// takes the roll for a CLASS ("Tuesday 4:00–5:30pm"). Those are different
// things and the gap between them is where the roll had to start:
//
//   🔴 One option attends MORE THAN ONE class. "Ages 5–7 · twice a week" is
//      stored on the registration as the single string "Tuesday + Saturday",
//      which is not the name of any class. That child belongs on two rolls, and
//      a roll built by matching the stored string to a class label would have
//      silently left them off both.
//
//   🔴 One option offers a CHOICE of classes. GymPlay's "1–2 sessions per week"
//      names three; the family picked one and it is stored. A child whose pick
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
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The timetable, per programme slug.
 *
 * Every entry is transcribed from the live cugc.co.nz option times — none is
 * invented. **Competitive Stream is deliberately absent**: its published times
 * read "Thursday" and "Tuesday or Thursday, + Saturday", and an "or" is not a
 * timetable. It is invite-only, has never sold through this flow and has zero
 * registrations, so it simply does not appear on the roll until a human writes
 * its real classes down.
 */
export const CUGC_CLASSES: Record<string, CugcClass[]> = {
  gymplay: [
    { id: "gymplay-wed-1600", label: "Wednesday 4:00–4:45pm", weekday: 3, start: "16:00", end: "16:45" },
    { id: "gymplay-sat-0930", label: "Saturday 9:30–10:15am", weekday: 6, start: "09:30", end: "10:15" },
    { id: "gymplay-sat-1030", label: "Saturday 10:30–11:15am", weekday: 6, start: "10:30", end: "11:15" },
  ],
  gymbasics: [
    { id: "gymbasics-tue-1600", label: "Tuesday 4:00–5:30pm", weekday: 2, start: "16:00", end: "17:30" },
    { id: "gymbasics-sat-0900", label: "Saturday 9:00–10:30am", weekday: 6, start: "09:00", end: "10:30" },
    { id: "gymbasics-fri-1600", label: "Friday 4:00–5:00pm", weekday: 5, start: "16:00", end: "17:00" },
  ],
};

/**
 * Which classes each purchasable option covers, keyed `"<slug>|<option label>"`.
 *
 * `attendsAll` is the distinction the stored string cannot make on its own:
 * true means the option attends EVERY class named (a twice-a-week place),
 * false means the family picks one of them.
 */
export const CUGC_OPTION_CLASSES: Record<string, { classIds: string[]; attendsAll: boolean }> = {
  "gymplay|1–2 sessions per week": {
    classIds: ["gymplay-wed-1600", "gymplay-sat-0930", "gymplay-sat-1030"],
    attendsAll: false,
  },
  "gymbasics|Ages 5–7 · once a week": {
    classIds: ["gymbasics-tue-1600", "gymbasics-sat-0900"],
    attendsAll: false,
  },
  "gymbasics|Ages 5–7 · twice a week": {
    classIds: ["gymbasics-tue-1600", "gymbasics-sat-0900"],
    attendsAll: true,
  },
  "gymbasics|Ages 8+ · once a week": {
    classIds: ["gymbasics-fri-1600"],
    attendsAll: false,
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

/** Every class that runs, ordered by day then start time. */
export function allClasses(): (CugcClass & { programSlug: string })[] {
  return Object.entries(CUGC_CLASSES)
    .flatMap(([programSlug, list]) => list.map((c) => ({ ...c, programSlug })))
    .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

/** The timetable strings for an option — derived, so the roll and the page a
 *  family reads can never describe different classes. */
export function optionTimes(programSlug: string, optionLabel: string): string[] {
  const entry = CUGC_OPTION_CLASSES[optionKey(programSlug, optionLabel)];
  if (!entry) return [];
  const labels = entry.classIds.map((id) => classById(id)?.label).filter((l): l is string => !!l);
  // A twice-a-week place attends both, and saying so as one phrase is how the
  // club has always written it.
  return entry.attendsAll && labels.length > 1 ? [labels.join(" + ")] : labels;
}

export type RollPlacement =
  | { placed: true; classIds: string[]; reason?: undefined }
  | { placed: false; reason: "no-timetable" | "not-recorded"; classIds: string[] };

/**
 * 🔴 THE ONE DECIDER for "which rolls is this child on".
 *
 * Order matters. The stored `session_time` is the family's own choice and wins
 * whenever it names a real class. Only when it does not do we fall back to what
 * the option itself implies — and only when the option leaves no room for
 * doubt.
 */
export function classesForRegistration(
  programSlug: string,
  optionLabel: string,
  sessionTime: string | null | undefined,
): RollPlacement {
  const entry = CUGC_OPTION_CLASSES[optionKey(programSlug, optionLabel)];
  if (!entry || entry.classIds.length === 0) return { placed: false, reason: "no-timetable", classIds: [] };

  // 1. They named a class. Compare on the trimmed label — the stored strings
  //    come from the same config, but a stray space must not lose a child.
  const named = (sessionTime ?? "").trim();
  if (named) {
    const exact = entry.classIds.filter((id) => classById(id)?.label.trim() === named);
    if (exact.length) return { placed: true, classIds: exact };
  }

  // 2. The option attends everything it names ("twice a week"), so the stored
  //    "Tuesday + Saturday" needs no parsing at all.
  if (entry.attendsAll) return { placed: true, classIds: [...entry.classIds] };

  // 3. The option covers exactly one class, so there was never a choice to make
  //    and a blank is not ambiguous.
  if (entry.classIds.length === 1) return { placed: true, classIds: [...entry.classIds] };

  // 4. A choice existed and nobody recorded it. NOT every class — that would
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
