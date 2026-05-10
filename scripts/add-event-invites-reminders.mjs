// Adds event_invitees + event_reminders tables for the calendar invite/RSVP
// + reminder system. Idempotent — safe to re-run.
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({ connectionString: url });
try {
  await pool.query(`
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
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS event_invitees_event_id_idx ON event_invitees(event_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS event_invitees_user_id_idx ON event_invitees(user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_reminders (
      id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      event_id integer NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      offset_minutes integer NOT NULL,
      channel text NOT NULL DEFAULT 'email',
      sent_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS event_reminders_event_id_idx ON event_reminders(event_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS event_reminders_pending_idx ON event_reminders(sent_at) WHERE sent_at IS NULL;`);

  const r1 = await pool.query(`SELECT to_regclass('public.event_invitees') AS t;`);
  const r2 = await pool.query(`SELECT to_regclass('public.event_reminders') AS t;`);
  console.log("event_invitees :", r1.rows[0].t || "missing");
  console.log("event_reminders:", r2.rows[0].t || "missing");
} finally {
  await pool.end();
}
