/**
 * Marketing tabs — how long each one's data takes on PRODUCTION, cold then warm,
 * as an ordinary United Sports Group admin. Reads only; its throwaway login is
 * removed at the end.
 *
 *   npx tsx --env-file=.env script/_time-marketing-live.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const PATHS: [string, string][] = [
  ["Marketing: overview", "marketing-hub/overview?period=30d"],
  ["Marketing: websites", "marketing-hub/websites?period=30d"],
  ["Marketing: forms", "marketing-hub/forms?period=30d"],
  ["Marketing: ads", "marketing-hub/ads?period=30d"],
  ["Marketing: tracked", "marketing-hub/tracked?period=30d"],
  ["Marketing: organic", "marketing-hub/organic?period=30d"],
  ["Marketing: sources", "marketing-hub/sources"],
  ["Campaigns: list", "campaigns"],
  ["Social: accounts", "social/accounts?brand=all&period=30d"],
  ["Social: overview", "social/overview?brand=all&period=30d"],
  ["Social: posts", "social/posts?brand=all&period=30d"],
  ["Social: calendar", "social/calendar?brand=all"],
  ["Websites: 30 days", "web-analytics/report?period=30d"],
  ["Websites: 7 days", "web-analytics/report?period=7d"],
  ["Websites: year", "web-analytics/report?period=ytd"],
  ["Paid Ads: ads", "paid-ads/ads?period=30d"],
  ["Paid Ads: tracked", "paid-ads/tracked?period=30d"],
  ["Email", "email-stats/report?period=30d"],
  ["SMS", "sms-stats/report?period=30d"],
  ["WhatsApp", "whatsapp-stats/report?period=30d"],
];

let userId: number | null = null;
async function main() {
  const email = `_mkt_time_${Date.now()}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Timing', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  userId = rows[0].id;
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'admin', NULL FROM organizations WHERE slug = $2`,
    [userId, USG],
  );
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const get = async (path: string) => {
    const t = Date.now();
    const r = await fetch(`${BASE}/api/admin/${path}`, { headers: { cookie, "X-Workspace-Slug": USG } });
    const body = await r.text();
    return { ms: Date.now() - t, status: r.status, kb: Math.round(body.length / 1024) };
  };
  console.log(`${"".padEnd(24)} ${"first".padStart(8)} ${"again".padStart(8)}   size`);
  for (const [label, path] of PATHS) {
    const a = await get(path);
    const b = await get(path);
    const flag = a.status !== 200 ? `  HTTP ${a.status}` : a.ms > 2000 ? "  SLOW" : "";
    console.log(`${label.padEnd(24)} ${String(a.ms).padStart(6)}ms ${String(b.ms).padStart(6)}ms ${String(a.kb).padStart(5)}KB${flag}`);
  }
}
main()
  .catch((e) => console.error(e))
  .finally(async () => {
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM session WHERE sess::text LIKE $1`, [`%"userId":${userId}%`]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch((e) => console.error("could not remove probe user", userId, e.message));
    }
    await pool.end();
  });
