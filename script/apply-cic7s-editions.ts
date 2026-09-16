/**
 * Applies migrations/2026-09-16_cic7s_editions.sql and proves it.
 *
 *   npx tsx --env-file=.env script/apply-cic7s-editions.ts [--dry-run]
 *
 * --dry-run runs the whole thing inside a transaction that is ROLLED BACK, which
 * is how a ClubOS migration is rehearsed (there is no local Postgres). The SQL
 * carries no BEGIN/COMMIT of its own — one would end the transaction early and
 * the rollback would then run in autocommit, defeating the rehearsal.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { CIC7S_CURRENT_EDITION } from "@shared/cic7s";

const DRY = process.argv.includes("--dry-run");
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

async function main() {
  const file = path.join(process.cwd(), "migrations/2026-09-16_cic7s_editions.sql");
  const ddl = fs.readFileSync(file, "utf8");
  // 🔴 A migration carrying its own BEGIN/COMMIT defeats this rehearsal: the
  // inner COMMIT ends the transaction and the ROLLBACK then runs in autocommit.
  // Strip `DO $$ … $$;` bodies first — PL/pgSQL's own BEGIN is a block opener,
  // not a transaction, and a naive check flags every guarded migration we write.
  const ddlOutsideDoBlocks = ddl.replace(/DO\s*\$\$[\s\S]*?\$\$\s*;/gi, "");
  if (/^\s*(BEGIN|COMMIT)\b/im.test(ddlOutsideDoBlocks)) {
    throw new Error("migration carries its own BEGIN/COMMIT — it would defeat --dry-run");
  }

  console.log(`\nCIC 7's editions — ${DRY ? "DRY RUN (rolled back)" : "APPLYING"}\n`);

  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(ddl));

    const cols: any = await tx.execute(sql`
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name='cic7s_registrations' AND column_name IN ('edition_year','team_name','entry_payment')`);
    const byName: any = Object.fromEntries((cols.rows ?? cols).map((c: any) => [c.column_name, c]));
    ok("edition_year exists", !!byName.edition_year);
    ok("…nullable — a registration nobody can place reads 'not recorded'", byName.edition_year?.is_nullable === "YES");
    ok("…no default — nothing is stamped with today's answer by accident", byName.edition_year?.column_default == null);
    ok("team_name exists", !!byName.team_name);
    ok("entry_payment exists", !!byName.entry_payment);

    const idx: any = await tx.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename='cic7s_registrations'`);
    const names: string[] = (idx.rows ?? idx).map((r: any) => r.indexname);
    ok("indexed on (organization_id, edition_year)", names.includes("cic7s_registrations_org_edition_idx"));
    ok("NO unique index on email — shared mailboxes are real people", !names.some((n) => /person_per_edition/.test(n)));

    const orgRes: any = await tx.execute(sql`SELECT DISTINCT organization_id AS id FROM cic7s_registrations LIMIT 1`);
    const orgId = (orgRes.rows ?? orgRes)[0]?.id;
    ok("found the CIC organisation", !!orgId, `org ${orgId}`);

    const refused = async (label: string, stmt: any) => {
      await tx.execute(sql`SAVEPOINT s`);
      try { await tx.execute(stmt); await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); ok(label, false, "it was ACCEPTED"); }
      catch { await tx.execute(sql`ROLLBACK TO SAVEPOINT s`); ok(label, true); }
    };
    await refused("an unknown entry_payment is refused", sql`
      INSERT INTO cic7s_registrations (organization_id, first_name, email, status, team_name, entry_payment)
      VALUES (${orgId}, 'Probe', 'probe@usg.co.nz', 'new', 'Probe FC', 'sort-of-paid')`);
    await refused("a payment state with NO team is refused", sql`
      INSERT INTO cic7s_registrations (organization_id, first_name, email, status, entry_payment)
      VALUES (${orgId}, 'Probe', 'probe@usg.co.nz', 'new', 'paid')`);

    const accepted = async (label: string, stmt: any) => {
      await tx.execute(sql`SAVEPOINT a`);
      try { await tx.execute(stmt); await tx.execute(sql`ROLLBACK TO SAVEPOINT a`); ok(label, true); }
      catch (e: any) { await tx.execute(sql`ROLLBACK TO SAVEPOINT a`); ok(label, false, e.message); }
    };
    await accepted("a real team + payment state is accepted", sql`
      INSERT INTO cic7s_registrations (organization_id, first_name, email, status, team_name, entry_payment, edition_year)
      VALUES (${orgId}, 'Probe', 'probe@usg.co.nz', 'new', 'Probe FC', 'paid', 2026)`);
    await accepted("the same address can register twice in one edition", sql`
      INSERT INTO cic7s_registrations (organization_id, first_name, email, status, edition_year)
      VALUES (${orgId}, 'Twin', 'twin@usg.co.nz', 'new', 2026), (${orgId}, 'Twin', 'twin@usg.co.nz', 'new', 2026)`);

    const before: any = await tx.execute(sql`SELECT count(*)::int n FROM cic7s_registrations WHERE edition_year IS NULL`);
    const n = Number((before.rows ?? before)[0].n);
    await tx.execute(sql`UPDATE cic7s_registrations SET edition_year = ${CIC7S_CURRENT_EDITION} WHERE edition_year IS NULL`);
    const after: any = await tx.execute(sql`SELECT count(*)::int n FROM cic7s_registrations WHERE edition_year IS NULL`);
    ok(`backfilled ${n} existing registration(s) to ${CIC7S_CURRENT_EDITION}`, Number((after.rows ?? after)[0].n) === 0);
    const early: any = await tx.execute(sql`
      SELECT count(*)::int n FROM cic7s_registrations WHERE edition_year = ${CIC7S_CURRENT_EDITION} AND created_at < '2026-06-01'`);
    ok("…and none of them predates the 2027 sales window", Number((early.rows ?? early)[0].n) === 0);

    if (DRY) { console.log("\n  (rolling back — dry run)"); throw new Error("__ROLLBACK__"); }
  }).catch((e: any) => { if (e?.message !== "__ROLLBACK__") throw e; });

  console.log(`\n${pass} passed, ${fail} failed${DRY ? " — NOTHING WRITTEN" : ""}\n`);
  process.exit(fail ? 1 : 0);
}
main();
