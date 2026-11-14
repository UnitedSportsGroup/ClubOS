// Applies migrations/2026-11-14_drive_share_links.sql and proves its rules.
//   npx tsx --env-file=.env script/apply-drive-share-links.ts            (rehearsal, rolled back)
//   npx tsx --env-file=.env script/apply-drive-share-links.ts --commit
import fs from "fs";
import { pool } from "../server/db";
const COMMIT = process.argv.includes("--commit");
(async () => {
  const c = await pool.connect(); let fail = 0;
  const ok = (name: string, pass: boolean, extra = "") => { console.log(`${pass ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`); if (!pass) fail++; };
  const refused = async (name: string, q: string, p: any[] = []) => { await c.query("savepoint s"); try { await c.query(q, p); ok(name, false, "was accepted"); } catch { ok(name, true); } await c.query("rollback to savepoint s"); };
  try {
    await c.query("begin");
    await c.query(fs.readFileSync("migrations/2026-11-14_drive_share_links.sql", "utf8"));
    const rls = await c.query(`select relrowsecurity from pg_class where relname='drive_share_links'`); ok("row level security is on", rls.rows[0]?.relrowsecurity === true);
    const f = await c.query(`insert into drive_nodes (kind, name, brand) values ('folder', '_probe share folder', 'all') returning id`); const id = f.rows[0].id;
    const tok = "p".repeat(43);
    await c.query(`insert into drive_share_links (token, node_id) values ($1,$2)`, [tok, id]); ok("a link can be made", true);
    await refused("a short token is refused", `insert into drive_share_links (token, node_id) values ('short', $1)`, [id]);
    await refused("a second live link on the same folder is refused", `insert into drive_share_links (token, node_id) values ($1,$2)`, ["q".repeat(43), id]);
    await refused("the same token twice is refused", `insert into drive_share_links (token, node_id, revoked_at) values ($1,$2, now())`, [tok, id]);
    await refused("a folder with a link cannot be deleted", `delete from drive_nodes where id=$1`, [id]);
    await c.query(`update drive_share_links set revoked_at=now() where node_id=$1`, [id]);
    await c.query(`insert into drive_share_links (token, node_id) values ($1,$2)`, ["r".repeat(43), id]); ok("a new link can be made after the old one is switched off", true);
    await c.query(`delete from drive_share_links where node_id=$1`, [id]); await c.query(`delete from drive_nodes where id=$1`, [id]);
    if (fail) throw new Error(`${fail} check(s) failed`);
    await c.query(COMMIT ? "commit" : "rollback"); console.log(COMMIT ? "APPLIED" : "rehearsal only, rolled back");
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.error("FAILED:", e.message); process.exitCode = 1; }
  c.release(); await pool.end();
})();
