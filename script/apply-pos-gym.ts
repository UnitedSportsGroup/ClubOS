// Apply migrations/2026-11-16_pos_gym.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-pos-gym.ts             (dry run)
//   npx tsx --env-file=.env script/apply-pos-gym.ts --commit
//
// Every invariant is proven by a write the database must REFUSE.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-16_pos_gym.sql"), "utf8");
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) throw new Error("The migration carries its own BEGIN/COMMIT — that defeats the dry run.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`\n  pos gym — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  const problems: string[] = [];
  const ok = (l: string, c: boolean, d = "") => { console.log(`  ${c ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); if (!c) problems.push(l); };
  const refused = async (l: string, stmt: string, params: unknown[] = []) => {
    await client.query("SAVEPOINT p");
    try { await client.query(stmt, params); await client.query("RELEASE SAVEPOINT p"); ok(l, false, "ACCEPTED"); }
    catch (e: any) { await client.query("ROLLBACK TO SAVEPOINT p"); ok(l, true, String(e?.message).slice(0, 80)); }
  };
  const accepted = async (l: string, stmt: string, params: unknown[] = []) => {
    await client.query("SAVEPOINT p");
    try { const r = await client.query(stmt, params); await client.query("RELEASE SAVEPOINT p"); ok(l, true); return r; }
    catch (e: any) { await client.query("ROLLBACK TO SAVEPOINT p"); ok(l, false, String(e?.message).slice(0, 80)); return null; }
  };
  try {
    const before = await client.query(`select (select count(*) from pos_sale_lines)::int lines, (select count(*) from cugc_registrations)::int regs, (select count(*) from cugc_registrations where status='paid')::int paid`);
    await client.query(sql);
    await client.query(sql); // idempotent: a second run must change nothing and not fail
    console.log("  migration ran (twice)");
    const after = await client.query(`select (select count(*) from pos_sale_lines)::int lines, (select count(*) from cugc_registrations)::int regs, (select count(*) from cugc_registrations where status='paid')::int paid`);
    ok("no line or registration added, removed or re-stated", JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]), JSON.stringify(after.rows[0]));
    const cols = await client.query(`select column_name from information_schema.columns where table_name='cugc_registrations' and column_name in ('pos_sale_id','payment_method','served_by_user_id')`);
    ok("cugc_registrations gained its three columns", cols.rows.length === 3);

    // A sale to hang lines off: the register's org is the gym, so the sale banks cugc.
    const [{ id: uid }] = (await client.query(`select id from users where active order by id limit 1`)).rows;
    const gym = await client.query(`select o.id from organizations o join pos_org_money_accounts m on m.organization_id = o.id where m.account = 'cugc' limit 1`);
    const club = await client.query(`select o.id from organizations o join pos_org_money_accounts m on m.organization_id = o.id where m.account = 'club' order by o.id limit 1`);
    ok("the gym banks with its own account in pos_org_money_accounts", gym.rows.length === 1);
    const reg = await client.query(`insert into pos_registers (name, default_org_id, created_by_user_id) values ('gym probe', $1, $2) returning id`, [gym.rows[0].id, uid]);
    const shift = await client.query(`insert into pos_shifts (register_id, opened_by_user_id, opening_float_cents) values ($1, $2, 0) returning id`, [reg.rows[0].id, uid]);
    const sale = await client.query(`insert into pos_sales (register_id, shift_id, money_account, served_by_user_id) values ($1, $2, 'cugc', $3) returning id`, [reg.rows[0].id, shift.rows[0].id, uid]);
    const clubSale = await client.query(`insert into pos_sales (register_id, shift_id, money_account, served_by_user_id) values ($1, $2, 'club', $3) returning id`, [reg.rows[0].id, shift.rows[0].id, uid]);
    const row = await client.query(`insert into cugc_registrations (organization_id, program_slug, program_name, option_label, price_cents, full_price_cents, term, gymnast_name, parent_name, email, status) values ($1,'gymplay','GymPlay','1–2 sessions per week',16500,16500,'Term 4 2026','Probe Child','Probe Parent','probe@example.com','pending_payment') returning id`, [gym.rows[0].id]);
    const rid = row.rows[0].id;

    await refused("a gym line with no registration is refused",
      `insert into pos_sale_lines (sale_id, kind, organization_id, title, unit_cents, qty, line_cents) values ($1, 'cugc_registration', $2, 'x', 100, 1, 100)`, [sale.rows[0].id, gym.rows[0].id]);
    await refused("a kit line naming a gym registration is refused",
      `insert into pos_sale_lines (sale_id, kind, organization_id, cugc_registration_id, title, unit_cents, qty, line_cents) values ($1, 'custom', $2, $3, 'x', 100, 1, 100)`, [sale.rows[0].id, gym.rows[0].id, rid]);
    await refused("a gym line on a sale that banks with the CLUB is refused (the one-account rule)",
      `insert into pos_sale_lines (sale_id, kind, organization_id, cugc_registration_id, title, unit_cents, qty, line_cents) values ($1, 'cugc_registration', $2, $3, 'x', 16500, 1, 16500)`, [clubSale.rows[0].id, gym.rows[0].id, rid]);
    await accepted("a gym line on a gym-account sale is accepted",
      `insert into pos_sale_lines (sale_id, kind, organization_id, cugc_registration_id, title, unit_cents, qty, line_cents) values ($1, 'cugc_registration', $2, $3, 'GymPlay', 16500, 1, 16500)`, [sale.rows[0].id, gym.rows[0].id, rid]);
    await refused("the same registration on a second line is refused",
      `insert into pos_sale_lines (sale_id, kind, organization_id, cugc_registration_id, title, unit_cents, qty, line_cents) values ($1, 'cugc_registration', $2, $3, 'GymPlay', 16500, 1, 16500)`, [sale.rows[0].id, gym.rows[0].id, rid]);
    await refused("deleting a registration a line names is refused",
      `delete from cugc_registrations where id = $1`, [rid]);
    await refused("a registration served by a person who does not exist is refused",
      `update cugc_registrations set served_by_user_id = -1 where id = $1`, [rid]);
    await accepted("a registration can name its sale, tender and server",
      `update cugc_registrations set pos_sale_id = $1, payment_method = 'bank_transfer', served_by_user_id = $2 where id = $3`, [sale.rows[0].id, uid, rid]);

    if (problems.length) throw new Error(`${problems.length} check(s) failed: ${problems.join("; ")}`);
    await client.query("ROLLBACK");
    if (!COMMIT) { console.log("\n  DRY RUN — rolled back. All checks passed.\n"); return; }
    await client.query("BEGIN"); await client.query(sql); await client.query("COMMIT");
    console.log("\n  COMMITTED — migration applied (rehearsal passed, then the DDL alone).\n");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED:", (e as Error).message, "\n"); process.exit(1);
  } finally { await client.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
