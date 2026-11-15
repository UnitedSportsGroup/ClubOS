/**
 * ClubOS Websites — end to end against the REAL database, through real HTTP.
 *   npx tsx --env-file=.env --env-file=../../../../.env script/_verify-sites-e2e.ts
 *   (the second env file brings ANTHROPIC_API_KEY for the one Rambo call; add
 *    --no-rambo to skip it)
 *
 * 🔴 Never boots the ClubOS server (that starts eight schedulers against the
 * live database). It mounts ONLY registerSiteRoutes on a bare Express app with
 * a stand-in session, on a random local port.
 *
 * Throwaway staff (a writer, an editor, an approver and a CUFC admin with NO
 * grant) are created and removed. The probe articles never reach cufc.co.nz:
 * the site is not rebuilt by this script, the article is unpublished before the
 * end, every probe row is deleted, and the site's change stamp is put back.
 */
import express from "express";
import type { AddressInfo } from "net";
import pg from "pg";
import { registerSiteRoutes, runSiteSchedulerOnce } from "../server/site-routes";

const RAMBO = !process.argv.includes("--no-rambo") && !!process.env.ANTHROPIC_API_KEY;
let pass = 0; const fails: string[] = [];
const t = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fails.push(label); console.log(`  ✗ ${label}`, extra ?? ""); }
};

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (s: string, p: any[] = []) => (await db.query(s, p)).rows;

  const site = (await q(`SELECT id, content_changed_at FROM site_sites WHERE key = 'cufc'`))[0];
  if (!site) throw new Error("no cufc site — seed first");
  const stampBefore = site.content_changed_at;

  // ── Throwaway people ──
  const mk = async (tag: string, role: string, tabs: string[] | null) => {
    const u = (await q(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Probe',$2,'x','team_member',true) RETURNING id`, [`_site_e2e_${tag}@usg.co.nz`, tag]))[0];
    await q(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 1, $2, $3::jsonb)`, [u.id, role, tabs ? JSON.stringify(tabs) : null]);
    return u.id as number;
  };
  const W = await mk("writer", "team_member", ["sites"]);
  const E = await mk("editor", "team_member", ["sites"]);
  const P = await mk("approver", "team_member", ["sites"]);
  const A = await mk("cufcadmin", "admin", null);
  const probes = [W, E, P, A];
  const DANIEL = 1;

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req: any, _res, next) => { req.session = { userId: Number(req.headers["x-test-user"]) || undefined }; next(); });
  registerSiteRoutes(app);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (user: number | null, method: string, path: string, body?: any, ws = "christchurch-united") => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (user) headers["x-test-user"] = String(user);
    if (ws) headers["x-workspace-slug"] = ws;
    const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json };
  };
  const S = `/api/admin/sites/${site.id}`;
  const slugs: string[] = [];

  try {
    console.log("\n  Who sees what");
    let r = await call(A, "GET", "/api/admin/sites");
    t("a CUFC workspace ADMIN with no grant sees no site", r.status === 200 && r.json.sites.length === 0, r.json);
    r = await call(A, "GET", `${S}/articles`);
    t("…and the site's articles answer 404 to them", r.status === 404);
    r = await call(DANIEL, "GET", "/api/admin/sites", undefined, "");
    t("no workspace header → 400, even for the super admin", r.status === 400);
    r = await call(DANIEL, "GET", "/api/admin/sites");
    t("super admin in CUFC sees cufc", r.json?.sites?.some((s: any) => s.key === "cufc"));
    r = await call(DANIEL, "GET", "/api/admin/sites", undefined, "united-sports-group");
    t("super admin in USG sees cufc (every site)", r.json?.sites?.some((s: any) => s.key === "cufc"));
    r = await call(DANIEL, "GET", `${S}/articles`, undefined, "united-prints");
    t("a workspace with no site (United Prints) gets 404 for cufc, super admin included", r.status === 404);

    console.log("\n  People");
    r = await call(DANIEL, "POST", `${S}/people`, { userId: W, level: "writer" });
    t("super admin gives a writer", r.status === 200, r.json);
    r = await call(DANIEL, "POST", `${S}/people`, { userId: E, level: "editor" });
    t("super admin gives an editor", r.status === 200, r.json);
    r = await call(DANIEL, "POST", `${S}/people`, { userId: P, level: "approver" });
    t("super admin gives an approver", r.status === 200, r.json);
    r = await call(W, "POST", `${S}/people`, { userId: A, level: "writer" });
    t("a writer cannot give access", r.status === 403);
    r = await call(E, "GET", `${S}/people`);
    t("an editor cannot see the people list", r.status === 403);
    r = await call(P, "POST", `${S}/people`, { userId: A, level: "approver" });
    t("an approver cannot make an approver", r.status === 403);
    r = await call(P, "POST", `${S}/people`, { userId: A, level: "writer" });
    t("an approver gives a writer", r.status === 200, r.json);
    r = await call(P, "DELETE", `${S}/people/${A}`);
    t("…and takes it away", r.status === 200);
    r = await call(A, "GET", `${S}/articles`);
    t("the revoke bites on the very next request", r.status === 404);
    r = await call(DANIEL, "POST", `${S}/people`, { userId: DANIEL, level: "writer" });
    t("a super admin can't be given a level (they hold all of them)", r.status === 400);

    console.log("\n  A writer's draft");
    r = await call(W, "POST", `${S}/articles`, { title: "ClubOS end-to-end probe — not real news", summary: "", body: "First paragraph.\n\nSecond paragraph." });
    t("a writer creates a draft", r.status === 201 && r.json.article.status === "draft", r.json);
    const a1 = r.json.article; slugs.push(a1.slug);
    r = await call(W, "PATCH", `${S}/articles/${a1.id}`, { body: "Edited by the writer.\n\nSecond paragraph.", version: a1.version });
    t("the writer edits their draft (version 2)", r.status === 200 && r.json.article.version === 2, r.json);
    r = await call(W, "PATCH", `${S}/articles/${a1.id}`, { body: "stale", version: 1 });
    t("a save on a stale version is refused (409), never overwrites", r.status === 409);
    r = await call(W, "POST", `${S}/articles/${a1.id}/publish`, { kind: "now", displayDate: "2026-10-30", version: 2 });
    t("a writer cannot publish", r.status === 403);
    r = await call(W, "POST", `${S}/articles/${a1.id}/submit`, {});
    t("the writer sends it for review", r.status === 200 && !!r.json.article.reviewRequestedAt);
    let pub = await call(null, "GET", `/api/public/site/cufc/articles`, undefined, "");
    t("a draft is NOT in the public list", !pub.json.articles.some((x: any) => x.slug === a1.slug));
    t("the public list carries the imported news (≥ 550 articles)", pub.json.total >= 550, pub.json.total);

    console.log("\n  An editor publishes, backdated");
    r = await call(E, "POST", `${S}/articles/${a1.id}/publish`, { kind: "now", displayDate: "2026-10-30", version: 2 });
    t("publishing with no summary/photo is refused", r.status === 400, r.json);
    r = await call(E, "PATCH", `${S}/articles/${a1.id}`, { summary: "A probe.", heroImage: "/img/hero-celebration.jpg", version: 2 });
    t("the editor adds the summary and photo", r.status === 200, r.json);
    r = await call(E, "POST", `${S}/articles/${a1.id}/publish`, { kind: "now", displayDate: "2099-01-01", version: 3 });
    t("publishing now with a FUTURE date is refused", r.status === 400);
    r = await call(E, "POST", `${S}/articles/${a1.id}/publish`, { kind: "now", displayDate: "2026-10-30", version: 3 });
    t("publish now, backdated to 30 Oct", r.status === 200 && r.json.article.status === "published" && r.json.article.displayDate === "2026-10-30", r.json);
    const stamp = (await q(`SELECT content_changed_at FROM site_sites WHERE id = $1`, [site.id]))[0].content_changed_at;
    t("publishing stamps the site as changed (the rebuild trigger)", !!stamp && (!stampBefore || new Date(stamp) > new Date(stampBefore)));
    pub = await call(null, "GET", `/api/public/site/cufc/articles`, undefined, "");
    const seen = pub.json.articles.find((x: any) => x.slug === a1.slug);
    t("now in the public list, dated 30 Oct, with its section", seen?.date === "2026-10-30" && seen?.tag === "Club", seen);
    const one = await call(null, "GET", `/api/public/site/cufc/articles/${a1.slug}`, undefined, "");
    t("the public article carries its body as the site's blocks", JSON.stringify(one.json?.article?.body) === JSON.stringify(["Edited by the writer.", "Second paragraph."]), one.json);
    r = await call(W, "PATCH", `${S}/articles/${a1.id}`, { title: "Writer sneaks a change", version: 4 });
    t("a writer cannot change a published article", r.status === 403);

    console.log("\n  Edit live, then revert");
    r = await call(E, "PATCH", `${S}/articles/${a1.id}`, { title: "ClubOS probe — headline changed", version: 4 });
    t("the editor changes the live headline (version 5)", r.status === 200 && r.json.article.version === 5);
    pub = await call(null, "GET", `/api/public/site/cufc/articles`, undefined, "");
    t("the public list shows the new headline at once (cache dropped)", pub.json.articles.find((x: any) => x.slug === a1.slug)?.title === "ClubOS probe — headline changed");
    r = await call(E, "GET", `${S}/articles/${a1.id}/versions`);
    const versions = r.json.versions as any[];
    t("every save is a version (5 so far)", versions.length === 5 && versions[0].version === 5, versions.map((v) => v.action));
    const v2 = versions.find((v) => v.version === 2);
    r = await call(W, "POST", `${S}/articles/${a1.id}/revert`, { versionId: v2.id, version: 5 });
    t("a writer cannot revert a published article", r.status === 403);
    r = await call(E, "POST", `${S}/articles/${a1.id}/revert`, { versionId: v2.id, version: 5 });
    t("the editor reverts to version 2's words", r.status === 200 && r.json.article.title === "ClubOS end-to-end probe — not real news" && r.json.article.status === "published", r.json);
    t("…which kept the status (still published) and the web address", r.json.article.slug === a1.slug);
    r = await call(E, "GET", `${S}/articles/${a1.id}/versions`);
    t("the revert is itself a new version (6), nothing lost", r.json.versions.length === 6 && /reverted to version 2/.test(r.json.versions[0].action));
    r = await call(E, "PATCH", `${S}/articles/${a1.id}`, { slug: "a-new-address", version: 6 });
    t("a web address that has been public can't change", r.status === 400);

    console.log("\n  Schedule");
    r = await call(E, "POST", `${S}/articles`, { title: "ClubOS scheduled probe — not real news", summary: "Probe.", heroImage: "/img/hero-celebration.jpg", body: "Scheduled." });
    const a2 = r.json.article; slugs.push(a2.slug);
    const when = new Date(Date.now() + 3 * 3600_000).toISOString();
    r = await call(E, "POST", `${S}/articles/${a2.id}/publish`, { kind: "schedule", publishAt: new Date(Date.now() - 60_000).toISOString(), displayDate: "2026-11-01", version: 1 });
    t("scheduling in the past is refused", r.status === 400);
    r = await call(E, "POST", `${S}/articles/${a2.id}/publish`, { kind: "schedule", publishAt: when, version: 1 });
    t("schedule three hours out", r.status === 200 && r.json.article.status === "scheduled", r.json);
    pub = await call(null, "GET", `/api/public/site/cufc/articles`, undefined, "");
    t("a scheduled article is NOT public yet", !pub.json.articles.some((x: any) => x.slug === a2.slug));
    await q(`UPDATE site_articles SET publish_at = now() - interval '1 minute' WHERE id = $1`, [a2.id]); // time passes
    const flipped = await runSiteSchedulerOnce();
    t("the scheduler flips it when its time comes", flipped >= 1);
    const after = (await q(`SELECT status, first_published_at FROM site_articles WHERE id = $1`, [a2.id]))[0];
    t("…to published, with its first-published moment", after.status === "published" && !!after.first_published_at);
    pub = await call(null, "GET", `/api/public/site/cufc/articles`, undefined, "");
    t("…and the public list now has it", pub.json.articles.some((x: any) => x.slug === a2.slug));

    console.log("\n  Unpublish and delete");
    r = await call(E, "POST", `${S}/articles/${a1.id}/publish`, { kind: "unpublish", version: 6 });
    t("the editor unpublishes", r.status === 200 && r.json.article.status === "unpublished");
    pub = await call(null, "GET", `/api/public/site/cufc/articles`, undefined, "");
    t("gone from the public list", !pub.json.articles.some((x: any) => x.slug === a1.slug));
    t("…and listed as withdrawn, so a site holding a code copy drops it", pub.json.withdrawn.includes(a1.slug));
    const gone = await call(null, "GET", `/api/public/site/cufc/articles/${a1.slug}`, undefined, "");
    t("the single-article endpoint answers 404", gone.status === 404);
    r = await call(E, "DELETE", `${S}/articles/${a1.id}`);
    t("an article that was ever public cannot be deleted", r.status === 400);
    r = await call(W, "POST", `${S}/articles`, { title: "ClubOS throwaway draft" });
    const a3 = r.json.article; slugs.push(a3.slug);
    r = await call(W, "DELETE", `${S}/articles/${a3.id}`);
    t("a writer deletes their own never-public draft", r.status === 200);

    if (RAMBO) {
      console.log("\n  Rambo for words (one real call)");
      const used = (await q(`SELECT count(*)::int n FROM site_ai_usage WHERE user_id = $1`, [W]))[0].n;
      r = await call(W, "POST", `${S}/rambo`, { notes: "Probe only. U14 Blue played Cashmere at English Park on Saturday 31 October. Final score 3-1 to United. Goals: Sam (2), Leo (1). Coach said: 'Proud of the effort.'", instruction: "" });
      t("Rambo writes an article from notes", r.status === 200 && r.json?.ok !== false && typeof r.json?.body === "string" && r.json.body.length > 50, r.json);
      t("…in plain paragraphs the site can show (body passes the checks)", Array.isArray(r.json?.problems) && r.json.problems.length === 0);
      t("…using the notes' facts (the score is there)", /3[-–]1/.test(`${r.json?.title} ${r.json?.summary} ${r.json?.body}`));
      const used2 = (await q(`SELECT count(*)::int n FROM site_ai_usage WHERE user_id = $1`, [W]))[0].n;
      t("…and it counts against the person's allowance", used2 === used + 1);
    } else console.log("\n  (Rambo skipped — no ANTHROPIC_API_KEY or --no-rambo)");

    console.log("\n  Revoke");
    r = await call(DANIEL, "DELETE", `${S}/people/${W}`);
    t("super admin takes the writer's access away", r.status === 200);
    r = await call(W, "GET", `${S}/articles/${a2.id}`);
    t("the writer can no longer open the site", r.status === 404);
    const hist = await q(`SELECT revoked_at FROM site_members WHERE site_id = $1 AND user_id = $2`, [site.id, W]);
    t("…and the grant is kept as history, not deleted", hist.length === 1 && !!hist[0].revoked_at);
  } finally {
    server.close();
    // ── Clean up every probe row ──
    const ids = (await q(`SELECT id FROM site_articles WHERE site_id = $1 AND slug = ANY($2::text[])`, [site.id, slugs])).map((x) => x.id);
    await q(`DELETE FROM site_events WHERE site_id = $1 AND (user_id = ANY($2::int[]) OR article_id = ANY($3::int[]) OR (detail->>'userId')::int = ANY($2::int[]))`, [site.id, probes, ids]);
    await q(`DELETE FROM site_articles WHERE id = ANY($1::int[])`, [ids]);
    await q(`DELETE FROM site_events WHERE site_id = $1 AND user_id IS NULL AND action = 'published-on-schedule' AND detail->>'slug' = ANY($2::text[])`, [site.id, slugs]);
    await q(`DELETE FROM site_ai_usage WHERE user_id = ANY($1::int[])`, [probes]);
    await q(`DELETE FROM site_members WHERE user_id = ANY($1::int[])`, [probes]);
    await q(`DELETE FROM user_organizations WHERE user_id = ANY($1::int[])`, [probes]);
    await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [probes]);
    await q(`UPDATE site_sites SET content_changed_at = $2 WHERE id = $1`, [site.id, stampBefore]);
    const left = (await q(`SELECT count(*)::int n FROM site_articles WHERE site_id = $1 AND slug = ANY($2::text[])`, [site.id, slugs]))[0].n;
    console.log(`\n  cleanup: ${left === 0 ? "every probe row removed; site stamp restored" : `${left} PROBE ARTICLES LEFT`}`);
    await db.end();
  }
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
