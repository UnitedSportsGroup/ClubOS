// Xero coding map — the tool Daniel maps Xero account codes to ClubOS units with.
//
//   npx tsx --env-file=.env script/xero-coding-map/server.ts      → http://localhost:4777
//
// Local only (binds 127.0.0.1). Reads the live Xero chart of accounts through
// ClubOS's own Xero connection, reads what ClubOS sells from the production
// database, and writes ONE table: `xero_sale_map`. Nothing here posts to Xero.
//
// Three screens: Map (every sellable unit → a Xero code) · Xero codes (the live
// chart, with what is mapped to each) · Deposits (every Stripe payout ClubOS
// has posted, with what Xero holds for it today — reconciled or not).

import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { execFileSync } from "node:child_process";
const ROOT = (() => {   // the AIOS workspace root, whether this runs from apps/clubos or a worktree under it
  let d = process.cwd();
  for (let i = 0; i < 8; i++) { if (fs.existsSync(path.join(d, "scripts", "xero_chain.py"))) return d; d = path.dirname(d); }
  throw new Error("could not find the AIOS workspace root (scripts/xero_chain.py) above " + process.cwd());
})();
const FIN_GET = path.join(ROOT, "scripts", "xero_fin_get.py");
const CACHE_DIR = path.join(ROOT, "outputs", "xero-coding-map");
/**
 * 🔴 Every Xero READ here goes through the FINANCE app ("CUFC Finance Reports"),
 * never ClubOS's app. ClubOS's app shares its 5,000/day with the hourly poster on
 * Fly and was exhausted at 3pm on 2026-10-25 — the page loaded and showed nothing.
 * A tool on Daniel's Mac must not compete with production for the same allowance.
 */
function finGet(xeroPath: string): any {
  const out = execFileSync("python3", [FIN_GET, xeroPath], { encoding: "utf8", timeout: 60_000, env: { ...process.env } });
  const j = JSON.parse(out);
  if (j?.error) throw new Error(`Xero (finance app) ${xeroPath}: ${j.error}${j.retry_after ? ` — resets in ${j.retry_after}s` : ""}`);
  return j;
}
import { detailCodeFor, AGE_BANDS } from "../../shared/xero-detail-codes";

const PORT = Number(process.env.XERO_MAP_PORT || 4777);
const ORG = 1;
const here = (() => { try { return path.dirname(fileURLToPath(import.meta.url)); } catch { return path.join(process.cwd(), "script", "xero-coding-map"); } })();
const INDEX = [path.join(here, "index.html"), path.join(process.cwd(), "script", "xero-coding-map", "index.html")].find((f) => { return fs.existsSync(f); }) ?? path.join(process.cwd(), "script", "xero-coding-map", "index.html");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (text: string, params: any[] = []) => (await pool.query(text, params)).rows as any[];

// ── Xero chart (cached 10 min) ──────────────────────────────────────────────
type Acc = { code: string; name: string; type: string; cls: string; status: string; taxType: string | null; description: string | null; id: string; bankAccountNumber?: string | null };
let chartCache: { at: number; accs: Acc[]; source: string } | null = null;
let chartNote = "";
function mapAccounts(raw: any[]): Acc[] {
  return raw.map((a: any) => ({
    code: String(a.Code ?? a.code ?? ""), name: String(a.Name ?? a.name ?? ""), type: String(a.Type ?? a.type ?? ""), cls: String(a.Class ?? a._class ?? a.class ?? ""),
    status: String(a.Status ?? a.status ?? ""), taxType: (a.TaxType ?? a.taxType) ? String(a.TaxType ?? a.taxType) : null,
    description: (a.Description ?? a.description) ? String(a.Description ?? a.description) : null,
    id: String(a.AccountID ?? a.accountID ?? ""), bankAccountNumber: a.BankAccountNumber ?? a.bankAccountNumber ?? null,
  })).filter((a) => a.code);
}
async function chart(force = false): Promise<Acc[]> {
  if (!force && chartCache && Date.now() - chartCache.at < 10 * 60_000) return chartCache.accs;
  const cacheFile = path.join(CACHE_DIR, "chart.json");
  try {
    const j = finGet("/Accounts");
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(j));
    chartCache = { at: Date.now(), accs: mapAccounts(j.Accounts ?? []), source: "live" };
    chartNote = "";
    return chartCache.accs;
  } catch (e: any) {
    if (!fs.existsSync(cacheFile)) throw new Error(`could not read the Xero chart of accounts and there is no cached copy: ${e?.message ?? e}`);
    const j = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    const at = fs.statSync(cacheFile).mtime;
    chartCache = { at: Date.now(), accs: mapAccounts(j.Accounts ?? []), source: "cache" };
    chartNote = `Xero could not be reached just now (${String(e?.message ?? e).slice(0, 160)}) — showing the chart of accounts saved at ${at.toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" })}.`;
    return chartCache.accs;
  }
}

// ── What ClubOS sells ───────────────────────────────────────────────────────
type Unit = {
  kind: "program_option" | "program_age" | "program" | "league_division" | "teampay_competition" | "category" | "fee";
  id: string; name: string; sub?: string | null; group: string; parent?: { kind: string; id: string } | null;
  programId?: number | null; programType?: string | null; inactive?: boolean;
  sales120?: { n: number; cents: number } | null; now?: string | null; nowWhy?: string | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  academy_term: "Academy — term programmes (any programme not mapped below)",
  academy_camp: "Holiday camps (any camp not mapped below)",
  academy_other: "Academy — other programmes (any not mapped below)",
  league_team: "Mini Football — team entry (any division not mapped below)",
  league_player: "Mini Football — player share (any division not mapped below)",
  tournament_team: "Tournaments — team entry (any competition not mapped below)",
  tournament_player: "Tournaments — player share (any competition not mapped below)",
  club_event: "Club events — tickets (Club Dinner)",
  membership: "Memberships",
  facility_hire: "Facility hire (United Sports Centre bookings)",
  shop: "Merchandise / shop orders",
  print: "United Prints orders",
  invoice: "Invoices paid by card (sponsorship, rebates)",
  gymnastics: "United Gymnastics (own Stripe account — never in this payout)",
  unallocated: "Stripe — anything ClubOS cannot identify",
};

async function loadMap() {
  const rows = await q(`SELECT * FROM xero_account_map WHERE organization_id=$1`, [ORG]);
  const byCategory = new Map<string, any>(), byProgram = new Map<string, any>(), byCompetition = new Map<string, any>();
  for (const r of rows) {
    if (r.program_id != null) byProgram.set(`${r.category}:${r.program_id}`, r);
    else if (r.teampay_competition_id != null) byCompetition.set(`${r.category}:${r.teampay_competition_id}`, r);
    else byCategory.set(r.category, r);
  }
  return { byCategory, byProgram, byCompetition };
}

function categoryOf(programType: string | null, scheduleType: string | null): string {
  if (programType === "holiday_camp") return "academy_camp";
  if (programType === "league_team") return "league_team";
  if (programType === "academy") return scheduleType === "term" ? "academy_term" : "academy_other";
  return "academy_other";
}

async function loadUnits(): Promise<Unit[]> {
  const map = await loadMap();
  const live = new Set((await chart()).filter((a) => a.status === "ACTIVE").map((a) => a.code));
  const units: Unit[] = [];
  const nowFor = (cat: string, progId: number | null, compId: number | null, det: any | null) => {
    const rule = (progId != null && map.byProgram.get(`${cat}:${progId}`)) || (compId != null && map.byCompetition.get(`${cat}:${compId}`)) || map.byCategory.get(cat);
    const fine = det ? detailCodeFor(det) : null;
    if (fine && live.has(fine)) return { code: fine, why: "age / camp / format rule in code" };
    if (rule?.xero_account_code) return { code: rule.xero_account_code, why: rule.program_id != null ? "programme row in xero_account_map" : rule.teampay_competition_id != null ? "competition row in xero_account_map" : "category default" };
    return { code: null, why: "nothing — this would BLOCK the payout" };
  };

  // Sales in the last 120 days, so the rows that carry money stand out.
  const salesByOption = new Map<number, { n: number; cents: number }>(), salesByProgram = new Map<number, { n: number; cents: number }>(), salesByDivision = new Map<number, { n: number; cents: number }>();
  for (const r of await q(`SELECT program_id, program_option_id, league_division_id, count(*)::int n, coalesce(sum(total_cents),0)::bigint cents
      FROM registrations WHERE stripe_payment_intent_id IS NOT NULL AND status IN ('confirmed','refunded','partially_refunded')
       AND registered_at > now() - interval '120 days' GROUP BY 1,2,3`)) {
    const v = { n: Number(r.n), cents: Number(r.cents) };
    if (r.program_option_id != null) salesByOption.set(Number(r.program_option_id), add(salesByOption.get(Number(r.program_option_id)), v));
    if (r.league_division_id != null) salesByDivision.set(Number(r.league_division_id), add(salesByDivision.get(Number(r.league_division_id)), v));
    if (r.program_id != null) salesByProgram.set(Number(r.program_id), add(salesByProgram.get(Number(r.program_id)), v));
  }
  try {
    for (const r of await q(`SELECT s.league_division_id d, s.program_id p, count(*)::int n, coalesce(sum(m.charged_cents),0)::bigint cents
        FROM split_members m JOIN split_sessions s ON s.id = m.split_session_id
       WHERE m.stripe_payment_intent_id IS NOT NULL AND m.paid_at > now() - interval '120 days' GROUP BY 1,2`)) {
      const v = { n: Number(r.n), cents: Number(r.cents) };
      if (r.d != null) salesByDivision.set(Number(r.d), add(salesByDivision.get(Number(r.d)), v));
      if (r.p != null) salesByProgram.set(Number(r.p), add(salesByProgram.get(Number(r.p)), v));
    }
  } catch (e: any) { console.warn("split_members stats skipped:", e.message); }
  const salesByComp = new Map<number, { n: number; cents: number }>();
  try {
    for (const r of await q(`SELECT te.competition_id c, count(*)::int n, coalesce(sum(tp.paid_cents),0)::bigint cents
        FROM teampay_players tp JOIN teampay_entries te ON te.id = tp.entry_id
       WHERE tp.stripe_payment_intent_id IS NOT NULL AND tp.paid_at > now() - interval '120 days' GROUP BY 1`))
      salesByComp.set(Number(r.c), { n: Number(r.n), cents: Number(r.cents) });
    for (const r of await q(`SELECT competition_id c, count(*)::int n, coalesce(sum(team_paid_cents),0)::bigint cents
        FROM teampay_entries WHERE team_stripe_payment_intent_id IS NOT NULL AND team_paid_at > now() - interval '120 days' GROUP BY 1`))
      salesByComp.set(Number(r.c), add(salesByComp.get(Number(r.c)), { n: Number(r.n), cents: Number(r.cents) }));
  } catch (e: any) { console.warn("teampay stats skipped:", e.message); }

  const progs = await q(`SELECT p.*, o.name org FROM programs p LEFT JOIN organizations o ON o.id = p.organization_id ORDER BY p.organization_id, p.type, p.id`);
  const opts = await q(`SELECT * FROM program_options ORDER BY program_id, display_order, id`);
  const divs = await q(`SELECT d.*, p.id program_id, p.name program_name FROM league_divisions d
      JOIN league_competitions lc ON lc.id = d.competition_id LEFT JOIN programs p ON p.league_competition_id = lc.id ORDER BY p.id NULLS LAST, d.id`);
  const comps = await q(`SELECT * FROM teampay_competitions ORDER BY id`);
  const year = new Date().getFullYear();

  for (const p of progs) {
    const cat = categoryOf(p.type, p.schedule_type);
    const group = p.type === "holiday_camp" ? "Holiday camps" : p.type === "league_team" ? "Mini Football Leagues" : /ballers/i.test(p.name) ? "Mini Football Leagues" : "Academy";
    const hasSales = (salesByProgram.get(p.id)?.n ?? 0) > 0;
    if (!p.is_active && !hasSales) continue;   // dead programmes with no money in 120 days stay out of the way
    const det = { programId: p.id, programName: p.name, programType: p.type, optionName: null, dob: null, seasonYear: p.season_year ?? year, divisionName: null };
    const now = nowFor(cat, p.id, null, det);
    units.push({ kind: "program", id: String(p.id), name: p.name, sub: `${p.org ?? ""} · ${p.type.replace("_", " ")}${p.academy_section ? ` · ${p.academy_section}` : ""}${p.is_active ? "" : " · INACTIVE"}`,
      group, programId: p.id, programType: p.type, inactive: !p.is_active, sales120: salesByProgram.get(p.id) ?? null, now: now.code, nowWhy: now.why });
    // Age groups inside a programme whose Xero codes are per age.
    const band = AGE_BANDS[p.id] ?? (p.id === 15 ? { lo: 13, hi: 17, label: "SIU camp", code: () => "" } : null);
    if (band) for (let g = band.lo; g <= band.hi; g++) {
      const d2 = { ...det, optionName: `U${g}` };
      const n2 = nowFor(cat, p.id, null, d2);
      units.push({ kind: "program_age", id: `${p.id}:${g}`, name: `U${g}`, sub: "age group (worked out from the player's date of birth)", group, parent: { kind: "program", id: String(p.id) },
        programId: p.id, programType: p.type, now: n2.code, nowWhy: n2.why });
    }
    for (const o of opts.filter((x) => x.program_id === p.id)) {
      if (!o.is_active && !(salesByOption.get(o.id)?.n)) continue;
      const d3 = { ...det, optionName: o.name };
      const n3 = nowFor(cat, p.id, null, d3);
      units.push({ kind: "program_option", id: String(o.id), name: o.name, sub: `option · $${(o.full_price_cents / 100).toFixed(0)}${o.is_active ? "" : " · INACTIVE"}`, group, parent: { kind: "program", id: String(p.id) },
        programId: p.id, programType: p.type, inactive: !o.is_active, sales120: salesByOption.get(o.id) ?? null, now: n3.code, nowWhy: n3.why });
    }
    if (p.type === "league_team") for (const d of divs.filter((x) => x.program_id === p.id)) {
      const d4 = { ...det, divisionName: d.name };
      const n4 = nowFor("league_team", p.id, null, d4);
      units.push({ kind: "league_division", id: String(d.id), name: d.name, sub: `division · team $${(d.team_cost_cents / 100).toFixed(0)}`, group, parent: { kind: "program", id: String(p.id) },
        programId: p.id, programType: p.type, sales120: salesByDivision.get(d.id) ?? null, now: n4.code, nowWhy: n4.why });
    }
  }
  for (const c of comps) {
    if (c.kind !== "tournament") continue;
    const n = nowFor("tournament_team", null, c.id, null);
    units.push({ kind: "teampay_competition", id: String(c.id), name: c.name, sub: `${c.slug} · $${(c.fee_cents / 100).toFixed(0)} a team · ${c.brand}`, group: "Tournaments (Team Pay)",
      sales120: salesByComp.get(c.id) ?? null, now: n.code, nowWhy: n.why });
  }
  for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
    const n = nowFor(key, null, null, null);
    units.push({ kind: "category", id: key, name: label, sub: `category · ${key}`, group: "Everything else (by kind of sale)", now: n.code, nowWhy: n.why });
  }
  units.push({ kind: "fee", id: "stripe_fee", name: "Stripe fee (the negative line on every deposit)", sub: "fee · GST on expenses", group: "Fees", now: "484/01", nowWhy: "constant in the poster" });
  return units;
}
const add = (a: { n: number; cents: number } | undefined, b: { n: number; cents: number }) => ({ n: (a?.n ?? 0) + b.n, cents: (a?.cents ?? 0) + b.cents });

// ── Deposits: what ClubOS posted and what Xero holds for it today ───────────
let depositCache: { at: number; rows: any[] } | null = null;
async function deposits(force = false) {
  if (!force && depositCache && Date.now() - depositCache.at < 10 * 60_000) return depositCache.rows;
  const posts = await q(`SELECT id, stripe_payout_id, to_char(arrival_date AT TIME ZONE 'Pacific/Auckland','YYYY-MM-DD') nz, payout_cents, status, xero_bank_txn_id, posted_at, split_json
      FROM xero_payout_posts WHERE stripe_account='club' AND stripe_payout_id LIKE 'po\\_%' AND stripe_payout_id <> 'po_test_1' ORDER BY arrival_date DESC LIMIT 40`);
  const out: any[] = [];
  const xeroDate = (d: any) => { const m = /\/Date\((\d+)/.exec(String(d ?? "")); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d ?? "").slice(0, 10); };
  for (const p of posts) {
    let xeroDoc: any = null;
    if (p.xero_bank_txn_id) {
      try {
        const j = finGet(`/BankTransactions/${p.xero_bank_txn_id}`);
        const t: any = j.BankTransactions?.[0];
        if (t) xeroDoc = { status: t.Status, reconciled: !!t.IsReconciled, date: xeroDate(t.DateString ?? t.Date), total: Number(t.Total), reference: t.Reference ?? "",
          lines: (t.LineItems ?? []).map((l: any) => ({ code: l.AccountCode, tax: l.TaxType, amount: Number(l.LineAmount), description: l.Description })) };
      } catch (e: any) { xeroDoc = { error: String(e?.message ?? e).slice(0, 200) }; }
    }
    const s = p.split_json ?? {};
    out.push({ id: p.id, payoutId: p.stripe_payout_id, date: p.nz, payoutCents: Number(p.payout_cents), status: p.status, xeroId: p.xero_bank_txn_id, postedAt: p.posted_at,
      invoiced: [...(s.invoiced ?? []), ...((s.toInvoice ?? []).map((v: any) => ({ invoiceNumber: "raised at post time", child: v.child, amountCents: v.amountCents, alreadyPaid: false })))], plannedLines: s.lines ?? [], xero: xeroDoc,
      url: p.xero_bank_txn_id ? `https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=${p.xero_bank_txn_id}` : null });
  }
  depositCache = { at: Date.now(), rows: out };
  return out;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
// 🔴 Not sendFile: the worktree lives under ".worktrees", and `send` refuses any path with a dot-directory in it (404, no message).
app.get("/", (_req, res) => res.type("html").send(fs.readFileSync(INDEX, "utf8")));
app.get("/api/state", async (_req, res) => {
  try {
    const [accs, units, rows] = await Promise.all([chart(), loadUnits(), q(`SELECT * FROM xero_sale_map WHERE organization_id=$1`, [ORG])]);
    res.json({ chart: accs, units, map: rows, chartNote, generatedAt: new Date().toISOString() });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
});
app.post("/api/chart/refresh", async (_req, res) => { try { res.json({ chart: await chart(true) }); } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); } });
app.get("/api/deposits", async (req, res) => { try { res.json({ deposits: await deposits(req.query.force === "1") }); } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); } });
app.post("/api/map", async (req, res) => {
  try {
    const { kind, id, code, tax, label, note } = req.body ?? {};
    if (!kind || !id) return res.status(400).json({ error: "kind and id are required" });
    if (code) {
      const acc = (await chart()).find((a) => a.code === code && a.status === "ACTIVE");
      if (!acc) return res.status(400).json({ error: `${code} is not an active account in Xero` });
      const taxType = tax || acc.taxType || (acc.cls === "REVENUE" ? "OUTPUT2" : "INPUT2");
      await q(`INSERT INTO xero_sale_map (organization_id, unit_kind, unit_id, xero_account_code, xero_tax_type, line_label, note, set_by, set_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'Daniel (coding map tool)',now(),now())
               ON CONFLICT (organization_id, unit_kind, unit_id) DO UPDATE SET xero_account_code=EXCLUDED.xero_account_code, xero_tax_type=EXCLUDED.xero_tax_type,
                 line_label=EXCLUDED.line_label, note=EXCLUDED.note, set_by=EXCLUDED.set_by, set_at=now(), updated_at=now()`,
        [ORG, kind, String(id), code, taxType, label || null, note || null]);
    } else {
      await q(`DELETE FROM xero_sale_map WHERE organization_id=$1 AND unit_kind=$2 AND unit_id=$3`, [ORG, kind, String(id)]);
    }
    res.json({ map: await q(`SELECT * FROM xero_sale_map WHERE organization_id=$1`, [ORG]) });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
});
app.post("/api/map/accept-current", async (_req, res) => {
  // Start from what the poster does TODAY, so the exercise is "fix what is wrong", not "type 60 codes".
  try {
    const units = await loadUnits();
    const accs = await chart();
    let n = 0;
    for (const u of units) {
      if (!u.now) continue;
      const acc = accs.find((a) => a.code === u.now && a.status === "ACTIVE");
      if (!acc) continue;
      const taxType = u.kind === "fee" ? "INPUT2" : (acc.taxType || "OUTPUT2");
      await q(`INSERT INTO xero_sale_map (organization_id, unit_kind, unit_id, xero_account_code, xero_tax_type, set_by, set_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,'Daniel (accepted current)',now(),now())
               ON CONFLICT (organization_id, unit_kind, unit_id) DO NOTHING`, [ORG, u.kind, u.id, u.now, taxType]);
      n++;
    }
    res.json({ accepted: n, map: await q(`SELECT * FROM xero_sale_map WHERE organization_id=$1`, [ORG]) });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? String(e) }); }
});

// Loopback only, on BOTH address families: a browser may resolve "localhost" to ::1 first.
app.listen(PORT, "127.0.0.1", () => console.log(`Xero coding map → http://localhost:${PORT}`));
try { app.listen(PORT, "::1", () => console.log(`Xero coding map → http://[::1]:${PORT}`)); } catch { /* no IPv6 loopback on this machine */ }
