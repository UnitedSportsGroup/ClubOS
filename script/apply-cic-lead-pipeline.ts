/**
 * Applies migrations/2026-09-25_cic_lead_pipeline.sql and proves it.
 *
 *   npx tsx --env-file=.env script/apply-cic-lead-pipeline.ts [--dry-run]
 *
 * --dry-run runs everything inside a transaction that is ROLLED BACK (there is
 * no local Postgres — this is how a ClubOS migration is rehearsed). Each rule is
 * proven by an insert that MUST be refused, inside its own SAVEPOINT.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const DRY = process.argv.includes("--dry-run");
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
let spN = 0;
async function refuses(tx: any, label: string, statement: any) {
  const sp = `sp_${++spN}`;
  await tx.execute(sql.raw(`SAVEPOINT ${sp}`));
  try {
    await tx.execute(statement);
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
    ok(label, false, "the database ACCEPTED it");
  } catch {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
    ok(label, true);
  }
}

async function main() {
  const ddl = fs.readFileSync(path.join(process.cwd(), "migrations/2026-09-25_cic_lead_pipeline.sql"), "utf8");
  const outsideDo = ddl.replace(/DO\s*\$\$[\s\S]*?\$\$\s*;/gi, "");
  if (/^\s*(BEGIN|COMMIT)\b/im.test(outsideDo)) throw new Error("migration carries its own BEGIN/COMMIT");

  console.log(`\nCIC lead pipeline — ${DRY ? "DRY RUN (rolled back)" : "APPLYING"}\n`);
  const ROLLBACK = new Error("__rollback__");
  try {
    await db.transaction(async (tx) => {
      const before = (await tx.execute(sql`SELECT count(*)::int n FROM cic_interest_registrations`)).rows[0] as any;
      await tx.execute(sql.raw(ddl));
      await tx.execute(sql.raw(ddl)); // idempotent: a second run must be a no-op
      ok("migration runs twice cleanly", true);

      const after = (await tx.execute(sql`SELECT count(*)::int n FROM cic_interest_registrations`)).rows[0] as any;
      ok("no lead added or lost", before.n === after.n, `${after.n} leads`);

      const cols = new Set(((await tx.execute(sql`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'cic_interest_registrations'`)).rows as any[])
        .map((c) => c.column_name));
      for (const c of ["closed_reason", "priority", "next_follow_up_on", "owner_user_id", "stage_changed_at", "last_activity_at", "updated_at"]) {
        ok(`column ${c}`, cols.has(c));
      }
      const legacy = (await tx.execute(sql`
        SELECT count(*)::int n FROM cic_interest_registrations WHERE status IN ('confirmed','declined','archived')`)).rows[0] as any;
      ok("no legacy status left", legacy.n === 0, `${legacy.n}`);

      const rls = (await tx.execute(sql`
        SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('cic_interest_activities','cic_interest_registrations')`)).rows as any[];
      for (const r of rls) ok(`RLS on ${r.relname}`, r.relrowsecurity === true);

      const [lead] = (await tx.execute(sql`SELECT id, organization_id FROM cic_interest_registrations ORDER BY id LIMIT 1`)).rows as any[];
      await tx.execute(sql`INSERT INTO cic_interest_activities (organization_id, registration_id, type, note)
        VALUES (${lead.organization_id}, ${lead.id}, 'call', 'rehearsal')`);
      ok("a call can be logged", true);
      await refuses(tx, "a stage move with nowhere to go is refused",
        sql`INSERT INTO cic_interest_activities (organization_id, registration_id, type) VALUES (${lead.organization_id}, ${lead.id}, 'stage_change')`);
      await refuses(tx, "an empty note is refused",
        sql`INSERT INTO cic_interest_activities (organization_id, registration_id, type, note) VALUES (${lead.organization_id}, ${lead.id}, 'note', '   ')`);
      await refuses(tx, "an activity on a lead that doesn't exist is refused",
        sql`INSERT INTO cic_interest_activities (organization_id, registration_id, type) VALUES (${lead.organization_id}, 999999999, 'call')`);
      await refuses(tx, "an owner who isn't a user is refused",
        sql`UPDATE cic_interest_registrations SET owner_user_id = 999999999 WHERE id = ${lead.id}`);

      if (DRY) throw ROLLBACK;
      await tx.execute(sql`DELETE FROM cic_interest_activities WHERE note = 'rehearsal'`);
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }

  console.log(`\n${pass} passed, ${fail} failed${DRY ? " (rolled back — nothing changed)" : " (APPLIED)"}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
