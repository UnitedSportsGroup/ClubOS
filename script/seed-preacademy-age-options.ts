/**
 * Pre-Academy (programme `pre-academy-u9-u12`) — sell it as FOUR age groups.
 *
 *   npx tsx --env-file=.env script/seed-preacademy-age-options.ts            # dry run (default)
 *   npx tsx --env-file=.env script/seed-preacademy-age-options.ts --commit
 *   npx tsx --env-file=.env script/seed-preacademy-age-options.ts --revert --commit
 *
 * Daniel, 2026-09-19: the Term 4 landing page and ads offer Under-9, Under-10,
 * Under-11 and Under-12, and in Term 4 each age trains as ONE group (Paul,
 * 18 Sep: "U9 training group, U10 training group…"). The programme sold two
 * paired options — "U9–U10" and "U11–U12" — so a registration could not say
 * which group a child belongs to, and the roll could not be filled from it.
 *
 * 🔴 NO PRICE IS STATED IN THIS FILE. Each new option COPIES its price, schedule
 * text, session count and pricing model from the live paired option it splits
 * (U9 + U10 ← "U9–U10"; U11 + U12 ← "U11–U12"). The same family pays the same
 * fee for the same sessions; only the label is narrower. Only Ryan approves fees.
 *
 * The paired options are RETIRED (is_active = false), never deleted: every
 * registration already sold on them keeps pointing at a real row.
 *
 * Idempotent on (program_id, name). One transaction. Verifies itself before
 * committing and rolls back on any surprise.
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const REVERT = process.argv.includes("--revert");
const SLUG = "pre-academy-u9-u12";

// new option name → the paired option it splits (matched by NAME, not id, so
// this reads the same on any database)
const SPLIT: { name: string; from: string; order: number }[] = [
  { name: "U9", from: "U9–U10", order: 0 },
  { name: "U10", from: "U9–U10", order: 1 },
  { name: "U11", from: "U11–U12", order: 2 },
  { name: "U12", from: "U11–U12", order: 3 },
];

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
let failed = 0;
const check = (ok: boolean, label: string) => { console.log(`${ok ? "  ✅" : "  ❌"} ${label}`); if (!ok) failed++; };

try {
  await c.query("BEGIN");
  const prog = (await c.query(`select id, name, organization_id from programs where slug = $1`, [SLUG])).rows[0];
  if (!prog) throw new Error(`programme ${SLUG} not found`);
  console.log(`\nProgramme ${prog.id} "${prog.name}" (org ${prog.organization_id}) — ${REVERT ? "REVERT" : "SPLIT"} · ${COMMIT ? "COMMIT" : "dry run"}\n`);

  const before = (await c.query(`select id, name, full_price_cents, is_active from program_options where program_id = $1 order by display_order, id`, [prog.id])).rows;
  console.log("Before:"); console.table(before);

  if (REVERT) {
    await c.query(`update program_options set is_active = true where program_id = $1 and name = any($2)`, [prog.id, [...new Set(SPLIT.map((s) => s.from))]]);
    await c.query(`update program_options set is_active = false where program_id = $1 and name = any($2)`, [prog.id, SPLIT.map((s) => s.name)]);
  } else {
    for (const s of SPLIT) {
      const src = (await c.query(`select * from program_options where program_id = $1 and name = $2`, [prog.id, s.from])).rows[0];
      if (!src) throw new Error(`source option "${s.from}" not found — refusing to guess a price`);
      if (!(src.full_price_cents > 0)) throw new Error(`source option "${s.from}" has no price — refusing to create an unpriced option`);
      const existing = (await c.query(`select id from program_options where program_id = $1 and name = $2`, [prog.id, s.name])).rows[0];
      if (existing) {
        await c.query(
          `update program_options set description = $2, schedule_text = $3, full_price_cents = $4, pricing_model = $5,
                  session_count = $6, allow_pay_weekly = $7, weekly_price_cents = $8, display_order = $9, is_active = true
            where id = $1`,
          [existing.id, src.description, src.schedule_text, src.full_price_cents, src.pricing_model, src.session_count, src.allow_pay_weekly, src.weekly_price_cents, s.order],
        );
      } else {
        await c.query(
          `insert into program_options (program_id, name, description, schedule_text, full_price_cents, pricing_model,
                                        session_count, allow_pay_weekly, weekly_price_cents, display_order, is_active)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
          [prog.id, s.name, src.description, src.schedule_text, src.full_price_cents, src.pricing_model, src.session_count, src.allow_pay_weekly, src.weekly_price_cents, s.order],
        );
      }
    }
    await c.query(`update program_options set is_active = false, display_order = display_order + 10
                    where program_id = $1 and name = any($2) and is_active = true`, [prog.id, [...new Set(SPLIT.map((s) => s.from))]]);
  }

  const after = (await c.query(`select id, name, schedule_text, full_price_cents, session_count, display_order, is_active from program_options where program_id = $1 order by is_active desc, display_order, id`, [prog.id])).rows;
  console.log("\nAfter:"); console.table(after);

  console.log("Checks:");
  const active = after.filter((o) => o.is_active);
  if (!REVERT) {
    check(active.length === 4, `exactly four options on sale (found ${active.length})`);
    check(active.map((o) => o.name).join(",") === "U9,U10,U11,U12", `on sale, in order: ${active.map((o) => o.name).join(", ")}`);
    for (const s of SPLIT) {
      const n = after.find((o) => o.name === s.name), f = after.find((o) => o.name === s.from);
      check(!!n && !!f && n.full_price_cents === f.full_price_cents && n.schedule_text === f.schedule_text && n.session_count === f.session_count,
        `${s.name} carries exactly what "${s.from}" carried ($${((n?.full_price_cents ?? 0) / 100).toFixed(2)})`);
    }
    check(after.filter((o) => !o.is_active).length >= 2, "paired options retired, not deleted");
  } else {
    check(active.length === 2, `two paired options back on sale (found ${active.length})`);
  }
  const orphans = (await c.query(`select count(*)::int n from registrations r where r.program_id = $1 and r.program_option_id is not null
                                   and not exists (select 1 from program_options o where o.id = r.program_option_id)`, [prog.id])).rows[0].n;
  check(orphans === 0, `no registration points at a missing option (${orphans})`);

  if (failed) throw new Error(`${failed} check(s) failed`);
  if (COMMIT) { await c.query("COMMIT"); console.log("\n🟢 COMMITTED"); }
  else { await c.query("ROLLBACK"); console.log("\n(dry run — rolled back; pass --commit to apply)"); }
} catch (e: any) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("\n🔴 ROLLED BACK:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
