/**
 * ClubOS Websites (phase 1) — apply the migration and PROVE its rules.
 *   npx tsx --env-file=.env script/apply-site-articles.ts            # dry run, rolled back
 *   npx tsx --env-file=.env script/apply-site-articles.ts --commit   # for real
 *
 * Proven: idempotent; a bad site key / domain / deploy hook is refused; one live
 * grant per person per site (a revoked one is history and a new grant is fine);
 * an unknown level is refused; a slug is unique per site but may repeat across
 * sites; a bad slug is refused; scheduling needs a time; a published article
 * must carry its first-published moment; versions and events are append-only;
 * a site with articles cannot be deleted; deleting an article takes its
 * versions; RLS is on for every table.
 */
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
const ok = (l: string) => console.log(`  ✓ ${l}`);
const bad = (l: string) => { problems.push(l); console.log(`  ✗ ${l}`); };
async function mustReject(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, params); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — was ACCEPTED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(label); }
}
async function mustAccept(c: pg.Client, label: string, sql: string, params: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, params); await c.query("RELEASE SAVEPOINT s"); ok(label); return r.rows[0]; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); return null; }
}

const TABLES = ["site_sites", "site_members", "site_articles", "site_versions", "site_events", "site_ai_usage"];

async function main() {
  const sql = readFileSync(join(process.cwd(), "migrations", "2026-11-01_site_articles.sql"), "utf8");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  ClubOS Websites — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(sql); ok("migration ran");
    await c.query(sql); ok("migration is idempotent (ran twice)");
    await c.query("SAVEPOINT fixtures");

    const u = await mustAccept(c, "a throwaway person", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_site_probe@usg.co.nz','Probe','Site','x','team_member',true) RETURNING id`);
    const u2 = await mustAccept(c, "a second throwaway person", `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ('_site_probe2@usg.co.nz','Probe','Two','x','team_member',true) RETURNING id`);
    const siteIns = `INSERT INTO site_sites (key, brand, domain, name, deploy_hook_url) VALUES ($1,$2,$3,$4,$5) RETURNING id`;
    const s1 = await mustAccept(c, "a site", siteIns, ["probe-site", "cufc", "probe.example.nz", "Probe", null]);
    const s2 = await mustAccept(c, "a second site", siteIns, ["probe-two", "mfl", "probe2.example.nz", "Probe two", "https://api.vercel.com/v1/integrations/deploy/prj_x/abc"]);
    await mustReject(c, "a site key with capitals is refused", siteIns, ["Probe", "cufc", "x.nz", "x", null]);
    await mustReject(c, "a duplicate site key is refused", siteIns, ["probe-site", "cufc", "y.example.nz", "y", null]);
    await mustReject(c, "a domain with a scheme is refused", siteIns, ["probe-3", "cufc", "https://x.nz", "x", null]);
    await mustReject(c, "a deploy hook that is not Vercel's is refused", siteIns, ["probe-4", "cufc", "z.example.nz", "z", "https://evil.example/hook"]);

    const memIns = `INSERT INTO site_members (site_id, user_id, level, granted_by_user_id) VALUES ($1,$2,$3,1) RETURNING id`;
    const m1 = await mustAccept(c, "a writer grant", memIns, [s1.id, u.id, "writer"]);
    await mustReject(c, "a second live grant for the same person on the same site is refused", memIns, [s1.id, u.id, "editor"]);
    await mustReject(c, "an unknown level is refused", memIns, [s1.id, u2.id, "owner"]);
    await mustAccept(c, "the same person may hold a grant on another site", memIns, [s2.id, u.id, "editor"]);
    await mustAccept(c, "revoking keeps the row", `UPDATE site_members SET revoked_at = now(), revoked_by_user_id = 1 WHERE id = $1 RETURNING id`, [m1.id]);
    await mustAccept(c, "…and a new grant after a revoke is fine", memIns, [s1.id, u.id, "editor"]);

    const artIns = `INSERT INTO site_articles (site_id, slug, title, status, display_date, publish_at, first_published_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;
    const a1 = await mustAccept(c, "a draft article", artIns, [s1.id, "probe-article", "Probe", "draft", "2026-11-01", null, null]);
    await mustReject(c, "the same slug twice on one site is refused", artIns, [s1.id, "probe-article", "Again", "draft", "2026-11-01", null, null]);
    await mustAccept(c, "the same slug on another site is fine", artIns, [s2.id, "probe-article", "Other", "draft", "2026-11-01", null, null]);
    await mustReject(c, "a slug with a space is refused", artIns, [s1.id, "bad slug", "x", "draft", "2026-11-01", null, null]);
    await mustReject(c, "an empty title is refused", artIns, [s1.id, "empty-title", "  ", "draft", "2026-11-01", null, null]);
    await mustReject(c, "scheduling with no time is refused", artIns, [s1.id, "sched-no-time", "x", "scheduled", "2026-11-01", null, null]);
    await mustReject(c, "published with no first-published moment is refused", artIns, [s1.id, "pub-no-moment", "x", "published", "2026-11-01", null, null]);
    await mustReject(c, "an unknown status is refused", artIns, [s1.id, "weird", "x", "live", "2026-11-01", null, null]);
    await mustAccept(c, "a backdated published article", artIns, [s1.id, "backdated", "Old news", "published", "2016-08-27", null, "2026-11-01T00:00:00Z"]);
    await mustReject(c, "a hero image that is not a URL or a site path is refused", `UPDATE site_articles SET hero_image = 'javascript:alert(1)' WHERE id = $1`, [a1.id]);

    const verIns = `INSERT INTO site_versions (article_id, version, action, snapshot, saved_by_user_id) VALUES ($1,$2,'save','{}'::jsonb,1) RETURNING id`;
    const v1 = await mustAccept(c, "a version row", verIns, [a1.id, 1]);
    await mustReject(c, "the same version number twice is refused", verIns, [a1.id, 1]);
    await mustReject(c, "a version cannot be rewritten (append-only)", `UPDATE site_versions SET action = 'tampered' WHERE id = $1`, [v1.id]);
    const ev = await mustAccept(c, "an event row", `INSERT INTO site_events (site_id, article_id, user_id, action) VALUES ($1,$2,1,'publish') RETURNING id`, [s1.id, a1.id]);
    await mustReject(c, "an event cannot be rewritten (append-only)", `UPDATE site_events SET action = 'tampered' WHERE id = $1`, [ev.id]);
    await mustReject(c, "…not even by clearing its article and changing something else", `UPDATE site_events SET article_id = NULL, action = 'tampered' WHERE id = $1`, [ev.id]);
    await mustReject(c, "a site with articles cannot be deleted", `DELETE FROM site_sites WHERE id = $1`, [s1.id]);
    await c.query(`DELETE FROM site_articles WHERE id = $1`, [a1.id]);
    const left = await c.query(`SELECT count(*)::int n FROM site_versions WHERE article_id = $1`, [a1.id]);
    left.rows[0].n === 0 ? ok("deleting an article takes its versions") : bad("versions outlived their article");
    const evLeft = await c.query(`SELECT article_id FROM site_events WHERE id = $1`, [ev.id]);
    evLeft.rows[0]?.article_id === null ? ok("…while its events stay, unlinked") : bad("events were lost or still linked");
    await mustAccept(c, "a Rambo usage row", `INSERT INTO site_ai_usage (site_id, user_id, model, ok) VALUES ($1,$2,'claude-sonnet-5-5',true) RETURNING id`, [s1.id, u.id]);
    await mustReject(c, "a negative cost is refused", `INSERT INTO site_ai_usage (site_id, model, cost_usd_cents) VALUES ($1,'m',-1)`, [s1.id]);

    for (const t of TABLES) {
      const r = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [t]);
      r.rows[0]?.relrowsecurity ? ok(`RLS is on: ${t}`) : bad(`RLS is OFF: ${t}`);
    }
    await c.query("ROLLBACK TO SAVEPOINT fixtures");
    if (problems.length) throw new Error(`${problems.length} problem(s)`);
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${COMMIT ? "Committed." : "Rolled back (dry run)."}\n`);
  } catch (e: any) {
    await c.query("ROLLBACK");
    console.error(`\n  Rolled back: ${e.message}\n`);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main();
