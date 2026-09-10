// Give every registration the TERM it is for.
//
// Daniel, 2026-09-10, of the FUNiño Players tab showing 151 people: "make sure
// you got a term selector here for term 1, term 2, term 3 and term 4 2026...
// only show corresponding registrations... I feel like you putting the term 4
// ones all in here now which is wrong imo."
//
// He was right. `registrations` carried no term, so the tab listed every
// registration ever taken and added the money up across two terms.
// `programs.term_id` cannot answer it either: that is the term a programme is
// selling RIGHT NOW and is flipped when a term opens, so reading it would
// rewrite history at every flip — which is exactly why the column was left off
// in the first place.
//
// 🔴 THE BACKFILL ONLY WRITES WHAT IT CAN JUSTIFY. Three rules, in order, and
// anything none of them settles is left NULL and reads "not recorded" rather
// than being filed under a real term on a guess.
//
//   1. STATED. The Friendly Manager and Xero imports wrote the term into
//      `notes` ("Term 3 2026 (20 Jul – 25 Sep) · …"). That is a fact somebody
//      recorded, so it wins outright.
//
//   2. PAID FOR. A term registration is for the sessions it bought. This club
//      charges the full term price for the first `prorata_grace_weeks` weeks
//      and pro-rates after that (Olga's rule), so inside a term's window:
//        · a REDUCED price is the remaining sessions of the term running now;
//        · the FULL price once that term is past its grace window is the NEXT
//          term — nobody pays for ten sessions when two are left.
//      Verified against the real rows: #707 is $48 and its own note says "Paid
//      for Pro rata Term 3", while the four $160 rows on 9–10 Sep are Term 4
//      sign-ups taken the day Term 4 opened.
//
//   3. IN THE WINDOW. Registered before a term starts, or inside it while it is
//      still at full price → that term.
//
// Dry run (default):  npx tsx --env-file=.env script/apply-registration-terms.ts
// Apply:              npx tsx --env-file=.env script/apply-registration-terms.ts --commit
import "dotenv/config";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

type Term = { id: number; org: number; year: number; num: number; name: string; start: string; end: string };

function isoOf(v: any): string {
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (sql: string, p: any[] = []) => (await c.query(sql, p)).rows;

  let failures = 0;
  const check = (ok: boolean, label: string) => {
    console.log(`  ${ok ? "ok  " : "✗   "}${label}`);
    if (!ok) failures++;
  };

  try {
    await c.query("BEGIN");

    // ── the column ───────────────────────────────────────────────────────────
    await c.query(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS term_id integer`);
    await c.query(`
      DO $$ BEGIN
        ALTER TABLE registrations ADD CONSTRAINT registrations_term_id_fkey
          FOREIGN KEY (term_id) REFERENCES terms(id);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    // The tab filters on it constantly, and it is always read beside the programme.
    await c.query(`CREATE INDEX IF NOT EXISTS registrations_program_term_idx ON registrations (program_id, term_id)`);

    const col = (await q(`SELECT data_type, is_nullable, column_default FROM information_schema.columns
                          WHERE table_name='registrations' AND column_name='term_id'`))[0];
    check(!!col, "term_id exists");
    check(col?.is_nullable === "YES", "nullable — 'we don't know' is a real answer");
    check(col?.column_default === null, "no default — nothing is filed under a term by accident");

    // ── the data ─────────────────────────────────────────────────────────────
    const terms: Term[] = (await q(
      `SELECT id, organization_id org, year, term_number num, COALESCE(name, 'Term ' || term_number) name,
              start_date, end_date FROM terms ORDER BY organization_id, year, term_number`,
    )).map((t: any) => ({ ...t, start: isoOf(t.start_date), end: isoOf(t.end_date) }));

    const regs = await q(`
      SELECT r.id, r.program_id, r.registered_at, r.total_cents, r.notes, r.legacy_source,
             p.organization_id AS org, p.term_id AS program_term_id, p.schedule_type,
             COALESCE(p.prorata_grace_weeks, 0) AS grace,
             p.term_price_cents
      FROM registrations r
      JOIN programs p ON p.id = r.program_id
      WHERE p.schedule_type = 'term'
      ORDER BY r.id`);

    const decisions = new Map<number, { termId: number | null; why: string }>();
    for (const r of regs as any[]) {
      const mine = terms.filter((t) => t.org === r.org);
      const when = r.registered_at ? isoOf(r.registered_at) : null;

      // 1. STATED — the importer wrote it down.
      const m = /Term\s+(\d)\s+(\d{4})/i.exec(String(r.notes ?? ""));
      if (m) {
        const t = mine.find((x) => x.num === Number(m[1]) && x.year === Number(m[2]));
        if (t) { decisions.set(r.id, { termId: t.id, why: `stated in notes: ${m[0]}` }); continue; }
      }

      if (!when) { decisions.set(r.id, { termId: null, why: "no registration date" }); continue; }

      // 2/3. PAID FOR, then IN THE WINDOW.
      const inWindow = mine.find((t) => when >= t.start && when <= t.end);
      const next = mine.filter((t) => t.start > when).sort((a, b) => a.start.localeCompare(b.start))[0];

      if (inWindow) {
        const graceEnds = addDaysIso(inWindow.start, Number(r.grace) * 7);
        const full = Number(r.term_price_cents ?? 0);
        const paidFull = full > 0 && Number(r.total_cents) >= full;
        if (when > graceEnds && paidFull && next) {
          decisions.set(r.id, { termId: next.id, why: `full price ($${(full / 100).toFixed(2)}) after ${inWindow.name} went pro-rata → ${next.name}` });
        } else {
          decisions.set(r.id, { termId: inWindow.id, why: `registered inside ${inWindow.name}` });
        }
        continue;
      }
      if (next) { decisions.set(r.id, { termId: next.id, why: `between terms → next is ${next.name}` }); continue; }
      decisions.set(r.id, { termId: null, why: "no term covers this date" });
    }

    // ── report before writing ────────────────────────────────────────────────
    const byTerm = new Map<string, number>();
    for (const [, d] of decisions) {
      const label = d.termId ? (terms.find((t) => t.id === d.termId)!.year + " " + terms.find((t) => t.id === d.termId)!.name) : "not recorded";
      byTerm.set(label, (byTerm.get(label) ?? 0) + 1);
    }
    console.log(`\n${decisions.size} term registrations across every term programme:`);
    for (const [label, n] of [...byTerm].sort()) console.log(`   ${String(n).padStart(5)}  ${label}`);

    const flips = [...decisions].filter(([, d]) => /full price/.test(d.why));
    if (flips.length) {
      console.log(`\n${flips.length} row(s) assigned to the NEXT term because they paid full price late in the current one:`);
      for (const [id, d] of flips.slice(0, 12)) console.log(`   #${id}  ${d.why}`);
    }

    // ── write ────────────────────────────────────────────────────────────────
    let written = 0;
    for (const [id, d] of decisions) {
      if (d.termId == null) continue;
      await c.query(`UPDATE registrations SET term_id = $1 WHERE id = $2 AND term_id IS DISTINCT FROM $1`, [d.termId, id]);
      written++;
    }
    console.log(`\n  ${written} row(s) stamped, ${decisions.size - written} left "not recorded".`);

    // ── prove it ─────────────────────────────────────────────────────────────
    const stated = await q(`
      SELECT count(*)::int n FROM registrations r
      WHERE r.notes ILIKE '%Term 3 2026%' AND r.term_id IS NOT NULL
        AND r.term_id <> (SELECT id FROM terms WHERE organization_id=1 AND year=2026 AND term_number=3)`);
    check(Number(stated[0].n) === 0, "no row that SAYS Term 3 2026 was filed under another term");

    const orphan = await q(`
      SELECT count(*)::int n FROM registrations r JOIN programs p ON p.id=r.program_id
      JOIN terms t ON t.id = r.term_id WHERE t.organization_id <> p.organization_id`);
    check(Number(orphan[0].n) === 0, "no registration points at another workspace's term");

    const funino = await q(`
      SELECT COALESCE(t.year || ' ' || COALESCE(t.name,'Term '||t.term_number), 'not recorded') label,
             count(*)::int n, SUM(r.total_cents)::bigint cents
      FROM registrations r LEFT JOIN terms t ON t.id = r.term_id
      WHERE r.program_id = 4 AND r.status = 'confirmed' GROUP BY 1 ORDER BY 1`);
    console.log("\n  FUNiño confirmed, by term — what the Players tab will now show:");
    for (const f of funino as any[]) console.log(`    ${String(f.n).padStart(4)}  $${(Number(f.cents) / 100).toFixed(2).padStart(10)}  ${f.label}`);
    check(funino.length > 1, "FUNiño is no longer one undivided list");

    if (failures) throw new Error(`${failures} check(s) failed`);

    if (COMMIT) { await c.query("COMMIT"); console.log("\nCOMMITTED."); }
    else { await c.query("ROLLBACK"); console.log("\nDRY RUN — rolled back. Re-run with --commit to apply."); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((e) => { console.error("\n✗", e.message ?? e); process.exit(1); });
