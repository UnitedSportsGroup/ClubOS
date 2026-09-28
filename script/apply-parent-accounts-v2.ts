// Apply parent accounts v2 (passwords, revocable sessions, auth audit, saved
// cards). ADDITIVE ONLY — four new tables. No existing row is written.
//
//   Rehearse (default):  npx tsx --env-file=.env script/apply-parent-accounts-v2.ts
//   Apply:               npx tsx --env-file=.env script/apply-parent-accounts-v2.ts --commit
//
// Without --commit, the migration AND every check run inside a transaction that
// is then ROLLED BACK. Postgres DDL is transactional, so this proves the whole
// thing against live data before anything is kept. One dedicated client, not
// pool.query — a pool may hand each statement a different connection, and a
// BEGIN on one connection does not cover a statement on another.
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const COMMIT = process.argv.includes("--commit");
const here = dirname(fileURLToPath(import.meta.url));
const ddl = readFileSync(join(here, "..", "migrations", "2026-09-28_parent_accounts_v2.sql"), "utf8");
if (/^\s*(BEGIN|COMMIT)\s*;/im.test(ddl)) {
  // A migration carrying its own COMMIT ends our transaction early, and the
  // "rehearsal" ROLLBACK would then run in autocommit — keeping everything.
  console.error("The migration contains its own BEGIN/COMMIT — refusing.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();
let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok " : " FAIL"}  ${label}`);
};

/** Run a statement that MUST be refused, inside a savepoint so the refusal does
 *  not poison the surrounding transaction. */
async function refused(label: string, stmt: string, params: any[] = []) {
  await client.query("SAVEPOINT s");
  try {
    await client.query(stmt, params);
    check(false, `${label} — was ACCEPTED`);
  } catch {
    check(true, label);
  }
  await client.query("ROLLBACK TO SAVEPOINT s");
}

try {
  console.log(COMMIT ? "\nAPPLYING to the database.\n" : "\nREHEARSAL — everything below is rolled back.\n");
  await client.query("BEGIN");
  await client.query(ddl);

  for (const t of ["parent_credentials", "parent_sessions", "parent_auth_events", "parent_stripe_customers"]) {
    const r = await client.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)", [t]);
    check(r.rowCount === 1, `table ${t}`);
    check(r.rows[0]?.relrowsecurity === true, `  RLS on ${t}`);
  }

  // ── Invariants, each proven by an insert the database refuses ──────────────
  await refused("an un-normalised email is refused (credentials)",
    `INSERT INTO parent_credentials (email) VALUES ('Mixed@Example.com')`);
  await refused("a hash without its timestamp is refused",
    `INSERT INTO parent_credentials (email, password_hash) VALUES ('rehearsal@example.com', 's1$x$y')`);
  await refused("a timestamp without a hash is refused",
    `INSERT INTO parent_credentials (email, password_set_at) VALUES ('rehearsal@example.com', now())`);
  await client.query(
    `INSERT INTO parent_credentials (email, password_hash, password_set_at)
     VALUES ('rehearsal@example.com', 's1$ab$cd', now())`);
  check(true, "a well-formed credential is accepted");
  await refused("two credential rows for one address are refused",
    `INSERT INTO parent_credentials (email) VALUES ('rehearsal@example.com')`);

  await client.query(
    `INSERT INTO parent_sessions (email, token_hash, method, expires_at)
     VALUES ('rehearsal@example.com', 'hash-1', 'code', now() + interval '30 days')`);
  await refused("the same session token twice is refused",
    `INSERT INTO parent_sessions (email, token_hash, method, expires_at)
     VALUES ('rehearsal@example.com', 'hash-1', 'code', now() + interval '30 days')`);
  await refused("a session that expires before it starts is refused",
    `INSERT INTO parent_sessions (email, token_hash, method, expires_at)
     VALUES ('rehearsal@example.com', 'hash-2', 'code', now() - interval '1 day')`);
  const revoke = await client.query(
    `UPDATE parent_sessions SET revoked_at = now()
     WHERE email = 'rehearsal@example.com' AND revoked_at IS NULL RETURNING id`);
  check(revoke.rowCount === 1, "revoking a session works");

  await client.query(
    `INSERT INTO parent_stripe_customers (email, stripe_account, stripe_customer_id)
     VALUES ('rehearsal@example.com', 'club', 'cus_rehearsal1')`);
  await refused("a second customer for the same family + account is refused",
    `INSERT INTO parent_stripe_customers (email, stripe_account, stripe_customer_id)
     VALUES ('rehearsal@example.com', 'club', 'cus_rehearsal2')`);
  await refused("one Stripe customer shared by two families is refused",
    `INSERT INTO parent_stripe_customers (email, stripe_account, stripe_customer_id)
     VALUES ('someone-else@example.com', 'club', 'cus_rehearsal1')`);
  await client.query(
    `INSERT INTO parent_stripe_customers (email, stripe_account, stripe_customer_id)
     VALUES ('rehearsal@example.com', 'trust', 'cus_rehearsal3')`);
  check(true, "the same family on another Stripe account is accepted");

  await client.query(
    `INSERT INTO parent_auth_events (email, action, ok, reason, ip)
     VALUES ('rehearsal@example.com', 'password_login', false, 'bad_password', '127.0.0.1')`);
  const ev = await client.query(
    `SELECT COUNT(*)::int n FROM parent_auth_events
     WHERE lower(email) = 'rehearsal@example.com' AND ok = false
       AND created_at > now() - interval '15 minutes'`);
  check(ev.rows[0].n === 1, "the limiter's query sees a failed attempt");

  // Clean the rehearsal rows even on --commit: the tables must go live empty.
  await client.query(`DELETE FROM parent_auth_events WHERE email = 'rehearsal@example.com'`);
  await client.query(`DELETE FROM parent_stripe_customers WHERE email = 'rehearsal@example.com'`);
  await client.query(`DELETE FROM parent_sessions WHERE email = 'rehearsal@example.com'`);
  await client.query(`DELETE FROM parent_credentials WHERE email = 'rehearsal@example.com'`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED — rolling back.\n`);
    await client.query("ROLLBACK");
    process.exit(1);
  }
  await client.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(COMMIT ? "\nCommitted.\n" : "\nRolled back. Nothing changed. Re-run with --commit to apply.\n");
} catch (e: any) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("\nFAILED — rolled back:", e.message, "\n");
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
