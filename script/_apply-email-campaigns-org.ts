import pg from "pg"; import fs from "fs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query(fs.readFileSync("migrations/2026-11-14_email_campaigns_org.sql", "utf8"));
  const r = await c.query(`select column_name, is_nullable from information_schema.columns where table_name='email_campaigns' and column_name='organization_id'`);
  if (r.rows.length !== 1 || r.rows[0].is_nullable !== "YES") throw new Error("column missing");
  const n = await c.query(`select count(*) from email_campaigns where organization_id is not null`);
  console.log("column ok; rows with org:", n.rows[0].count);
  if (process.argv.includes("--commit")) { await c.query("COMMIT"); console.log("COMMITTED"); } else { await c.query("ROLLBACK"); console.log("dry run, rolled back"); }
} catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); await pool.end(); }
