// What one person's record actually looks like across all four systems.
//
// Daniel, 2026-09-11: "we now need to clean up this shopify data and then we
// should have a full unification, migration and merge between all of our
// databases of all time — clubos, fm, xero, and shopify."
//
// This measures, it never writes. Three questions:
//   1. How many duplicate people are there really, and which are SAFE to merge?
//   2. What is already unified, and what is genuinely still missing?
//   3. What would a merge move, and what would it have to ask a human?
//
//   npx tsx --env-file=.env script/analyse-people-unification.ts
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
pg.types.setTypeParser(1082, (v: string) => v);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
const n = (x: any) => Number(x ?? 0);
const $ = (c: any) => `$${n(c).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

async function main() {
  const out: any = { generated: new Date().toISOString() };

  // ── 1. WHAT IS ALREADY UNIFIED ────────────────────────────────────────────
  console.log(`\n${"═".repeat(74)}\n  WHAT IS ALREADY IN CLUBOS\n${"═".repeat(74)}`);
  const sources = await q(`
    SELECT source, count(*)::int rows, count(DISTINCT contact_id)::int people,
           (sum(amount_cents)/100.0) amt, min(paid_on)::text first, max(paid_on)::text last
    FROM fm_payment_history GROUP BY 1 ORDER BY 4 DESC NULLS LAST`);
  for (const s of sources)
    console.log(`  ${String(s.source).padEnd(17)} ${String(s.rows).padStart(6)} payments · ${String(s.people).padStart(5)} people · ${$(s.amt).padStart(12)} · ${s.first} → ${s.last}`);
  const live = await q(`SELECT count(*)::int rows, count(DISTINCT contact_id)::int people, (sum(total_cents)/100.0) amt
    FROM registrations WHERE status IN ('confirmed','refunded','partially_refunded')`);
  console.log(`  ${"live registrations".padEnd(17)} ${String(live[0].rows).padStart(6)} rows     · ${String(live[0].people).padStart(5)} people · ${$(live[0].amt).padStart(12)}`);
  out.sources = sources;

  // ── 2. THE DUPLICATE PEOPLE, SPLIT BY HOW SAFE A MERGE IS ─────────────────
  // A group is: records sharing a FULL NAME that also share a guardian (by
  // guardian record or by the guardian's email — the Shopify import made new
  // guardian records too, so a shared id alone would miss half of them).
  console.log(`\n${"═".repeat(74)}\n  DUPLICATE PEOPLE\n${"═".repeat(74)}`);
  const groups = await q(`
    WITH linked AS (
      SELECT p.id AS person, lower(trim(p.first_name))||' '||lower(trim(p.last_name)) AS who,
             p.date_of_birth AS dob, p.tags,
             coalesce(lower(nullif(trim(g.email),'')), 'gid:'||g.id::text) AS family
      FROM contact_relationships cr
      JOIN contacts p ON p.id = cr.player_id AND p.merged_into_contact_id IS NULL
      JOIN contacts g ON g.id = cr.guardian_id
    ),
    grouped AS (
      SELECT who, family, count(DISTINCT person)::int records,
             count(DISTINCT dob) FILTER (WHERE dob IS NOT NULL)::int distinct_dobs,
             count(DISTINCT person) FILTER (WHERE dob IS NULL)::int no_dob,
             array_agg(DISTINCT person ORDER BY person) AS ids
      FROM linked WHERE who <> ' ' GROUP BY who, family HAVING count(DISTINCT person) > 1)
    SELECT * FROM grouped ORDER BY records DESC`);

  const tierA = groups.filter((g: any) => n(g.distinct_dobs) <= 1);
  const tierB = groups.filter((g: any) => n(g.distinct_dobs) > 1);
  const recs = (gs: any[]) => gs.reduce((a, g) => a + n(g.records), 0);
  console.log(`  ${groups.length} groups · ${recs(groups)} contact records · ${recs(groups) - groups.length} records would disappear\n`);
  console.log(`  🟢 SAFE   ${String(tierA.length).padStart(4)} groups (${recs(tierA)} records) — one date of birth between them, or none`);
  console.log(`  🔴 ASK    ${String(tierB.length).padStart(4)} groups (${recs(tierB)} records) — the records disagree on the child's date of birth`);
  console.log(`\n  biggest:`);
  for (const g of groups.slice(0, 8))
    console.log(`    ${String(g.who).padEnd(24)} ×${String(g.records).padStart(2)}  ${n(g.distinct_dobs) > 1 ? "🔴 DOB conflict" : "🟢"}  (${String(g.family).slice(0, 34)})`);
  out.groups = { total: groups.length, records: recs(groups), safe: tierA.length, ask: tierB.length, detail: groups };

  // ── 3. WHAT A MERGE WOULD MOVE ───────────────────────────────────────────
  const ids = groups.flatMap((g: any) => g.ids);
  const survivors = groups.map((g: any) => g.ids[0]);
  const losers = ids.filter((i: number) => !survivors.includes(i));
  console.log(`\n${"═".repeat(74)}\n  WHAT A MERGE WOULD MOVE\n${"═".repeat(74)}`);
  const fks = await q(`
    SELECT tc.table_name tbl, kcu.column_name col FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY' AND ccu.table_name='contacts' AND ccu.column_name='id' AND tc.table_name<>'contacts'`);
  let moved = 0;
  for (const f of fks) {
    const r = await q(`SELECT count(*)::int n FROM "${f.tbl}" WHERE "${f.col}" = ANY($1::int[])`, [losers]).catch(() => [{ n: 0 }]);
    if (n(r[0].n)) { console.log(`  ${`${f.tbl}.${f.col}`.padEnd(42)} ${String(r[0].n).padStart(6)} rows move`); moved += n(r[0].n); }
  }
  console.log(`  ${"".padEnd(42)} ${String(moved).padStart(6)} total`);
  const money = await q(`SELECT count(*)::int rows, (sum(amount_cents)/100.0) amt FROM fm_payment_history WHERE contact_id = ANY($1::int[])`, [losers]);
  console.log(`\n  ${$(money[0].amt)} of payment history currently sits on a record that is not the child's main one.`);
  console.log(`  🔴 That money is NOT double-counted and NOT lost — it is SPLIT, so a family's own`);
  console.log(`     history reads short and the same child shows up several times in a search.`);
  out.move = { losers: losers.length, rows: moved, moneyOnLosers: n(money[0].amt) };

  // Would any LIVE registration collide (one child, one programme, one term, twice)?
  const coll = await q(`
    SELECT count(*)::int n FROM (
      SELECT 1 FROM registrations r JOIN contacts c ON c.id = r.contact_id
      WHERE c.id = ANY($1::int[]) AND r.status IN ('confirmed','refunded','partially_refunded')
      GROUP BY r.program_id, r.term_id, lower(c.first_name)||' '||lower(c.last_name)
      HAVING count(*) > 1) x`, [ids]);
  console.log(`  ${coll[0].n} live registration(s) would collapse (the same child on one programme/term twice).`);
  out.collisions = n(coll[0].n);

  // ── 4. WHAT IS GENUINELY STILL MISSING ───────────────────────────────────
  console.log(`\n${"═".repeat(74)}\n  WHAT IS STILL MISSING\n${"═".repeat(74)}`);
  const xeroYears = await q(`
    SELECT season_year, count(*)::int payments, (sum(amount_cents)/100.0) amt
    FROM fm_payment_history WHERE source='xero' GROUP BY 1 ORDER BY 1`);
  const regYears = await q(`
    SELECT t.year, count(*)::int regs FROM registrations r JOIN terms t ON t.id=r.term_id
    WHERE r.status IN ('confirmed','refunded','partially_refunded') GROUP BY 1 ORDER BY 1`);
  const byYear = new Map(regYears.map((r: any) => [n(r.year), n(r.regs)]));
  console.log(`  Xero money is in for every year; live REGISTRATIONS exist only where noted:\n`);
  for (const y of xeroYears)
    console.log(`    ${y.season_year}: ${String(y.payments).padStart(5)} payments ${$(y.amt).padStart(11)}   registrations: ${byYear.get(n(y.season_year)) ?? 0}`);
  const orphanPay = await q(`SELECT count(*)::int n FROM fm_payment_history WHERE contact_id IS NULL`);
  console.log(`\n  payments not attached to any person: ${orphanPay[0].n}`);
  out.years = { xero: xeroYears, registrationsByYear: [...byYear] };

  mkdirSync("outputs/people-unification", { recursive: true });
  writeFileSync("outputs/people-unification/analysis.json", JSON.stringify(out, null, 1));
  console.log(`\n  full detail → outputs/people-unification/analysis.json\n`);
  await pool.end();
}
main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });
