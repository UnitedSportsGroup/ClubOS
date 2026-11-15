// Applies migrations/2026-11-16_drive_node_shares.sql. --dry-run rolls it back.
import pg from "pg"; import fs from "fs";
const DRY = process.argv.includes("--dry-run");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ok = (m: string) => console.log("  ok  ", m); let bad = 0; const no = (m: string) => { bad++; console.log("  FAIL", m); };
await c.connect();
await c.query("BEGIN");
try {
  await c.query(fs.readFileSync("migrations/2026-11-16_drive_node_shares.sql", "utf8"));
  const node = (await c.query("select id from drive_nodes limit 1")).rows[0].id; const u = (await c.query("select id from users order by id limit 2")).rows;
  await c.query("insert into drive_node_shares (node_id,user_id,granted_by) values ($1,$2,$3)", [node, u[1].id, u[0].id]); ok("a share inserts");
  await c.query("SAVEPOINT s"); try { await c.query("insert into drive_node_shares (node_id,user_id,granted_by) values ($1,$2,$3)", [node, u[1].id, u[0].id]); no("duplicate live share allowed"); } catch { ok("a second live share for the same person is refused"); } await c.query("ROLLBACK TO s");
  await c.query("SAVEPOINT s"); try { await c.query("update drive_node_shares set revoked_at=now() where node_id=$1", [node]); no("revoked without who"); } catch { ok("revoking needs who did it"); } await c.query("ROLLBACK TO s");
  await c.query("update drive_node_shares set revoked_at=now(), revoked_by=$2 where node_id=$1", [node, u[0].id]);
  await c.query("insert into drive_node_shares (node_id,user_id,granted_by) values ($1,$2,$3)", [node, u[1].id, u[0].id]); ok("share again after revoking");
  const rls = (await c.query("select relrowsecurity from pg_class where relname='drive_node_shares'")).rows[0].relrowsecurity; rls ? ok("RLS on") : no("RLS off");
  // remove the test rows either way
  await c.query("delete from drive_node_shares where node_id=$1", [node]);
  if (bad || DRY) { await c.query("ROLLBACK"); console.log(bad ? "ROLLED BACK (failures)" : "dry run: rolled back"); } else { await c.query("COMMIT"); console.log("APPLIED"); }
} catch (e) { await c.query("ROLLBACK"); throw e; }
await c.end(); process.exit(bad ? 1 : 0);
