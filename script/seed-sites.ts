/**
 * ClubOS Websites — seed the first site and its first grant.
 *   npx tsx --env-file=.env script/seed-sites.ts            # dry run (rolled back)
 *   npx tsx --env-file=.env script/seed-sites.ts --commit
 *
 * - The CUFC site row (cufc.co.nz). No deploy hook: the Vercel project is not
 *   connected to git and the site's build needs Chrome, so it is rebuilt by
 *   the watcher in apps/cufc-website/scripts/rebuild-watch.mjs instead.
 * - Daniel (user 1) is a super admin: every level on every site, implicitly —
 *   no row is written for him.
 * - Travis Graham (travis@cufc.co.nz) as APPROVER on CUFC (Daniel, 2026-11-01:
 *   structural proposals are approved by super admins plus Travis).
 * Nobody else is granted. Daniel adds people himself in the tab.
 * Idempotent: an existing site row is left as it is; an existing grant is kept.
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const TRAVIS_EMAIL = "travis@cufc.co.nz";

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Seed Website — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    const owner = (await c.query(`SELECT id, first_name, role FROM users WHERE id = 1`)).rows[0];
    if (owner?.role !== "super_admin") throw new Error("user 1 is not a super admin — stopping");
    const site = (await c.query(
      `INSERT INTO site_sites (key, brand, domain, name, owner_user_id, owner_note, settings)
       VALUES ('cufc', 'cufc', 'cufc.co.nz', 'Christchurch United — cufc.co.nz', 1,
               'Built on Daniel''s Mac (the prerender needs Chrome): apps/cufc-website/deploy.sh. News comes from this tab at build time; the in-code articles stay as the fallback.',
               '{"tags":["Club","First Team","Academy","Programmes"]}'::jsonb)
       ON CONFLICT (key) DO NOTHING RETURNING id`)).rows[0]
      ?? (await c.query(`SELECT id FROM site_sites WHERE key = 'cufc'`)).rows[0];
    console.log(`  ✓ site cufc → id ${site.id}`);

    const travis = (await c.query(`SELECT id, first_name, last_name, email, role, active FROM users WHERE lower(email) = $1`, [TRAVIS_EMAIL])).rows;
    if (travis.length !== 1) throw new Error(`expected exactly one user ${TRAVIS_EMAIL}, found ${travis.length}`);
    const t = travis[0];
    console.log(`  · found ${t.first_name} ${t.last_name} <${t.email}> id ${t.id}, role ${t.role}, active ${t.active}`);
    const existing = (await c.query(`SELECT level FROM site_members WHERE site_id = $1 AND user_id = $2 AND revoked_at IS NULL`, [site.id, t.id])).rows[0];
    if (existing) console.log(`  ✓ Travis already holds ${existing.level} — left as it is`);
    else {
      await c.query(`INSERT INTO site_members (site_id, user_id, level, granted_by_user_id) VALUES ($1, $2, 'approver', 1)`, [site.id, t.id]);
      await c.query(`INSERT INTO site_events (site_id, user_id, user_label, action, detail) VALUES ($1, 1, 'Daniel Meyn (seed)', 'access-given', $2::jsonb)`,
        [site.id, JSON.stringify({ userId: t.id, name: `${t.first_name} ${t.last_name}`, level: "approver" })]);
      console.log(`  ✓ Travis → approver on cufc`);
    }
    const members = (await c.query(`SELECT user_id, level FROM site_members WHERE site_id = $1 AND revoked_at IS NULL`, [site.id])).rows;
    console.log(`  · live grants on cufc: ${JSON.stringify(members)}`);
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${COMMIT ? "Committed." : "Rolled back (dry run)."}\n`);
  } catch (e: any) {
    await c.query("ROLLBACK");
    console.error(`\n  Rolled back: ${e.message}\n`);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main();
