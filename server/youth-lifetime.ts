// Youth lifetime value — every child the club has ever taught, on one timeline,
// so Rambo can answer "how long do families stay", "what is a U4–U8 child worth
// over their time with us", "how many move up to Pre-Academy", "who is new this
// term and who came back".
//
// Daniel, 2026-10-27: "We have the historical data, the lifetime value, and the
// cycles of the customers and all that. That is a massive part of all of this
// to win … usually scattered in different places. Now we're bringing it all in
// one place, and we want to be able to have that all searchable in here."
//
// This is the engine behind outputs/youth-ltv/2026-10-20 (build_youth_ltv.cjs
// + journeys.cjs), ported into the server so the figures are LIVE rather than a
// report dated 20 October. The rules are the same ones, in the same order:
//
//   1. A CHILD is one person across every system: a player contact (merged
//      records resolved), a ClubOS camp child, or a Shopify line that only ever
//      carried the child's name and date of birth. Records join on name + DOB,
//      then name + a shared parent email/phone (never an office address), then
//      DOB + first name + a containing surname or a shared parent.
//   2. Every programme record and every payment is classified by the club's two
//      existing deciders — @shared/term-programme-history (stream + term) and
//      @shared/holiday-camp-history (camp series + holiday) — never a third
//      transcription of the rules.
//   3. The same money recorded twice (Friendly Manager and Xero, Xero and a
//      migrated ClubOS registration) is counted once; a payment with no term on
//      it snaps onto the child's enrolment next door; money that only names the
//      FAMILY is split across the children who were active that year.
//   4. 🔴 The dataset is CACHED per organisation for 15 minutes — it reads six
//      tables in full and takes a few seconds. Nothing is written anywhere.
//
// Only Christchurch United's youth programmes are modelled (the deciders know
// FUNiño, Pre-Academy, Academy, Technification, Goalkeeper, Morning and the
// camps). Mini Football Leagues has its own engine (server/league-lifetime.ts).

import { sql } from "drizzle-orm";
import { db } from "./db";
import { REAL_REGISTRATION_STATUS_SQL } from "@shared/registrations";
import { classifyTermRow, streamForProgramme, termForPaidDate } from "@shared/term-programme-history";
import { classifyHistoryRow, editionForCampStart } from "@shared/holiday-camp-history";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

// ── Streams ──────────────────────────────────────────────────────────────────
export type Stream =
  | "u48" | "pre_academy" | "academy" | "technification" | "goalkeeper" | "morning"
  | "camp_fundamentals" | "camp_worldcup" | "camp_other" | "uniform" | "other";
export const STREAMS: Stream[] = ["u48", "pre_academy", "academy", "technification", "goalkeeper", "morning", "camp_fundamentals", "camp_worldcup", "camp_other", "uniform", "other"];
export const TERM_STREAMS: Stream[] = ["u48", "pre_academy", "academy", "technification", "goalkeeper", "morning"];
export const CAMP_STREAMS: Stream[] = ["camp_fundamentals", "camp_worldcup", "camp_other"];
export const PROGRAMME_STREAMS: Stream[] = [...TERM_STREAMS, ...CAMP_STREAMS];
export const STREAM_NAME: Record<Stream, string> = {
  u48: "U4–U8 (FUNiño)", pre_academy: "Pre-Academy (U9–U12)", academy: "Academy (U13+)",
  technification: "Technification", goalkeeper: "Goalkeeper", morning: "Morning programme",
  camp_fundamentals: "FUNdamentals camp (U4–U8)", camp_worldcup: "World Cup camp (U9–U13)",
  camp_other: "Other holiday camps", uniform: "Uniform / kit", other: "Other",
};
const TPH_MAP: Record<string, Stream | "academy_unsplit"> = { funino: "u48", technification: "technification", pre_academy: "pre_academy", academy: "academy", goalkeeper: "goalkeeper", morning: "morning", academy_unsplit: "academy_unsplit" };
const CAMP_MAP: Record<string, Stream> = { fundamentals: "camp_fundamentals", world_cup: "camp_worldcup", specialist: "camp_other", general: "camp_other" };
const isTermStream = (s: string) => (TERM_STREAMS as string[]).includes(s);
const isCampStream = (s: string) => (CAMP_STREAMS as string[]).includes(s);
const isProgrammeStream = (s: string) => (PROGRAMME_STREAMS as string[]).includes(s);

/** Resolve a nickname staff use to a stream. */
export function streamFromText(text: string | null | undefined): Stream | "all" | null {
  const q = String(text ?? "").trim().toLowerCase();
  if (!q || /^(all|every|everything|every programme|whole club)$/.test(q)) return "all";
  if (/fundament|first skills/.test(q) && /camp|holiday/.test(q)) return "camp_fundamentals";
  if (/world cup/.test(q)) return "camp_worldcup";
  if (/camp|holiday/.test(q)) return "camp_fundamentals";
  if (/technif/.test(q)) return "technification";
  if (/goal ?keep|\bgk\b/.test(q)) return "goalkeeper";
  if (/morning|institute/.test(q)) return "morning";
  if (/pre[- ]?academy|\bu9\b|\bu10\b|\bu11\b|\bu12\b|u9\s*[-–to ]+\s*u?12/.test(q)) return "pre_academy";
  if (/\bu4|\bu5\b|\bu6\b|\bu7\b|\bu8\b|first kicks|fun[iñ]o|funino|u4\s*[-–to ]+\s*u?8/.test(q)) return "u48";
  if (/academy|\bu13\b|\bu14\b|\bu15\b|\bu16\b|\bu17\b|u13\s*[-–to ]+\s*u?17/.test(q)) return "academy";
  return null;
}

// ── Helpers (verbatim from the 20 Oct build) ─────────────────────────────────
const lower = (s: any) => (s ?? "").toString().toLowerCase();
const normName = (s: any) => lower(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\([^)]*\)/g, " ").replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
const fullName = (f: any, l: any) => { const n = normName(`${f ?? ""} ${l ?? ""}`); return n.length >= 3 && n.includes(" ") ? n : null; };
const normEmail = (e: any) => { const x = lower(e).trim(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(x) ? x : null; };
const normPhone = (p: any) => { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-9) : null; };
const okDob = (d: any) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && +d.slice(0, 4) >= 1995 && +d.slice(0, 4) <= 2024 ? String(d) : null);
export const median = (a: number[]) => { if (!a.length) return null; const s = Array.from(a).sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const ageAt = (dob: string | null, iso: string | null) => { if (!dob || !iso) return null; let a = +iso.slice(0, 4) - +dob.slice(0, 4); if (iso.slice(5) < dob.slice(5)) a--; return a; };

class UF {
  p = new Map<string, string>();
  add(x: string) { if (!this.p.has(x)) this.p.set(x, x); }
  find(x: string): string { this.add(x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r)!; let c = x; while (this.p.get(c) !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n; } return r; }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) { if (ra < rb) this.p.set(rb, ra); else this.p.set(ra, rb); } }
}

// ── Periods ──────────────────────────────────────────────────────────────────
// Term "2025-T3", whole year "2019-YR", camp "2025-Apr" | "2025-Jul" | "2025-Sep-Oct" | "2025-Dec" (Dec 2025–Jan 2026).
const NOMINAL: Record<number, string> = { 1: "02-01", 2: "04-27", 3: "07-17", 4: "10-09" };
const CAMP: Record<string, [string, string | null, number]> = { apr: ["Apr", "04-15", 2], jul: ["Jul", "07-08", 3], sep: ["Sep-Oct", "09-29", 4], summer: ["Dec", null, 1] };
interface PeriodInfo { label: string; start: string; idx: number; isTerm: boolean; isYear?: boolean; isCamp?: boolean }

function makePeriodInfo(termStarts: Map<string, string>) {
  const termStart = (y: number, t: number) => termStarts.get(`${y}-${t}`) ?? `${y}-${NOMINAL[t]}`;
  return (kind: "term" | "camp", key: string): PeriodInfo => {
    const [ys, p] = key.split("-"); const y = +ys;
    if (kind === "term") {
      if (p === "yr") return { label: `${y}-YR`, start: `${y}-02-01`, idx: y * 4 + 0, isTerm: false, isYear: true };
      const t = +p.slice(1); return { label: `${y}-T${t}`, start: termStart(y, t), idx: y * 4 + (t - 1), isTerm: true };
    }
    const [lab, md, nextT] = CAMP[p];
    // A camp counts toward the TERM IT PRECEDES (Apr → T2, Jul → T3, Sep-Oct → T4, Dec → next T1).
    const start = p === "summer" ? `${y + 1}-01-12` : `${y}-${md}`;
    const idx = p === "summer" ? (y + 1) * 4 + 0 : y * 4 + (nextT - 1);
    return { label: `${y}-${lab}`, start, idx, isTerm: false, isCamp: true };
  };
}
/** Index of a dataset label ("2025-T3", "2025-Sep-Oct", "2025-Dec", "2019-YR"). */
export function labelIdx(label: string): number {
  const y = +label.slice(0, 4); const s = label.slice(5);
  if (s[0] === "T") return y * 4 + (+s[1] - 1);
  if (s === "YR") return y * 4;
  if (s === "Apr") return y * 4 + 1;
  if (s === "Jul") return y * 4 + 2;
  if (s === "Sep-Oct") return y * 4 + 3;
  if (s === "Dec") return (y + 1) * 4;
  return y * 4;
}
export const idxLabel = (i: number) => `${Math.floor(i / 4)}-T${(i % 4) + 1}`;

// ── Classification (one decider for a piece of product text) ─────────────────
const NOT_YOUTH_PROGRAMME = /international cup|\bcic\b|\btrip\b|valencia|\btour\b|entry fee|national (youth )?league|southern league|boarding|\bseniors?\b|spreydon|referee|sumner camp|reimburse|ole academy/;
type Classified =
  | { kind: "term" | "camp"; stream: Stream | "academy_unsplit"; periodKey: string | null; how: string }
  | { kind: "uniform" } | { kind: "other"; reason: string } | { kind: "drop"; reason: string };

function classify(row: { programme: string | null; fee_description: string | null; term_name: string | null; season_year: number | null; paid_on: string; first_name?: string | null; last_name?: string | null; amount_cents: number }): Classified {
  const pre = [row.programme, row.fee_description, row.term_name].map(lower).join(" | ");
  if (NOT_YOUTH_PROGRAMME.test(pre)) return { kind: "other", reason: "CIC entry, team trip/tour, senior or league fee (pre-filter)" };
  const c = classifyTermRow({ id: 0, source: "x", first_name: row.first_name ?? "x", last_name: row.last_name ?? "y", fee_description: row.fee_description, programme: row.programme, term_name: row.term_name, season_year: row.season_year, paid_on: row.paid_on, amount_cents: row.amount_cents });
  // The shared classifier tests age groups BEFORE "morning programme", so "Morning Programme U12" lands in Pre-Academy.
  if (c.include && /morning (programme|program|session|training)/.test(pre)) return { kind: "term", stream: "morning", periodKey: c.period, how: c.how };
  if (c.include) return { kind: "term", stream: TPH_MAP[c.stream], periodKey: c.period, how: c.how };
  if (/^Holiday camp/.test(c.reason)) {
    const h = classifyHistoryRow({ id: 0, source: "x", first_name: row.first_name ?? "x", last_name: row.last_name ?? "y", fee_description: row.fee_description, programme: row.programme, term_name: row.term_name, paid_on: row.paid_on, amount_cents: row.amount_cents });
    if (h.include) return { kind: "camp", stream: CAMP_MAP[h.series], periodKey: h.edition, how: h.how };
    return { kind: "other", reason: `camp-like: ${h.reason}` };
  }
  if (/^Uniform/.test(c.reason)) return { kind: "uniform" };
  if (/^Test/.test(c.reason) || /^Free/.test(c.reason)) return { kind: "drop", reason: c.reason };
  return { kind: "other", reason: c.reason };
}

/** Friendly Manager group names the shared classifier cannot read (no age, no product word). */
function fmGroupRule(t: string): Stream | "FREE" | null {
  if (/open training|free week/.test(t)) return "FREE";
  if (/unlimited play|u4-?8 players|u4 ?- ?u8/.test(t)) return "u48";
  if (/^(monday|tuesday|wednesday|thursday|friday) ?4\.30pm/.test(t)) return "u48";
  if (/^saturday game day 9\.30am/.test(t)) return "u48";
  if (/advanced development training/.test(t)) return "technification";
  return null;
}
const splitByAge = (age: number | null): Stream => (age == null ? "academy" : age <= 8 ? "u48" : age <= 12 ? "pre_academy" : "academy");

// ── The dataset ──────────────────────────────────────────────────────────────
export interface ChildTermRow {
  childKey: string;
  isFamily: boolean;
  family: string;
  stream: Stream;
  label: string;      // "2025-T3" | "2025-YR" | "2025-Sep-Oct" | "2025-Dec"
  start: string;
  idx: number;
  isTerm: boolean;
  isCamp: boolean;
  cents: number;
  seen: string[];
  src: string[];
  attended: boolean;  // a participation record, not just allocated money
  age: number | null;
}
export interface ChildRecord {
  key: string;
  family: string;
  dob: string | null;
  birthYear: number | null;
  firstStream: Stream;
  firstLabel: string;
  firstStart: string;
  firstIdx: number;
  ageAtFirstJoin: number | null;
  termsInFirst: number;
  totalTerms: number;
  campsAttended: number;
  streams: Stream[];
  lastLabel: string;
  stillActiveLatest: boolean;
  lifetimeCents: number;
  paidByStream: Record<Stream, number>;
  rows: ChildTermRow[];
  /** first participation row per stream */
  firstIn: Partial<Record<Stream, ChildTermRow>>;
  /** participation rows on programme streams, sorted */
  att: ChildTermRow[];
  termRows: ChildTermRow[];
  years: number[];
}
export interface YouthDataset {
  builtAt: string;
  orgId: number;
  latest: { y: number; t: number; label: string; idx: number; inProgress: boolean };
  rows: ChildTermRow[];
  children: ChildRecord[];
  diagnostics: Record<string, any>;
}

const CACHE = new Map<number, { at: number; ds: Promise<YouthDataset> }>();
const TTL_MS = 15 * 60 * 1000;

export function getYouthDataset(orgId = 1, force = false): Promise<YouthDataset> {
  const hit = CACHE.get(orgId);
  if (hit && !force && Date.now() - hit.at < TTL_MS) return hit.ds;
  const ds = buildYouthDataset(orgId).catch((e) => { CACHE.delete(orgId); throw e; });
  CACHE.set(orgId, { at: Date.now(), ds });
  return ds;
}

function nzTodayIso() { return new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }); }

export async function buildYouthDataset(orgId: number): Promise<YouthDataset> {
  const run = async (s: ReturnType<typeof sql>) => rowsOf(await db.execute(s));
  const REAL = sql.raw(REAL_REGISTRATION_STATUS_SQL);
  const D: Record<string, any> = { sources: {}, identity: {}, money: {}, excluded: {}, notes: [] };
  const bump = (o: Record<string, any>, k: string, cents = 0) => { o[k] ??= { rows: 0, cents: 0 }; o[k].rows++; o[k].cents += cents; };

  // Terms: the club's own dates where it has them; the term running now is "latest".
  const termRows = await run(sql`SELECT year, term_number, start_date::text sd, end_date::text ed FROM terms WHERE organization_id=${orgId} ORDER BY year, term_number`);
  const termStarts = new Map<string, string>();
  for (const t of termRows) termStarts.set(`${t.year}-${t.term_number}`, String(t.sd));
  const today = nzTodayIso();
  const periodInfo = makePeriodInfo(termStarts);
  let latest: YouthDataset["latest"];
  {
    const running = termRows.find((t) => String(t.sd) <= today && today <= String(t.ed));
    const started = Array.from(termRows).reverse().find((t) => String(t.sd) <= today);
    const pick = running ?? started ?? null;
    let y: number, t: number;
    if (pick) { y = Number(pick.year); t = Number(pick.term_number); }
    else { const k = termForPaidDate(today); y = Number(k.slice(0, 4)); t = Number(k.slice(-1)); }
    const inProgress = !!running || (!!started && today <= String(started.ed));
    latest = { y, t, label: `${y}-T${t}`, idx: y * 4 + (t - 1), inProgress };
  }
  const LATEST_IDX = latest.idx;

  // ---------- people
  const contacts = new Map<number, any>();
  for (const c of await run(sql`SELECT id, type::text type, first_name, last_name, email, phone, date_of_birth::text dob, friendly_manager_id fm, merged_into_contact_id m FROM contacts`)) contacts.set(Number(c.id), { ...c, id: Number(c.id), m: c.m == null ? null : Number(c.m) });
  const resolve = (id: number | null | undefined): number | null => { let x = id == null ? null : Number(id), n = 0; while (x && contacts.get(x)?.m && n++ < 10) x = contacts.get(x)!.m; return x; };
  const guardiansOf = new Map<number, Set<number>>();
  const addG = (p: any, g: any) => { if (!p || !g) return; const pp = resolve(p)!, gg = resolve(g)!; if (pp === gg) return; (guardiansOf.get(pp) ?? guardiansOf.set(pp, new Set()).get(pp)!).add(gg); };
  for (const r of await run(sql`SELECT guardian_id g, player_id p FROM contact_relationships`)) addG(r.p, r.g);
  for (const r of await run(sql`SELECT contact_id, guardian_id FROM registrations WHERE guardian_id IS NOT NULL AND contact_id IS NOT NULL`)) addG(r.contact_id, r.guardian_id);
  const children = (await run(sql`SELECT id, parent_id, first_name, last_name, date_of_birth::text dob FROM children`)).map((c) => ({ ...c, id: Number(c.id), parent_id: c.parent_id == null ? null : Number(c.parent_id) }));

  const fmReg = await run(sql`SELECT id, contact_id, source, term_name, season_year, programme_group, raw_json FROM fm_registration_history WHERE organization_id=${orgId}`);
  const pays = (await run(sql`SELECT id, contact_id, source, first_name, last_name, fee_number, fee_description, term_name, season_year, programme, paid_on::text paid_on, amount_cents, external_key FROM fm_payment_history WHERE organization_id=${orgId}`))
    .map((p) => ({ ...p, id: Number(p.id), amount_cents: Number(p.amount_cents), season_year: p.season_year == null ? null : Number(p.season_year) }));
  const regs = (await run(sql`
    SELECT r.id, r.program_id, r.contact_id, r.guardian_id, r.status::text status, r.total_cents, coalesce(r.refunded_amount_cents,0) refunded,
           r.legacy_source, r.legacy_external_id, r.registered_at::date::text registered_on,
           p.name pname, p.slug, p.type::text ptype, p.start_date::text pstart, t.year ty, t.term_number tn, po.name opt
    FROM registrations r JOIN programs p ON p.id=r.program_id
    LEFT JOIN terms t ON t.id=r.term_id LEFT JOIN program_options po ON po.id=r.program_option_id
    WHERE p.organization_id=${orgId} AND r.status IN ${REAL}`))
    .map((r) => ({ ...r, id: Number(r.id), total_cents: r.total_cents == null ? 0 : Number(r.total_cents), refunded: Number(r.refunded) }));
  const items = (await run(sql`SELECT ri.registration_id rid, ri.child_id, count(*)::int n FROM registration_items ri JOIN registrations r ON r.id=ri.registration_id JOIN programs p ON p.id=r.program_id WHERE p.organization_id=${orgId} AND ri.child_id IS NOT NULL GROUP BY 1,2`))
    .map((i) => ({ rid: Number(i.rid), child_id: Number(i.child_id), n: Number(i.n) }));
  const shop = (await run(sql`SELECT o.id, o.status, o.email, o.phone, o.total_cents, o.created_at::date::text d,
                          (SELECT string_agg(i.title, ' + ') FROM shop_order_items i WHERE i.order_id=o.id) titles
                        FROM shop_orders o WHERE o.organization_id=${orgId} AND o.status IN ('paid','completed')`))
    .map((o) => ({ ...o, total_cents: Number(o.total_cents) }));
  D.sources = {
    fm_registration_history: Object.fromEntries(["friendly_manager", "xero", "shopify"].map((s) => [s, fmReg.filter((r) => r.source === s).length])),
    fm_payment_history: Object.fromEntries(["friendly_manager", "xero", "shopify"].map((s) => { const x = pays.filter((r) => r.source === s); return [s, { rows: x.length, cents: x.reduce((a, r) => a + r.amount_cents, 0) }]; })),
    clubos_registrations_real: { rows: regs.length, cents: regs.reduce((a, r) => a + r.total_cents - r.refunded, 0) },
    clubos_children: children.length, contacts: contacts.size, shop_orders_paid: shop.length,
  };

  // ---------- child nodes
  // node id: c:<contactId> (player contact) · k:<childrenId> (ClubOS camp child) · s:<shopifyLineId> (Shopify child known by name only)
  const nodes = new Map<string, { name: string | null; dob: string | null; tokens: Set<string>; kind: string }>();
  const tokensOfContact = (cid: number | null) => { const c = cid == null ? null : contacts.get(cid); const t = new Set<string>(); if (!c) return t; const e = normEmail(c.email), p = normPhone(c.phone); if (e) t.add("e:" + e); if (p) t.add("p:" + p); return t; };
  const familyTokensOfPlayer = (cid: number) => { const t = tokensOfContact(cid); for (const g of Array.from(guardiansOf.get(cid) ?? [])) for (const x of Array.from(tokensOfContact(g))) t.add(x); return t; };
  const addNode = (id: string, name: string | null, dob: any, tokens: Set<string>, kind: string) => { if (!nodes.has(id)) nodes.set(id, { name, dob: okDob(dob), tokens, kind }); return id; };
  const playerNode = (cidIn: any): string | null => {
    const cid = resolve(cidIn); const c = cid == null ? null : contacts.get(cid);
    if (!c || c.type !== "player") return null;
    return addNode(`c:${cid}`, fullName(c.first_name, c.last_name), c.dob, familyTokensOfPlayer(cid!), "contact");
  };
  for (const ch of children) addNode(`k:${ch.id}`, fullName(ch.first_name, ch.last_name), ch.dob, tokensOfContact(resolve(ch.parent_id)), "camp_child");

  // Shopify line → child node (the payment rows carry the guardian; the registration rows carry the child)
  const shopifyLine = new Map<string, { node: string | null; rule: string | null; guardian: number | null }>();
  for (const r of fmReg.filter((x) => x.source === "shopify")) {
    const j = r.raw_json ?? {}; const line = j.line_id;
    const cid = resolve(r.contact_id); const c = cid == null ? null : contacts.get(cid);
    let node: string | null = null, rule: string | null = null;
    if (c?.type === "player") { node = playerNode(cid); rule = "shopify_child_contact"; }
    else if (j.child_unknown !== "1" && fullName(j.child_first, j.child_last)) {
      const t = new Set<string>(); const e = normEmail(j.buyer_email), p = normPhone(j.buyer_phone); if (e) t.add("e:" + e); if (p) t.add("p:" + p); for (const x of Array.from(tokensOfContact(cid))) t.add(x);
      node = addNode(`s:${line}`, fullName(j.child_first, j.child_last), j.child_dob, t, "shopify_child"); rule = "shopify_child_name_dob";
    }
    if (line) shopifyLine.set(String(line), { node, rule, guardian: cid });
  }
  for (const c of Array.from(contacts.values())) if (c.type === "player" && !c.m) playerNode(c.id);

  // ---------- identity union
  const uf = new UF();
  for (const id of Array.from(nodes.keys())) uf.add(id);
  const byNameDob = new Map<string, string[]>(), byName = new Map<string, string[]>();
  for (const [id, n] of Array.from(nodes)) {
    if (!n.name) continue;
    (byName.get(n.name) ?? byName.set(n.name, []).get(n.name)!).push(id);
    if (n.dob) { const k = `${n.name}|${n.dob}`; (byNameDob.get(k) ?? byNameDob.set(k, []).get(k)!).push(id); }
  }
  let r2u = 0, r3u = 0, r3amb = 0, r4u = 0;
  for (const ids of Array.from(byNameDob.values())) for (let i = 1; i < ids.length; i++) { if (uf.find(ids[0]) !== uf.find(ids[i])) r2u++; uf.union(ids[0], ids[i]); }
  const tokenUse = new Map<string, number>();
  for (const n of Array.from(nodes.values())) for (const t of Array.from(n.tokens)) tokenUse.set(t, (tokenUse.get(t) ?? 0) + 1);
  const BAD_TOKEN = (t: string) => (tokenUse.get(t) ?? 0) > 40 || /@cufc\.co\.nz$|@unitedsportsgroup/.test(t);
  for (const ids of Array.from(byName.values())) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = nodes.get(ids[i])!, b = nodes.get(ids[j])!;
      if (a.dob && b.dob && a.dob !== b.dob) continue;
      const shared = Array.from(a.tokens).some((t) => !BAD_TOKEN(t) && b.tokens.has(t));
      if (!shared) continue;
      if (uf.find(ids[i]) !== uf.find(ids[j])) { uf.union(ids[i], ids[j]); r3u++; }
    }
  }
  const byDobFirst = new Map<string, string[]>();
  for (const [id, n] of Array.from(nodes)) if (n.name && n.dob) { const k = `${n.dob}|${n.name.split(" ")[0]}`; (byDobFirst.get(k) ?? byDobFirst.set(k, []).get(k)!).push(id); }
  for (const ids of Array.from(byDobFirst.values())) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (uf.find(ids[i]) === uf.find(ids[j])) continue;
      const a = nodes.get(ids[i])!, b = nodes.get(ids[j])!;
      const sa = a.name!.split(" ").slice(1).join(" "), sb = b.name!.split(" ").slice(1).join(" ");
      const contain = !!sa && !!sb && (` ${sa} `.includes(` ${sb} `) || ` ${sb} `.includes(` ${sa} `));
      const shared = Array.from(a.tokens).some((t) => !BAD_TOKEN(t) && b.tokens.has(t));
      if (contain || shared) { uf.union(ids[i], ids[j]); r4u++; }
    }
  }
  const compDobs = new Map<string, Set<string>>();
  for (const [id, n] of Array.from(nodes)) if (n.dob) { const r = uf.find(id); (compDobs.get(r) ?? compDobs.set(r, new Set()).get(r)!).add(n.dob); }
  for (const s of Array.from(compDobs.values())) if (s.size > 1) r3amb++;

  // ---------- families (union over parent emails/phones, through the children who share them)
  const fuf = new UF();
  for (const [id, n] of Array.from(nodes)) { const r = "N" + uf.find(id); fuf.add(r); for (const t of Array.from(n.tokens)) if (!BAD_TOKEN(t)) fuf.union(r, "T" + t); }
  const familyOfToken = (tokens: Set<string>) => { for (const t of Array.from(tokens)) if (!BAD_TOKEN(t) && fuf.p.has("T" + t)) return fuf.find("T" + t); return null; };
  const famLabel = new Map<string, string>();
  const famMembers = new Map<string, string[]>();
  for (const k of Array.from(fuf.p.keys())) { const r = fuf.find(k); (famMembers.get(r) ?? famMembers.set(r, []).get(r)!).push(k); }
  for (const [r, ms] of Array.from(famMembers)) { const em = ms.filter((m) => m.startsWith("Te:")).map((m) => m.slice(3)).sort(); const ph = ms.filter((m) => m.startsWith("Tp:")).map((m) => m.slice(3)).sort(); famLabel.set(r, em[0] ? `fam:${em[0]}` : ph[0] ? `fam:ph${ph[0]}` : `fam:solo-${r.slice(1)}`); }
  const childKeyOf = (nodeId: string) => { const r = uf.find(nodeId); return r.replace(/^c:/, "child-c").replace(/^k:/, "child-k").replace(/^s:/, "child-s"); };
  const familyOfNode = (nodeId: string) => famLabel.get(fuf.find("N" + uf.find(nodeId))) ?? null;
  const familyOfContact = (cid: any) => { const root = familyOfToken(tokensOfContact(resolve(cid))); return root ? famLabel.get(root) ?? null : null; };

  const kids = new Map<string, { dob: string | null; dobs: Map<string, number>; names: Set<string>; family: string | null; nodes: string[] }>();
  for (const [id, n] of Array.from(nodes)) {
    const k = childKeyOf(id);
    const e = kids.get(k) ?? kids.set(k, { dob: null, dobs: new Map(), names: new Set(), family: familyOfNode(id), nodes: [] }).get(k)!;
    if (n.dob) e.dobs.set(n.dob, (e.dobs.get(n.dob) ?? 0) + 1);
    if (n.name) e.names.add(n.name); e.nodes.push(id);
  }
  for (const e of Array.from(kids.values())) e.dob = Array.from(e.dobs.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const uniqueNameToKid = new Map<string, string>(); { const cnt = new Map<string, string[]>(); for (const [k, e] of Array.from(kids)) for (const nm of Array.from(e.names)) cnt.set(nm, Array.from(cnt.get(nm) ?? []).concat(k)); for (const [nm, ks] of Array.from(cnt)) if (new Set(ks).size === 1) uniqueNameToKid.set(nm, ks[0]); }
  D.identity = { nodes: nodes.size, player_contacts: Array.from(nodes.values()).filter((n) => n.kind === "contact").length, camp_children_rows: children.length, shopify_name_only_children: Array.from(nodes.values()).filter((n) => n.kind === "shopify_child").length, unions_name_dob: r2u, unions_name_family: r3u, unions_dob_firstname_surname_or_family: r4u, components_with_conflicting_dob: r3amb, distinct_children_all_nodes: kids.size };

  // ---------- raw facts: one per (child|family, stream, period)
  interface Fact { who: string; isFamily: boolean; stream: Stream | "academy_unsplit"; kind: "term" | "camp" | "uniform" | "other"; periodKey: string; amount: number; src: string; seen: string; rule: string; how?: string; enrol?: boolean; legacy?: boolean; paidOn?: string; payId?: number; feeNumber?: string | null; mixed?: boolean; dropped?: string; twinUsed?: boolean; moneyOnly?: boolean; firstName?: string }
  const facts: Fact[] = [];
  const push = (f: Fact) => facts.push(f);
  const who = (nodeId: string) => ({ who: childKeyOf(nodeId), isFamily: false });

  // (a) ClubOS registrations
  const migrated = new Set<string>();
  const itemsByReg = new Map<number, typeof items>(); for (const it of items) (itemsByReg.get(it.rid) ?? itemsByReg.set(it.rid, []).get(it.rid)!).push(it);
  for (const r of regs) {
    if (r.legacy_external_id) migrated.add(String(r.legacy_external_id));
    const net = r.total_cents - r.refunded;
    const src = r.legacy_source ? (r.legacy_source === "friendly_manager" ? "fm" : String(r.legacy_source)) : "clubos";
    const seen = r.opt ? `${r.pname} — ${r.opt}` : String(r.pname);
    if (r.ptype === "holiday_camp") {
      if (!r.pstart) continue;
      const ed = editionForCampStart(String(r.pstart));
      const s: Stream = /fundament/i.test(r.pname) ? "camp_fundamentals" : /world cup/i.test(r.pname) ? "camp_worldcup" : "camp_other";
      const its = itemsByReg.get(r.id) ?? [];
      const tot = its.reduce((a, x) => a + x.n, 0);
      if (!its.length) { push({ who: familyOfContact(r.guardian_id ?? r.contact_id) ?? `fam:unknown`, isFamily: true, stream: s, kind: "camp", periodKey: ed, amount: net, src: "clubos", seen, rule: "clubos_camp_no_child", enrol: true }); continue; }
      let left = net;
      its.forEach((it, i) => { const share = i === its.length - 1 ? left : Math.round((net * it.n) / tot); left -= share; const nid = `k:${it.child_id}`; if (!nodes.has(nid)) return; push({ ...who(nid), stream: s, kind: "camp", periodKey: ed, amount: share, src: "clubos", seen, rule: its.length > 1 ? "clubos_camp_child_split_by_days" : "clubos_camp_child", enrol: true }); });
      continue;
    }
    const st = streamForProgramme(r.slug, r.pname);
    if (!st) { bump(D.excluded, "ClubOS registration on a programme with no stream", net); continue; }
    const pk = r.ty && r.tn ? `${r.ty}-t${r.tn}` : termForPaidDate(String(r.registered_on));
    const nid = playerNode(r.contact_id);
    if (!nid) { push({ who: familyOfContact(r.contact_id) ?? "fam:unknown", isFamily: true, stream: TPH_MAP[st], kind: "term", periodKey: pk, amount: net, src, seen, rule: "clubos_registrant_not_a_player", enrol: true }); continue; }
    push({ ...who(nid), stream: TPH_MAP[st], kind: "term", periodKey: pk, amount: net, src, seen, rule: r.legacy_source ? `clubos_contact(migrated_${r.legacy_source})` : "clubos_contact", enrol: true, how: r.ty ? "named" : "paid_date", legacy: !!r.legacy_source });
  }

  // (b) enrolment rows from Friendly Manager / Xero invoice lines (2017–2026)
  for (const r of fmReg) {
    if (r.source === "shopify") continue;
    const j = r.raw_json ?? {};
    const parts = r.source === "xero" ? [r.programme_group, j.description, j.reference, String(j.xeroContactName ?? "").replace(/\).*/, ")")] : [r.programme_group, j.Programme];
    const text = parts.filter(Boolean).join(" | ").replace(/_/g, " ");
    const tl = lower(text);
    const termName = r.term_name ?? "";
    const yearFake = r.season_year ? `${r.season_year}-06-30` : null;
    const nid = playerNode(r.contact_id);
    const base = nid ? who(nid) : { who: familyOfContact(r.contact_id) ?? "fam:unknown", isFamily: true };
    const rule = nid ? (r.source === "xero" ? "xero_invoice_line_contact" : "fm_person_contact") : "registrant_is_guardian";
    const g = fmGroupRule(lower(r.programme_group ?? ""));
    if (g === "FREE") { bump(D.excluded, "Free open training / free week (not a paid programme)"); continue; }
    let c = classify({ amount_cents: 1, programme: text, fee_description: null, term_name: termName, season_year: r.season_year == null ? null : Number(r.season_year), paid_on: yearFake ?? "2000-06-30" });
    if (g && (c.kind !== "term" || c.stream === "academy_unsplit")) c = { kind: "term", stream: g, periodKey: null, how: "group_rule" };
    if (c.kind === "drop") { bump(D.excluded, `Enrolment dropped: ${c.reason}`); continue; }
    if (c.kind === "uniform" || c.kind === "other") { bump(D.excluded, `Enrolment not a programme: ${c.kind === "other" ? c.reason : "uniform"}`); continue; }
    let pk: string | null = null;
    const ym = /\b(20\d{2})\b/.exec(termName);
    const y = ym ? +ym[1] : r.season_year ? +r.season_year : null;
    const tm = /\bterm ?([1-4])\b/i.exec(termName) ?? /\bterm ?([1-4])\b/i.exec(tl);
    if (!y) pk = null;
    else if (c.kind === "camp") pk = c.how === "named" && c.periodKey && c.periodKey.startsWith(String(y)) ? c.periodKey : null;
    else if (tm) pk = `${y}-t${tm[1]}`;
    else pk = `${y}-yr`;
    if (!pk) { bump(D.excluded, "Enrolment with no term or year on it"); continue; }
    push({ ...base, stream: c.stream, kind: c.kind === "camp" ? "camp" : "term", periodKey: pk, amount: 0, src: r.source === "xero" ? "xero" : "fm", seen: [r.programme_group, termName].filter(Boolean).join(" · "), rule, enrol: true, how: "enrolment" });
  }

  // (c) money: Friendly Manager payments, Xero invoices, Shopify lines
  const unattributed = { rows: 0, cents: 0 };
  const fmFee = new Map<string, number>(), xeFee = new Map<string, number>();
  for (const p of pays) if (p.fee_number?.startsWith("FM-")) { const m = p.source === "friendly_manager" ? fmFee : p.source === "xero" ? xeFee : null; if (m) m.set(p.fee_number, (m.get(p.fee_number) ?? 0) + p.amount_cents); }
  for (const p of pays) {
    if (p.source === "xero" && p.fee_number?.startsWith("FM-") && fmFee.has(p.fee_number)) { bump(D.money, "skipped: Xero invoice of a Friendly Manager fee that FM already holds a payment on", p.amount_cents); continue; }
    if (p.fee_number && migrated.has(String(p.fee_number))) { bump(D.money, "skipped: same fee already held as a ClubOS registration", p.amount_cents); continue; }
    const c = classify(p);
    if (c.kind === "drop") { bump(D.excluded, `Payment dropped: ${c.reason}`, p.amount_cents); continue; }
    const src = p.source === "friendly_manager" ? "fm" : String(p.source);
    let base: { who: string; isFamily: boolean } | null = null, rule: string | null = null;
    const seen = p.fee_description ?? p.programme ?? "";
    if (p.source === "shopify" && String(p.external_key ?? "").startsWith("shopify:")) {
      const L = shopifyLine.get(String(p.external_key).slice(8));
      if (L?.node) { base = who(L.node); rule = L.rule; }
      else if (L) { base = { who: familyOfContact(L.guardian) ?? "fam:unknown", isFamily: true }; rule = "shopify_guardian_only"; }
    }
    if (!base) {
      const cid = resolve(p.contact_id); const ct = cid == null ? null : contacts.get(cid);
      if (ct?.type === "player") { base = who(playerNode(cid)!); rule = `${src}_contact`; }
      else if (ct) { base = { who: familyOfContact(cid) ?? "fam:unknown", isFamily: true }; rule = `${src}_guardian_contact`; }
      else { const nm = fullName(p.first_name, p.last_name); const k = nm && uniqueNameToKid.get(nm); if (k) { base = { who: k, isFamily: false }; rule = "name_unique_no_contact"; } }
    }
    if (!base) { unattributed.rows++; unattributed.cents += p.amount_cents; bump(D.money, `unattributed (${c.kind})`, p.amount_cents); continue; }
    if (c.kind === "uniform") {
      const mixed = /term|\bt[1-4]\b|levies|training|registration/i.test(p.fee_description ?? "");
      push({ ...base, stream: "uniform", kind: "uniform", periodKey: termForPaidDate(p.paid_on), amount: p.amount_cents, src, seen, rule: mixed ? rule + "+mixed_with_fees" : rule!, paidOn: p.paid_on, payId: p.id, feeNumber: p.fee_number, mixed });
      continue;
    }
    if (c.kind === "other") { push({ ...base, stream: "other", kind: "other", periodKey: termForPaidDate(p.paid_on), amount: p.amount_cents, src, seen: `${seen} [${c.reason}]`, rule: rule!, paidOn: p.paid_on, payId: p.id, feeNumber: p.fee_number }); continue; }
    if (!c.periodKey) continue;
    push({ ...base, stream: c.stream, kind: c.kind, periodKey: c.periodKey, amount: p.amount_cents, src, seen, rule: rule!, how: c.how, paidOn: p.paid_on, payId: p.id, feeNumber: p.fee_number, firstName: lower(p.first_name).trim() });
  }
  D.money.unattributed_total = { rows: unattributed.rows, cents: unattributed.cents };

  // (d) ClubOS store (uniform + merchandise incl. team photos), 16 Oct 2026 on
  for (const o of shop) {
    const t = new Set<string>(); const e = normEmail(o.email), ph = normPhone(o.phone); if (e) t.add("e:" + e); if (ph) t.add("p:" + ph);
    const root = familyOfToken(t);
    push({ who: root ? famLabel.get(root)! : `fam:${e ?? "shop-" + o.id}`, isFamily: true, stream: "uniform", kind: "uniform", periodKey: termForPaidDate(String(o.d)), amount: o.total_cents, src: "shop", seen: o.titles ?? "ClubOS store order", rule: root ? "shop_email_family" : "shop_unmatched_family", paidOn: String(o.d) });
  }

  // ---------- resolve academy_unsplit by age
  const ageFor = (f: Fact) => { const k = kids.get(f.who); return k?.dob ? ageAt(k.dob, periodInfo(f.kind === "camp" ? "camp" : "term", f.periodKey).start) : null; };
  let unsplitAge = 0, unsplitNoDob = 0;
  for (const f of facts) if (f.stream === "academy_unsplit") { const a = f.isFamily ? null : ageFor(f); f.stream = splitByAge(a); f.rule += a == null ? "+academy_unsplit_no_dob" : "+academy_unsplit_by_age"; a == null ? unsplitNoDob++ : unsplitAge++; }
  D.identity.academy_unsplit_split_by_age = unsplitAge; D.identity.academy_unsplit_no_dob_kept_academy = unsplitNoDob;

  // ---------- FM ↔ Xero twins
  const groupKey = (f: Fact) => `${f.who}|${f.stream}|${f.periodKey}`;
  const byGK = new Map<string, Fact[]>(); for (const f of facts) (byGK.get(groupKey(f)) ?? byGK.set(groupKey(f), []).get(groupKey(f))!).push(f);
  let twins = 0, twinCents = 0;
  for (const fs_ of Array.from(byGK.values())) {
    const rank = (f: Fact) => (f.src === "clubos" || f.legacy ? 3 : f.src === "fm" && f.payId ? 2 : f.src === "xero" && f.payId ? 1 : 0);
    const money = fs_.filter((f) => rank(f) > 0 && f.amount > 0 && !f.dropped);
    if (money.length < 2) continue;
    const used = new Set<Fact>();
    for (const lowR of [1, 2]) for (const x of money.filter((f) => rank(f) === lowR)) {
      const m = money.find((f) => rank(f) > lowR && !used.has(f) && !f.dropped && f.amount === x.amount);
      if (m) { used.add(m); m.twinUsed = true; x.dropped = "twin_equal"; twins++; twinCents += x.amount; }
    }
    for (const lowR of [1, 2]) for (const x of money.filter((f) => rank(f) === lowR && !f.dropped)) {
      const higher = money.filter((f) => rank(f) > lowR && !f.dropped).reduce((t, f) => t + f.amount, 0);
      if (higher > 0 && higher === x.amount) { x.dropped = "twin_sum"; twins++; twinCents += x.amount; }
    }
  }
  const k7 = (f: Fact) => `${f.who}|${f.stream}|${f.amount}`;
  const fmByFirst = new Map<string, Fact[]>(); for (const f of facts) if (f.src === "fm" && f.payId && !f.dropped && !f.twinUsed) (fmByFirst.get(k7(f)) ?? fmByFirst.set(k7(f), []).get(k7(f))!).push(f);
  const dn = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  const usedFm = new Set<Fact>();
  for (const x of facts) {
    if (x.src !== "xero" || !x.payId || x.dropped || x.amount <= 0 || !x.paidOn) continue;
    const cand = (fmByFirst.get(k7(x)) ?? []).find((m) => !usedFm.has(m) && m.paidOn && Math.abs(dn(m.paidOn) - dn(x.paidOn!)) <= 7);
    if (cand) { usedFm.add(cand); x.dropped = "fm_xero_twin_7day"; twins++; twinCents += x.amount; }
  }
  D.money.fm_xero_twins_dropped = { rows: twins, cents: twinCents };

  // ---------- snap paid-date-placed money onto the child's enrolment in the same stream (±1 term)
  const live = facts.filter((f) => !f.dropped);
  const enrolIdx = new Map<string, Map<number, string>>();
  for (const f of live) if (f.enrol && (f.kind === "term" || f.kind === "camp")) { const pi = periodInfo(f.kind, f.periodKey); if (!pi.isTerm && !pi.isCamp) continue; const k = `${f.who}|${f.stream}`; (enrolIdx.get(k) ?? enrolIdx.set(k, new Map()).get(k)!).set(pi.idx, f.periodKey); }
  let snapped = 0;
  for (const f of live) {
    if (f.how !== "paid_date" || f.enrol || (f.kind !== "term" && f.kind !== "camp")) continue;
    const m = enrolIdx.get(`${f.who}|${f.stream}`); if (!m) continue;
    const pi = periodInfo(f.kind, f.periodKey); if (m.has(pi.idx)) continue;
    const near = [pi.idx + 1, pi.idx - 1].find((i) => m.has(i));
    if (near != null) { f.periodKey = m.get(near)!; f.rule += "+snapped_to_enrolment"; snapped++; }
  }
  D.money.paid_date_rows_snapped_to_enrolment = snapped;

  // ---------- family-level money → children of that family
  const famKids = new Map<string, string[]>(); for (const [k, e] of Array.from(kids)) if (e.family) (famKids.get(e.family) ?? famKids.set(e.family, []).get(e.family)!).push(k);
  const activeYears = new Map<string, Set<number>>(); for (const f of live) if (!f.isFamily && isProgrammeStream(f.stream)) { const y = +periodInfo(f.kind === "camp" ? "camp" : "term", f.periodKey).start.slice(0, 4); (activeYears.get(f.who) ?? activeYears.set(f.who, new Set()).get(f.who)!).add(y); }
  const finalFacts: Fact[] = [];
  const famAlloc = { rows: 0, cents: 0 }, famLeft = { rows: 0, cents: 0 };
  for (const f of live) {
    if (!f.isFamily) { finalFacts.push(f); continue; }
    const ks = famKids.get(f.who) ?? [];
    let targets: string[] = [];
    if (f.kind === "term" || f.kind === "camp") targets = ks.filter((k) => live.some((g) => g.who === k && g.stream === f.stream && g.periodKey === f.periodKey));
    if (!targets.length) { const y = +((f.paidOn ?? periodInfo(f.kind === "camp" ? "camp" : "term", f.periodKey).start).slice(0, 4)); targets = ks.filter((k) => [y - 1, y, y + 1].some((yy) => activeYears.get(k)?.has(yy))); }
    if (!targets.length && f.kind === "uniform") targets = ks.filter((k) => activeYears.has(k));
    if (!targets.length) { finalFacts.push(f); famLeft.rows++; famLeft.cents += f.amount; continue; }
    let left = f.amount;
    targets.forEach((k, i) => { const share = i === targets.length - 1 ? left : Math.round(f.amount / targets.length); left -= share; finalFacts.push({ ...f, who: k, isFamily: false, amount: share, rule: `${f.rule}+family_split_${targets.length}`, enrol: false, moneyOnly: true }); });
    famAlloc.rows++; famAlloc.cents += f.amount;
  }
  D.money.family_level_allocated_to_children = famAlloc; D.money.family_level_left_on_family = famLeft;

  // ---------- aggregate child_terms
  const agg = new Map<string, ChildTermRow & { seenSet: Set<string>; srcSet: Set<string> }>();
  for (const f of finalFacts) {
    const pkind = f.kind === "camp" ? "camp" : "term";
    const pi = periodInfo(pkind, f.periodKey);
    const k = `${f.who}|${f.stream}|${pi.label}`;
    const e = agg.get(k) ?? agg.set(k, { childKey: f.who, isFamily: f.isFamily, family: "", stream: f.stream as Stream, label: pi.label, start: pi.start, idx: pi.idx, isTerm: !!pi.isTerm, isCamp: !!pi.isCamp, cents: 0, seen: [], src: [], attended: false, age: null, seenSet: new Set(), srcSet: new Set() }).get(k)!;
    e.cents += f.amount; if (f.seen) e.seenSet.add(String(f.seen).slice(0, 90)); e.srcSet.add(f.src);
    if (!f.moneyOnly) e.attended = true;
  }
  const rows: ChildTermRow[] = Array.from(agg.values()).map((e) => {
    const k = kids.get(e.childKey);
    const { seenSet, srcSet, ...row } = e;
    return { ...row, seen: Array.from(seenSet), src: Array.from(srcSet).sort(), family: e.isFamily ? e.childKey : k?.family ?? "", age: k?.dob ? ageAt(k.dob, e.start) : null };
  });
  rows.sort((a, b) => (a.childKey < b.childKey ? -1 : a.childKey > b.childKey ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : a.stream < b.stream ? -1 : 1));

  // ---------- children
  const perKid = new Map<string, ChildTermRow[]>();
  for (const r of rows) { if (r.isFamily || r.stream === "other") continue; (perKid.get(r.childKey) ?? perKid.set(r.childKey, []).get(r.childKey)!).push(r); }
  const childrenOut: ChildRecord[] = [];
  for (const [k, rs] of Array.from(perKid)) {
    const prog = rs.filter((r) => isProgrammeStream(r.stream) && (r.attended || r.label.endsWith("-YR")));
    if (!prog.length) continue;
    const e = kids.get(k);
    const ord = (r: ChildTermRow) => (isTermStream(r.stream) ? 0 : 1);
    const sorted = Array.from(rs).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : ord(a) - ord(b) || (a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : 0)));
    prog.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : ord(a) - ord(b)));
    const first = prog[0];
    const firstStream = first.stream;
    const termsIn = (s: string) => new Set(rs.filter((r) => r.stream === s && r.isTerm).map((r) => r.label)).size;
    const allTerms = new Set(rs.filter((r) => isTermStream(r.stream) && r.isTerm).map((r) => r.label)).size;
    const last = Array.from(prog).sort((a, b) => (a.start < b.start ? 1 : -1))[0];
    const byStream = Object.fromEntries(STREAMS.map((s) => [s, rs.filter((r) => r.stream === s).reduce((a, r) => a + r.cents, 0)])) as Record<Stream, number>;
    const att = sorted.filter((r) => r.attended && isProgrammeStream(r.stream));
    const firstIn: Partial<Record<Stream, ChildTermRow>> = {};
    for (const r of att) if (!firstIn[r.stream]) firstIn[r.stream] = r;
    const termRows = att.filter((r) => isTermStream(r.stream));
    childrenOut.push({
      key: k, family: e?.family ?? "", dob: e?.dob ?? null, birthYear: e?.dob ? Number(e.dob.slice(0, 4)) : null,
      firstStream, firstLabel: first.label, firstStart: first.start, firstIdx: first.idx,
      ageAtFirstJoin: e?.dob ? ageAt(e.dob, first.start) : null,
      termsInFirst: isCampStream(firstStream) ? new Set(rs.filter((r) => r.stream === firstStream).map((r) => r.label)).size : termsIn(firstStream),
      totalTerms: allTerms,
      campsAttended: new Set(rs.filter((r) => isCampStream(r.stream)).map((r) => r.label)).size,
      streams: Array.from(new Set(rs.map((r) => r.stream))).sort() as Stream[],
      lastLabel: last.label,
      stillActiveLatest: rs.some((r) => isProgrammeStream(r.stream) && r.label === latest.label),
      lifetimeCents: Object.values(byStream).reduce((a, b) => a + b, 0),
      paidByStream: byStream,
      rows: sorted, firstIn, att, termRows,
      years: Array.from(new Set(termRows.map((r) => +r.label.slice(0, 4)))).sort(),
    });
  }
  D.children = childrenOut.length; D.child_terms = rows.length;
  D.excluded_sorted = Object.entries(D.excluded).sort((a: any, b: any) => b[1].cents - a[1].cents).map(([k, v]: any) => ({ reason: k, rows: v.rows, cents: v.cents }));

  return { builtAt: new Date().toISOString(), orgId, latest, rows, children: childrenOut, diagnostics: D };
}

// ── Analyses ─────────────────────────────────────────────────────────────────
export type CohortFilter = "all" | "clean" | "mature4" | "mature8";

/** Children whose FIRST programme was this stream. "clean" = term starters
 *  2021-T1 to 2024-T4 (full Friendly Manager records, two years to come back);
 *  camp starters at least four terms before the latest term. */
export function cohortMembers(ds: YouthDataset, stream: Stream, filter: CohortFilter, joinYear?: number | null): ChildRecord[] {
  let list = ds.children.filter((o) => o.firstStream === stream);
  const L = ds.latest.idx;
  if (filter === "clean") list = isCampStream(stream) ? list.filter((o) => L - o.firstIdx >= 4) : list.filter((o) => o.firstIdx >= 2021 * 4 && o.firstIdx <= 2024 * 4 + 3);
  if (filter === "mature4") list = list.filter((o) => L - o.firstIdx >= 4);
  if (filter === "mature8") list = list.filter((o) => L - o.firstIdx >= 8);
  if (joinYear) list = list.filter((o) => o.firstStart.slice(0, 4) === String(joinYear));
  return list;
}

export interface CohortBlock {
  children: number;
  ageAtJoin: { known: number; mean: number | null; median: number | null; distribution: Record<string, number> };
  termsInFirst: { mean: number | null; median: number | null; histogram: Record<string, number> };
  totalTerms: { mean: number | null; median: number | null };
  progressedPct: Record<string, number>;
  revenue: Record<string, { meanCents: number; medianCents: number; totalCents: number }>;
  zeroMoney: number;
  stillActivePct: number;
}

export function cohortBlock(list: ChildRecord[], stream: Stream): CohortBlock {
  const n = list.length;
  const pct = (f: (o: ChildRecord) => boolean) => (n ? Math.round((1000 * list.filter(f).length) / n) / 10 : 0);
  const hist = (vals: (number | null)[], buckets: { label: string; test: (v: number | null) => boolean }[]) => { const h: Record<string, number> = {}; for (const b of buckets) h[b.label] = 0; for (const v of vals) { const b = buckets.find((x) => x.test(v)); if (b) h[b.label]++; } return h; };
  const AGE_B = [{ label: "unknown", test: (v: number | null) => v == null }, { label: "3 or under", test: (v: number | null) => v != null && v <= 3 }, ...[4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((k) => ({ label: String(k), test: (v: number | null) => v === k })), { label: "14+", test: (v: number | null) => v != null && v >= 14 }];
  const TERM_B = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ label: String(k), test: (v: number | null) => v === k })).concat([{ label: "9–12", test: (v: number | null) => v != null && v >= 9 && v <= 12 }, { label: "13+", test: (v: number | null) => v != null && v >= 13 }, { label: "0 (year-level record only)", test: (v: number | null) => v === 0 }]);
  const after = (o: ChildRecord, s: Stream) => o.rows.some((r) => r.stream === s && r.start > o.firstStart && (r.attended || r.cents > 0));
  const touched = (o: ChildRecord, s: Stream) => o.rows.some((r) => r.stream === s && (r.attended || r.cents > 0));
  const money = (sel: (o: ChildRecord) => number) => { const v = list.map(sel); return { meanCents: Math.round(mean(v) ?? 0), medianCents: Math.round(median(v) ?? 0), totalCents: v.reduce((a, b) => a + b, 0) }; };
  const ages = list.map((o) => o.ageAtFirstJoin); const known = ages.filter((a): a is number => a != null);
  const stay = list.map((o) => o.termsInFirst);
  return {
    children: n,
    ageAtJoin: { known: known.length, mean: r1(mean(known)), median: median(known), distribution: hist(ages, AGE_B) },
    termsInFirst: { mean: r1(mean(stay)), median: median(stay), histogram: hist(stay, TERM_B) },
    totalTerms: { mean: r1(mean(list.map((o) => o.totalTerms))), median: median(list.map((o) => o.totalTerms)) },
    progressedPct: {
      pre_academy: pct((o) => stream !== "pre_academy" && after(o, "pre_academy")),
      academy: pct((o) => stream !== "academy" && after(o, "academy")),
      technification_or_goalkeeper: pct((o) => after(o, "technification") || after(o, "goalkeeper")),
      u48: pct((o) => stream !== "u48" && after(o, "u48")),
      any_camp_after_first: pct((o) => CAMP_STREAMS.some((s) => after(o, s))),
      any_camp_ever: pct((o) => CAMP_STREAMS.some((s) => touched(o, s))),
      uniform: pct((o) => o.paidByStream.uniform > 0),
    },
    revenue: {
      total: money((o) => o.lifetimeCents),
      programmes: money((o) => PROGRAMME_STREAMS.reduce((a, s) => a + o.paidByStream[s], 0)),
      ...Object.fromEntries(STREAMS.filter((s) => s !== "other").map((s) => [s, money((o) => o.paidByStream[s])])),
    },
    zeroMoney: list.filter((o) => o.lifetimeCents <= 0).length,
    stillActivePct: pct((o) => o.stillActiveLatest),
  };
}

/** Term-over-term retention inside one stream: stayed, moved to another
 *  programme next term, or not in any term programme next term. */
export function retention(ds: YouthDataset, stream: Stream, fromYear = 2017) {
  const inStreamTerm = new Map<string, Set<string>>();
  const anyProgTerm = new Map<string, Set<string>>();
  for (const r of ds.rows) {
    if (r.isFamily || !r.isTerm || !r.attended) continue;
    (inStreamTerm.get(`${r.stream}|${r.label}`) ?? inStreamTerm.set(`${r.stream}|${r.label}`, new Set()).get(`${r.stream}|${r.label}`)!).add(r.childKey);
    if (isTermStream(r.stream)) (anyProgTerm.get(r.label) ?? anyProgTerm.set(r.label, new Set()).get(r.label)!).add(r.childKey);
  }
  const S = (s: string, l: string) => inStreamTerm.get(`${s}|${l}`) ?? new Set<string>();
  const labels: string[] = []; for (let y = fromYear; y <= ds.latest.y; y++) for (let t = 1; t <= 4; t++) if (y * 4 + t - 1 <= ds.latest.idx) labels.push(`${y}-T${t}`);
  const out: { from: string; to: string; inStream: number; stayed: number; retentionPct: number; moved: number; gone: number; nextInProgress: boolean }[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    const a = labels[i], b = labels[i + 1];
    const A = S(stream, a); if (!A.size) continue;
    const B = S(stream, b), Bany = anyProgTerm.get(b) ?? new Set<string>();
    const stayed = Array.from(A).filter((x) => B.has(x)).length;
    const moved = Array.from(A).filter((x) => !B.has(x) && Bany.has(x)).length;
    out.push({ from: a, to: b, inStream: A.size, stayed, retentionPct: Math.round((1000 * stayed) / A.size) / 10, moved, gone: A.size - stayed - moved, nextInProgress: b === ds.latest.label });
  }
  return out;
}

/** A year in one stream: per term, how many children, how many new to the
 *  stream, how many brand-new to the club, how many returning. */
export function yearPicture(ds: YouthDataset, stream: Stream, year: number) {
  const inTerm = new Map<string, Set<string>>();
  for (const r of ds.rows) if (!r.isFamily && r.isTerm && r.attended && r.stream === stream) (inTerm.get(r.label) ?? inTerm.set(r.label, new Set()).get(r.label)!).add(r.childKey);
  const firstInStream = new Map<string, number>();
  for (const o of ds.children) { const t = o.rows.filter((r) => r.stream === stream && r.isTerm && r.attended).map((r) => r.idx); if (t.length) firstInStream.set(o.key, Math.min(...t)); }
  const byKey = new Map(ds.children.map((o) => [o.key, o]));
  const terms = [1, 2, 3, 4].map((t) => {
    const l = `${year}-T${t}`; const set = inTerm.get(l) ?? new Set<string>(); const idx = year * 4 + (t - 1);
    const newOnes = Array.from(set).filter((k) => firstInStream.get(k) === idx);
    const brandNew = newOnes.filter((k) => { const o = byKey.get(k); return o?.firstIdx === idx && o.firstStream === stream; });
    return { term: l, children: set.size, newToStream: newOnes.length, brandNewToClub: brandNew.length, cameFromElsewhereFirst: newOnes.length - brandNew.length, returning: set.size - newOnes.length, inProgress: l === ds.latest.label, future: idx > ds.latest.idx };
  });
  const unique = new Set(terms.flatMap((t) => Array.from((inTerm.get(t.term) ?? [])))).size;
  return { year, terms, uniqueChildren: unique };
}

/** The pathway U4–U8 → Pre-Academy → Academy: how many walked each path and
 *  what they were worth. */
export function funnel(ds: YouthDataset, matureOnly = false) {
  const L = ds.latest.idx;
  let players = ds.children.filter((k) => k.termRows.length > 0);
  if (matureOnly) players = players.filter((k) => k.birthYear != null && k.birthYear <= ds.latest.y - 13 && L - Math.min(...k.att.map((r) => r.idx)) >= 4);
  const classify = (k: ChildRecord) => {
    const a = k.firstIn.u48, b = k.firstIn.pre_academy, c = k.firstIn.academy;
    const seq = ([["A", a], ["B", b], ["C", c]] as [string, ChildTermRow | undefined][]).filter((x) => x[1]) as [string, ChildTermRow][];
    if (!seq.length) return "none_of_three";
    const sorted = Array.from(seq).sort((x, y) => (x[1].start < y[1].start ? -1 : x[1].start > y[1].start ? 1 : x[0] < y[0] ? -1 : 1));
    const s = sorted.map((x) => x[0]).join("");
    const map: Record<string, string> = { A: "A_only", AB: "A_to_B", ABC: "A_to_B_to_C", AC: "A_to_C", B: "B_only", BC: "B_to_C", C: "C_only" };
    return map[s] ?? "other_order";
  };
  const CLASS_LABEL: Record<string, string> = { A_only: "U4–U8 only", A_to_B: "U4–U8 → Pre-Academy", A_to_B_to_C: "U4–U8 → Pre-Academy → Academy", A_to_C: "U4–U8 → Academy (no Pre-Academy recorded)", B_only: "Pre-Academy only", B_to_C: "Pre-Academy → Academy", C_only: "Academy only", other_order: "Other order (e.g. Pre-Academy before U4–U8)", none_of_three: "Technification / GK / Morning only" };
  const termCount = (k: ChildRecord) => new Set(k.termRows.filter((r) => r.label.slice(5, 6) === "T").map((r) => r.label)).size;
  const classes = Object.keys(CLASS_LABEL).map((cls) => {
    const m = players.filter((k) => classify(k) === cls);
    const rev = m.map((k) => k.lifetimeCents);
    return { cls, label: CLASS_LABEL[cls], n: m.length, pct: players.length ? Math.round((1000 * m.length) / players.length) / 10 : 0, meanCents: Math.round(mean(rev) ?? 0), medianCents: Math.round(median(rev) ?? 0), meanTerms: r1(mean(m.map(termCount))), medianTerms: median(m.map(termCount)) };
  });
  const after = (k: ChildRecord, x: Stream, y: Stream) => !!k.firstIn[x] && !!k.firstIn[y] && k.firstIn[y]!.start > k.firstIn[x]!.start;
  const A = players.filter((k) => k.firstIn.u48), B = players.filter((k) => k.firstIn.pre_academy);
  const AB = A.filter((k) => after(k, "u48", "pre_academy"));
  const rate = (den: number, num: number, text: string) => ({ text, base: den, yes: num, pct: den ? Math.round((1000 * num) / den) / 10 : null });
  return {
    players: players.length, matureOnly,
    classes,
    conditional: {
      u48ToPreAcademy: rate(A.length, AB.length, "of children who did U4–U8, share who later did Pre-Academy"),
      preAcademyToAcademy: rate(B.length, B.filter((k) => after(k, "pre_academy", "academy")).length, "of children who did Pre-Academy, share who later did Academy"),
      u48ToAcademy: rate(A.length, A.filter((k) => after(k, "u48", "academy")).length, "of children who did U4–U8, share who later did Academy"),
      wholeWay: rate(AB.length, AB.filter((k) => after(k, "pre_academy", "academy")).length, "of children who went U4–U8 then Pre-Academy, share who later did Academy"),
    },
  };
}

/** How long players stay, in calendar years, and how many are one-and-done. */
export function tenure(ds: YouthDataset) {
  const players = ds.children.filter((k) => k.termRows.length > 0);
  const nYears = (k: ChildRecord) => k.years.length;
  const nTerms = (k: ChildRecord) => new Set(k.termRows.filter((r) => r.label.slice(5, 6) === "T").map((r) => r.label)).size;
  const nPeriods = (k: ChildRecord) => new Set(k.termRows.map((r) => r.label)).size;
  const span = (k: ChildRecord) => (k.years.length ? k.years[k.years.length - 1] - k.years[0] + 1 : 0);
  const table = (set: ChildRecord[], field: (k: ChildRecord) => number) => {
    const n = set.length; const dist: { years: number; n: number; pct: number }[] = [];
    for (let y = 1; y <= 10; y++) { const c = set.filter((k) => field(k) === y).length; dist.push({ years: y, n: c, pct: n ? Math.round((1000 * c) / n) / 10 : 0 }); }
    const v = set.map(field);
    return { n, distribution: dist, median: median(v), mean: r1(mean(v)), twoPlusPct: n ? Math.round((1000 * set.filter((k) => field(k) >= 2).length) / n) / 10 : 0, threePlusPct: n ? Math.round((1000 * set.filter((k) => field(k) >= 3).length) / n) / 10 : 0, fivePlusPct: n ? Math.round((1000 * set.filter((k) => field(k) >= 5).length) / n) / 10 : 0 };
  };
  const everPlayers = players.filter((k) => k.years[0] <= ds.latest.y - 1);
  const cur = players.filter((k) => k.termRows.some((r) => r.idx >= ds.latest.idx - 1 && r.idx <= ds.latest.idx));
  const churn = (set: ChildRecord[]) => {
    const one = set.filter((k) => nPeriods(k) === 1), oneYr = set.filter((k) => nPeriods(k) > 1 && nYears(k) === 1), more = set.filter((k) => nYears(k) >= 2);
    const p = (x: number) => (set.length ? Math.round((1000 * x) / set.length) / 10 : 0);
    return { n: set.length, exactlyOneTermEver: { n: one.length, pct: p(one.length) }, oneYearOnlyMoreThanOneTerm: { n: oneYr.length, pct: p(oneYr.length) }, twoPlusYears: { n: more.length, pct: p(more.length) }, termsEveryone: { mean: r1(mean(set.map(nTerms))), median: median(set.map(nTerms)) }, termsPastFirstYear: { mean: r1(mean(more.map(nTerms))), median: median(more.map(nTerms)) } };
  };
  const multi = everPlayers.filter((k) => nYears(k) >= 2); const gap = multi.filter((k) => span(k) > nYears(k));
  const survival: { firstYear: number; n: number; stillAfter: Record<number, number | null> }[] = [];
  for (let y = 2017; y <= ds.latest.y - 1; y++) {
    const c = players.filter((k) => k.years[0] === y);
    const row = { firstYear: y, n: c.length, stillAfter: {} as Record<number, number | null> };
    for (let g = 1; g <= 9; g++) { const yy = y + g; if (yy > ds.latest.y) break; const s = c.filter((k) => k.years.includes(yy)).length; row.stillAfter[g] = c.length ? Math.round((1000 * s) / c.length) / 10 : null; }
    survival.push(row);
  }
  return {
    players: players.length,
    campsOnlyChildren: ds.children.filter((k) => k.termRows.length === 0 && k.att.some((r) => isCampStream(r.stream))).length,
    allTime: table(everPlayers, nYears),
    current: table(cur, nYears),
    currentByProgramme: Object.fromEntries(TERM_STREAMS.map((s) => [s, table(cur.filter((k) => k.termRows.some((r) => r.stream === s && r.idx >= ds.latest.idx - 1)), nYears)])),
    gapYears: { n: multi.length, withGap: gap.length, pct: multi.length ? Math.round((1000 * gap.length) / multi.length) / 10 : 0 },
    churn: { allTime: churn(everPlayers), since2021: churn(everPlayers.filter((k) => k.years[0] >= 2021)) },
    survival,
  };
}

/** Where the money goes AFTER a child's first programme (journey by entry). */
export function journey(ds: YouthDataset, stream: Stream, filter: CohortFilter) {
  const members = cohortMembers(ds, stream, filter);
  const n = members.length;
  const BUCKETS = ["same", "other_camps", "u48", "tech_gk_morning", "pre_academy", "academy", "uniform"] as const;
  const bucketOf = (s: Stream): typeof BUCKETS[number] | null => {
    if (s === stream) return "same";
    if (isCampStream(s)) return "other_camps";
    if (s === "technification" || s === "goalkeeper" || s === "morning") return "tech_gk_morning";
    if (s === "u48" || s === "pre_academy" || s === "academy" || s === "uniform") return s;
    return null;
  };
  const label = (b: string) => b === "same" ? (isCampStream(stream) ? "More of the same camp" : `More ${STREAM_NAME[stream]} terms`) : ({ other_camps: isCampStream(stream) ? "Other camps" : "Holiday camps", u48: "U4–U8 terms", tech_gk_morning: "Technification / GK / Morning", pre_academy: "Pre-Academy", academy: "Academy", uniform: "Uniform / kit" } as Record<string, string>)[b];
  const seg = { nothingMore: 0, moreCampsOnly: 0, termsOnly: 0, termsAndCamps: 0 };
  const totals: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  const perChild: Record<string, number>[] = members.map(() => ({}));
  let originCents = 0; const downstreamPer: number[] = [];
  members.forEach((k, i) => {
    const o = k.rows.find((r) => r.stream === k.firstStream && r.label === k.firstLabel) ?? null;
    originCents += o ? o.cents : 0;
    let moreTerm = false, moreCamp = false, ds_ = 0;
    for (const r of k.rows) {
      if (r === o || r.stream === "other") continue;
      if (r.attended && isTermStream(r.stream)) moreTerm = true;
      if (r.attended && isCampStream(r.stream)) moreCamp = true;
      const b = bucketOf(r.stream); if (!b) continue;
      perChild[i][b] = (perChild[i][b] ?? 0) + r.cents; totals[b] += r.cents; ds_ += r.cents;
    }
    downstreamPer.push(ds_);
    if (moreTerm) seg[moreCamp ? "termsAndCamps" : "termsOnly"]++; else seg[moreCamp ? "moreCampsOnly" : "nothingMore"]++;
  });
  const dsTotal = BUCKETS.reduce((s, b) => s + totals[b], 0);
  const p = (x: number) => (n ? Math.round((1000 * x) / n) / 10 : 0);
  return {
    stream, filter, n,
    segments: { nothingMore: { n: seg.nothingMore, pct: p(seg.nothingMore) }, moreCampsOnly: { n: seg.moreCampsOnly, pct: p(seg.moreCampsOnly) }, termsOnly: { n: seg.termsOnly, pct: p(seg.termsOnly) }, termsAndCamps: { n: seg.termsAndCamps, pct: p(seg.termsAndCamps) } },
    firstRecord: { totalCents: originCents, meanCents: n ? Math.round(originCents / n) : 0 },
    downstream: { totalCents: dsTotal, meanCents: n ? Math.round(dsTotal / n) : 0, medianCents: Math.round(median(downstreamPer) ?? 0) },
    buckets: BUCKETS.map((b) => {
      const have = perChild.map((x) => x[b] ?? 0).filter((v) => v > 0);
      return { bucket: b, label: label(b), childrenWithAny: have.length, pctChildren: p(have.length), totalCents: totals[b], meanCentsPerChild: n ? Math.round(totals[b] / n) : 0, shareOfDownstreamPct: dsTotal ? Math.round((1000 * totals[b]) / dsTotal) / 10 : 0, medianAmongThoseWithAny: Math.round(median(have) ?? 0) };
    }).filter((b) => b.bucket !== "same" || isCampStream(stream) || true),
  };
}

/** A transition (e.g. FUNdamentals camp → U4–U8): how many eligible children
 *  made it, how fast, which holiday converts best, by age. */
export const TRANSITIONS: { id: string; o: Stream[]; d: Stream[]; noU48?: boolean; label: string }[] = [
  { id: "fundamentals_to_u48", o: ["camp_fundamentals"], d: ["u48"], label: "FUNdamentals camp → U4–U8 term programme" },
  { id: "fundamentals_to_worldcup", o: ["camp_fundamentals"], d: ["camp_worldcup"], label: "FUNdamentals camp → World Cup camp" },
  { id: "worldcup_to_pre_academy", o: ["camp_worldcup"], d: ["pre_academy"], label: "World Cup camp → Pre-Academy" },
  { id: "worldcup_to_technification", o: ["camp_worldcup"], d: ["technification"], label: "World Cup camp → Technification" },
  { id: "u48_to_pre_academy", o: ["u48"], d: ["pre_academy"], label: "U4–U8 → Pre-Academy" },
  { id: "u48_to_technification", o: ["u48"], d: ["technification"], label: "U4–U8 → Technification" },
  { id: "u48_to_any_camp", o: ["u48"], d: CAMP_STREAMS, label: "U4–U8 → any holiday camp" },
  { id: "technification_to_pre_academy", o: ["technification"], d: ["pre_academy"], label: "Technification → Pre-Academy" },
  { id: "pre_academy_to_academy", o: ["pre_academy"], d: ["academy"], label: "Pre-Academy → Academy" },
  { id: "camp_to_any_term", o: CAMP_STREAMS, d: TERM_STREAMS, label: "Any holiday camp → any term programme" },
];
export function conversion(ds: YouthDataset, id: string) {
  const t = TRANSITIONS.find((x) => x.id === id); if (!t) return null;
  const L = ds.latest.idx;
  const gate = t.d.includes("academy") ? ds.latest.y - 13 : t.d.includes("pre_academy") ? ds.latest.y - 9 : null;
  const firstOf = (k: ChildRecord, streams: Stream[]) => { let best: ChildTermRow | null = null; for (const s of streams) { const r = k.firstIn[s]; if (r && (!best || r.start < best.start)) best = r; } return best; };
  let prior = 0, together = 0;
  const elig: { k: ChildRecord; o: ChildTermRow; d: ChildTermRow | null; me: boolean }[] = [];
  for (const k of ds.children) {
    const o = firstOf(k, t.o); if (!o) continue;
    const d = firstOf(k, t.d);
    if (d && d.start < o.start) { prior++; continue; }
    if (d && d.start === o.start) { together++; continue; }
    const conv = !!d && (!t.noU48 || !k.firstIn.u48);
    const me = L - o.idx >= 4 && (gate == null || (k.birthYear != null && k.birthYear <= gate));
    elig.push({ k, o, d: conv ? d : null, me });
  }
  const conv = elig.filter((e) => e.d);
  const meBase = elig.filter((e) => e.me), meConv = meBase.filter((e) => e.d);
  const rateObj = (den: number, num: number) => ({ eligible: den, converted: num, pct: den ? Math.round((1000 * num) / den) / 10 : null });
  const ELAPSED: [string, number][] = [["same term", 0], ["next term", 1], ["within 2 terms", 2], ["within 4 terms", 4], ["within 8 terms", 8], ["later", Infinity]];
  const timing = ELAPSED.map(([name, lim]) => { const c = conv.filter((e) => e.d!.idx - e.o.idx <= lim).length; return { bucket: name, cumulative: c, pctOfConverters: conv.length ? Math.round((1000 * c) / conv.length) / 10 : null }; });
  const landing = ["T1", "T2", "T3", "T4"].map((tt, i) => { const k = conv.filter((e) => e.d!.idx % 4 === i).length; return { term: tt, n: k, pct: conv.length ? Math.round((1000 * k) / conv.length) / 10 : null }; });
  const groupRates = (fn: (e: typeof elig[number]) => string, keys: string[]) => keys.map((key) => { const b = elig.filter((e) => fn(e) === key), bm = b.filter((e) => e.me); return { group: key, all: rateObj(b.length, b.filter((e) => e.d).length), mature: rateObj(bm.length, bm.filter((e) => e.d).length) }; }).filter((g) => g.all.eligible > 0);
  const byAge = groupRates((e) => (e.o.age == null ? "unknown" : e.o.age < 4 ? "3 or under" : e.o.age > 13 ? "14+" : String(e.o.age)), ["3 or under", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14+", "unknown"]);
  const out: any = {
    id: t.id, label: t.label,
    excluded: { alreadyInDestinationBefore: prior, startedBothSameTerm: together },
    all: rateObj(elig.length, conv.length),
    mature: rateObj(meBase.length, meConv.length),
    matureRule: `origin at least four terms before ${ds.latest.label}${gate ? ` and born ${gate} or earlier` : ""}`,
    timing, landing, byAge,
  };
  if (t.o.some(isCampStream)) {
    out.byHoliday = groupRates((e) => e.o.label.slice(5), ["Apr", "Jul", "Sep-Oct", "Dec"]);
    const years = Array.from(new Set(elig.map((e) => e.o.label.slice(0, 4)))).sort();
    out.byYear = groupRates((e) => e.o.label.slice(0, 4), years);
  }
  return out;
}

/** Year-by-year totals across every stream: money and distinct children. */
export function yearTotals(ds: YouthDataset, fromYear = 2017) {
  const out = new Map<number, { cents: Record<string, number>; children: Record<string, Set<string>> }>();
  for (const r of ds.rows) {
    if (r.stream === "other") continue;
    const y = Number(r.start.slice(0, 4));
    if (y < fromYear || y > ds.latest.y + 1) continue;
    const e = out.get(y) ?? out.set(y, { cents: {}, children: {} }).get(y)!;
    e.cents[r.stream] = (e.cents[r.stream] ?? 0) + r.cents;
    if (!r.isFamily && r.attended) (e.children[r.stream] ??= new Set()).add(r.childKey);
  }
  return Array.from(out.entries()).sort((a, b) => a[0] - b[0]).map(([year, e]) => ({
    year,
    cents: e.cents,
    totalCents: Object.values(e.cents).reduce((a, b) => a + b, 0),
    children: Object.fromEntries(Object.entries(e.children).map(([s, set]) => [s, set.size])),
    uniqueChildren: new Set(Object.values(e.children).flatMap((s) => Array.from(s))).size,
  }));
}
