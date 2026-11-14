// Applies migrations/2026-11-14_drive_share_short_code.sql and gives every live link a short code.
//   npx tsx --env-file=.env script/apply-drive-share-short-code.ts [--commit]
import fs from "fs";
import { randomBytes } from "crypto";
import { pool } from "../server/db";
const COMMIT = process.argv.includes("--commit");
const A = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = () => Array.from(randomBytes(12)).map((b) => A[b % A.length]).join("");
(async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(fs.readFileSync("migrations/2026-11-14_drive_share_short_code.sql", "utf8"));
    const rows = (await c.query(`select id from drive_share_links where short_code is null`)).rows;
    for (const r of rows) await c.query(`update drive_share_links set short_code=$1 where id=$2`, [code(), r.id]);
    await c.query("savepoint s"); let refused = false;
    try { await c.query(`update drive_share_links set short_code='short' where id=(select min(id) from drive_share_links)`); } catch { refused = true; }
    await c.query("rollback to savepoint s");
    console.log(refused ? "✓ a too-short code is refused" : "✗ a too-short code was accepted");
    const left = (await c.query(`select count(*)::int n from drive_share_links where short_code is null`)).rows[0].n;
    console.log(`✓ ${rows.length} link(s) given a code, ${left} without`);
    if (!refused || left) throw new Error("checks failed");
    await c.query(COMMIT ? "commit" : "rollback"); console.log(COMMIT ? "APPLIED" : "rehearsal only, rolled back");
  } catch (e: any) { await c.query("rollback").catch(() => {}); console.error("FAILED:", e.message); process.exitCode = 1; }
  c.release(); await pool.end();
})();
