/**
 * Social media — prove, against PRODUCTION, that the right people can open it,
 * that everyone who can sees the same thing, and that it holds real posts.
 *
 *   npx tsx --env-file=.env script/_verify-social-live.ts
 *
 * 🔴 Signs in as ORDINARY staff, never as Daniel (a super admin short-circuits
 * the checks). Four throwaway accounts and one probe social account, all
 * deleted at the end. It never presses "Update now" (that starts a real pull).
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const MFL = "mini-football-leagues";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

const created: number[] = [];

async function account(tag: string, workspace: string, role: string, tabs: string[] | null): Promise<string> {
  const email = `_social_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `M${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1, 'Social', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  created.push(rows[0].id);
  const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug = $1`, [workspace]);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, $2, $3, $4)`,
    [rows[0].id, org[0].id, role, tabs == null ? null : JSON.stringify(tabs)],
  );
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  if (!res.ok) throw new Error(`login for ${tag} failed: HTTP ${res.status}`);
  return (res.headers.get("set-cookie") || "").split(";")[0];
}

const call = (cookie: string | null, path: string, workspace: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/admin/social/${path}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(workspace ? { "X-Workspace-Slug": workspace } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

async function main() {
  console.log(`\nSocial media — on ${BASE}\n`);

  const anon = await call(null, "accounts", USG);
  ok("signed out → 401", anon.status === 401, `HTTP ${anon.status}`);

  const admin = await account("usg_admin", USG, "admin", null);
  const staff = await account("usg_staff", USG, "team_member", ["social-media"]);
  const other = await account("usg_other", USG, "team_member", ["calendar"]);
  const mfl = await account("mfl_admin", MFL, "admin", null);

  console.log("\nGates");
  ok("no workspace header → 400, for everyone", (await call(admin, "accounts", null)).status === 400);
  ok("an admin of another workspace, from that workspace → 404", (await call(mfl, "accounts", MFL)).status === 404);
  ok("an admin of another workspace, claiming USG → 403", (await call(mfl, "accounts", USG)).status === 403);
  ok("USG staff without the tab → 403", (await call(other, "accounts", USG)).status === 403);
  ok("…and cannot add an account", (await call(other, "accounts", USG, { method: "POST", body: JSON.stringify({ platform: "tiktok", brand: "cufc", profile: "_probe_x" }) })).status === 403);

  console.log("\nEvery view opens for staff who have the tab");
  const bodies: Record<string, any> = {};
  for (const path of ["accounts?brand=all&period=30d", "overview?brand=cufc&period=30d", "overview?brand=all&period=all", "posts?brand=siu&period=all&sort=top&limit=12", "calendar?brand=cufc"]) {
    const t = Date.now();
    const res = await call(staff, path, USG);
    ok(`${path} → 200`, res.status === 200, `HTTP ${res.status}, ${Date.now() - t}ms`);
    if (res.ok) bodies[path.split("&")[0]] = await res.json();
  }

  console.log("\nThe same for everyone who can see it");
  const adminAccounts = await (await call(admin, "accounts?brand=all&period=30d", USG)).json();
  const strip = (b: any) => JSON.stringify(b?.accounts?.map((a: any) => [a.id, a.brand, a.followers, a.postsStored]));
  ok("admin and ordinary staff see identical accounts", strip(adminAccounts) === strip(bodies["accounts?brand=all"]));
  const adminOverview = await (await call(admin, "overview?brand=cufc&period=30d", USG)).json();
  ok("admin and ordinary staff see identical CUFC numbers",
    JSON.stringify([adminOverview.followers, adminOverview.posts, adminOverview.interactions]) ===
    JSON.stringify([bodies["overview?brand=cufc"]?.followers, bodies["overview?brand=cufc"]?.posts, bodies["overview?brand=cufc"]?.interactions]));

  console.log("\nWhat production holds");
  const accounts: any[] = bodies["accounts?brand=all"]?.accounts ?? [];
  const meta = accounts.filter((a) => a.platform === "instagram" || a.platform === "facebook");
  ok("Instagram and Facebook accounts were found automatically", meta.length >= 16, `${meta.length} accounts`);
  ok("every one of them is filed under a brand", meta.every((a) => a.brand), meta.filter((a) => !a.brand).map((a) => a.handle).join(", "));
  ok("every one of them has a follower count", meta.every((a) => a.followers != null), meta.filter((a) => a.followers == null).map((a) => a.handle).join(", "));
  const failing = meta.filter((a) => a.lastError);
  ok("no account's last update failed", failing.length === 0, failing.map((a) => `${a.handle}: ${a.lastError}`).join(" | "));
  const cufc = bodies["overview?brand=cufc"];
  ok("CUFC has followers as a number", typeof cufc?.followers?.total === "number" && cufc.followers.total > 10000, String(cufc?.followers?.total));
  const all = bodies["overview?brand=all"];
  ok("thousands of posts are stored", all?.posts > 3000, `${all?.posts} posts`);
  const cal = bodies["calendar?brand=cufc"];
  ok("the CUFC calendar goes back years", cal?.firstDay && cal.firstDay < "2024-01-01", `first post ${cal?.firstDay}`);
  const posts: any[] = bodies["posts?brand=siu"]?.posts ?? [];
  ok("SIU's best posts come back, best first", posts.length === 12 && posts[0].interactions >= posts[11].interactions);
  ok("a post from another brand never appears under SIU", posts.every((p) => p.brand === "siu"));

  console.log("\nPictures");
  const withThumb = posts.find((p) => p.thumb && p.thumb.startsWith("/api/"));
  if (withThumb) {
    // An <img> cannot send the workspace header, so none is sent here.
    const img = await fetch(`${BASE}${withThumb.thumb}`, { headers: { cookie: staff } });
    const bytes = (await img.arrayBuffer()).byteLength;
    ok("a post's picture loads without the workspace header", img.status === 200 && img.headers.get("content-type") === "image/webp", `HTTP ${img.status}, ${bytes} bytes`);
    ok("…and is small", bytes > 500 && bytes < 120_000, `${bytes} bytes`);
    ok("signed out, the picture is refused", (await fetch(`${BASE}${withThumb.thumb}`)).status === 401);
    ok("staff without the tab cannot load it", (await fetch(`${BASE}${withThumb.thumb}`, { headers: { cookie: other } })).status === 403);
  } else ok("a post with a picture exists to test", false);

  console.log("\nConnecting an account by link");
  const tag = `_probe_${Date.now()}`;
  const meta1 = await call(staff, "accounts", USG, { method: "POST", body: JSON.stringify({ platform: "instagram", brand: "cufc", profile: tag }) });
  ok("Instagram cannot be added by hand (it is found automatically)", meta1.status === 400);
  const wrong = await call(staff, "accounts", USG, { method: "POST", body: JSON.stringify({ platform: "tiktok", brand: "cufc", profile: "https://www.instagram.com/someone" }) });
  ok("an Instagram link given as TikTok → 400", wrong.status === 400);
  const noBrand = await call(staff, "accounts", USG, { method: "POST", body: JSON.stringify({ platform: "tiktok", brand: "nope", profile: tag }) });
  ok("an unknown brand → 400", noBrand.status === 400);
  const add = await call(staff, "accounts", USG, { method: "POST", body: JSON.stringify({ platform: "tiktok", brand: "usc", profile: `https://www.tiktok.com/@${tag}` }) });
  const added = add.ok ? await add.json() : null;
  ok("a TikTok link is saved", add.status === 201 && added?.connection === "link", `HTTP ${add.status}`);
  const again = await call(staff, "accounts", USG, { method: "POST", body: JSON.stringify({ platform: "tiktok", brand: "usc", profile: `@${tag}` }) });
  ok("the same account twice → 400", again.status === 400);
  if (added) {
    const neg = await call(staff, `accounts/${added.id}/followers`, USG, { method: "POST", body: JSON.stringify({ followers: -4 }) });
    ok("a negative follower count → 400", neg.status === 400);
    const typed = await call(staff, `accounts/${added.id}/followers`, USG, { method: "POST", body: JSON.stringify({ followers: 1234 }) });
    ok("followers can be typed in for a saved link", typed.status === 200);
    const list = await (await call(staff, "accounts?brand=usc", USG)).json();
    const mine = list.accounts.find((a: any) => a.id === added.id);
    ok("…and it shows, marked as typed in", mine?.followers === 1234 && mine?.followersSource === "manual");
    const metaAcct = meta[0];
    const refuse = await call(staff, `accounts/${metaAcct.id}/followers`, USG, { method: "POST", body: JSON.stringify({ followers: 1 }) });
    ok("followers cannot be typed over an account ClubOS reads itself", refuse.status === 400);
    const gone = await call(staff, `accounts/${added.id}`, USG, { method: "PATCH", body: JSON.stringify({ archived: true }) });
    const after = await (await call(staff, "accounts?brand=usc", USG)).json();
    ok("removing it takes it off the list", gone.status === 200 && !after.accounts.some((a: any) => a.id === added.id));
  }
  ok("an unknown brand in the filter → 400", (await call(staff, "overview?brand=nope", USG)).status === 400);

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.query(`DELETE FROM social_account_daily WHERE account_id IN (SELECT id FROM social_accounts WHERE handle LIKE '_probe_%')`).catch(() => {});
    await pool.query(`DELETE FROM social_accounts WHERE handle LIKE '_probe_%'`).catch(() => {});
    for (const id of created) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
