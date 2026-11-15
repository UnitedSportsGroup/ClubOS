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

// ── Workspaces whose people are not `programs` registrations ─────────────────
// (2026-11-14, Daniel: "make mailer same for all workspaces same as cufc").
// United Gymnastics, Mini Football Leagues and the CIC keep their people in
// their own tables, so "By Programme" there is a few rows of choices the SERVER
// describes — Who · Term · Programme for the gym, Who · Term · League for MFL,
// Event · Who · Age group · Edition for the CIC. The page draws whatever rows
// it is given; the server alone decides who each choice reaches.

export type MailerKind = "programmes" | "groups";

export type GroupOption = {
  value: string;
  label: string;
  /** Shown faintly after the label ("now", "next"). */
  hint?: string;
  /** Only offered while the row named by the row's `parentRow` holds this value. */
  parent?: string;
};

export type GroupRow = {
  key: string;
  label: string;
  options: GroupOption[];
  /** The value picked when the page opens. */
  initial: string;
  /** Hide this row unless another row holds one of these values. */
  showWhen?: { key: string; values: string[] };
  /** Narrow this row's options to those whose `parent` equals that row's value
   *  (an option with no parent is always offered). */
  parentRow?: string;
};

export type GroupCatalogue = {
  kind: "groups";
  rows: GroupRow[];
  /** One sentence per value of the first row: what that group means. */
  notes?: Record<string, string>;
};

export type GroupChoice = Record<string, string>;

/** The choice a page should send: each row's value, dropping a hidden row and
 *  resetting an option its parent no longer offers. */
export function settleGroupChoice(cat: GroupCatalogue, choice: GroupChoice): GroupChoice {
  const out: GroupChoice = {};
  for (const row of cat.rows) {
    if (row.showWhen && !row.showWhen.values.includes(out[row.showWhen.key] ?? "")) continue;
    const offered = groupRowOptions(row, out);
    const want = choice[row.key];
    out[row.key] = offered.some((o) => o.value === want) ? want : offered.some((o) => o.value === row.initial) ? row.initial : (offered[0]?.value ?? "");
  }
  return out;
}

export function groupRowOptions(row: GroupRow, settled: GroupChoice): GroupOption[] {
  if (!row.parentRow) return row.options;
  const p = settled[row.parentRow] ?? "";
  return row.options.filter((o) => o.parent == null || o.parent === p);
}

/** "Confirmed families · Term 4 2026 · GymPlay" — for the review step and history. */
export function groupChoiceLabel(cat: GroupCatalogue | undefined, choice: GroupChoice): string {
  if (!cat) return "By programme";
  const settled = settleGroupChoice(cat, choice);
  const parts: string[] = [];
  for (const row of cat.rows) {
    if (!(row.key in settled)) continue;
    const o = row.options.find((x) => x.value === settled[row.key]);
    if (o) parts.push(o.label);
  }
  return parts.join(" · ");
}
