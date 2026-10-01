// The Stripe → Xero account map, moved onto Victor's restructured chart (Sep 2026).
//
// Every row says where it came from: OLGA = how she has hand-coded Stripe payouts
// since the restructure (read from Xero, 1–25 Sep 2026), or CHART = Victor's
// chart where she has not coded that thing yet. Dry run by default.
//   npx tsx --env-file=.env script/update-xero-payout-map-2026-10.ts [--commit]
import { Pool } from "pg";
const COMMIT = process.argv.includes("--commit");
const ORG = 1;
type Row = { category: string; program_id: number | null; comp?: number; code: string | null; tax: string | null; why: string };
const ROWS: Row[] = [
  // ── programmes, by id ────────────────────────────────────────────────────
  { category: "academy_term", program_id: 4,  code: "200/05", tax: "OUTPUT2", why: "OLGA: FUNiño 'FS - T4' → 200/05 on 21–25 Sep" },
  { category: "academy_term", program_id: 5,  code: "113-02", tax: "OUTPUT2", why: "OLGA: 'Tech - T4' → 113-02 on 22 Sep (113 once, 23 Sep); 113-02 is Technification" },
  { category: "academy_term", program_id: 16, code: "101",    tax: "OUTPUT2", why: "CHART: Pre-Academy → 101 Registration Fees - Academy (Olga codes parents, e.g. 103/104). Per age 101-02-0x exists if wanted" },
  { category: "academy_term", program_id: 17, code: "101",    tax: "OUTPUT2", why: "CHART: Academy U13–U17 → 101" },
  { category: "academy_term", program_id: 19, code: "113-04", tax: "OUTPUT2", why: "CHART: GK Technification" },
  { category: "academy_term", program_id: 20, code: "113-01", tax: "OUTPUT2", why: "CHART: Morning Session" },
  { category: "academy_other", program_id: 58, code: "113-03", tax: "OUTPUT2", why: "CHART: Football Institute" },
  { category: "academy_term", program_id: 44, code: "104",    tax: "OUTPUT2", why: "OLGA: Mini Football → 104 (Ballers U9 is an MFL product)" },
  { category: "academy_term", program_id: 45, code: "104",    tax: "OUTPUT2", why: "OLGA: Mini Football → 104 (Ballers U10)" },
  { category: "academy_term", program_id: 46, code: "104",    tax: "OUTPUT2", why: "OLGA: Mini Football → 104 (Ballers U11)" },
  { category: "academy_term", program_id: 47, code: "104",    tax: "OUTPUT2", why: "OLGA: Mini Football → 104 (Ballers U12)" },
  { category: "academy_camp", program_id: 30, code: "103",    tax: "OUTPUT2", why: "OLGA: holiday camps 'T3 HP' → 103 on every entry 3–25 Sep" },
  { category: "academy_camp", program_id: 39, code: "103",    tax: "OUTPUT2", why: "OLGA: holiday camps → 103" },
  { category: "academy_camp", program_id: 15, code: "103",    tax: "OUTPUT2", why: "OLGA: holiday camps → 103 (SIU camp)" },
  // Team Pay competitions (program_id = teampay competition id)
  { category: "tournament_team",   program_id: null, comp: 18, code: "102-02-01", tax: "OUTPUT2", why: "CHART: CIC 7s Competitive (Open). ⚠ Olga used 307/03 (an EXPENSE account at INPUT2) — income belongs here" },
  { category: "tournament_player", program_id: null, comp: 18, code: "102-02-01", tax: "OUTPUT2", why: "CHART: CIC 7s Open, player share" },
  { category: "tournament_team",   program_id: null, comp: 20, code: "102-02-02", tax: "OUTPUT2", why: "CHART: CIC 7s Social" },
  { category: "tournament_player", program_id: null, comp: 20, code: "102-02-02", tax: "OUTPUT2", why: "CHART: CIC 7s Social, player share" },
  { category: "tournament_team",   program_id: null, comp: 8,  code: "102-02-03", tax: "OUTPUT2", why: "CHART: Ethnic Tournament" },
  { category: "tournament_player", program_id: null, comp: 8,  code: "102-02-03", tax: "OUTPUT2", why: "CHART: Ethnic Tournament, player share" },
  // ── category fallbacks ──────────────────────────────────────────────────
  { category: "academy_term",      program_id: null, code: "101",    tax: "OUTPUT2", why: "CHART: any other academy term → 101" },
  { category: "academy_other",     program_id: null, code: "113",    tax: "OUTPUT2", why: "CHART: other programmes → 113" },
  { category: "academy_camp",      program_id: null, code: "103",    tax: "OUTPUT2", why: "OLGA: holiday camps → 103" },
  { category: "league_team",       program_id: null, code: "104",    tax: "OUTPUT2", why: "OLGA: MFL → 104 on every entry" },
  { category: "league_player",     program_id: null, code: "104",    tax: "OUTPUT2", why: "OLGA: MFL → 104" },
  { category: "facility_hire",     program_id: null, code: "106",    tax: "OUTPUT2", why: "OLGA: 'Facility Hire' → 106 at OUTPUT2 (23–24 Sep) — replaces 301, an expense account" },
  { category: "tournament_team",   program_id: null, code: "102",    tax: "OUTPUT2", why: "CHART: Tournaments Income" },
  { category: "tournament_player", program_id: null, code: "102",    tax: "OUTPUT2", why: "CHART: Tournaments Income" },
  { category: "shop",              program_id: null, code: "105-01", tax: "OUTPUT2", why: "CHART: CUFC Merchandise (the ClubOS shop)" },
  { category: "invoice",           program_id: null, code: "200/11", tax: "OUTPUT2", why: "unchanged: Event Revenue, still active" },
  { category: "club_event",        program_id: null, code: "112-10", tax: "OUTPUT2", why: "CHART: Ticket Sales (Club Dinner)" },
  { category: "membership",        program_id: null, code: "112-09", tax: "OUTPUT2", why: "CHART: SIU Membership Programme" },
  { category: "print",             program_id: null, code: "330/3",  tax: "OUTPUT2", why: "CHART: United Print Sales" },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  for (const r of ROWS) {
    const cur = (await c.query(
      `SELECT id, xero_account_code, xero_tax_type FROM xero_account_map
        WHERE organization_id=$1 AND category=$2 AND program_id IS NOT DISTINCT FROM $3
          AND teampay_competition_id IS NOT DISTINCT FROM $4`, [ORG, r.category, r.program_id, r.comp ?? null])).rows[0];
    const was = cur ? `${cur.xero_account_code ?? "—"}/${cur.xero_tax_type ?? "—"}` : "(none)";
    const now = `${r.code}/${r.tax}`;
    if (was !== now) console.log(`  ${r.category.padEnd(18)} ${String(r.program_id ?? (r.comp ? "c" + r.comp : "*")).padEnd(4)} ${was.padEnd(18)} → ${now.padEnd(18)} ${r.why}`);
    if (cur) {
      await c.query(`UPDATE xero_account_map SET xero_account_code=$1, xero_tax_type=$2, evidence=$3, confirmed_by=$4, confirmed_at=now(), updated_at=now() WHERE id=$5`,
        [r.code, r.tax, r.why, "Daniel (2026-10-02, from Olga's Sep entries + Victor's chart)", cur.id]);
    } else {
      await c.query(`INSERT INTO xero_account_map (organization_id, category, program_id, teampay_competition_id, xero_account_code, xero_tax_type, evidence, confirmed_by, confirmed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`, [ORG, r.category, r.program_id, r.comp ?? null, r.code, r.tax, r.why, "Daniel (2026-10-02, from Olga's Sep entries + Victor's chart)"]);
    }
  }
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(COMMIT ? "\nCommitted." : "\nDry run — rolled back. --commit to apply.");
} catch (e: any) { await c.query("ROLLBACK"); console.error(e.message); process.exit(1); }
finally { c.release(); await pool.end(); }
