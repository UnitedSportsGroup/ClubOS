/**
 * Social media: collaboration posts. Adds `social_posts.collab_with` (the other
 * accounts a post was shared with as an Instagram collaboration) and can fill it
 * for posts already stored.
 *
 *   npx tsx --env-file=.env script/apply-social-collab.ts                 (adds the column; safe to run again)
 *   npx tsx --env-file=../../.env --env-file=.env script/apply-social-collab.ts --backfill [--brand siu]
 *
 * NULL = never asked. An empty list = asked, and it was the club's post alone.
 * Only collaborators who ACCEPTED are stored: an invite nobody accepted put the
 * post on nobody else's page.
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };

(async () => {
  await pool.query(`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS collab_with text[]`);
  await pool.query(`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS collab_checked_at timestamptz`);
  await pool.query(`CREATE INDEX IF NOT EXISTS social_posts_collab_idx ON social_posts (account_id) WHERE cardinality(collab_with) > 0`);
  console.log("columns ready");
  if (process.argv.includes("--backfill")) {
    const tok = (process.env.META_SOCIAL_ACCESS_TOKEN || "").replace(/^"|"$/g, "").trim();
    if (!tok) throw new Error("META_SOCIAL_ACCESS_TOKEN is not set");
    const brand = arg("--brand");
    const { rows } = await pool.query(
      `SELECT p.id, p.external_id FROM social_posts p JOIN social_accounts a ON a.id = p.account_id
       WHERE a.platform = 'instagram' AND p.collab_checked_at IS NULL AND ($1::text IS NULL OR a.brand = $1) ORDER BY p.posted_at DESC`, [brand]);
    console.log("to ask", rows.length);
    let done = 0, withCollab = 0, failed = 0;
    for (let i = 0; i < rows.length; i += 5) {
      await Promise.all(rows.slice(i, i + 5).map(async (r: any) => {
        try {
          const j: any = await (await fetch(`https://graph.facebook.com/v23.0/${r.external_id}/collaborators?access_token=${tok}`)).json();
          if (j.error) throw new Error(j.error.message);
          const names = (j.data ?? []).filter((d: any) => d.invite_status === "Accepted").map((d: any) => String(d.username).toLowerCase());
          await pool.query(`UPDATE social_posts SET collab_with = $2, collab_checked_at = now() WHERE id = $1`, [r.id, names]);
          done++; if (names.length) withCollab++;
        } catch (e: any) { failed++; if (failed < 4) console.log("failed", r.id, String(e.message).slice(0, 120)); }
      }));
      if (i % 200 === 0) console.log(i, "of", rows.length);
    }
    console.log({ done, withCollab, failed });
  }
  await pool.end(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
