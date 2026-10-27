/**
 * The Mailer's "By programme" audience — the shape both ends agree on.
 *
 * Zach, 27 Oct 2026: "Can we get an option to send it to groups again? as i
 * cant send an email i need to the 4-8s." Daniel: "per program / per segment
 * sending as an option to quickly send to all like u4-u8 or all pre academy
 * or all u9 … organised logically and easy to find."
 *
 * A pick is any number of GROUPS — a whole programme, some of its age groups
 * (options), or a holiday-camp edition — within a TERM (default: the one
 * running now) or any time. Camp editions ignore the term: an edition is its
 * own time. The server resolves the pick with the same decider as every other
 * send (server/mailer-audience.ts); this file holds the types and the pure
 * helpers the picker and the send step share.
 */

/** One tick in the picker: a whole programme (optionIds null) or some of its
 *  age groups ("Pre-Academy, U9 and U10"). */
export type AudienceGroup = { programId: number; optionIds: number[] | null };

export type AudienceProgramme = {
  id: number;
  name: string;
  type: string;
  scheduleType: string | null;
  academySection: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean | null;
  ageMin: number | null;
  options: { id: number; name: string; isActive: boolean | null }[];
  /** Distinct family addresses with a real registration — all-time and per term. */
  families: { all: number; byTerm: Record<string, number> };
  optionFamilies: Record<string, { all: number; byTerm: Record<string, number> }>;
};

export type AudienceCatalogue = {
  today: string;
  currentTermId: number | null;
  terms: { id: number; name: string; startDate: string | null; endDate: string | null; current: boolean }[];
  programmes: AudienceProgramme[];
};

/** The term choice in the picker: a term id, "all" (any time), or null =
 *  the term running now (resolved from the catalogue). */
export type AudienceTerm = number | "all" | null;

const toIds = (v: unknown): number[] =>
  Array.isArray(v) ? Array.from(new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))) : [];

/** Reads a request's `groups` leniently: `optionIds: [..]`, a single
 *  `optionId`, or nothing (the whole programme). Unknown shapes are dropped. */
export function parseAudienceGroups(v: unknown): AudienceGroup[] {
  if (!Array.isArray(v)) return [];
  const out: AudienceGroup[] = [];
  for (const g of v) {
    const programId = Number((g as any)?.programId);
    if (!Number.isInteger(programId) || programId <= 0) continue;
    const raw = (g as any)?.optionIds ?? ((g as any)?.optionId != null ? [(g as any).optionId] : null);
    const optionIds = toIds(raw);
    out.push({ programId, optionIds: optionIds.length ? optionIds : null });
  }
  return out;
}

/** "U9" → [9] · "U9–U10" → [9, 10] · "U4-U8 All-Access Pass" → [4..8] ·
 *  "U13–U15" → [13, 14, 15]. Empty when the name carries no grade. */
export function gradesInName(name: string | null | undefined): number[] {
  const m = /U\s?(\d{1,2})(?:\s?[–-]\s?U?(\d{1,2}))?/i.exec(String(name ?? ""));
  if (!m) return [];
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b - a > 20) return [];
  const out: number[] = [];
  for (let g = a; g <= b; g++) out.push(g);
  return out;
}

export const isTermProgramme = (p: Pick<AudienceProgramme, "scheduleType" | "type">): boolean =>
  p.scheduleType === "term" || (p.type === "academy" && p.scheduleType !== "camp");

/** The term ids a pick sends within: null for "any time"; otherwise the
 *  chosen term, or the term running now. Empty when nothing is running and
 *  nothing was chosen — the caller treats that as "nothing to send to". */
export function termIdsFor(cat: AudienceCatalogue | undefined, term: AudienceTerm): number[] | null {
  if (term === "all") return null;
  const id = term ?? cat?.currentTermId ?? null;
  return id ? [id] : [];
}

/** Families in a programme (or one of its options) for the picker's current
 *  term choice. A camp edition is counted all-time: its rows carry no term. */
export function familiesFor(p: AudienceProgramme, term: AudienceTerm, cat: AudienceCatalogue | undefined, optionId?: number): number {
  const tally = optionId != null ? p.optionFamilies[String(optionId)] : p.families;
  if (!tally) return 0;
  if (!isTermProgramme(p) || term === "all") return tally.all;
  const id = term ?? cat?.currentTermId ?? null;
  return id ? tally.byTerm[String(id)] ?? 0 : 0;
}

const stripEdition = (name: string) =>
  name.replace(/\s*(Term\s*\d\s*\d{4}|Summer\s*\d{4}|Pre-Christmas\s*\d{4}|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(\s*[–-]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)?\s*\d{4}|\b\d{4})\s*$/i, "").trim() || name;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function editionOf(p: AudienceProgramme): string {
  if (!p.startDate) return "";
  const [sy, sm] = p.startDate.split("-").map(Number);
  const [ey, em] = (p.endDate ?? p.startDate).split("-").map(Number);
  if (!sy || !sm || !ey || !em) return "";
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey) return `${MONTHS[sm - 1]}–${MONTHS[em - 1]} ${sy}`;
  return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
}

/** How a programme reads in the picker and on the send step: a term
 *  programme by its name; a camp by its series and edition ("FUNdamentals
 *  Holiday Camp · Sep–Oct 2026"). */
export function programmeTitle(p: AudienceProgramme): string {
  if (isTermProgramme(p)) return p.name;
  const ed = editionOf(p);
  return ed ? `${stripEdition(p.name)} · ${ed}` : p.name;
}

/** "Pre-Academy: U9, U10 + FUNiño — First Kicks · Term 4 2026". What the
 *  send step, the confirmation and the History row show. */
export function audienceLabel(cat: AudienceCatalogue | undefined, groups: AudienceGroup[], term: AudienceTerm): string {
  if (!groups.length) return "No programme chosen";
  const parts: string[] = [];
  let anyTerm = false;
  for (const g of groups) {
    const p = cat?.programmes.find((x) => x.id === g.programId);
    if (!p) { parts.push(`Programme ${g.programId}`); continue; }
    if (isTermProgramme(p)) anyTerm = true;
    const title = programmeTitle(p);
    if (g.optionIds?.length) {
      const names = g.optionIds.map((id) => p.options.find((o) => o.id === id)?.name ?? `#${id}`);
      parts.push(`${title}: ${names.join(", ")}`);
    } else parts.push(title);
  }
  let when = "";
  if (anyTerm) {
    if (term === "all") when = " · any time";
    else {
      const id = term ?? cat?.currentTermId ?? null;
      const t = cat?.terms.find((x) => x.id === id);
      when = t ? ` · ${t.name}` : " · this term";
    }
  }
  return parts.join(" + ") + when;
}
