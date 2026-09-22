// ─────────────────────────────────────────────────────────────────────────────
// CUGC terms — which gymnastics term is being sold, and which one a
// registration is FOR.
//
// 🔴 THE LESSON THIS MODULE EXISTS TO ENCODE (learned on the CUFC academy,
// 2026-09-10): the term a programme is SELLING is not the term a registration
// BELONGS TO. `CUGC_TERM` used to be a single constant meaning both at once, so
// the day it was edited to point at Term 4 every past Term 3 enrolment would
// have silently re-filed itself. The term is resolved at the point of SALE and
// stamped on the row (`cugc_registrations.term`); everything that displays or
// counts reads it back from there and never from this file.
//
// 🔴 AND THE BUG THAT WAS ALREADY LOADED: the pricing engine returns
// `status: "ended"` with `price = fullPrice`, and nothing on cugc.co.nz ever
// read that field. Term 3 finishes Fri 25 Sep 2026 — on Sat 26 Sep the live
// card page would have gone back to charging the full $165 for a term that was
// over. `sellableTerms()` below is the fix, and it is a fix nobody has to
// remember: a term whose end date has passed is unsellable whatever anyone
// forgot to edit.
// ─────────────────────────────────────────────────────────────────────────────

export type CugcTerm = {
  /** Stable key. Never shown to a family; it is what a URL and a request carry,
   *  so renaming the term can never strand a link or a stored row. */
  id: string;
  /** What a human reads, and what is STORED on the registration. The 35 rows
   *  that existed before this module all carry "Term 3 2026", so the shape of
   *  this string is a contract with the data, not a label. */
  name: string;
  /** Both inclusive, `YYYY-MM-DD`, NZ calendar dates — never instants. */
  start: string;
  end: string;
  /** Teaching weeks. Drives pro-rata; not derived from the dates because a term
   *  can contain a week with no classes and only a human knows that. */
  weeks: number;
  /** A human switch, independent of the dates. False closes enrolment for a
   *  term that has not started yet — e.g. while a price is still being agreed.
   *  It can only ever CLOSE a term: it cannot re-open one that has finished. */
  enrolmentOpen: boolean;
};

/**
 * Official NZ school terms (Ministry of Education), which is what the club runs
 * to. Term 4 2026 was added 2026-09-20 on Daniel's instruction, at Term 3's
 * prices — prices live on the programme option and are shared across terms, so
 * "same as Term 3" meant nothing to copy. If Term 4 ever needs its own prices
 * that is a real change here, not a number typed into a page.
 */
//
// Term 3 enrolment CLOSED 2026-09-22 with three days of term left: Term 4's
// timetable is different (new days, a dropped Saturday class), the website
// shows one timetable, and selling a last-week Term 3 place beside it would
// have shown a parent Term 4's times for a Term 3 class.
export const CUGC_TERMS: CugcTerm[] = [
  { id: "t3-2026", name: "Term 3 2026", start: "2026-07-20", end: "2026-09-25", weeks: 10, enrolmentOpen: false },
  { id: "t4-2026", name: "Term 4 2026", start: "2026-10-12", end: "2026-12-18", weeks: 10, enrolmentOpen: true },
];

export type CugcTermStatus = "upcoming" | "active" | "ended";

/** Today in New Zealand as `YYYY-MM-DD`. The server runs in UTC, so asking it
 *  for "today" directly reads a day behind for most of the NZ afternoon — which
 *  would flip a term a day early or late. */
export function nzTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Where a term sits relative to today. Compared as `YYYY-MM-DD` STRINGS, which
 * sort correctly and are timezone-free — putting an ISO date through a JS
 * `Date` is how this codebase has printed the wrong day more than once.
 *
 * `end` is INCLUSIVE: the last day of term is still `active`, because a class
 * runs that day.
 */
export function termStatus(term: CugcTerm, todayIso: string = nzTodayIso()): CugcTermStatus {
  if (todayIso < term.start) return "upcoming";
  if (todayIso > term.end) return "ended";
  return "active";
}

/**
 * 🔴 THE ONE DECIDER for "can somebody buy this right now".
 *
 * Two conditions, and the order of the reasons matters when explaining a
 * refusal: a term that has finished is closed as a matter of fact, and a term
 * a human has switched off is closed as a matter of choice.
 */
export function isSellable(term: CugcTerm, todayIso: string = nzTodayIso()): boolean {
  return term.enrolmentOpen && termStatus(term, todayIso) !== "ended";
}

/** Every term a family may enrol into today, in calendar order. */
export function sellableTerms(todayIso: string = nzTodayIso()): CugcTerm[] {
  return CUGC_TERMS.filter((t) => isSellable(t, todayIso)).sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The term a family lands on when they have not chosen one.
 *
 * Deliberately the LAST sellable term, not the first. Through most of a term
 * the useful thing to sell is the one that is still whole: on 20 September,
 * Term 3 has two weeks left and Term 4 has ten. Offering the stub by default
 * would have families buying a fortnight of gymnastics by accident.
 */
export function defaultTerm(todayIso: string = nzTodayIso()): CugcTerm | null {
  const open = sellableTerms(todayIso);
  return open.length ? open[open.length - 1] : null;
}

export function termById(id: string | null | undefined): CugcTerm | null {
  if (!id) return null;
  return CUGC_TERMS.find((t) => t.id === id) ?? null;
}

export function termByName(name: string | null | undefined): CugcTerm | null {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  return CUGC_TERMS.find((t) => t.name.toLowerCase() === want) ?? null;
}

export type TermResolution =
  | { ok: true; term: CugcTerm }
  | { ok: false; reason: "unknown" | "closed" | "ended" | "none"; message: string };

/**
 * Resolve the term an enrolment is FOR, server-side.
 *
 * 🔴 The browser used to send the term as a NAME and the server stored it
 * unchecked (`req.body.term || CUGC_TERM.name`) — the same class of mistake as
 * letting the browser send the price. A stale page, or anybody with curl, could
 * file a paid enrolment under any term they liked, including one that had
 * finished. Now the browser sends an id and the server decides.
 *
 * 🔴 Tolerant of a MISSING id on purpose. The website and ClubOS deploy
 * separately, and shipping the strict server first is exactly what broke the
 * CUGC free-session form for a few minutes on 2026-08-09. A request with no
 * term is an older bundle, and it means the term that is running right now —
 * which is what that bundle was showing. If no term is running, it gets the
 * default rather than an error.
 */
export function resolveTermForSale(
  requestedId: string | null | undefined,
  todayIso: string = nzTodayIso(),
): TermResolution {
  const open = sellableTerms(todayIso);
  if (!open.length) {
    return { ok: false, reason: "none", message: "Enrolments are closed at the moment. Please get in touch and we'll help." };
  }

  if (requestedId) {
    const wanted = termById(requestedId);
    if (!wanted) return { ok: false, reason: "unknown", message: "That term isn't available." };
    if (termStatus(wanted, todayIso) === "ended") {
      return { ok: false, reason: "ended", message: `${wanted.name} has finished. Please choose the current term.` };
    }
    if (!wanted.enrolmentOpen) {
      // A term can be closed before it starts or while it runs out — "not
      // open yet" is only true of the first.
      const message = termStatus(wanted, todayIso) === "upcoming"
        ? `Enrolments for ${wanted.name} aren't open yet.`
        : `Enrolments for ${wanted.name} have closed. Please choose the next term.`;
      return { ok: false, reason: "closed", message };
    }
    return { ok: true, term: wanted };
  }

  // No term named — an older cugc.co.nz bundle. Prefer the term actually
  // running today (what that page was pricing), else the default.
  const running = open.find((t) => termStatus(t, todayIso) === "active");
  return { ok: true, term: running ?? open[open.length - 1] };
}

/** A term's label for display, with its state — "Term 4 2026 · starts 12 Oct". */
export function termWindowLabel(term: CugcTerm): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
    return `${Number(d)} ${month}`;
  };
  return `${fmt(term.start)} – ${fmt(term.end)}`;
}
