// Backfill for Staff Chat room admins (2026-09-21). No schema change — the
// membership `role` column is text ('owner' | 'admin' | 'member'). This only
// makes the record match the rule that already applied at creation time:
//   · a CHANNEL's creator is its owner (creation already wrote 'owner'; this
//     repairs any row that was ever re-inserted as 'member');
//   · a GROUP message's creator is its owner (creation wrote 'member' until
//     today, so every existing group has no owner — fixed here);
//   · a 1:1 message has no owner.
// Dry-run by default; --commit writes. Idempotent.
//   npx tsx --env-file=.env script/apply-chat-admins.ts [--commit]
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const channels = await c.query(`
      UPDATE staff_channel_members m SET role = 'owner'
      FROM staff_channels ch
      WHERE ch.id = m.channel_id AND ch.kind = 'channel' AND ch.created_by = m.user_id
        AND m.role = 'member'
      RETURNING ch.id AS channel_id, ch.name, m.user_id`);
    const groups = await c.query(`
      UPDATE staff_channel_members m SET role = 'owner'
      FROM staff_channels ch
      WHERE ch.id = m.channel_id AND ch.kind = 'dm' AND ch.created_by = m.user_id
        AND m.role = 'member'
        AND (SELECT count(*) FROM staff_channel_members x WHERE x.channel_id = ch.id) >= 3
      RETURNING ch.id AS channel_id, m.user_id`);
    const orphanGroups = await c.query(`
      SELECT ch.id FROM staff_channels ch
      WHERE ch.kind = 'dm'
        AND (SELECT count(*) FROM staff_channel_members x WHERE x.channel_id = ch.id) >= 3
        AND NOT EXISTS (SELECT 1 FROM staff_channel_members o WHERE o.channel_id = ch.id AND o.role = 'owner')`);
    console.log(`channels whose creator was not marked owner: ${channels.rowCount}`);
    for (const r of channels.rows) console.log(`  #${r.name} (channel ${r.channel_id}) → user ${r.user_id} is owner`);
    console.log(`group messages whose creator was not marked owner: ${groups.rowCount}`);
    console.log(`group messages still without an owner (creator unknown or gone): ${orphanGroups.rowCount} — leadership runs those`);
    const roles = await c.query(`SELECT role, count(*)::int AS n FROM staff_channel_members WHERE left_at IS NULL GROUP BY role ORDER BY role`);
    console.log("active memberships by role:", roles.rows.map((r: any) => `${r.role}=${r.n}`).join(" · "));
    if (COMMIT) { await c.query("COMMIT"); console.log("\nCOMMITTED"); }
    else { await c.query("ROLLBACK"); console.log("\nDRY RUN — rolled back. Re-run with --commit to write."); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
