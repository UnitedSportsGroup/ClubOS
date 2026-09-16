// Apply migrations/2026-09-17_teampay_captains.sql, rehearsing it first.
//
//   npx tsx --env-file=.env script/apply-teampay-captains.ts            (dry run)
//   npx tsx --env-file=.env script/apply-teampay-captains.ts --commit
//
// There is no local Postgres, so a dry run is the only rehearsal available: it
// runs the real DDL and the real checks inside a transaction it then rolls back.
//
// 🔴 The behavioural checks are the point. What must be REFUSED:
//   1. the same captain email twice, differing only in case
//   2. a session that expires before it was created
//   3. a set-password token that expires before it was created
//   4. a session belonging to a captain who does not exist
//
// And what must be ACCEPTED, each easy to break by accident:
//   A. a captain with NO password hash      — the placeholder, before they prove the address
//   B. several fill-ins with no photo       — NULLs must stay distinct
//   C. deleting a captain                   — sessions cascade, the audit trail survives
//   D. re-running the whole migration       — idempotency
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const MIGRATION = "2026-09-17_teampay_captains.sql";

const problems: string[] = [];
let checks = 0;

function ok(l: string) { checks++; console.log(`  ✓ ${l}`); }
function bad(l: string) { checks++; problems.push(l); console.log(`  ✗ ${l}`); }

async function mustRefuse(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was ALLOWED, and must not be`);
  } catch {
    await c.query("ROLLBACK TO SAVEPOINT s");
    ok(`refused: ${label}`);
  }
}

async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT s");
    ok(`accepted: ${label}`);
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s");
    bad(`${label} — was REFUSED: ${e.message}`);
  }
}

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", MIGRATION), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log(`\n  Team Pay — captain accounts — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");

  try {
    await c.query(sql);
    console.log("  migration ran\n");

    // ── structure ──────────────────────────────────────────────────────────
    for (const t of [
      "teampay_captains", "teampay_captain_sessions",
      "teampay_captain_tokens", "teampay_captain_auth_events",
    ]) {
      const r = await c.query(`select 1 from information_schema.tables where table_name = $1`, [t]);
      r.rowCount ? ok(`${t} exists`) : bad(`${t} was not created`);
    }

    for (const [t, col] of [
      ["teampay_fillins", "photo_key"],
      ["teampay_fillins", "highlight_url"],
      ["teampay_fillin_holds", "requested_by_captain_id"],
    ]) {
      const r = await c.query(
        `select 1 from information_schema.columns where table_name = $1 and column_name = $2`, [t, col]);
      r.rowCount ? ok(`${t}.${col} exists`) : bad(`${t}.${col} MISSING`);
    }

    // 🔴 password_hash must be nullable AND have no default. A default of ''
    // would be a stored hash that fails to parse — which is fine — but a
    // NOT NULL would force the signup flow to invent a password for an account
    // nobody has claimed yet.
    const ph = await c.query(
      `select is_nullable, column_default from information_schema.columns
        where table_name = 'teampay_captains' and column_name = 'password_hash'`);
    ph.rows[0]?.is_nullable === "YES" && ph.rows[0]?.column_default == null
      ? ok("password_hash is nullable with no default — an unclaimed account holds no credential")
      : bad(`password_hash: nullable=${ph.rows[0]?.is_nullable} default=${ph.rows[0]?.column_default}`);

    // ── behaviour ──────────────────────────────────────────────────────────
    const cap = await c.query(
      `insert into teampay_captains (email, name) values ('ZZ.Probe@Example.Invalid','ZZ Probe')
       returning id, password_hash`);
    const capId = cap.rows[0].id;

    // A — the placeholder state is legal.
    cap.rows[0].password_hash === null
      ? ok("a captain can exist with no password yet")
      : bad("a new captain came with a password hash");

    // 1 — the one that would split a person into two accounts.
    await mustRefuse(c, "the same email twice, differing only in case",
      `insert into teampay_captains (email) values ('zz.probe@example.invalid')`);

    // 2, 3
    await mustRefuse(c, "a session that expires before it was created",
      `insert into teampay_captain_sessions (captain_id, token_hash, created_at, expires_at)
       values ($1, 'h1', now(), now() - interval '1 hour')`, [capId]);
    await mustRefuse(c, "a token that expires before it was created",
      `insert into teampay_captain_tokens (captain_id, token_hash, created_at, expires_at)
       values ($1, 'h2', now(), now() - interval '1 hour')`, [capId]);

    // 4
    await mustRefuse(c, "a session for a captain who does not exist",
      `insert into teampay_captain_sessions (captain_id, token_hash, expires_at)
       values (0, 'h3', now() + interval '1 day')`);

    await mustAccept(c, "a real session",
      `insert into teampay_captain_sessions (captain_id, token_hash, expires_at)
       values ($1, 'h-real', now() + interval '30 days')`, [capId]);

    await mustRefuse(c, "two sessions sharing one token hash",
      `insert into teampay_captain_sessions (captain_id, token_hash, expires_at)
       values ($1, 'h-real', now() + interval '30 days')`, [capId]);

    // C — 🔴 deleting a captain must take their sessions with it (nobody stays
    // signed in as a deleted account) but must NOT take the audit trail, which
    // is the record of what that account did.
    await c.query(
      `insert into teampay_captain_auth_events (email, captain_id, action, ok)
       values ('zz.probe@example.invalid', $1, 'sign_in', true)`, [capId]);
    await c.query(`delete from teampay_captains where id = $1`, [capId]);
    const sess = await c.query(`select count(*)::int n from teampay_captain_sessions where captain_id = $1`, [capId]);
    const ev = await c.query(
      `select count(*)::int n from teampay_captain_auth_events where lower(email) = 'zz.probe@example.invalid'`);
    sess.rows[0].n === 0 ? ok("deleting a captain cascades their sessions") : bad("sessions survived a deleted captain");
    ev.rows[0].n === 1
      ? ok("the audit trail SURVIVES a deleted captain")
      : bad("deleting a captain erased the record of what they did");

    // B — NULL photo keys must not collide.
    const comp = await c.query(`select id, organization_id from teampay_competitions order by id limit 1`);
    if (comp.rowCount) {
      await mustAccept(c, "two fill-ins with no photo and no video",
        `insert into teampay_fillins (competition_id, organization_id, first_name, email, player_token)
         values ($1,$2,'ZZ One','zz1@example.invalid','zztok1'),
                ($1,$2,'ZZ Two','zz2@example.invalid','zztok2')`,
        [comp.rows[0].id, comp.rows[0].organization_id]);
      await c.query(`delete from teampay_fillins where email like 'zz%@example.invalid'`);
    } else {
      bad("no teampay_competition to test fill-ins against");
    }

    // D
    await mustAccept(c, "re-running the whole migration", sql);

    // 🔴 Nothing this script created may survive, even on --commit.
    await c.query(`delete from teampay_captain_auth_events where lower(email) = 'zz.probe@example.invalid'`);
    await c.query(`delete from teampay_captains where lower(email) = 'zz.probe@example.invalid'`);
    const left = await c.query(
      `select (select count(*) from teampay_captains where lower(email) like 'zz%')::int a,
              (select count(*) from teampay_fillins where email like 'zz%@example.invalid')::int b`);
    left.rows[0].a === 0 && left.rows[0].b === 0
      ? ok("probes cleaned up")
      : bad(`probes left behind: ${left.rows[0].a} captains, ${left.rows[0].b} fill-ins`);

  } catch (e: any) {
    problems.push(`fatal: ${e.message}`);
    console.error(`\n  ✗ fatal: ${e.message}`);
  }

  const clean = problems.length === 0;
  if (COMMIT && clean) {
    await c.query("COMMIT");
    console.log(`\n  ${checks} checks passed — COMMITTED\n`);
  } else {
    await c.query("ROLLBACK");
    console.log(
      clean
        ? `\n  ${checks} checks passed — rolled back. Re-run with --commit to apply.\n`
        : `\n  ${problems.length} problem(s) of ${checks} checks — ROLLED BACK:\n` +
          problems.map((p) => `    · ${p}`).join("\n") + "\n",
    );
  }
  await c.end();
  process.exit(clean ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
