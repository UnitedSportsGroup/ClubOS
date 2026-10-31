// Apply migrations/2026-10-31_pos_counter_till.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-pos-counter-till.ts             (dry run)
//   npx tsx --env-file=.env script/apply-pos-counter-till.ts --commit
//
// Every invariant is proven by a write the database must REFUSE.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-31_pos_counter_till.sql"), "utf8");
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) throw new Error("The migration carries its own BEGIN/COMMIT — that defeats the dry run.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`\n  pos counter till — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
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
    const before = await client.query(`select count(*)::int n from pos_counter_devices`);
    await client.query(sql);
    await client.query(sql); // idempotent: a second run must change nothing and not fail
    console.log("  migration ran (twice)");

    const r = await client.query(`select relrowsecurity from pg_class where relname = 'pos_staff_pins'`);
    ok("pos_staff_pins exists with RLS on", r.rows[0]?.relrowsecurity === true);
    const after = await client.query(`select count(*)::int n from pos_counter_devices`);
    ok("no device row added or removed", before.rows[0].n === after.rows[0].n);
    const unlocked = await client.query(`select count(*)::int n from pos_counter_devices where till_user_id is not null`);
    ok("every existing device starts LOCKED", unlocked.rows[0].n === 0);

    const [{ id: uid }] = (await client.query(`select id from users where active order by id limit 1`)).rows;
    await refused("a PIN stored in plain text (no s1$ hash) is refused",
      `insert into pos_staff_pins (user_id, pin_hash) values ($1, '1234')`, [uid]);
    await accepted("a hashed PIN is accepted",
      `insert into pos_staff_pins (user_id, pin_hash) values ($1, 's1$salt$abcd')`, [uid]);
    await refused("a second PIN row for the same person is refused",
      `insert into pos_staff_pins (user_id, pin_hash) values ($1, 's1$salt$ef01')`, [uid]);
    await refused("a negative wrong-try count is refused",
      `update pos_staff_pins set failed_count = -1 where user_id = $1`, [uid]);
    await client.query(`insert into pos_counter_devices (token_hash) values ('till-probe')`);
    await refused("unlocked by a person with no expiry is refused",
      `update pos_counter_devices set till_user_id = $1 where token_hash = 'till-probe'`, [uid]);
    await refused("an expiry with no person is refused",
      `update pos_counter_devices set till_until = now() where token_hash = 'till-probe'`);
    await accepted("a person AND an expiry is accepted",
      `update pos_counter_devices set till_user_id = $1, till_until = now() + interval '5 minutes' where token_hash = 'till-probe'`, [uid]);
    await refused("a till sale that doesn't exist is refused",
      `update pos_counter_devices set till_sale_id = -1 where token_hash = 'till-probe'`);

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
