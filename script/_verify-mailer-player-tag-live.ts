// Is the player-tag Mailer what PRODUCTION serves? Proven over HTTP, as a
// signed-in staff member, without emailing a single family.
//
//   npx tsx --env-file=.env script/_verify-mailer-player-tag-live.ts
//
// The tell: the audience resolver reads the guardian's address as well as the
// registrant's, so "By Camp" on FUNiño counts MORE people than the old code did
// (277 vs 208 on 2026-10-06). This asks production for that count and compares
// it to the resolver run locally against the same database — equal means the
// deployed server is running the new resolver; the old figure means it is not.
// The test-send is exercised against Resend's own sink address, which accepts
// and delivers to nobody. A throwaway staff user is created and deleted.
import pg from "pg";
import bcrypt from "bcryptjs";
import { resolveMailerAudience } from "../server/mailer-audience";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`);
  good ? pass++ : fail++;
};
const users: number[] = [];

try {
  console.log(`\nMailer player tag — live against ${BASE}\n`);

  const version = await fetch(`${BASE}/api/version`).then((r) => r.json()).catch(() => null);
  const want = process.env.EXPECT_SHA || "";
  ok("production reports the commit it runs", !!version?.sha, String(version?.sha || "none"));
  if (want) ok("…and it is this tree's HEAD", String(version?.sha || "").startsWith(want.slice(0, 12)), `${version?.sha} vs ${want}`);

  const email = `_playertag_${Date.now()}@usg.co.nz`;
  const password = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'Preflight','PlayerTag',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(password, 10)],
  );
  users.push(rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1, 2, 'admin', NULL)`, [rows[0].id]);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  ok("a staff member can sign in", login.ok, `HTTP ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const H = { "Content-Type": "application/json", Cookie: cookie, "X-Workspace-Slug": "cufc" };

  for (const programId of [4, 16]) {
    const local = await resolveMailerAudience("camp", { campId: programId });
    const r = await fetch(`${BASE}/api/admin/mailer/preview-recipients`, {
      method: "POST", headers: H, body: JSON.stringify({ segmentType: "camp", segmentConfig: { campId: programId } }),
    });
    const j = await r.json().catch(() => ({}));
    ok(`programme ${programId}: production counts the audience the new resolver counts`, r.ok && j.count === local.emails.length,
      `prod ${j.count} vs resolver ${local.emails.length}`);
    const { rows: oldRows } = await pool.query(
      `select count(distinct lower(trim(c.email))) n from registrations r join contacts c on c.id=r.contact_id
        where r.program_id=$1 and r.status='confirmed' and c.email is not null and c.email<>''`, [programId]);
    ok(`programme ${programId}: …and more than the old registrant-only list did`, j.count > Number(oldRows[0].n), `old ${oldRows[0].n}`);
  }

  // Resend's sink: accepted, delivered to nobody. Proves the test-send route
  // resolves the address and renders both tags without a human receiving mail.
  const t = await fetch(`${BASE}/api/admin/mailer/test-send`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      to: "delivered@resend.dev",
      subject: "{{player_first_name}} — player tag proof ({{first_name}})",
      body: "<html><body><p>Hi {{player_first_name}}, from {{first_name}} ({{player_name}}).</p></body></html>",
    }),
  });
  const tj = await t.json().catch(() => ({}));
  ok("test-send with both tags is accepted end to end", t.ok && tj.ok === true, `HTTP ${t.status}, resend ${tj.status}`);

  const anon = await fetch(`${BASE}/api/admin/mailer/preview-recipients`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segmentType: "all" }),
  });
  ok("signed out, the audience is refused", anon.status === 401, `HTTP ${anon.status}`);
} catch (e) {
  fail++;
  console.error("  FAIL", e);
} finally {
  for (const id of users) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
