// One-off migration to bring Supabase Sydney in line with the schema commits
// 9be26f3 (permissions) and 23a32cc (subtasks + calendar invites/reminders).
// db:push was never run after those commits, so live admin requests 500 with
// `column user_organizations.tabs does not exist` and AuthGuard bounces every
// login back to the login page.
//
// Purely additive: ADD COLUMN IF NOT EXISTS and CREATE TABLE IF NOT EXISTS.
// All wrapped in a single transaction — any failure rolls everything back.
//
// Usage: tsx script/apply-permissions-calendar-subtasks-schema.ts

import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
BEGIN;

-- 1) Tab-level permissions on workspace memberships (commit 9be26f3).
ALTER TABLE user_organizations
  ADD COLUMN IF NOT EXISTS tabs jsonb;

-- 2) Subtasks: parent_id self-ref on project_tasks (commit 23a32cc).
ALTER TABLE project_tasks
  ADD COLUMN IF NOT EXISTS parent_id integer
  REFERENCES project_tasks(id) ON DELETE CASCADE;

-- 3) Calendar invitees with RSVP tokens (commit 23a32cc).
CREATE TABLE IF NOT EXISTS event_invitees (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  event_id integer NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  rsvp_status text NOT NULL DEFAULT 'pending',
  rsvp_token text NOT NULL UNIQUE,
  invited_by integer REFERENCES users(id),
  invited_at timestamp NOT NULL DEFAULT now(),
  responded_at timestamp,
  invite_email_sent_at timestamp
);

-- 4) Calendar event reminders (commit 23a32cc).
CREATE TABLE IF NOT EXISTS event_reminders (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  event_id integer NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  offset_minutes integer NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  sent_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

COMMIT;
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected. Applying additive migration in one transaction...");
    await client.query(SQL);
    console.log("✅ Migration applied.");

    const checks = await client.query<{ table_name: string; column_name: string | null }>(`
      SELECT 'user_organizations' AS table_name, 'tabs' AS column_name
      WHERE EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_organizations' AND column_name = 'tabs'
      )
      UNION ALL
      SELECT 'project_tasks', 'parent_id'
      WHERE EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'project_tasks' AND column_name = 'parent_id'
      )
      UNION ALL
      SELECT 'event_invitees', NULL
      WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'event_invitees'
      )
      UNION ALL
      SELECT 'event_reminders', NULL
      WHERE EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'event_reminders'
      );
    `);
    console.log("Post-migration sanity check (each row = a piece now present):");
    for (const r of checks.rows) {
      console.log(`  ✓ ${r.table_name}${r.column_name ? "." + r.column_name : ""}`);
    }
    if (checks.rows.length !== 4) {
      throw new Error(`Expected 4 post-migration artifacts, found ${checks.rows.length}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
