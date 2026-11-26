// Apply migrations/2026-11-26_cic_packages_groups.sql (several age groups, one
// deposit), rehearsing first.
//
//   npx tsx --env-file=.env script/apply-cic-packages-groups.ts            (dry run, rolled back)
//   npx tsx --env-file=.env script/apply-cic-packages-groups.ts --commit
//
// Proves on a throwaway group of two teams inside the transaction: the group
// payment + a deposit row per team are accepted; a second PAID group deposit, a
// group link on a non-deposit row, and a team deposit that isn't 10% are refused;
// paying the group flips every team's deposit and paidToward sees it.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };
async function refuse(c: pg.Client, label: string, sql: string, p: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, p); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — ALLOWED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(`refused: ${label}`); }
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");
  try {
    await c.query(readFileSync(join(process.cwd(), "migrations/2026-11-26_cic_packages_groups.sql"), "utf8"));
    ok("migration ran");
    for (const t of ["cic_pkg_groups", "cic_pkg_group_payments"]) {
      const r = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname=$1`, [t]);
      r.rows[0]?.relrowsecurity ? ok(`RLS on ${t}`) : bad(`RLS OFF on ${t}`);
    }

    // A throwaway group of two teams (rolled back at the end, even with --commit).
    await c.query("SAVEPOINT probe");
    const g = (await c.query(
      `INSERT INTO cic_pkg_groups (organization_id, token, club_name, manager_name, manager_email, manager_phone, deposit_cents, expires_at)
       VALUES (5, 'probe' || md5(random()::text), 'Probe FC', 'Probe', 'probe@example.com', '0210000000', 3000, now() + interval '14 days') RETURNING id`,
    )).rows[0].id;
    const mk = async (age: string, invoice: number) => (await c.query(
      `INSERT INTO cic_pkg_bookings (organization_id, token, join_token, club_name, manager_name, manager_email, manager_phone,
         origin, package_id, age_group, players, staff, adults, input, lines, total_cents, flights_cents, invoice_cents,
         deposit_cents, per_player_cents, player_share_cents, per_adult_cents, terms_accepted_at, expires_at, group_id)
       VALUES (5, md5(random()::text), md5(random()::text), 'Probe FC', 'Probe', 'probe@example.com', '0210000000',
         'north', 'base', $1, 13, 2, 0, '{}', '[]', $2::int, 0, $2::int, round($2::numeric/10), 100, 0, 0, now(), now() + interval '14 days', $3) RETURNING id`,
      [age, invoice, g])).rows[0].id;
    const b1 = await mk("U12", 10000), b2 = await mk("U14", 20000);
    const gp = (await c.query(`INSERT INTO cic_pkg_group_payments (group_id, amount_cents, stripe_payment_intent_id) VALUES ($1, 3000, 'pi_probe_' || md5(random()::text)) RETURNING id`, [g])).rows[0].id;
    await c.query(`INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, group_payment_id) VALUES ($1,'deposit',1000,$3), ($2,'deposit',2000,$3)`, [b1, b2, gp]);
    ok("group charge + a deposit row per team accepted");
    await refuse(c, "a team deposit that isn't 10%", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, group_payment_id) VALUES ($1,'deposit',999,$2)`, [b1, gp]);
    await refuse(c, "a group link on a non-deposit row", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, group_payment_id) VALUES ($1,'balance',500,$2)`, [b1, gp]);
    // Pay the group: the same three updates markGroupPaid runs.
    await c.query(`UPDATE cic_pkg_group_payments SET paid_at=now() WHERE id=$1`, [gp]);
    await c.query(`UPDATE cic_pkg_payments SET paid_at=now() WHERE group_payment_id=$1`, [gp]);
    await c.query(`UPDATE cic_pkg_bookings SET deposit_paid_at=now() WHERE group_id=$1`, [g]);
    const paid = (await c.query(`SELECT booking_id, sum(amount_cents)::int s FROM cic_pkg_payments WHERE booking_id IN ($1,$2) AND paid_at IS NOT NULL GROUP BY booking_id ORDER BY booking_id`, [b1, b2])).rows;
    paid.length === 2 && paid[0].s === 1000 && paid[1].s === 2000 ? ok("paying the group pays each team its own 10%") : bad(`team paid sums wrong: ${JSON.stringify(paid)}`);
    await refuse(c, "a second PAID deposit for the group", `INSERT INTO cic_pkg_group_payments (group_id, amount_cents, paid_at) VALUES ($1, 3000, now())`, [g]);
    await refuse(c, "a second PAID deposit on a team", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, paid_at) VALUES ($1,'deposit',1000, now())`, [b1]);
    const instal = await c.query(`SAVEPOINT i`).then(() => c.query(`INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents) VALUES ($1,'instalment',3000) RETURNING id`, [b1]))
      .then(() => { ok("an instalment on a group team after the group deposit"); }).catch((e) => bad(`instalment refused: ${e.message}`));
    void instal;
    await c.query("ROLLBACK TO SAVEPOINT probe");
    const left = (await c.query(`SELECT count(*)::int n FROM cic_pkg_groups WHERE club_name='Probe FC'`)).rows[0].n;
    left === 0 ? ok("probe rows gone") : bad("probe rows left behind");
  } catch (e: any) {
    bad(`crashed: ${e.message}`);
  }
  if (COMMIT && problems.length === 0) { await c.query("COMMIT"); console.log(`\nCOMMITTED. ${checks} checks.`); }
  else { await c.query("ROLLBACK"); console.log(`\n${problems.length ? "FAILED" : "Dry run OK"}, rolled back. ${checks} checks, ${problems.length} problems.`); }
  await c.end();
  process.exit(problems.length ? 1 : 0);
}
main();
