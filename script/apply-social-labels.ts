/**
 * Social media labels — apply the migration, prove its rules, and seed the
 * starting labels (content types staff can rename, and one sponsor label per
 * signed partner).
 *
 *   npx tsx --env-file=.env script/apply-social-labels.ts            (rehearsal: rolled back)
 *   npx tsx --env-file=.env script/apply-social-labels.ts --commit
 *
 * Safe to run again: labels are added only where the name is not already there.
 */
import { readFileSync } from "fs";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

/** Starting content types. Staff can rename, reword or remove any of them in the Labels view. */
const ASSETS: [string, string][] = [
  ["Starting line-up", "A graphic listing the starting eleven for a match, usually headed Starting XI or Line-up, with player names and numbers."],
  ["Match day", "A graphic or post announcing today's or an upcoming match: opponent, kick-off time, venue."],
  ["Full-time result", "A graphic or post giving the final score of a match."],
  ["Goal or scorer", "A graphic or clip celebrating a goal or naming a goalscorer during or after a match."],
  ["Player of the match", "A graphic or post naming the player of the match or man of the match."],
  ["Match highlights", "A video of highlights or goals from a match."],
  ["Match photos", "A set of photographs from a match (action shots), not a designed graphic."],
  ["Player signing", "An announcement that a player or coach has signed, re-signed or joined."],
  ["Programme promotion", "A post promoting registrations for a programme, camp, league, term or trial."],
  ["Sponsor or partner post", "A post that is mainly about a sponsor or partner: a thank-you, an offer, a partnership announcement."],
  ["Behind the scenes", "Training, travel, changing room or day-in-the-life content."],
];

async function expectRefused(client: pg.PoolClient, label: string, sql: string, params: unknown[]) {
  await client.query("SAVEPOINT t");
  let refused = false;
  try {
    await client.query(sql, params);
  } catch {
    refused = true;
  }
  await client.query("ROLLBACK TO SAVEPOINT t");
  ok(label, refused);
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(readFileSync("migrations/2026-11-13_social_labels.sql", "utf8"));

    for (const t of ["social_labels", "social_post_labels", "social_label_runs"]) {
      const { rows } = await client.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [t]);
      ok(`${t} exists with row security on`, rows[0]?.relrowsecurity === true);
    }
    const col = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'social_posts' AND column_name = 'label_checked_at'`);
    ok("social_posts.label_checked_at exists", col.rowCount === 1);

    // Seed.
    let added = 0;
    for (const [name, hint] of ASSETS) {
      const r = await client.query(
        `INSERT INTO social_labels (kind, name, hint) SELECT 'asset', $1, $2
         WHERE NOT EXISTS (SELECT 1 FROM social_labels WHERE kind = 'asset' AND lower(name) = lower($1) AND archived_at IS NULL)`,
        [name, hint],
      );
      added += r.rowCount ?? 0;
    }
    const partners = await client.query(`SELECT id, COALESCE(NULLIF(trim(trading_name), ''), company) AS name FROM sponsorship_partners WHERE archived_at IS NULL ORDER BY company`);
    let sponsors = 0;
    for (const p of partners.rows) {
      // "CUPRA Christchurch (Miles Group)" → "CUPRA Christchurch": the bracket is who signs, not what is on the shirt.
      const name = String(p.name).replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 60);
      const r = await client.query(
        `INSERT INTO social_labels (kind, name, hint, partner_id) SELECT 'sponsor', $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM social_labels WHERE kind = 'sponsor' AND archived_at IS NULL AND (lower(name) = lower($1) OR partner_id = $3))`,
        [name, `The ${name} name or logo is visible, or the caption names them.`, p.id],
      );
      sponsors += r.rowCount ?? 0;
    }
    console.log(`  seeded ${added} content types and ${sponsors} sponsors (of ${partners.rowCount} signed partners)`);

    // The rules, each proven by a write that must be refused.
    const { rows: [label] } = await client.query(`SELECT id FROM social_labels WHERE kind = 'asset' LIMIT 1`);
    const { rows: [post] } = await client.query(`SELECT id FROM social_posts LIMIT 1`);
    await expectRefused(client, "the same live label name twice is refused", `INSERT INTO social_labels (kind, name) SELECT 'asset', upper(name) FROM social_labels WHERE id = $1`, [label.id]);
    await expectRefused(client, "a content type tied to a partner is refused", `INSERT INTO social_labels (kind, name, partner_id) VALUES ('asset', '_probe', $1)`, [partners.rows[0]?.id ?? 1]);
    await expectRefused(client, "a person's label that is not confirmed is refused", `INSERT INTO social_post_labels (post_id, label_id, source) VALUES ($1, $2, 'person')`, [post.id, label.id]);
    await expectRefused(client, "confirmed and rejected at once is refused", `INSERT INTO social_post_labels (post_id, label_id, source, confirmed_at, rejected_at) VALUES ($1, $2, 'rambo', now(), now())`, [post.id, label.id]);
    await client.query("SAVEPOINT t");
    await client.query(`INSERT INTO social_post_labels (post_id, label_id, source) VALUES ($1, $2, 'rambo')`, [post.id, label.id]);
    let twice = false;
    try {
      await client.query(`INSERT INTO social_post_labels (post_id, label_id, source, confirmed_at) VALUES ($1, $2, 'person', now())`, [post.id, label.id]);
    } catch {
      twice = true;
    }
    await client.query("ROLLBACK TO SAVEPOINT t");
    ok("one label on one post twice is refused", twice);
    await expectRefused(client, "deleting a label that is on a post is refused", `WITH x AS (INSERT INTO social_post_labels (post_id, label_id, source) VALUES ($1, $2, 'rambo')) DELETE FROM social_labels WHERE id = $2`, [post.id, label.id]);

    if (COMMIT && fail === 0) {
      await client.query("COMMIT");
      console.log("\nCOMMITTED");
    } else {
      await client.query("ROLLBACK");
      console.log(COMMIT ? "\nROLLED BACK (a check failed)" : "\nRehearsal only: rolled back. Add --commit to apply.");
    }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    fail++;
  } finally {
    client.release();
    await pool.end();
    console.log(`${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
