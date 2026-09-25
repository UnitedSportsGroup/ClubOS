/**
 * Applies migrations/2026-09-25_task_board.sql and proves it.
 *
 *   npx tsx --env-file=.env script/apply-task-board.ts [--dry-run]
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
  try { await tx.execute(statement); await tx.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`)); ok(label, false, "the database ACCEPTED it"); }
  catch { await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`)); ok(label, true); }
}

async function main() {
  const ddl = fs.readFileSync(path.join(process.cwd(), "migrations/2026-09-25_task_board.sql"), "utf8");
  const outsideDo = ddl.replace(/DO\s*\$\$[\s\S]*?\$\$\s*;/gi, "");
  if (/^\s*(BEGIN|COMMIT)\b/im.test(outsideDo)) throw new Error("migration carries its own BEGIN/COMMIT");
  console.log(`\nTask Board — ${DRY ? "DRY RUN (rolled back)" : "APPLYING"}\n`);
  const ROLLBACK = new Error("__rollback__");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(ddl));
      await tx.execute(sql.raw(ddl));
      ok("migration runs twice cleanly", true);
      const rls = (await tx.execute(sql`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('tb_projects','tb_tasks')`)).rows as any[];
      ok("both tables exist", rls.length === 2);
      for (const r of rls) ok(`RLS on ${r.relname}`, r.relrowsecurity === true);
      const [org] = (await tx.execute(sql`SELECT id FROM organizations WHERE slug = 'mini-football-leagues'`)).rows as any[];
      const [p] = (await tx.execute(sql`INSERT INTO tb_projects (organization_id, name) VALUES (${org.id}, '__rehearsal__') RETURNING id`)).rows as any[];
      const [t] = (await tx.execute(sql`INSERT INTO tb_tasks (organization_id, project_id, title) VALUES (${org.id}, ${p.id}, 'Rehearsal task') RETURNING id`)).rows as any[];
      ok("a project and a task can be added", !!t?.id);
      await refuses(tx, "a blank task title is refused", sql`INSERT INTO tb_tasks (organization_id, title) VALUES (${org.id}, '   ')`);
      await refuses(tx, "a blank project name is refused", sql`INSERT INTO tb_projects (organization_id, name) VALUES (${org.id}, '')`);
      await refuses(tx, "an owner who isn't a user is refused", sql`UPDATE tb_tasks SET owner_user_id = 999999999 WHERE id = ${t.id}`);
      await tx.execute(sql`DELETE FROM tb_projects WHERE id = ${p.id}`);
      const [still] = (await tx.execute(sql`SELECT project_id FROM tb_tasks WHERE id = ${t.id}`)).rows as any[];
      ok("deleting a project keeps its tasks (project cleared, task kept)", still && still.project_id === null);
      if (DRY) throw ROLLBACK;
      await tx.execute(sql`DELETE FROM tb_tasks WHERE title = 'Rehearsal task'`);
    });
  } catch (e) { if (e !== ROLLBACK) throw e; }
  console.log(`\n${pass} passed, ${fail} failed${DRY ? " (rolled back — nothing changed)" : " (APPLIED)"}\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
