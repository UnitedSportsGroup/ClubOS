/**
 * Holiday camps come in EDITIONS — the same camp run every school holiday —
 * and each edition is its own `programs` row with its own dates, prices,
 * sessions, registrations and public page. That is the right data shape: a
 * family books "the April World Cup camp", and an ad or join.cufc.co.nz/worldcup
 * points at ONE row. What was wrong was the LIST: four rows for two camps.
 *
 * Daniel, 2026-09-21: "We have two options: World Cup Holiday Camp,
 * Fundamentals Holiday Camp. When you click inside, you've got the option to
 * view the January camps, the April camps, the September/October camps, our
 * December pre-Christmas camps, the January 2027 camps… Keep it super clean.
 * Keep the programs just to the programs, and then inside you've got the
 * selectors of the different timeframes."
 *
 * 🔴 The SERIES is DERIVED from the name, never stored. "World Cup Holiday Camp
 * Term 3 2026" and "World Cup Holiday Camp" are one series because the first
 * is the second plus an edition suffix. A name that matches no known suffix is
 * its own series — it shows on the list as an extra row where a human will
 * see it, never silently merged into the wrong camp.
 *
 * 🔴 The TIMEFRAME label comes from the camp's DATES, never from its name —
 * "Term 3 2026" in a name is somebody's wording; 28 Sep – 9 Oct is a fact.
 */

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const YEAR = "(?:\\s*,?\\s*(?:19|20)\\d{2})?";

/** Edition suffixes, each anchored to the END of the name. */
const EDITION_SUFFIXES: RegExp[] = [
  new RegExp(`\\bterm\\s*\\d${YEAR}$`, "i"),                              // "Term 3 2026" · "Term 3"
  new RegExp(`\\b${MONTH}(?:\\s*[–—/-]\\s*${MONTH})?${YEAR}$`, "i"),      // "April 2026" · "Sep–Oct 2026" · "September/October"
  new RegExp(`\\b(?:summer|autumn|winter|spring)${YEAR}$`, "i"),          // "Summer 2027"
  new RegExp(`\\b(?:pre[\\s-]?christmas|christmas|xmas|easter)${YEAR}$`, "i"),
  new RegExp(`\\b(?:school\\s+)?holidays?${YEAR}$`, "i"),                 // "… School Holidays 2026" (never "Holiday Camp" — that ends in Camp)
  /\b(?:19|20)\d{2}$/,                                                     // a bare year
];
const TRAILING_SEPARATORS = /[\s,:;|–—-]+$/;

function stripOnce(s: string): string {
  // "(April 2026)" — a parenthetical that is entirely an edition suffix.
  const paren = /\s*\(([^()]*)\)\s*$/.exec(s);
  if (paren && stripAll(paren[1]).length === 0) return s.slice(0, paren.index).trim();
  let next = s;
  for (const re of EDITION_SUFFIXES) next = next.replace(re, "").trim();
  return next.replace(TRAILING_SEPARATORS, "").trim();
}
function stripAll(s: string): string {
  let cur = s.trim();
  for (let i = 0; i < 6; i++) {
    const next = stripOnce(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** "World Cup Holiday Camp Term 3 2026" → "World Cup Holiday Camp". A name
 *  that is nothing but a suffix keeps its own name rather than becoming "". */
export function seriesName(name: string): string {
  const s = stripAll(name);
  return s || name.trim();
}

/** The grouping key — case- and whitespace-insensitive. */
export function seriesKey(name: string): string {
  return seriesName(name).toLowerCase().replace(/\s+/g, " ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Apr 2026" · "Sep–Oct 2026" · "Dec 2026 – Jan 2027", from the DATES. Works
 *  on the y-m-d parts — an ISO date never goes through a JS Date here. */
export function editionLabel(startDate: string | null | undefined, endDate?: string | null): string {
  if (!startDate) return "Dates not set";
  const [sy, sm] = startDate.slice(0, 10).split("-").map(Number);
  const [ey, em] = (endDate ?? startDate).slice(0, 10).split("-").map(Number);
  if (!sy || !sm || !ey || !em) return "Dates not set";
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTHS[sm - 1]}–${MONTHS[em - 1]} ${sy}`;
  return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
}

export type EditionLike = {
  id: number;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean | null | undefined;
};

/** Oldest first — a timeline reads left to right (Jan · Apr · Sep–Oct · Dec). */
export function sortEditions<T extends EditionLike>(editions: T[]): T[] {
  return [...editions].sort((a, b) =>
    (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999") || a.id - b.id);
}

/**
 * The edition a series ROW stands for and opens on: the one switched on that
 * is running or next up; else the latest one switched on; else the latest of
 * all. Never null for a non-empty list.
 */
export function currentEditionId<T extends EditionLike>(editions: T[], todayIso: string): number | null {
  if (editions.length === 0) return null;
  const byStart = sortEditions(editions);
  const live = byStart.filter((e) => !!e.isActive);
  const upcoming = live.find((e) => (e.endDate ?? e.startDate ?? "") >= todayIso);
  if (upcoming) return upcoming.id;
  if (live.length) return live[live.length - 1].id;
  return byStart[byStart.length - 1].id;
}

export type CampSeries<T extends EditionLike & { name: string }> = {
  key: string;
  name: string;
  editions: T[];   // oldest first
  current: T;
};

/** Group holiday camps into series, each with its current edition. Series
 *  order: by the current edition's start, newest first — what is on sale
 *  sits at the top of the list. */
export function groupCampSeries<T extends EditionLike & { name: string }>(camps: T[], todayIso: string): CampSeries<T>[] {
  const by = new Map<string, T[]>();
  for (const c of camps) {
    const k = seriesKey(c.name);
    const list = by.get(k);
    if (list) list.push(c); else by.set(k, [c]);
  }
  const out: CampSeries<T>[] = [];
  for (const [key, list] of Array.from(by.entries())) {
    const editions = sortEditions(list);
    const currentId = currentEditionId(editions, todayIso);
    const current = editions.find((e) => e.id === currentId) ?? editions[editions.length - 1];
    out.push({ key, name: seriesName(current.name), editions, current });
  }
  out.sort((a, b) => (b.current.startDate ?? "").localeCompare(a.current.startDate ?? "") || a.name.localeCompare(b.name, "en-NZ"));
  return out;
}
