// One-off: add parent_id self-ref column to project_tasks for subtask support.
// Idempotent — safe to re-run. Run with: node scripts/add-task-parent-id.mjs
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({ connectionString: url });
try {
  await pool.query(`ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS parent_id integer;`);
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'project_tasks_parent_id_fkey' AND table_name = 'project_tasks'
      ) THEN
        ALTER TABLE project_tasks
          ADD CONSTRAINT project_tasks_parent_id_fkey
          FOREIGN KEY (parent_id) REFERENCES project_tasks(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS project_tasks_parent_id_idx ON project_tasks(parent_id);`);
  const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'project_tasks' AND column_name = 'parent_id';`);
  console.log("parent_id column:", r.rowCount > 0 ? "present" : "missing");
} finally {
  await pool.end();
}
