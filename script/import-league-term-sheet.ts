// Load one of Isaac's MFL term team spreadsheets into league_term_sheet_rows.
//
//   npx tsx --env-file=.env script/import-league-term-sheet.ts <file.xlsx> <term e.g. 2025-T4> [--commit]
//
// Dry-run by default (applies the migration and the rows inside a transaction,
// prints them, rolls back). Re-running replaces that file's rows for that term.
//
// Each league tab is a list of teams (Team · Captain · Email · Phone · … ·
// Payment Type), then a blank-ish "Premiership | Championship" split. The list
// ends at that row; the split only sets each team's tier. Only the league tabs
// are read — the Referees tab (bank accounts, home addresses) is never opened.
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import * as XLSX from "xlsx";

const [file, term] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const COMMIT = process.argv.includes("--commit");
if (!file || !/^\d{4}-T[1-4]$/.test(term || "")) {
  console.error("usage: import-league-term-sheet.ts <file.xlsx> <YYYY-Tn> [--commit]");
  process.exit(1);
}
const MFL_ORG = 3;
// Tabs that are leagues. Anything else (Weekly Payers, Individual Players, Referees, Blacklist) is skipped.
const LEAGUE_TAB = /cage|5s|7s|5's|7's|a-side|aside|youth/i;
const SKIP_TAB = /referee|weekly pay|individual|blacklist/i;

const clean = (v: unknown) => (v == null || v === false || v === true ? null : String(v).replace(/[‪‬]/g, "").replace(/ /g, " ").trim() || null);

type Row = { league: string; team: string; captain: string | null; email: string | null; phone: string | null; payment: string | null; discount: string | null; discountType: string | null; related: string | null; tier: string | null; sourceRow: number };

const wb = XLSX.read(fs.readFileSync(file));
const rows: Row[] = [];
for (const tab of wb.SheetNames) {
  if (SKIP_TAB.test(tab) || !LEAGUE_TAB.test(tab)) continue;
  const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, raw: true, defval: null });
  const head = (grid[0] || []).map((h) => String(h ?? "").trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const cCap = col(/^captain|^parent/), cEmail = col(/^email/), cPhone = col(/^phone/), cPay = col(/^payment/);
  const cDisc = col(/^discount$/), cDiscType = col(/^discount type/), cRel = col(/^related/);
  const listed: Row[] = [];
  let i = 1;
  for (; i < grid.length; i++) {
    const r = grid[i] || [];
    const team = clean(r[0]);
    if (!team) continue;
    if (/^premiership$/i.test(team)) break; // the tier split starts here
    listed.push({
      league: tab.trim(), team: team.replace(/\s+-\s+.*$/, "").trim(), // "Bayer Neverlosin - Tier two, play casino …" → name
      captain: clean(r[cCap]), email: clean(r[cEmail])?.toLowerCase() ?? null, phone: clean(r[cPhone]),
      payment: cPay >= 0 ? clean(r[cPay]) : null, discount: cDisc >= 0 ? clean(r[cDisc]) : null,
      discountType: cDiscType >= 0 ? clean(r[cDiscType]) : null, related: cRel >= 0 ? clean(r[cRel]) : null,
      tier: null, sourceRow: i + 1,
    });
  }
  // Tier split: column A = Premiership, the next non-empty column = Championship.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (i = i + 1; i < grid.length; i++) {
    const cells = (grid[i] || []).map(clean);
    const prem = cells[0], champ = cells.slice(1, 3).find(Boolean) ?? null;
    for (const [name, tier] of [[prem, "Premiership"], [champ, "Championship"]] as const) {
      if (!name) continue;
      const hit = listed.find((x) => norm(x.team) === norm(name) || norm(x.team).startsWith(norm(name)) || norm(name).startsWith(norm(x.team)));
      if (hit && !hit.tier) hit.tier = tier;
    }
  }
  rows.push(...listed);
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    await c.query(fs.readFileSync(path.resolve(process.cwd(), "migrations/2026-10-30_league_term_sheet_rows.sql"), "utf8"));
    const src = path.basename(file);
    await c.query(`DELETE FROM league_term_sheet_rows WHERE organization_id=$1 AND term=$2 AND source_file=$3`, [MFL_ORG, term, src]);
    for (const r of rows)
      await c.query(
        `INSERT INTO league_term_sheet_rows (organization_id, term, league, team_name, captain, email, phone, payment_type, discount, discount_type, related_team, tier, source_file, source_row)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [MFL_ORG, term, r.league, r.team, r.captain, r.email, r.phone, r.payment, r.discount, r.discountType, r.related, r.tier, src, r.sourceRow],
      );
    const byLeague: Record<string, number> = {};
    for (const r of rows) byLeague[r.league] = (byLeague[r.league] || 0) + 1;
    console.log(`${rows.length} team entries from ${src} for ${term}:`, byLeague);
    console.log(`distinct team names: ${new Set(rows.map((r) => r.team.toLowerCase().replace(/[^a-z0-9]/g, ""))).size}`);
    const rls = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='league_term_sheet_rows'`);
    if (!rls.rows[0]?.relrowsecurity) throw new Error("RLS is not on");
    if (COMMIT) { await c.query("COMMIT"); console.log("🟢 COMMITTED"); }
    else { await c.query("ROLLBACK"); console.log("↩️  rolled back (rehearsal) — add --commit"); }
  } catch (e: any) {
    await c.query("ROLLBACK");
    console.error("FATAL", e?.message);
    process.exit(1);
  } finally { await c.end(); }
})();
