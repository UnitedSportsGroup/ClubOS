// ── Rambo's club-data tools — the club's numbers, in plain English ───────────
//
// Daniel, 2026-10-26 (night): "Tell me how many under-4 to 8s I have right
// now … a breakdown of how many we have at 3 years old, 4 years old … how many
// of them were in the holiday camps … how many players are in the roll but
// have not paid yet … what is our percentage of academy payments made for the
// whole academy, or the whole pre-academy … under-13 blue specific."
//
// Every query here is HAND-WRITTEN. The model never supplies SQL, a table or a
// column — it supplies a programme nickname, a term and a grouping, each of
// which is matched against a bounded list. Every count goes through the one
// decider the rest of ClubOS uses: a registration is real only when it is
// confirmed / refunded / partially_refunded (shared/registrations.ts). A
// pending row is a checkout somebody abandoned, never a player.
//
// Who is "a person": an academy registration's contact_id IS the player
// (contacts.date_of_birth); a holiday-camp booking's children ride on
// registration_items.child_id (children.date_of_birth). The two tables
// overlap in id space, so camp overlap is matched by name + date of birth and
// says so.
//
// Access: every handler re-checks the Registrations tab IN THE WORKSPACE being
// asked about (viewerCanReachTab with the org slug) — the second wall, per
// workspace, because a tool def's gate is "any workspace of theirs".

import { sql } from "drizzle-orm";
import { db } from "./db";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { ageFromDob } from "@shared/family";
import { KB_BRANDS, viewerCanReachTab, type Viewer } from "@shared/knowledge-base";

interface ToolResult {
  text: string;
  sources?: { id: number; title: string; brand: string }[];
}

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const REAL = sql.raw(REAL_REGISTRATION_STATUS_SQL);

// ── Workspace → organisation ─────────────────────────────────────────────────

interface Scope {
  orgId: number;
  orgSlug: string;
  orgName: string;
}

/** Which workspace the question is about: the one the person is standing in
 *  (X-Workspace-Slug), else the brand the model named, else their only
 *  workspace. Then: may they see registrations THERE? */
async function scopeFor(viewer: Viewer, input: any): Promise<{ ok: true; scope: Scope } | { ok: false; text: string }> {
  let slug: string | null = viewer.workspaceSlug ?? null;
  if (!slug && typeof input?.brand === "string") slug = KB_BRANDS.find((b) => b.key === input.brand)?.orgSlug ?? null;
  if (!slug && viewer.memberships.length === 1) slug = viewer.memberships[0].orgSlug;
  if (!slug) {
    return { ok: false, text: `Which workspace do you mean? Say one of: ${viewer.memberships.map((m) => m.orgName).join(", ")}.` };
  }
  const r = rowsOf(await db.execute(sql`SELECT id, slug, name FROM organizations WHERE slug = ${slug} LIMIT 1`));
  if (!r[0]) return { ok: false, text: `There's no workspace called "${slug}".` };
  if (!viewerCanReachTab(viewer, "registrations", String(r[0].slug)).allowed) {
    return { ok: false, text: `You don't have the Registrations area in ${r[0].name}, so I can't read its registration numbers for you. A super admin (Daniel) can give you that access.` };
  }
  return { ok: true, scope: { orgId: Number(r[0].id), orgSlug: String(r[0].slug), orgName: String(r[0].name) } };
}

// ── Programmes + terms ───────────────────────────────────────────────────────

interface Programme { id: number; name: string; slug: string; type: string; academySection: string | null; startDate: string | null; seasonYear: number | null; termId: number | null }

async function programmesFor(orgId: number): Promise<Programme[]> {
  return rowsOf(await db.execute(sql`
    SELECT id, name, slug, type, academy_section, start_date::text AS start_date, season_year, term_id
    FROM programs WHERE organization_id = ${orgId} ORDER BY type, name`)).map((r) => ({
    id: Number(r.id), name: String(r.name), slug: String(r.slug ?? ""), type: String(r.type ?? ""),
    academySection: r.academy_section ? String(r.academy_section) : null,
    startDate: r.start_date ? String(r.start_date).slice(0, 10) : null,
    seasonYear: r.season_year ? Number(r.season_year) : null, termId: r.term_id ? Number(r.term_id) : null,
  }));
}

/** Nicknames staff use, mapped to what the programme rows are called. */
const ALIASES: { test: RegExp; slugs?: string[]; type?: string; section?: string }[] = [
  { test: /\b(u4|u5|u6|u7|u8|u4\s*[-–to ]+\s*u?8|under[ -]?4|first kicks|fun[iñ]o|funino)\b/i, slugs: ["u4-u8"] },
  { test: /\b(pre[- ]?academy|u9|u10|u11|u12|u9\s*[-–to ]+\s*u?12)\b/i, slugs: ["pre-academy-u9-u12"] },
  { test: /\b(academy u13|u13|u14|u15|u16|u17|u13\s*[-–to ]+\s*u?17|the academy|^academy$)\b/i, slugs: ["academy-u13-u17"] },
  { test: /\btechnification\b/i, slugs: ["technification"] },
  { test: /\b(goalkeep|gk)\b/i, slugs: ["gk-programme"] },
  { test: /\bmorning\b/i, slugs: ["morning-programme"] },
  { test: /\b(football institute|institute)\b/i, slugs: ["football-institute"] },
  { test: /\b(holiday|camp|camps|school holiday)\b/i, type: "holiday_camp" },
  { test: /\b(core academy|whole academy|all academy|every academy|academy programmes?)\b/i, type: "academy", section: "core" },
];

/** Match a nickname to programmes. Returns every match (a camp family has
 *  several) plus what it was read as, so the answer can say so. */
function matchProgrammes(all: Programme[], text: string | undefined | null): { matched: Programme[]; readAs: string } {
  const q = String(text ?? "").trim();
  if (!q || /^(all|everything|every programme|everyone)$/i.test(q)) return { matched: all, readAs: "every programme" };
  for (const a of ALIASES) {
    if (!a.test.test(q)) continue;
    const m = all.filter((p) => (a.slugs ? a.slugs.includes(p.slug) : true) && (a.type ? p.type === a.type : true) && (a.section ? p.academySection === a.section : true));
    if (m.length) return { matched: m, readAs: a.slugs ? m.map((p) => p.name).join(", ") : a.type === "holiday_camp" ? "the holiday camps" : "the core academy programmes" };
  }
  const lower = q.toLowerCase();
  const exact = all.filter((p) => p.name.toLowerCase() === lower || p.slug === lower);
  if (exact.length) return { matched: exact, readAs: exact.map((p) => p.name).join(", ") };
  const partial = all.filter((p) => p.name.toLowerCase().includes(lower) || p.slug.includes(lower.replace(/\s+/g, "-")));
  if (partial.length) return { matched: partial, readAs: partial.map((p) => p.name).join(", ") };
  return { matched: [], readAs: q };
}

interface Term { id: number; name: string; year: number; number: number; start: string; end: string }

async function termsFor(orgId: number): Promise<Term[]> {
  return rowsOf(await db.execute(sql`
    SELECT id, name, year, term_number, start_date::text AS s, end_date::text AS e
    FROM terms WHERE organization_id = ${orgId} ORDER BY year, term_number`)).map((r) => ({
    id: Number(r.id), name: String(r.name), year: Number(r.year), number: Number(r.term_number),
    start: String(r.s).slice(0, 10), end: String(r.e).slice(0, 10),
  }));
}

function nzToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
}

/** "current" (default) = the term we are IN today, else the next one to start,
 *  else the latest. "last term" = the one before that. "Term 3 2026" parses. */
function resolveTerm(terms: Term[], text: string | undefined | null): Term | null {
  if (!terms.length) return null;
  const today = nzToday();
  const current = terms.find((t) => t.start <= today && today <= t.end)
    ?? terms.find((t) => t.start > today)
    ?? terms[terms.length - 1];
  const q = String(text ?? "").trim().toLowerCase();
  if (!q || /^(current|this term|now|this)$/.test(q)) return current;
  if (/^(last term|previous term|last)$/.test(q)) {
    const i = terms.findIndex((t) => t.id === current.id);
    return i > 0 ? terms[i - 1] : current;
  }
  if (/^(next term|next)$/.test(q)) {
    const i = terms.findIndex((t) => t.id === current.id);
    return terms[i + 1] ?? current;
  }
  const m = /term\s*(\d)(?:\D+(\d{4}))?/.exec(q);
  if (m) {
    const n = Number(m[1]);
    const year = m[2] ? Number(m[2]) : current.year;
    return terms.find((t) => t.number === n && t.year === year) ?? null;
  }
  const y = /^(\d{4})$/.exec(q);
  if (y) return terms.filter((t) => t.year === Number(y[1])).pop() ?? null;
  return null;
}

const termLabel = (t: Term) => `${t.name} ${t.year}`;

// ── People in a programme ────────────────────────────────────────────────────

interface Person {
  key: string;        // "c:123" or "k:456" — never collide
  firstName: string;
  lastName: string;
  dob: string | null; // yyyy-mm-dd
  programme: string;
  option: string | null;
}

/** Paid people on these programmes in this term. Academy = the contact on the
 *  registration; camps = the children on its items. Distinct per person. */
async function paidPeople(orgId: number, programmes: Programme[], term: Term | null): Promise<Person[]> {
  const out = new Map<string, Person>();
  const academy = programmes.filter((p) => p.type !== "holiday_camp").map((p) => p.id);
  const camps = programmes.filter((p) => p.type === "holiday_camp").map((p) => p.id);
  if (academy.length) {
    const rows = rowsOf(await db.execute(sql`
      SELECT DISTINCT ON (c.id, p.id) c.id AS cid, c.first_name, c.last_name, c.date_of_birth::text AS dob, p.name AS programme, po.name AS option_name
      FROM registrations r
      JOIN programs p ON p.id = r.program_id
      JOIN contacts c ON c.id = r.contact_id
      LEFT JOIN program_options po ON po.id = r.program_option_id
      WHERE p.organization_id = ${orgId} AND r.status IN ${REAL}
        AND r.program_id IN (${sql.join(academy.map((id) => sql`${id}`), sql`, `)})
        ${term ? sql`AND r.term_id = ${term.id}` : sql``}
      ORDER BY c.id, p.id, r.registered_at DESC`));
    for (const r of rows) {
      const key = `c:${r.cid}`;
      if (!out.has(key)) out.set(key, { key, firstName: String(r.first_name ?? ""), lastName: String(r.last_name ?? ""), dob: r.dob ? String(r.dob).slice(0, 10) : null, programme: String(r.programme), option: r.option_name ? String(r.option_name) : null });
    }
  }
  if (camps.length) {
    const rows = rowsOf(await db.execute(sql`
      SELECT DISTINCT ON (ch.id, p.id) ch.id AS kid, ch.first_name, ch.last_name, ch.date_of_birth::text AS dob, p.name AS programme
      FROM registration_items ri
      JOIN registrations r ON r.id = ri.registration_id
      JOIN programs p ON p.id = r.program_id
      JOIN children ch ON ch.id = ri.child_id
      WHERE p.organization_id = ${orgId} AND r.status IN ${REAL}
        AND r.program_id IN (${sql.join(camps.map((id) => sql`${id}`), sql`, `)})
        ${term ? sql`AND p.start_date BETWEEN ${term.start}::date AND ${term.end}::date` : sql``}
      ORDER BY ch.id, p.id`));
    for (const r of rows) {
      const key = `k:${r.kid}`;
      if (!out.has(key)) out.set(key, { key, firstName: String(r.first_name ?? ""), lastName: String(r.last_name ?? ""), dob: r.dob ? String(r.dob).slice(0, 10) : null, programme: String(r.programme), option: null });
    }
  }
  return Array.from(out.values());
}

const ageOf = (p: Person): number | null => (p.dob ? ageFromDob(p.dob, nzToday()) : null);
const gradeOf = (p: Person, seasonYear: number): number | null => (p.dob ? seasonYear - Number(p.dob.slice(0, 4)) : null);

function countBy<T>(items: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) { const k = key(it); m.set(k, (m.get(k) ?? 0) + 1); }
  return Array.from(m.entries());
}

const DECIDER_NOTE = "Counted as registered: paid and confirmed (refunds included as history). An unfinished online checkout is never counted.";

// ── Tool: player numbers ─────────────────────────────────────────────────────

export async function runPlayerNumbers(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { scope } = s;
  const all = await programmesFor(scope.orgId);
  const { matched, readAs } = matchProgrammes(all, input?.programme);
  if (!matched.length) {
    return { text: `I couldn't match "${input?.programme}" to a programme in ${scope.orgName}. The programmes are: ${all.map((p) => p.name).join("; ")}. Ask again naming one of those.` };
  }
  const terms = await termsFor(scope.orgId);
  const wantTerm = input?.term && !/^(all|all time|ever)$/i.test(String(input.term));
  const term = wantTerm || !input?.term ? resolveTerm(terms, input?.term) : null;
  if (wantTerm && !term) return { text: `I don't know a term called "${input.term}" in ${scope.orgName}. Terms on file: ${terms.map(termLabel).join(", ")}.` };
  const people = await paidPeople(scope.orgId, matched, term);
  const seasonYear = term?.year ?? Number(nzToday().slice(0, 4));
  const groupBy = String(input?.group_by ?? "programme").toLowerCase();

  const lines: string[] = [];
  lines.push(`${readAs}${term ? ` — ${termLabel(term)}` : " — all time"} (${scope.orgName}): **${people.length} registered ${people.length === 1 ? "player" : "players"}** (distinct people).`);
  if (!people.length) lines.push("Nobody is registered there for that term.");
  else if (groupBy === "age") {
    const withAge = people.filter((p) => ageOf(p) != null);
    const byAge = countBy(withAge, (p) => String(ageOf(p))).sort((a, b) => Number(a[0]) - Number(b[0]));
    lines.push(`By age today (years): ${byAge.map(([a, n]) => `${a} yrs: ${n}`).join(" · ")}${withAge.length < people.length ? ` · no date of birth on file: ${people.length - withAge.length}` : ""}`);
  } else if (groupBy === "grade" || groupBy === "age_group") {
    const withG = people.filter((p) => gradeOf(p, seasonYear) != null);
    const byG = countBy(withG, (p) => `U${gradeOf(p, seasonYear)}`).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
    lines.push(`By age grade (${seasonYear} season, NZ Football's year-of-birth rule): ${byG.map(([g, n]) => `${g}: ${n}`).join(" · ")}${withG.length < people.length ? ` · no date of birth: ${people.length - withG.length}` : ""}`);
  } else if (groupBy === "option") {
    const byO = countBy(people, (p) => p.option ?? "(no option recorded)").sort((a, b) => b[1] - a[1]);
    lines.push(`By the option the family chose: ${byO.map(([o, n]) => `${o}: ${n}`).join(" · ")}`);
  } else {
    const byP = countBy(people, (p) => p.programme).sort((a, b) => b[1] - a[1]);
    lines.push(`By programme: ${byP.map(([p, n]) => `${p}: ${n}`).join(" · ")}`);
    if (matched.length === 1 && people.some((p) => p.option)) {
      const byO = countBy(people, (p) => p.option ?? "(no option recorded)").sort((a, b) => b[1] - a[1]);
      lines.push(`By option: ${byO.map(([o, n]) => `${o}: ${n}`).join(" · ")}`);
    }
  }
  lines.push(DECIDER_NOTE + (matched.some((p) => p.type === "holiday_camp") ? " Holiday camps have no term; they are filtered by the camp's start date inside the term's dates." : ""));
  return { text: lines.join("\n") };
}

// ── Tool: payment status (paid · on the roll but unpaid · abandoned checkouts) ─

export async function runPaymentStatus(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { scope } = s;
  const all = await programmesFor(scope.orgId);
  const { matched, readAs } = matchProgrammes(all, input?.programme || "core academy");
  if (!matched.length) return { text: `I couldn't match "${input?.programme}" to a programme. The programmes are: ${all.map((p) => p.name).join("; ")}.` };
  const terms = await termsFor(scope.orgId);
  const term = resolveTerm(terms, input?.term);
  if (!term) return { text: `I don't know a term called "${input?.term}". Terms on file: ${terms.map(termLabel).join(", ")}.` };
  const ids = matched.map((p) => p.id);
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  const paid = await paidPeople(scope.orgId, matched, term);
  const paidKeys = new Set(paid.map((p) => p.key));

  // Started a checkout, never paid — distinct people, excluding anyone who paid.
  const pendingRows = rowsOf(await db.execute(sql`
    SELECT DISTINCT c.id AS cid, c.first_name, c.last_name, p.name AS programme
    FROM registrations r JOIN programs p ON p.id = r.program_id JOIN contacts c ON c.id = r.contact_id
    WHERE p.organization_id = ${scope.orgId} AND r.status = 'pending' AND r.program_id IN (${idList}) AND r.term_id = ${term.id}`));
  const pending = pendingRows.filter((r) => !paidKeys.has(`c:${r.cid}`));

  // On the roll (marked present, or checked in) at a session of these
  // programmes inside the term, with no paid registration for the term.
  const rollRows = rowsOf(await db.execute(sql`
    SELECT DISTINCT COALESCE(c.id, 0) AS cid, COALESCE(ch.id, 0) AS kid,
           COALESCE(c.first_name, ch.first_name) AS first_name, COALESCE(c.last_name, ch.last_name) AS last_name,
           p.name AS programme, count(DISTINCT cd.date) AS sessions
    FROM attendance a
    JOIN camp_dates cd ON cd.id = a.camp_date_id
    JOIN programs p ON p.id = cd.camp_id
    LEFT JOIN contacts c ON c.id = a.contact_id
    LEFT JOIN children ch ON ch.id = a.child_id
    WHERE p.organization_id = ${scope.orgId} AND p.id IN (${idList})
      AND cd.date BETWEEN ${term.start}::date AND ${term.end}::date
      AND (a.status = 'present' OR a.checked_in_at IS NOT NULL)
    GROUP BY 1, 2, 3, 4, 5`));
  const onRoll = rollRows.map((r) => ({ key: Number(r.cid) ? `c:${r.cid}` : `k:${r.kid}`, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), programme: String(r.programme), sessions: Number(r.sessions) }));
  const rollUnpaid = onRoll.filter((r) => !paidKeys.has(r.key));
  const rollPaid = onRoll.length - rollUnpaid.length;

  const everyone = paid.length + rollUnpaid.length;
  const pct = everyone ? Math.round((paid.length / everyone) * 100) : null;

  const lines: string[] = [];
  lines.push(`${readAs} — ${termLabel(term)} (${scope.orgName}):`);
  lines.push(`- **Paid and registered: ${paid.length}**`);
  lines.push(`- **On the roll but NOT paid: ${rollUnpaid.length}** (marked present or checked in at a ${termLabel(term)} session, no paid registration for the term)`);
  lines.push(`- Started an online checkout and never paid: ${pending.length} (not counted as players)`);
  if (pct != null) lines.push(`- **Paid share: ${pct}%** of everyone seen this term (${paid.length} of ${everyone}); ${rollPaid} of the ${onRoll.length} people on the roll have paid.`);
  if (matched.length > 1) {
    const byP = new Map<string, { paid: number; roll: number }>();
    for (const p of paid) byP.set(p.programme, { paid: (byP.get(p.programme)?.paid ?? 0) + 1, roll: byP.get(p.programme)?.roll ?? 0 });
    for (const r of rollUnpaid) byP.set(r.programme, { paid: byP.get(r.programme)?.paid ?? 0, roll: (byP.get(r.programme)?.roll ?? 0) + 1 });
    lines.push(`By programme (paid / on the roll unpaid): ${Array.from(byP.entries()).map(([n, v]) => `${n}: ${v.paid} / ${v.roll}`).join(" · ")}`);
  } else if (paid.some((p) => p.option)) {
    const byO = countBy(paid, (p) => p.option ?? "(no option)").sort((a, b) => b[1] - a[1]);
    lines.push(`Paid, by option: ${byO.map(([o, n]) => `${o}: ${n}`).join(" · ")}`);
  }
  if (rollUnpaid.length) {
    const names = rollUnpaid.slice(0, 30).map((r) => `${r.name}${matched.length > 1 ? ` (${r.programme})` : ""} — ${r.sessions} session${r.sessions === 1 ? "" : "s"}`);
    lines.push(`On the roll, unpaid${rollUnpaid.length > 30 ? " (first 30)" : ""}: ${names.join("; ")}`);
  }
  lines.push(DECIDER_NOTE + " A person can be on the roll because a coach marked them present at open training or a trial.");
  return { text: lines.join("\n") };
}

// ── Tool: camp overlap ───────────────────────────────────────────────────────

export async function runCampOverlap(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { scope } = s;
  const all = await programmesFor(scope.orgId);
  const { matched, readAs } = matchProgrammes(all.filter((p) => p.type !== "holiday_camp"), input?.programme);
  if (!matched.length) return { text: `I couldn't match "${input?.programme}" to an academy programme. The programmes are: ${all.filter((p) => p.type !== "holiday_camp").map((p) => p.name).join("; ")}.` };
  const terms = await termsFor(scope.orgId);
  const term = resolveTerm(terms, input?.term);
  const people = await paidPeople(scope.orgId, matched, term);
  if (!people.length) return { text: `Nobody is registered on ${readAs}${term ? ` in ${termLabel(term)}` : ""}, so there is nobody to match against the camps.` };

  // Match academy players (contacts) to camp children by name + date of birth.
  const year = input?.year ? Number(input.year) : null;
  const campKids = rowsOf(await db.execute(sql`
    SELECT DISTINCT lower(ch.first_name) AS fn, lower(ch.last_name) AS ln, ch.date_of_birth::text AS dob, p.name AS camp, p.start_date::text AS start
    FROM registration_items ri
    JOIN registrations r ON r.id = ri.registration_id
    JOIN programs p ON p.id = r.program_id
    JOIN children ch ON ch.id = ri.child_id
    WHERE p.organization_id = ${scope.orgId} AND p.type = 'holiday_camp' AND r.status IN ${REAL}
      ${year ? sql`AND EXTRACT(YEAR FROM p.start_date) = ${year}` : sql``}`));
  const byPerson = new Map<string, string[]>();
  for (const k of campKids) {
    const key = `${k.fn}|${k.ln}|${k.dob ? String(k.dob).slice(0, 10) : ""}`;
    byPerson.set(key, [...(byPerson.get(key) ?? []), String(k.camp)]);
  }
  const overlap = people.filter((p) => byPerson.has(`${p.firstName.toLowerCase()}|${p.lastName.toLowerCase()}|${p.dob ?? ""}`));
  const campCounts = countBy(overlap.flatMap((p) => Array.from(new Set(byPerson.get(`${p.firstName.toLowerCase()}|${p.lastName.toLowerCase()}|${p.dob ?? ""}`) ?? []))), (c) => c).sort((a, b) => b[1] - a[1]);
  const pct = Math.round((overlap.length / people.length) * 100);
  const lines = [
    `${readAs}${term ? ` — ${termLabel(term)}` : ""} (${scope.orgName}): **${overlap.length} of ${people.length} registered players (${pct}%) have also been to a holiday camp**${year ? ` in ${year}` : " (any camp on record)"}.`,
    campCounts.length ? `Which camps: ${campCounts.map(([c, n]) => `${c}: ${n}`).join(" · ")}` : "",
    `Matched by first name, last name and date of birth, because a camp booking records the child separately from an academy player. A family that spelt a name differently on one form will be missed.`,
    DECIDER_NOTE,
  ].filter(Boolean);
  return { text: lines.join("\n") };
}

// ── Tool: squad payment status ("U13 Blue") ──────────────────────────────────

export async function runSquadPaymentStatus(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { scope } = s;
  const terms = await termsFor(scope.orgId);
  const term = resolveTerm(terms, input?.term);
  if (!term) return { text: `I don't know a term called "${input?.term}". Terms on file: ${terms.map(termLabel).join(", ")}.` };
  const q = String(input?.squad ?? "").trim();
  const squads = rowsOf(await db.execute(sql`
    SELECT id, name, age_grade FROM club_squads
    WHERE organization_id = ${scope.orgId} AND is_active = true AND season_year = ${term.year}
    ORDER BY age_grade, name`)).map((r) => ({ id: Number(r.id), name: String(r.name), grade: r.age_grade ? Number(r.age_grade) : null }));
  if (!squads.length) return { text: `${scope.orgName} has no squads set up for ${term.year}.` };
  let chosen = squads;
  if (q && !/^(all|every|everyone)$/i.test(q)) {
    const lower = q.toLowerCase().replace(/\s+/g, " ");
    chosen = squads.filter((sq) => sq.name.toLowerCase() === lower);
    if (!chosen.length) chosen = squads.filter((sq) => sq.name.toLowerCase().includes(lower));
    if (!chosen.length) {
      const g = /u\s?(\d{1,2})/i.exec(lower);
      if (g) chosen = squads.filter((sq) => sq.grade === Number(g[1]));
    }
    if (!chosen.length) return { text: `I couldn't match "${q}" to a squad. ${term.year} squads: ${squads.map((sq) => sq.name).join(", ")}.` };
  }
  const squadIds = sql.join(chosen.map((sq) => sql`${sq.id}`), sql`, `);
  const rows = rowsOf(await db.execute(sql`
    SELECT sq.name AS squad, c.id AS cid, c.first_name, c.last_name,
           EXISTS (
             SELECT 1 FROM registrations r JOIN programs p ON p.id = r.program_id
             WHERE r.contact_id = c.id AND p.organization_id = ${scope.orgId} AND p.type <> 'holiday_camp'
               AND r.status IN ${REAL} AND r.term_id = ${term.id}
           ) AS paid
    FROM club_squad_members m
    JOIN club_squads sq ON sq.id = m.squad_id
    JOIN contacts c ON c.id = m.contact_id
    WHERE m.squad_id IN (${squadIds}) AND m.left_at IS NULL AND (m.role IS NULL OR m.role = 'player')
    ORDER BY sq.name, c.last_name, c.first_name`));
  if (!rows.length) return { text: `${chosen.map((sq) => sq.name).join(", ")}: no players on the roster yet (rosters are filled in by the coaches).` };
  const bySquad = new Map<string, { paid: string[]; unpaid: string[] }>();
  for (const r of rows) {
    const e = bySquad.get(r.squad) ?? { paid: [], unpaid: [] };
    (r.paid ? e.paid : e.unpaid).push(`${r.first_name ?? ""} ${r.last_name ?? ""}`.trim());
    bySquad.set(r.squad, e);
  }
  const lines: string[] = [`Squad payments — ${termLabel(term)} (${scope.orgName}), "paid" = a paid academy registration for the term:`];
  let tp = 0, tu = 0;
  for (const [name, e] of Array.from(bySquad.entries())) {
    tp += e.paid.length; tu += e.unpaid.length;
    const total = e.paid.length + e.unpaid.length;
    lines.push(`- **${name}: ${e.paid.length} of ${total} paid (${Math.round((e.paid.length / total) * 100)}%)**${e.unpaid.length ? ` — not paid: ${e.unpaid.slice(0, 25).join(", ")}${e.unpaid.length > 25 ? ` and ${e.unpaid.length - 25} more` : ""}` : ""}`);
  }
  if (bySquad.size > 1) lines.push(`All of these squads together: ${tp} of ${tp + tu} paid (${Math.round((tp / (tp + tu)) * 100)}%).`);
  lines.push(DECIDER_NOTE);
  return { text: lines.join("\n") };
}

export const CLUB_TOOL_HANDLERS: Record<string, (viewer: Viewer, input: any) => Promise<ToolResult>> = {
  player_numbers: runPlayerNumbers,
  payment_status: runPaymentStatus,
  camp_overlap: runCampOverlap,
  squad_payment_status: runSquadPaymentStatus,
};
