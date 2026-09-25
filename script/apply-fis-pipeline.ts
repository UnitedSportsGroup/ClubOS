/**
 * Applies migrations/2026-09-25_fis_pipeline.sql and proves it.
 *
 *   npx tsx --env-file=.env script/apply-fis-pipeline.ts [--dry-run]
 *
 * --dry-run runs everything inside a transaction that is ROLLED BACK. Each rule
 * is proven by a write that MUST be refused, inside its own SAVEPOINT.
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
  const ddl = fs.readFileSync(path.join(process.cwd(), "migrations/2026-09-25_fis_pipeline.sql"), "utf8");
  const outsideDo = ddl.replace(/DO\s*\$\$[\s\S]*?\$\$\s*;/gi, "");
  if (/^\s*(BEGIN|COMMIT)\b/im.test(outsideDo)) throw new Error("migration carries its own BEGIN/COMMIT");

  console.log(`\nFootball in Schools pipeline — ${DRY ? "DRY RUN (rolled back)" : "APPLYING"}\n`);
  const ROLLBACK = new Error("__rollback__");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(ddl));
      await tx.execute(sql.raw(ddl));
      ok("migration runs twice cleanly", true);

      const rls = (await tx.execute(sql`
        SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('fis_leads','fis_lead_activities')`)).rows as any[];
      ok("both tables exist", rls.length === 2);
      for (const r of rls) ok(`RLS on ${r.relname}`, r.relrowsecurity === true);

      const [org] = (await tx.execute(sql`SELECT id FROM organizations WHERE slug = 'christchurch-united'`)).rows as any[];
      const [lead] = (await tx.execute(sql`INSERT INTO fis_leads (organization_id, kind, slug, name)
        VALUES (${org.id}, 'school', '__rehearsal__', 'Rehearsal School') RETURNING id`)).rows as any[];
      ok("a school can be added", !!lead?.id);
      await refuses(tx, "the same school twice is refused",
        sql`INSERT INTO fis_leads (organization_id, kind, slug, name) VALUES (${org.id}, 'school', '__rehearsal__', 'Again')`);
      await refuses(tx, "a kind that isn't school or elc is refused",
        sql`INSERT INTO fis_leads (organization_id, kind, slug, name) VALUES (${org.id}, 'club', '__x__', 'X')`);
      await tx.execute(sql`INSERT INTO fis_lead_activities (organization_id, lead_id, type, note) VALUES (${org.id}, ${lead.id}, 'call', 'rehearsal')`);
      ok("a call can be logged", true);
      await refuses(tx, "a stage move with nowhere to go is refused",
        sql`INSERT INTO fis_lead_activities (organization_id, lead_id, type) VALUES (${org.id}, ${lead.id}, 'stage_change')`);
      await refuses(tx, "an empty note is refused",
        sql`INSERT INTO fis_lead_activities (organization_id, lead_id, type, note) VALUES (${org.id}, ${lead.id}, 'note', '  ')`);
      await refuses(tx, "an owner who isn't a user is refused",
        sql`UPDATE fis_leads SET owner_user_id = 999999999 WHERE id = ${lead.id}`);

      if (DRY) throw ROLLBACK;
      await tx.execute(sql`DELETE FROM fis_leads WHERE slug = '__rehearsal__'`);
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }

  console.log(`\n${pass} passed, ${fail} failed${DRY ? " (rolled back — nothing changed)" : " (APPLIED)"}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
