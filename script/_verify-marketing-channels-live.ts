/**
 * Marketing channel tabs — Website analytics · Paid ads · Email · SMS · WhatsApp.
 * Prove on PRODUCTION that each opens for ordinary staff who hold that tab,
 * is refused to those who do not, and returns real data.
 *
 *   npx tsx --env-file=.env script/_verify-marketing-channels-live.ts
 *
 * Signs in as ORDINARY staff (never a super admin). Read-only; the throwaway
 * logins are cleaned up at the end.
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
  const email = `_mkt_${tag}_${Date.now()}@usg.co.nz`;
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
  fetch(`${BASE}/api/admin/${path}`, {
    ...init,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(workspace ? { "X-Workspace-Slug": workspace } : {}),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

const REPORTS: [string, string, string][] = [
  ["web-analytics", "web-analytics/report?period=30d", "Website analytics"],
  ["paid-ads", "paid-ads/ads?period=30d", "Paid ads"],
  ["email-stats", "email-stats/report?period=30d", "Email"],
  ["sms-stats", "sms-stats/report?period=30d", "SMS"],
  ["whatsapp-stats", "whatsapp-stats/report?period=30d", "WhatsApp"],
];

async function main() {
  console.log(`\nMarketing channel tabs — on ${BASE}\n`);
  const all = REPORTS.map((r) => r[0]);
  const staff = await account("usg_staff", USG, "team_member", all);
  const other = await account("usg_other", USG, "team_member", ["calendar"]);
  const mfl = await account("mfl_admin", MFL, "admin", null);
  const admin = await account("usg_admin", USG, "admin", null);
  const bodies: Record<string, any> = {};

  for (const [tab, path, label] of REPORTS) {
    console.log(`\n${label}`);
    ok("signed out → 401", (await call(null, path, USG)).status === 401);
    ok("no workspace header → 400", (await call(staff, path, null)).status === 400);
    ok("staff without the tab → 403", (await call(other, path, USG)).status === 403);
    ok("an admin of another workspace, from that workspace → 404", (await call(mfl, path, MFL)).status === 404);
    const t = Date.now();
    const res = await call(staff, path, USG);
    ok("ordinary staff with the tab → 200", res.status === 200, `HTTP ${res.status}, ${Date.now() - t}ms`);
    if (res.ok) bodies[tab] = await res.json();
  }

  console.log("\nOne tab does not open another");
  const onlyEmail = await account("usg_email", USG, "team_member", ["email-stats"]);
  ok("holding Email alone → Email opens", (await call(onlyEmail, "email-stats/report?period=30d", USG)).status === 200);
  ok("…and Paid ads does not", (await call(onlyEmail, "paid-ads/ads?period=30d", USG)).status === 403);
  ok("…and Website analytics does not", (await call(onlyEmail, "web-analytics/report?period=30d", USG)).status === 403);

  console.log("\nWhat production holds");
  const web = bodies["web-analytics"];
  ok("websites have visitors", web?.totals?.visitors > 1000, `${web?.totals?.visitors} visitors, ${web?.sites?.length} sites`);
  ok("pages are listed, most viewed first", web?.pages?.length > 10 && web.pages[0].views >= web.pages[5].views);
  ok("the club's own sites are never counted as a referrer", !(web?.referrers ?? []).some((r: any) => /cufc\.co\.nz$|usg\.co\.nz$|southislandunited\.com$|cicyouth\.com$|minifootball\.co\.nz$/.test(r.host)));
  const adminWeb = await (await call(admin, "web-analytics/report?period=30d", USG)).json();
  ok("admin and ordinary staff see the same visitors", adminWeb?.totals?.visitors === web?.totals?.visitors, `${adminWeb?.totals?.visitors} vs ${web?.totals?.visitors}`);
  const one = await call(staff, "web-analytics/report?period=30d&site=cufc.co.nz", USG);
  const oneBody = one.ok ? await one.json() : null;
  ok("one website on its own has fewer visitors than all of them", oneBody?.totals?.visitors > 0 && oneBody.totals.visitors < web.totals.visitors, String(oneBody?.totals?.visitors));
  ok("…and lists only that website's pages", (oneBody?.pages ?? []).every((p: any) => p.host === "cufc.co.nz"));
  ok("a website from another workspace than the one chosen → 400", (await call(staff, "web-analytics/report?period=30d&workspace=mini-football-leagues&site=cufc.co.nz", USG)).status === 400);
  ok("a malformed website → 400", (await call(staff, "web-analytics/report?site=" + encodeURIComponent("a b/c"), USG)).status === 400);

  const email = bodies["email-stats"];
  ok("email campaigns are listed", email?.campaigns?.length > 3, `${email?.campaigns?.length} campaigns, ${email?.totals?.sent} delivered`);
  ok("no one-to-one email is listed (every row went to ten or more)", (email?.campaigns ?? []).every((c: any) => c.recipients >= 10));
  ok("no email address is in the report", !/[a-z0-9._%+-]+@(gmail|hotmail|outlook|xtra|yahoo|icloud)\./i.test(JSON.stringify(email ?? {})));
  const ads = bodies["paid-ads"];
  ok("Meta ads are connected and have spend", ads?.platforms?.some((p: any) => p.key === "meta_ads" && p.status === "connected") && ads?.totals?.spendCents?.current > 0, JSON.stringify(ads?.totals?.spendCents ?? null));
  const sms = bodies["sms-stats"];
  ok("SMS says which sender is set and how many people can be texted", typeof sms?.provider === "string" && typeof sms?.consent?.canText === "number", `${sms?.provider}, ${sms?.consent?.canText} can be texted`);
  ok("no full phone number is in the SMS report", !/\+64\d{8,}/.test(JSON.stringify(sms ?? {})));
  const wa = bodies["whatsapp-stats"];
  ok("WhatsApp says whether it is connected", typeof wa?.connected === "boolean" && typeof wa?.linkClicks === "number", `connected ${wa?.connected}, ${wa?.linkClicks} link presses`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    for (const id of created) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
