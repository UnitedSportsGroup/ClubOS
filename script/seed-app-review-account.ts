// The store reviewer's account — Apple and Google must get past the login wall.
//
//   npx tsx --env-file=.env script/seed-app-review-account.ts            # dry run
//   npx tsx --env-file=.env script/seed-app-review-account.ts --commit
//
// What it is: ONE staff account, role team_member, a member of the Sandbox
// workspace (org 9: no programmes, no families) holding the Team tab only.
// 🔴 It is kept OUT of #announcements and #general: chat's bootstrap auto-joins
// every default channel with onConflictDoNothing, so a membership row that is
// already LEFT stops it — a reviewer must never read, or post into, real staff
// conversations. The Task Tracker and the chat directory are org-wide by design
// and WILL be visible to the reviewer; that is reported, not hidden.
// The password is written to credentials/clubos-app-review.txt, never printed.
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { writeFileSync } from "node:fs";

const EMAIL = "appreview@unitedsportsgroup.co.nz";
const SANDBOX_ORG = 9;
const commit = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const { rows: existing } = await pool.query(`select id, active from users where lower(email)=$1`, [EMAIL]);
const { rows: defaults } = await pool.query(`select id, name from staff_channels where is_default = true and archived_at is null`);
console.log(`reviewer account: ${existing.length ? `exists (id ${existing[0].id}, active ${existing[0].active})` : "not yet"}; default channels to stay out of: ${defaults.map((d) => `#${d.name}`).join(", ")}`);
if (!commit) { console.log("dry run — pass --commit to create it"); await pool.end(); process.exit(0); }

const password = `Rv-${crypto.randomBytes(9).toString("base64url")}-${new Date().getFullYear()}`;
const hash = await bcrypt.hash(password, 10);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  let userId: number;
  if (existing.length) {
    userId = existing[0].id;
    await client.query(`update users set password=$2, active=true, role='team_member', first_name='App', last_name='Reviewer' where id=$1`, [userId, hash]);
  } else {
    const r = await client.query(
      `insert into users (email, first_name, last_name, password, role, active) values ($1,'App','Reviewer',$2,'team_member',true) returning id`, [EMAIL, hash]);
    userId = r.rows[0].id;
  }
  await client.query(
    `insert into user_organizations (user_id, organization_id, role, tabs) values ($1,$2,'team_member',$3)
     on conflict do nothing`, [userId, SANDBOX_ORG, JSON.stringify(["team"])]);
  for (const d of defaults) {
    await client.query(
      `insert into staff_channel_members (channel_id, user_id, left_at) values ($1,$2,now())
       on conflict (channel_id, user_id) do update set left_at = now()`, [d.id, userId]);
  }
  await client.query("COMMIT");
  writeFileSync("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/credentials/clubos-app-review.txt",
    `ClubOS staff app — store reviewer account (Apple App Review + Google Play)\ncreated ${new Date().toISOString().slice(0, 10)} by script/seed-app-review-account.ts\n\nemail: ${EMAIL}\npassword: ${password}\nworkspace: Sandbox (org ${SANDBOX_ORG}), tab: team\nkept out of: ${defaults.map((d) => "#" + d.name).join(", ")}\n\nRotate: re-run the script with --commit (it overwrites the password here).\n`, { mode: 0o600 });
  console.log(`✓ reviewer account ready (user ${userId}); password written to credentials/clubos-app-review.txt`);
} catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); await pool.end(); }
