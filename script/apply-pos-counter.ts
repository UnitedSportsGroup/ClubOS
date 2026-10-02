// Apply migrations/2026-10-03_pos_counter.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-pos-counter.ts             (dry run)
//   npx tsx --env-file=.env script/apply-pos-counter.ts --commit
//
// Every invariant is proven by a write the database must REFUSE.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-10-03_pos_counter.sql"), "utf8");
  if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) throw new Error("The migration carries its own BEGIN/COMMIT — that defeats the dry run.");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`\n  pos counter screen — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
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
    const before = await client.query(`select count(*)::int n from pos_payments`);
    await client.query(sql);
    console.log("  migration ran");

    for (const t of ["pos_counter_devices", "pos_counter_events"]) {
      const r = await client.query(`select relrowsecurity from pg_class where relname = $1`, [t]);
      ok(`${t} exists with RLS on`, r.rows[0]?.relrowsecurity === true);
    }
    const cols = await client.query(`select table_name, column_name, is_nullable, column_default from information_schema.columns
      where (table_name='pos_registers' and column_name in ('counter_sale_id','counter_updated_at'))
         or (table_name='pos_payments' and column_name in ('channel','collect_started_at'))`);
    ok("four new columns, all nullable, no defaults", cols.rowCount === 4 && cols.rows.every((c) => c.is_nullable === "YES" && c.column_default == null));
    const after = await client.query(`select count(*)::int n, count(channel)::int c from pos_payments`);
    ok("no existing payment was touched (channel NULL on all)", after.rows[0].n === before.rows[0].n && after.rows[0].c === 0, `${after.rows[0].n} payments`);

    const u = await client.query(`select id from users where active = true order by id limit 1`);
    const uid = u.rows[0].id;
    const r1 = (await client.query(`insert into pos_registers (name) values ('counter probe A') returning id`)).rows[0].id;
    const r2 = (await client.query(`insert into pos_registers (name) values ('counter probe B') returning id`)).rows[0].id;

    const d1 = await accepted("an unpaired device with a code is accepted",
      `insert into pos_counter_devices (token_hash, pairing_code, pairing_expires_at) values ('h1','ABC123', now() + interval '10 minutes') returning id`);
    await refused("a second OUTSTANDING device with the same code is refused",
      `insert into pos_counter_devices (token_hash, pairing_code) values ('h2','ABC123')`);
    await refused("the same token twice is refused",
      `insert into pos_counter_devices (token_hash) values ('h1')`);
    await refused("paired with no register is refused",
      `update pos_counter_devices set paired_at = now(), paired_by_user_id = $1 where token_hash = 'h1'`, [uid]);
    await refused("paired by nobody is refused",
      `update pos_counter_devices set paired_at = now(), register_id = $1 where token_hash = 'h1'`, [r1]);
    await accepted("paired to a register by a named person is accepted",
      `update pos_counter_devices set paired_at = now(), paired_by_user_id = $1, register_id = $2, pairing_code = null where token_hash = 'h1'`, [uid, r1]);
    await client.query(`insert into pos_counter_devices (token_hash) values ('h3')`);
    await refused("🔴 a SECOND live screen on the same register is refused",
      `update pos_counter_devices set paired_at = now(), paired_by_user_id = $1, register_id = $2 where token_hash = 'h3'`, [uid, r1]);
    await accepted("…but it can pair to a different register",
      `update pos_counter_devices set paired_at = now(), paired_by_user_id = $1, register_id = $2 where token_hash = 'h3'`, [uid, r2]);
    await refused("revoked by nobody is refused",
      `update pos_counter_devices set revoked_at = now() where token_hash = 'h3'`);
    await accepted("revoked by a named person frees the register",
      `update pos_counter_devices set revoked_at = now(), revoked_by_user_id = $1 where token_hash = 'h3'`, [uid]);
    await client.query(`insert into pos_counter_devices (token_hash) values ('h4')`);
    await accepted("…so a replacement screen can pair to that register",
      `update pos_counter_devices set paired_at = now(), paired_by_user_id = $1, register_id = $2 where token_hash = 'h4'`, [uid, r2]);
    await refused("a paired register cannot be deleted while its screen points at it",
      `delete from pos_registers where id = $1`, [r1]);
    if (d1) await accepted("an event row for a device is accepted",
      `insert into pos_counter_events (device_id, level, message) values ($1, 'error', 'probe')`, [d1.rows[0].id]);

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
