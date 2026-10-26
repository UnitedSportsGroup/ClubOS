// ── Rambo's history tools — ten years of the club's numbers, in plain English ─
//
// Daniel, 2026-10-27: "He's only giving me data for April and October because
// that's what went through ClubOS, but we actually already have the data loaded
// in … We have the historical data, the lifetime value, and the cycles of the
// customers and all that. That is a massive part of all of this to win."
//
// ClubOS has sold registrations itself only since 2026. Everything before that
// — Friendly Manager 2017→, the office's Xero invoices, Shopify camps 2024→ — is
// migrated history (fm_payment_history / fm_registration_history) and already
// drives the History tabs on the camp and term-programme pages. These tools
// hand Rambo the SAME deciders those tabs use:
//   camp_history       → server/camp-history.ts (shared/holiday-camp-history)
//   programme_history  → server/term-programme-history.ts (shared/term-programme-history)
//   customer_lifetime  → server/youth-lifetime.ts (the 20 Oct engine, live)
//   league_lifetime    → server/league-lifetime.ts (MFL Analytics, live)
//   person_history     → server/person-history.ts (the person page's resolver)
// so Rambo can never disagree with the page a staff member would open.
//
// Every query is hand-written; the model names a programme, a year, a view.
// Access: the Registrations tab IN THE WORKSPACE asked about (scopeFor), the
// same wall the counting tools stand behind; the MFL tool is gated on the MFL
// Analytics tab by the tool definition AND re-checked here.

import { sql } from "drizzle-orm";
import { db } from "./db";
import { viewerCanReachTab, type Viewer } from "@shared/knowledge-base";
import { editionOrder, editionTitle, sameHolidayLastYear, CAMP_SERIES, type CampSeries } from "@shared/holiday-camp-history";
import { periodOrder, periodTitle, periodYear, TERM_STREAMS as TERM_STREAM_META, type TermStream } from "@shared/term-programme-history";
import { holidayCampHistory } from "./camp-history";
import { termProgrammeHistory } from "./term-programme-history";
import { scopeFor, programmesFor, nzToday } from "./rambo-club-tools";
import {
  getYouthDataset, cohortMembers, cohortBlock, retention, yearPicture, funnel, tenure, journey, conversion, yearTotals,
  streamFromText, STREAM_NAME, TRANSITIONS, TERM_STREAMS, CAMP_STREAMS, type Stream,
} from "./youth-lifetime";

interface ToolResult {
  text: string;
  sources?: { id: number; title: string; brand: string }[];
}
const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];
const dollars = (cents: number) => `$${(Math.round(Number(cents)) / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const whole = (cents: number) => `$${Math.round(Number(cents) / 100).toLocaleString("en-NZ")}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const num = (n: number | null | undefined) => (n == null ? "—" : String(n));
const SOURCE_NAME: Record<string, string> = { friendly_manager: "Friendly Manager", fm: "Friendly Manager", shopify: "Shopify", xero: "Xero invoices", clubos: "ClubOS", shop: "ClubOS store" };
const sourcesLine = (s: Record<string, number> | undefined, amounts = true) => s ? Object.entries(s).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([k, c]) => amounts ? `${SOURCE_NAME[k] ?? k} ${whole(c)}` : (SOURCE_NAME[k] ?? k)).join(", ") : "";

// The two History builders read ~30k rows and classify each call (5–8 s for
// term programmes). Rambo may call one twice in an answer, so cache per org
// for ten minutes — the page itself recomputes on every open.
const HIST_CACHE = new Map<string, { at: number; v: Promise<any> }>();
const HIST_TTL = 10 * 60 * 1000;
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = HIST_CACHE.get(key);
  if (hit && Date.now() - hit.at < HIST_TTL) return hit.v as Promise<T>;
  const v = make().catch((e) => { HIST_CACHE.delete(key); throw e; });
  HIST_CACHE.set(key, { at: Date.now(), v });
  return v;
}

const HISTORY_NOTE =
  "Counted from every system the club has sold through — Friendly Manager (2017 on), the office's Xero invoices, Shopify (camps 2024 to Jan 2026) and ClubOS (2026 on) — with the same payment recorded in two systems counted once. " +
  "Children is a floor: a Xero invoice names the parent, not the child. Before 2021 the only record is Xero invoice lines, so 2017–2020 are a floor too. 'Placed by payment date' means the record did not name its holiday or term, so it was filed under the next one after the payment.";

function yearArg(v: any): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  const thisYear = Number(nzToday().slice(0, 4));
  if (/^(this year|current|ytd|year to date)$/.test(s)) return thisYear;
  if (/^(last year|previous year)$/.test(s)) return thisYear - 1;
  const m = /(20\d{2})/.exec(s);
  return m ? Number(m[1]) : null;
}

// ── camp_history ─────────────────────────────────────────────────────────────
// Calendar year Y = the summer camp that ran in January Y (keyed by its
// December, so "Y-1-summer") + Apr + Jul + Sep–Oct of Y. That is how Daniel
// reads "this year": "January, April, October".
const yearEditions = (y: number) => [`${y - 1}-summer`, `${y}-apr`, `${y}-jul`, `${y}-sep`];
const editionYear = (k: string) => (k.endsWith("-summer") ? Number(k.slice(0, 4)) + 1 : Number(k.slice(0, 4)));

function seriesArg(text: any): { key: CampSeries | "all"; name: string; label: string } {
  const q = String(text ?? "").trim().toLowerCase();
  if (!q || /^(all|every|both|holiday camps?|camps)$/.test(q)) return { key: "all", name: "Holiday Camp", label: "every holiday camp" };
  if (/fundament|first skills|u4|4\s*[-–to ]+\s*8/.test(q)) return { key: "fundamentals", name: "FUNdamentals Holiday Camp", label: "FUNdamentals camp (U4–U8)" };
  if (/world cup|u9|9\s*[-–to ]+\s*13|junior/.test(q)) return { key: "world_cup", name: "World Cup Holiday Camp", label: "World Cup camp (U9–U13)" };
  if (/special|elite|hp|high performance|goal ?scor|shotstop/.test(q)) return { key: "specialist", name: "HP Camp", label: "specialist camps" };
  return { key: "all", name: "Holiday Camp", label: "every holiday camp" };
}

export async function runCampHistory(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { orgId, orgName } = s.scope;
  const series = seriesArg(input?.series ?? input?.programme);
  const year = yearArg(input?.year);
  const fromYear = yearArg(input?.from_year) ?? (year ? year - 1 : 2017);
  const h = await cached(`camp|${orgId}|${series.name}`, () => holidayCampHistory(orgId, series.name));
  const pick = (e: (typeof h.editions)[number]) => series.key === "all" ? { cents: e.cents, children: e.children } : (e.series[series.key] ?? { cents: 0, children: 0 });
  let editions = h.editions.filter((e) => pick(e).cents > 0 || pick(e).children > 0);
  if (!editions.length) return { text: `No holiday camp history on record for ${series.label} in ${orgName}. ${orgId === 1 ? "" : "The migrated Friendly Manager / Xero / Shopify history is Christchurch United's; this workspace only has what ClubOS itself sold."}` };
  const byKey = new Map(editions.map((e) => [e.key, e]));
  const lines: string[] = [];
  const editionLine = (e: (typeof h.editions)[number]) => {
    const v = pick(e);
    const last = byKey.get(sameHolidayLastYear(e.key));
    const lv = last ? pick(last) : null;
    const growth = lv && lv.cents > 0 ? ` · vs ${editionTitle(last!.key)}: ${v.cents >= lv.cents ? "+" : ""}${Math.round(((v.cents - lv.cents) / lv.cents) * 100)}%` : "";
    const est = e.estimatedCents > 0 ? ` · ${whole(e.estimatedCents)} placed by payment date` : "";
    const prog = e.inProgress ? " · still selling" : "";
    const split = series.key === "all" && Object.keys(e.series).length > 1
      ? ` [${Object.entries(e.series).map(([k, c]) => `${CAMP_SERIES.find((x) => x.key === k)?.label ?? k} ${whole(c!.cents)}`).join(", ")}]`
      : "";
    const sold = series.key === "all" ? sourcesLine(e.sources) : `sold through ${sourcesLine(e.sources, false)}`;
    return `- ${editionTitle(e.key)}: ${dollars(v.cents)} · ${v.children} children · ${sold}${split}${growth}${est}${prog}`;
  };
  if (year) {
    const keys = yearEditions(year);
    const inYear = keys.map((k) => byKey.get(k)).filter(Boolean) as typeof editions;
    const total = inYear.reduce((a, e) => a + pick(e).cents, 0);
    const kids = inYear.reduce((a, e) => a + pick(e).children, 0);
    lines.push(`**${series.label} — calendar ${year}: ${dollars(total)} across ${inYear.length} holiday${inYear.length === 1 ? "" : "s"}, ${kids} children's bookings** (${orgName}).`);
    lines.push(`The year counts the summer camp that ran in January ${year} (Dec ${year - 1} – Jan ${year}), then April, July and Sep–Oct ${year}:`);
    for (const e of inYear) lines.push(editionLine(e));
    const missing = keys.filter((k) => !byKey.get(k));
    if (missing.length) lines.push(`No ${series.label} record for: ${missing.map(editionTitle).join(", ")}.`);
    const coming = byKey.get(`${year}-summer`);
    if (coming) lines.push(`Dec ${year} – Jan ${year + 1} (counted in ${year + 1}): ${dollars(pick(coming).cents)} so far, ${pick(coming).children} children.`);
    const lastYear = yearEditions(year - 1).map((k) => byKey.get(k)).filter(Boolean) as typeof editions;
    if (lastYear.length) {
      const lt = lastYear.reduce((a, e) => a + pick(e).cents, 0);
      lines.push(`Calendar ${year - 1} for comparison: ${dollars(lt)} across ${lastYear.length} holidays (${lastYear.map((e) => `${editionTitle(e.key)} ${whole(pick(e).cents)}`).join(", ")})${lt > 0 ? ` — ${total >= lt ? "+" : ""}${Math.round(((total - lt) / lt) * 100)}%` : ""}.`);
    }
    const xy = h.years.find((y) => y.year === year);
    if (xy && xy.xeroIncGstCents > 0) lines.push(`Xero's holiday-camp income line for ${year}: ${dollars(xy.xeroIncGstCents)} incl GST (${dollars(xy.xeroExGstCents)} excl) as at ${h.xero.asOf} — Xero also sees counter EFTPOS, cash and bank transfers that no booking system recorded, so it can read higher than the records.`);
  } else {
    editions = editions.filter((e) => editionYear(e.key) >= fromYear).sort((a, b) => editionOrder(a.key) - editionOrder(b.key));
    const years = new Map<number, { cents: number; children: number; n: number }>();
    for (const e of editions) { const y = editionYear(e.key); const v = pick(e); const cur = years.get(y) ?? { cents: 0, children: 0, n: 0 }; cur.cents += v.cents; cur.children += v.children; cur.n++; years.set(y, cur); }
    lines.push(`**${series.label} — every holiday since ${fromYear}** (${orgName}). By calendar year (a year = the summer camp that ran in its January + April + July + Sep–Oct):`);
    for (const [y, v] of Array.from(years.entries()).sort((a, b) => a[0] - b[0])) {
      const xy = h.years.find((x) => x.year === y);
      const xero = xy && xy.xeroIncGstCents > 0 ? ` · Xero ${whole(xy.xeroIncGstCents)} incl GST` : "";
      lines.push(`- ${y}: ${dollars(v.cents)} · ${v.children} children's bookings · ${v.n} holiday${v.n === 1 ? "" : "s"}${xero}${y === Number(nzToday().slice(0, 4)) ? " (year in progress)" : ""}`);
    }
    lines.push("By holiday:");
    for (const e of editions) lines.push(editionLine(e));
  }
  if (h.excluded.length) {
    const top = h.excluded.slice(0, 3).map((x) => `${x.reason} (${x.rows} rows, ${whole(x.cents)})`).join("; ");
    lines.push(`Left out on purpose: ${top}.`);
  }
  lines.push(HISTORY_NOTE);
  lines.push("This is the same data as the History tab on the camp's page in ClubOS → Academy → the camp → History.");
  return { text: lines.join("\n") };
}

// ── programme_history ────────────────────────────────────────────────────────
const STREAM_SLUG: Record<TermStream, string> = { funino: "u4-u8", technification: "technification", pre_academy: "pre-academy-u9-u12", academy: "academy-u13-u17", academy_unsplit: "academy-u13-u17", goalkeeper: "gk-programme", morning: "morning-programme" };
const YOUTH_TO_TERM: Partial<Record<Stream, TermStream>> = { u48: "funino", pre_academy: "pre_academy", academy: "academy", technification: "technification", goalkeeper: "goalkeeper", morning: "morning" };
const streamLabel = (s: TermStream) => TERM_STREAM_META.find((x) => x.key === s)?.label ?? s;

export async function runProgrammeHistory(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { orgId, orgName } = s.scope;
  const asked = streamFromText(input?.programme);
  if (asked === null) return { text: `I couldn't read "${input?.programme}" as a programme. Say one of: U4-U8 (FUNiño), pre-academy (U9–U12), academy (U13+), technification, goalkeeper, morning programme, or "all". For the holiday camps use camp_history.` };
  if (asked !== "all" && (CAMP_STREAMS as string[]).includes(asked)) return { text: "Holiday camps are on camp_history, not here — call that for the camps." };
  const stream: TermStream | "all" = asked === "all" ? "all" : YOUTH_TO_TERM[asked]!;
  const by = String(input?.by ?? "").toLowerCase() === "year" || (stream === "all" && !input?.by) ? "year" : "term";
  const year = yearArg(input?.year);
  const fromYear = yearArg(input?.from_year) ?? (year ? year - 1 : 2017);
  const all = await programmesFor(orgId);
  const slug = stream === "all" ? "u4-u8" : STREAM_SLUG[stream];
  const programme = all.find((p) => p.slug === slug) ?? all.find((p) => p.type === "academy") ?? null;
  if (!programme) return { text: `${orgName} has no term programmes in ClubOS, so there is no term history to read here.` };
  const h = await cached(`term|${orgId}|${programme.slug}`, () => termProgrammeHistory(orgId, { slug: programme.slug, name: programme.name }));
  const pick = (p: (typeof h.periods)[number]) => stream === "all" ? { cents: p.cents, children: p.children } : (p.streams[stream] ?? { cents: 0, children: 0 });
  let periods = h.periods.filter((p) => pick(p).cents > 0 || pick(p).children > 0).filter((p) => periodYear(p.key) >= fromYear);
  if (year) periods = periods.filter((p) => periodYear(p.key) === year);
  if (!periods.length) return { text: `No term-programme history on record for ${stream === "all" ? "any term programme" : streamLabel(stream)} in ${orgName}${year ? ` in ${year}` : ` since ${fromYear}`}.` };
  const title = stream === "all" ? "every term programme" : streamLabel(stream);
  const lines: string[] = [];
  const thisYear = Number(nzToday().slice(0, 4));
  if (by === "year") {
    const years = new Map<number, { cents: number; children: number; terms: number; streams: Record<string, number> }>();
    for (const p of periods) {
      const y = periodYear(p.key); const v = pick(p);
      const cur = years.get(y) ?? { cents: 0, children: 0, terms: 0, streams: {} };
      cur.cents += v.cents; cur.children += v.children; cur.terms++;
      if (stream === "all") for (const [k, c] of Object.entries(p.streams)) cur.streams[k] = (cur.streams[k] ?? 0) + (c?.cents ?? 0);
      years.set(y, cur);
    }
    const rows = Array.from(years.entries()).sort((a, b) => a[0] - b[0]);
    const grand = rows.reduce((a, [, v]) => a + v.cents, 0);
    lines.push(`**${title} — by year${year ? ` (${year})` : ` since ${fromYear}`}: ${dollars(grand)} in total** (${orgName}). Children per year adds each term's count, so a child who did three terms counts three times — ask customer_lifetime for distinct children.`);
    for (const [y, v] of Array.from(rows)) {
      const split = stream === "all" ? ` [${Object.entries(v.streams).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${streamLabel(k as TermStream)} ${whole(c)}`).join(", ")}]` : "";
      const prev = years.get(y - 1);
      const growth = prev && prev.cents > 0 ? ` · vs ${y - 1}: ${v.cents >= prev.cents ? "+" : ""}${Math.round(((v.cents - prev.cents) / prev.cents) * 100)}%` : "";
      lines.push(`- ${y}: ${dollars(v.cents)} · ${v.children} child-terms across ${v.terms} period${v.terms === 1 ? "" : "s"}${split}${growth}${y === thisYear ? " (year in progress)" : ""}`);
    }
  } else {
    lines.push(`**${title} — by term${year ? ` (${year})` : ` since ${fromYear}`}** (${orgName}):`);
    const byKey = new Map(periods.map((p) => [p.key, p]));
    for (const p of periods.sort((a, b) => periodOrder(a.key) - periodOrder(b.key))) {
      const v = pick(p);
      const last = h.periods.find((x) => x.key === p.lastYearKey);
      const lv = last ? pick(last) : null;
      const growth = lv && lv.cents > 0 ? ` · vs ${periodTitle(last!.key)}: ${v.cents >= lv.cents ? "+" : ""}${Math.round(((v.cents - lv.cents) / lv.cents) * 100)}%` : "";
      const est = p.estimatedCents > 0 && stream === "all" ? ` · ${whole(p.estimatedCents)} placed by payment date` : "";
      const split = stream === "all" && Object.keys(p.streams).length > 1 ? ` [${Object.entries(p.streams).filter(([, c]) => (c?.cents ?? 0) > 0).map(([k, c]) => `${streamLabel(k as TermStream)} ${whole(c!.cents)}`).join(", ")}]` : "";
      const sold = stream === "all" ? sourcesLine(p.sources) : `sold through ${sourcesLine(p.sources, false)}`;
      lines.push(`- ${p.title}: ${dollars(v.cents)} · ${v.children} children · ${sold}${split}${growth}${est}${p.inProgress ? " · in progress" : ""}`);
      void byKey;
    }
  }
  if (stream !== "all" && h.priceHistory.length) {
    const recent = h.priceHistory.filter((p) => !year || p.year === year).slice(0, 6);
    if (recent.length) {
      lines.push(`Fee charged (${streamLabel(stream)}), most recent first — the most common full-size amount in the term; smaller amounts are pro-rata, discounts or part-payments:`);
      for (const p of recent) lines.push(`- ${p.title}: ${p.groups.map((g) => `${g.group} ${dollars(g.feeCents)} (${g.feeCount} of ${g.payments} payments)`).join(" · ")}`);
    }
  }
  if (h.excluded.length) lines.push(`Left out on purpose: ${h.excluded.slice(0, 3).map((x) => `${x.reason} (${x.rows} rows, ${whole(x.cents)})`).join("; ")}.`);
  lines.push(HISTORY_NOTE);
  lines.push("This is the same data as the History tab on the programme's page in ClubOS → Academy → the programme → History.");
  return { text: lines.join("\n") };
}

// ── customer_lifetime ────────────────────────────────────────────────────────
const LIFETIME_NOTE =
  "Money is NZD incl GST as families paid it, gross of refunds, counted once across Friendly Manager, Xero, Shopify and ClubOS. A child is one person across every system (matched on name + date of birth, then name + a shared parent email/phone). " +
  "'Clean cohort' = children whose first term was 2021–2024 (full records and two years to come back); camp starters at least four terms ago. Free open trainings are never a programme.";

const youthStream = (text: any, fallback: Stream): Stream => { const s = streamFromText(text); return s && s !== "all" ? s : fallback; };

export async function runCustomerLifetime(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { orgId, orgName } = s.scope;
  if (orgId !== 1) return { text: `Customer lifetime figures are built for Christchurch United's youth programmes only today (that is where the ten-year history lives). ${orgName} has no lifetime model yet. For Mini Football Leagues use league_lifetime.` };
  const ds = await getYouthDataset(orgId);
  const view = String(input?.view ?? "cohort").toLowerCase();
  const filter = (String(input?.cohort ?? "clean").toLowerCase().replace(/[^a-z0-9]/g, "") === "all" ? "all" : /mature8|8/.test(String(input?.cohort ?? "")) ? "mature8" : /mature/.test(String(input?.cohort ?? "")) ? "mature4" : "clean") as "all" | "clean" | "mature4" | "mature8";
  const filterLabel = { all: "every child, all time", clean: "the clean cohort", mature4: "children who joined at least four terms ago", mature8: "children who joined at least eight terms ago" }[filter];
  const year = yearArg(input?.year);
  const lines: string[] = [];
  const latest = `${ds.latest.label}${ds.latest.inProgress ? " (in progress)" : ""}`;

  if (view === "cohort" || view === "value" || view === "ltv") {
    const stream = youthStream(input?.programme, "u48");
    const members = cohortMembers(ds, stream, filter, year);
    const allN = cohortMembers(ds, stream, "all").length;
    if (!members.length) return { text: `No children whose first programme was ${STREAM_NAME[stream]} match ${filterLabel}${year ? ` joining in ${year}` : ""}. ${allN} children started there all time.` };
    const b = cohortBlock(members, stream);
    lines.push(`**Children whose FIRST programme was ${STREAM_NAME[stream]} — ${filterLabel}${year ? `, joined ${year}` : ""}: ${b.children} children** (of ${allN} all time; latest term ${latest}).`);
    const AGE_ORDER = ["3 or under", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14+", "unknown"];
    lines.push(`- Age when they joined: median ${num(b.ageAtJoin.median)}, mean ${num(b.ageAtJoin.mean)} (${b.ageAtJoin.known} with a date of birth). Spread: ${AGE_ORDER.filter((a) => (b.ageAtJoin.distribution[a] ?? 0) > 0).map((a) => `${a}: ${b.ageAtJoin.distribution[a]}`).join(" · ")}.`);
    lines.push(`- How long they stayed in ${STREAM_NAME[stream]}: median ${num(b.termsInFirst.median)} ${(CAMP_STREAMS as string[]).includes(stream) ? "camps" : "terms"}, mean ${num(b.termsInFirst.mean)}. ${Object.entries(b.termsInFirst.histogram).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(" · ")}. Terms in any programme: median ${num(b.totalTerms.median)}, mean ${num(b.totalTerms.mean)}.`);
    lines.push(`- What they did AFTER: Pre-Academy ${pct(b.progressedPct.pre_academy)} · Academy ${pct(b.progressedPct.academy)} · Technification or Goalkeeper ${pct(b.progressedPct.technification_or_goalkeeper)}${stream !== "u48" ? ` · U4–U8 ${pct(b.progressedPct.u48)}` : ""} · a holiday camp ${pct(b.progressedPct.any_camp_after_first)} · bought uniform ${pct(b.progressedPct.uniform)} · still with us in ${ds.latest.label}: ${pct(b.stillActivePct)}.`);
    const r = b.revenue;
    lines.push(`- Lifetime revenue per child, programmes only: mean ${dollars(r.programmes.meanCents)}, median ${dollars(r.programmes.medianCents)} (${dollars(r.programmes.totalCents)} across the cohort). ${STREAM_NAME[stream]} alone: mean ${dollars(r[stream].meanCents)}, median ${dollars(r[stream].medianCents)}. Including uniform: mean ${dollars(r.total.meanCents)}.`);
    const streams = (["u48", "pre_academy", "academy", "technification", "goalkeeper", "camp_fundamentals", "camp_worldcup", "camp_other", "uniform"] as Stream[]).filter((x) => r[x].totalCents > 0);
    lines.push(`- Where that money came from (mean per child): ${streams.map((x) => `${STREAM_NAME[x]} ${dollars(r[x].meanCents)}`).join(" · ")}.`);
    if (b.zeroMoney) lines.push(`- ${b.zeroMoney} of them have no money recorded against them (enrolled, paid off-system or under a parent's name).`);
    if (!year) {
      const byYear = [2021, 2022, 2023, 2024, 2025, 2026].map((y) => ({ y, n: cohortMembers(ds, stream, "all", y).length })).filter((x) => x.n > 0);
      if (byYear.length) lines.push(`- New ${STREAM_NAME[stream]} starters by year: ${byYear.map((x) => `${x.y}: ${x.n}`).join(" · ")}${ds.latest.inProgress ? ` (${ds.latest.y} still registering)` : ""}.`);
    }
  } else if (view === "retention") {
    const stream = youthStream(input?.programme, "u48");
    if (!(TERM_STREAMS as string[]).includes(stream)) return { text: "Retention term to term is for term programmes (U4-U8, pre-academy, academy, technification). For camps ask for the 'journey' or 'conversion' view." };
    const rows = retention(ds, stream, year ?? 2021);
    if (!rows.length) return { text: `No term-to-term data for ${STREAM_NAME[stream]}.` };
    const done = rows.filter((r) => !r.nextInProgress);
    const best = Array.from(done).sort((a, b) => b.retentionPct - a.retentionPct).slice(0, 2), worst = Array.from(done).sort((a, b) => a.retentionPct - b.retentionPct).slice(0, 2);
    const typical = done.length ? Math.round((done.reduce((a, r) => a + r.retentionPct, 0) / done.length) * 10) / 10 : null;
    lines.push(`**${STREAM_NAME[stream]} — retention term to term since ${year ?? 2021}** (latest ${latest}). Typical: ${pct(typical)} of a term's children are back the next term. Best: ${best.map((r) => `${r.from}→${r.to} ${r.retentionPct}%`).join(", ")}. Worst: ${worst.map((r) => `${r.from}→${r.to} ${r.retentionPct}%`).join(", ")}.`);
    for (const r of rows.slice(-16)) lines.push(`- ${r.from} → ${r.to}: ${r.inStream} in ${STREAM_NAME[stream]}, ${r.stayed} stayed (${r.retentionPct}%), ${r.moved} moved to another programme, ${r.gone} not in any term programme next term${r.nextInProgress ? " (next term still registering)" : ""}`);
    lines.push("'Moved' is progression (e.g. up to Pre-Academy), not loss. Term 4 → Term 1 crosses the summer break and is usually the weakest step.");
  } else if (view === "year" || view === "new_vs_returning" || view === "picture") {
    const stream = youthStream(input?.programme, "u48");
    const y = year ?? ds.latest.y;
    const p = yearPicture(ds, stream, y);
    lines.push(`**${STREAM_NAME[stream]} in ${y}: ${p.uniqueChildren} distinct children across the year** (latest ${latest}).`);
    for (const t of p.terms) {
      if (t.future) continue;
      lines.push(`- ${t.term}: ${t.children} children — ${t.newToStream} new to ${STREAM_NAME[stream]} (${t.brandNewToClub} brand-new to the club, ${t.cameFromElsewhereFirst} came from a camp or another programme first), ${t.returning} returning${t.inProgress ? " (still registering)" : ""}`);
    }
  } else if (view === "funnel" || view === "progression" || view === "pathway") {
    const f = funnel(ds, false), fm = funnel(ds, true);
    lines.push(`**The pathway U4–U8 → Pre-Academy → Academy, every player ever (${f.players} players with a term-programme record; latest ${latest}).**`);
    for (const c of f.classes.filter((c) => c.n > 0)) lines.push(`- ${c.label}: ${c.n} (${c.pct}%) · lifetime revenue mean ${dollars(c.meanCents)}, median ${dollars(c.medianCents)} · terms median ${num(c.medianTerms)}`);
    const cond = (c: { text: string; base: number; yes: number; pct: number | null }) => `${c.text}: ${pct(c.pct)} (${c.yes} of ${c.base})`;
    lines.push(`Conditional, all players: ${cond(f.conditional.u48ToPreAcademy)} · ${cond(f.conditional.preAcademyToAcademy)} · ${cond(f.conditional.u48ToAcademy)} · ${cond(f.conditional.wholeWay)}.`);
    lines.push(`Old enough and with time to move (born ${ds.latest.y - 13} or earlier, joined at least four terms ago; ${fm.players} players): ${cond(fm.conditional.u48ToPreAcademy)} · ${cond(fm.conditional.preAcademyToAcademy)} · ${cond(fm.conditional.u48ToAcademy)}.`);
  } else if (view === "tenure" || view === "years" || view === "churn") {
    const t = tenure(ds);
    const dist = (d: { years: number; n: number; pct: number }[]) => d.filter((x) => x.n > 0).slice(0, 6).map((x) => `${x.years} yr${x.years === 1 ? "" : "s"}: ${x.pct}%`).join(" · ");
    lines.push(`**How long players stay (${t.players} players with a term-programme record; ${t.campsOnlyChildren} more only ever came to a camp; latest ${latest}).**`);
    lines.push(`- Everyone who started by ${ds.latest.y - 1} (${t.allTime.n}): years with us median ${num(t.allTime.median)}, mean ${num(t.allTime.mean)}; ${t.allTime.twoPlusPct}% stayed 2+ years, ${t.allTime.threePlusPct}% 3+, ${t.allTime.fivePlusPct}% 5+. ${dist(t.allTime.distribution)}.`);
    lines.push(`- Current players (${t.current.n}, in the last two terms): ${t.current.distribution[0]?.pct}% in their first year, ${t.current.threePlusPct}% have 3+ years. By programme now: ${TERM_STREAMS.map((s) => `${STREAM_NAME[s]} ${t.currentByProgramme[s].n} (median ${num(t.currentByProgramme[s].median)} yrs)`).filter((x) => !/ 0 \(/.test(x)).join(" · ")}.`);
    const c = t.churn.allTime;
    lines.push(`- One-and-done: ${c.exactlyOneTermEver.pct}% did exactly one term ever; ${c.oneYearOnlyMoreThanOneTerm.pct}% more than one term but one year only; ${c.twoPlusYears.pct}% two or more years. Terms per player: median ${num(c.termsEveryone.median)}, mean ${num(c.termsEveryone.mean)}; those who made it past year one average ${num(c.termsPastFirstYear.mean)} terms (median ${num(c.termsPastFirstYear.median)}).`);
    lines.push(`- Gap years: ${t.gapYears.pct}% of multi-year players left for a whole year and came back (${t.gapYears.withGap} of ${t.gapYears.n}) — the drag is one-and-done children, not children who leave and return.`);
    const surv = t.survival.filter((r) => r.n >= 20).slice(-5);
    if (surv.length) lines.push(`- Still a player after 1 / 2 / 3 years, by the year they joined: ${surv.map((r) => `${r.firstYear} (${r.n}): ${[1, 2, 3].map((g) => pct(r.stillAfter[g] ?? null)).join(" / ")}`).join(" · ")}.`);
  } else if (view === "journey" || view === "downstream" || view === "after") {
    const stream = youthStream(input?.programme, "camp_fundamentals");
    const j = journey(ds, stream, filter);
    if (!j.n) return { text: `No children whose first programme was ${STREAM_NAME[stream]} match ${filterLabel}.` };
    lines.push(`**What happens AFTER a child's first ${STREAM_NAME[stream]} — ${filterLabel}, ${j.n} children** (latest ${latest}).`);
    lines.push(`- Bought nothing more: ${j.segments.nothingMore.pct}% (${j.segments.nothingMore.n}) · more camps only ${j.segments.moreCampsOnly.pct}% · term programmes and no more camps ${j.segments.termsOnly.pct}% · term programmes and more camps ${j.segments.termsAndCamps.pct}%.`);
    lines.push(`- First record: ${dollars(j.firstRecord.meanCents)} a child. Later spend: ${dollars(j.downstream.totalCents)} in total, mean ${dollars(j.downstream.meanCents)} a child, median ${dollars(j.downstream.medianCents)}.`);
    lines.push("- Where the later money went:");
    for (const b of j.buckets.filter((b) => b.childrenWithAny > 0)) lines.push(`  - ${b.label}: ${b.pctChildren}% of children (${b.childrenWithAny}), ${dollars(b.totalCents)} = ${b.shareOfDownstreamPct}% of later spend, mean ${dollars(b.meanCentsPerChild)} per cohort child, median ${dollars(b.medianAmongThoseWithAny)} among those who did`);
  } else if (view === "conversion" || view === "transition") {
    const want = String(input?.transition ?? input?.programme ?? "").toLowerCase().replace(/[–—]/g, "-");
    const sides = want.split(/\s*(?:->|→|\bto\b|\binto\b)\s*/).map((x) => x.trim()).filter(Boolean);
    const sideStream = (x: string | undefined): Stream | "any_camp" | "any_term" | null => {
      if (!x) return null;
      if (/any (holiday )?camp|camps?$/.test(x) && !/fundament|world/.test(x)) return "any_camp";
      if (/any (term )?programme|term programme/.test(x)) return "any_term";
      const st = streamFromText(x); return st && st !== "all" ? st : null;
    };
    const from = sideStream(sides[0]), to = sideStream(sides[1]);
    const matches = (set: Stream[], want: ReturnType<typeof sideStream>) => want == null ? true : want === "any_camp" ? set.every((x) => (CAMP_STREAMS as string[]).includes(x)) && set.length > 1 : want === "any_term" ? set.every((x) => (TERM_STREAMS as string[]).includes(x)) && set.length > 1 : set.includes(want);
    const t = TRANSITIONS.find((x) => x.id === want)
      ?? (from || to ? TRANSITIONS.find((x) => matches(x.o, from) && matches(x.d, to) && (from == null || to == null ? x.o.length === 1 || from === "any_camp" : true)) : undefined)
      ?? (from ? TRANSITIONS.find((x) => matches(x.o, from)) : undefined)
      ?? TRANSITIONS[0];
    const c = conversion(ds, t!.id)!;
    lines.push(`**${c.label}** (latest ${latest}). Of every child who did the first thing without having done the second before it: ${c.all.converted} of ${c.all.eligible} went on to it (${pct(c.all.pct)}). Among those ${c.matureRule}: ${c.mature.converted} of ${c.mature.eligible} (${pct(c.mature.pct)}) — the fair rate.`);
    lines.push(`- How quickly: ${c.timing.map((x: any) => `${x.bucket} ${pct(x.pctOfConverters)}`).join(" · ")} (share of those who converted).`);
    lines.push(`- Which term they land in: ${c.landing.map((x: any) => `${x.term} ${pct(x.pct)}`).join(" · ")}.`);
    if (c.byHoliday?.length) lines.push(`- By the holiday of the first camp (fair rate): ${c.byHoliday.map((g: any) => `${g.group === "Dec" ? "Dec–Jan summer" : g.group} ${pct(g.mature.pct)} (${g.mature.converted} of ${g.mature.eligible})`).join(" · ")}.`);
    if (c.byYear?.length) lines.push(`- By the year of the first camp (all): ${c.byYear.map((g: any) => `${g.group} ${pct(g.all.pct)} (${g.all.converted} of ${g.all.eligible})`).join(" · ")}.`);
    const ages = c.byAge.filter((g: any) => g.mature.eligible >= 10);
    if (ages.length) lines.push(`- By age at the first record (fair rate): ${ages.map((g: any) => `${g.group}: ${pct(g.mature.pct)} (${g.mature.eligible})`).join(" · ")}.`);
    lines.push(`Other transitions I can give you: ${TRANSITIONS.filter((x) => x.id !== c.id).map((x) => x.label).join("; ")}.`);
  } else if (view === "totals" || view === "by_year" || view === "growth") {
    const rows = yearTotals(ds, year ?? 2017);
    lines.push(`**Every youth programme and camp by calendar year — money and distinct children** (latest ${latest}). A camp held in January counts in that year.`);
    for (const r of rows) {
      const prev = rows.find((x) => x.year === r.year - 1);
      const growth = prev && prev.totalCents > 0 ? ` · vs ${r.year - 1}: ${r.totalCents >= prev.totalCents ? "+" : ""}${Math.round(((r.totalCents - prev.totalCents) / prev.totalCents) * 100)}%` : "";
      const parts = (Object.entries(r.cents) as [Stream, number][]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([s, c]) => `${STREAM_NAME[s]} ${whole(c)}${r.children[s] ? ` (${r.children[s]} children)` : ""}`).join(" · ");
      lines.push(`- ${r.year}: ${dollars(r.totalCents)} · ${r.uniqueChildren} distinct children${growth}${r.year >= ds.latest.y ? " (in progress)" : ""} — ${parts}`);
    }
    lines.push("Uniform and kit are included in a year's total; CIC entries, residency and trips are not.");
  } else {
    return { text: `I don't know the view "${view}". Say one of: cohort (what a child who starts in a programme is worth, how old, how long they stay, where they go next), retention (term to term), year (new vs returning per term), funnel (U4–U8 → Pre-Academy → Academy), tenure (years with us, one-and-done share), journey (where the money goes after the first programme), conversion (camp → term programme and the like), totals (every year since 2017).` };
  }
  lines.push(LIFETIME_NOTE);
  return { text: lines.join("\n") };
}

// ── league_lifetime (Mini Football Leagues) ──────────────────────────────────
export async function runLeagueLifetime(viewer: Viewer, input: any): Promise<ToolResult> {
  if (!viewerCanReachTab(viewer, "analytics", "mini-football-leagues").allowed) {
    return { text: "You don't have the Analytics area in Mini Football Leagues, so I can't read the league's lifetime figures for you. A super admin (Daniel) can give you that access." };
  }
  const { getLeagueDataset, computeLifetime, getAcquisition, isKnownTerm } = await import("./league-lifetime");
  const ds = await getLeagueDataset();
  const termIn = String(input?.term ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const term = termIn && termIn !== "ALL" && isKnownTerm(termIn) ? termIn : null;
  if (termIn && termIn !== "ALL" && !term) return { text: `I don't know a league term called "${input?.term}". Say it like "2026-T3", or "all".` };
  const lt = computeLifetime(ds, { scenario: "all", term });
  const acq = await getAcquisition(ds, term);
  const lines: string[] = [];
  lines.push(`**Mini Football Leagues — what a team is worth and what one costs to win${term ? ` (${term})` : ""}** (latest term ${lt.latestTerm}; ${lt.totals.identities} teams across ${lt.totals.teamTerms} team-terms).`);
  lines.push(`- How long a team stays: mean ${num(lt.stay.all.mean)} terms, median ${num(lt.stay.all.median)} (${lt.stay.all.n} teams); among teams old enough to have come back: mean ${num(lt.stay.mature.mean)}, median ${num(lt.stay.mature.median)}; ${lt.stay.everReturnMaturePct != null ? `${Math.round(lt.stay.everReturnMaturePct * 100)}%` : "—"} ever came back for a second term.${lt.stay.longestRun ? ` Longest unbroken run: ${lt.stay.longestRun.team}, ${lt.stay.longestRun.terms} terms.` : ""}`);
  const ret = lt.retention.filter((r) => r.hasData && r.rate != null).slice(-8);
  if (ret.length) lines.push(`- Retention term to term (teams back the next term): ${ret.map((r) => `${r.label} ${Math.round((r.rate ?? 0) * 100)}% (${r.cameBack} of ${r.prevTeams})`).join(" · ")}. Best: ${lt.retentionBest.join(", ")}. Worst: ${lt.retentionWorst.join(", ")}.`);
  const l = lt.ltv;
  lines.push(`- Lifetime value per team: revenue mean ${l.meanRevenueCents != null ? dollars(l.meanRevenueCents) : "—"}, median ${l.medianRevenueCents != null ? dollars(l.medianRevenueCents) : "—"} incl GST (${l.teams} teams); gross profit after referees mean ${l.meanLtgpCents != null ? dollars(l.meanLtgpCents) : "—"}; contribution per team-term ${l.contributionPerTeamTermCents != null ? dollars(l.contributionPerTeamTermCents) : "—"}; forward LTGP at today's price and retention ${l.forwardLtgpCents != null ? dollars(l.forwardLtgpCents) : "—"} (${num(l.forwardTerms)} terms at ${l.recentRetention != null ? Math.round(l.recentRetention * 100) : "—"}% retention).`);
  if (lt.formats.length) lines.push(`- By format: ${lt.formats.map((f) => `${f.label} ${f.entries} entries${f.avgListCents != null ? `, list ${dollars(f.avgListCents)}` : ""}`).join(" · ")}.`);
  const rows = acq.rows.filter((r) => r.newTeams > 0 || r.spendCents != null).slice(-6);
  if (rows.length) lines.push(`- Acquisition (ad spend ÷ new teams): ${rows.map((r) => `${r.label}: ${r.newTeams} new teams, spend ${r.spendCents != null ? dollars(r.spendCents) : "not recorded"}, CAC ${r.cacCents != null ? dollars(r.cacCents) : "—"}, LTGP:CAC ${r.ltgpCacRatio != null ? `${Math.round(r.ltgpCacRatio * 10) / 10}:1` : "—"}`).join(" · ")}. ${acq.ltgpBasis}`);
  if (lt.notes.length) lines.push(`Notes: ${lt.notes.slice(0, 4).join(" ")}`);
  lines.push("Same figures as ClubOS → Mini Football Leagues → Analytics → Lifetime and Acquisition. The customer is the TEAM (the captain who enters and pays); money is what the card was charged, incl GST.");
  return { text: lines.join("\n") };
}

// ── person_history ───────────────────────────────────────────────────────────
export async function runPersonHistory(viewer: Viewer, input: any): Promise<ToolResult> {
  const s = await scopeFor(viewer, input);
  if (!s.ok) return { text: s.text };
  const { orgId, orgName } = s.scope;
  if (orgId !== 1) return { text: `A person's ten-year history is built for Christchurch United today (that is where the migrated Friendly Manager and Xero records live). ${orgName} people are on the Contacts page.` };
  const name = String(input?.name ?? "").trim();
  if (name.length < 2) return { text: "Give me a name to look up." };
  const { searchPeople } = await import("./family-routes");
  const { resolvePeopleHistory } = await import("./person-history");
  const { rows, total } = await searchPeople(name, "all", 6, 0);
  if (!rows.length) return { text: `Nobody called "${name}" in the club's records (contacts or camp children).` };
  const contactIds = rows.filter((r) => r.kind === "contact").map((r) => Number(r.id));
  const childIds = rows.filter((r) => r.kind === "child").map((r) => Number(r.id));
  const { byContact, byChild } = await resolvePeopleHistory(contactIds, childIds);
  const today = nzToday();
  const ageOf = (dob: any) => { if (!dob) return null; const d = String(dob).slice(0, 10); let a = Number(today.slice(0, 4)) - Number(d.slice(0, 4)); if (today.slice(5) < d.slice(5)) a--; return a; };
  const lines: string[] = [];
  lines.push(`**${rows.length}${total > rows.length ? ` of ${total}` : ""} people match "${name}"** (${orgName}):`);
  for (const r of rows.slice(0, 5)) {
    const h = r.kind === "contact" ? byContact.get(Number(r.id)) : byChild.get(Number(r.id));
    const who = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
    const age = ageOf(r.date_of_birth);
    const head = `- **${who}** (${r.kind === "child" ? "camp child" : r.type}${age != null ? `, ${age}` : ""}; [open their page](https://app.usg.co.nz/admin/people/${r.kind}-${r.id}))`;
    if (!h || (!h.programmes.length && !h.payments.length)) { lines.push(`${head}: nothing on their record yet.`); continue; }
    const t = h.totals;
    lines.push(`${head}: ${t.programmeCount} programme record${t.programmeCount === 1 ? "" : "s"} across ${t.termCount} term${t.termCount === 1 ? "" : "s"}, seasons ${t.seasons.length ? t.seasons.join(", ") : "—"}; ${dollars(t.paidCents)} paid over ${t.paymentCount} payment${t.paymentCount === 1 ? "" : "s"}${t.refundedCents ? ` (${dollars(t.refundedCents)} refunded)` : ""}; first ${t.firstActivity ?? "—"}, last ${t.lastActivity ?? "—"}.`);
    const byYear = new Map<string, string[]>();
    for (const p of h.programmes) {
      const y = p.seasonYear ? String(p.seasonYear) : (p.termLabel && /20\d{2}/.exec(p.termLabel)?.[0]) || (p.registeredAt ?? "").slice(0, 4) || "undated";
      const label = `${p.programme}${p.termLabel && !p.programme.includes(p.termLabel) ? ` (${p.termLabel})` : ""}${p.chargedCents != null && p.chargedCents > 0 ? ` ${whole(p.chargedCents)}` : ""}${p.status && p.status !== "confirmed" ? ` [${p.status}]` : ""}`;
      (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(label);
    }
    for (const [y, items] of Array.from(byYear.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10)) {
      const uniq = Array.from(new Set(items));
      lines.push(`  - ${y}: ${uniq.slice(0, 8).join(" · ")}${uniq.length > 8 ? ` · +${uniq.length - 8} more` : ""}`);
    }
  }
  if (rows.length > 5) lines.push(`…and ${rows.length - 5} more matches — give me a surname or a first and last name to narrow it.`);
  lines.push("Money is what the records show was paid (Friendly Manager, Xero invoices, ClubOS); a family-level payment under a parent's name shows on the parent, not the child. Same data as the person's page in ClubOS → Contacts.");
  return { text: lines.join("\n") };
}

export const HISTORY_TOOL_HANDLERS: Record<string, (viewer: Viewer, input: any) => Promise<ToolResult>> = {
  camp_history: runCampHistory,
  programme_history: runProgrammeHistory,
  customer_lifetime: runCustomerLifetime,
  league_lifetime: runLeagueLifetime,
  person_history: runPersonHistory,
};

// Used by the test harness to warm the engine without going through a tool.
export async function warmHistory(orgId = 1) {
  await getYouthDataset(orgId);
  await rowsOf(await db.execute(sql`SELECT 1`));
}
