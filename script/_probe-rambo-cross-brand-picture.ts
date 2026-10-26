// One paid prompt (~5c): can Rambo, inside a CUFC email, put a GYMNASTICS
// picture in — of young kids — for a United Gymnastics free session?
//   npx tsx --env-file=.env script/_probe-rambo-cross-brand-picture.ts
// Daniel, 2026-10-27: it could not; the kit rule and the captions were the
// reason. Signs in as a throwaway admin, asks once, deletes the account.
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

const MJML = `<mjml><mj-body background-color="#f4f4f4"><mj-section background-color="#ffffff"><mj-column>
<mj-image src="https://app.usg.co.nz/mailer/crests/cufc.png" width="64px" alt="Christchurch United" />
<mj-text font-size="24px" font-weight="700">A free gymnastics session for your 4 to 8 year old</mj-text>
<mj-text>Our friends at United Gymnastics are opening the gym to Christchurch United families for a free session these holidays.</mj-text>
<mj-button href="https://cugc.co.nz/free-session">Book a free session</mj-button>
</mj-column></mj-section></mj-body></mjml>`;

let uid: number | null = null;
try {
  console.log(`\nRambo — a gymnastics picture in a football email, against ${BASE}\n`);
  const email = `_rambopic_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Rambo','Pic',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  uid = rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,'admin',NULL)`, [uid]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const r = await fetch(`${BASE}/api/admin/mailer/ai/edit`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS },
    body: JSON.stringify({
      brandKey: "cufc", mjml: MJML, history: [],
      instruction: "Add a photo of young gymnastics kids — the 4 to 8 range — between the headline and the paragraph, so this reads as a gymnastics email, not a football one. Nothing else.",
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  const out = String(j.mjml || "");
  ok("Rambo answered and changed the email", r.status === 200 && j.ok === true && j.changed === true, `${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  ok("…with the gymnastics beginner-class photo (kids about 5 to 8), not a football one", /\/mailer\/cugc\/hero\.jpg/.test(out) && !/\/mailer\/cufc\/(hero|academy|funino|technification|photo-14)\.jpg/.test(out), (out.match(/\/mailer\/[a-z]+\/[a-z0-9-]+\.jpg/g) || []).join(", "));
  ok("…and the crest, the words and the button are still there", /crests\/cufc\.png/.test(out) && /free gymnastics session/i.test(out) && /cugc\.co\.nz\/free-session/.test(out));
  if (j.reply) console.log(`  Rambo said: ${String(j.reply).slice(0, 200)}`);
} catch (e: any) {
  ok("the probe ran", false, String(e?.message ?? e));
} finally {
  if (uid) {
    await pool.query(`DELETE FROM mailer_ai_usage WHERE user_id=$1`, [uid]).catch(() => {});
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid]));
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
