// Prove the Email History sender is real: send ONE email as a named ClubOS
// account and check the row comes back stamped and verified.
//
// 🔴 The only recipient is `delivered@resend.dev` — Resend's OWN sandbox
// address. It reaches no person, no inbox, and cannot affect our sending
// reputation. No family is emailed by this script.
// 🔴 The campaign row and the probe account are BOTH removed afterwards, so
// Olga's history is left exactly as it was found.
import pg from "pg"; import bcrypt from "bcryptjs"; import puppeteer from "puppeteer-core";
const BASE = "https://app.usg.co.nz", WS = "christchurch-united";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const wait = (m: number) => new Promise(r => setTimeout(r, m));

(async () => {
  const email = `_sender_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Sender','Check',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  const uid = rows[0].id;
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, o[0].id]);
  let campaignId: number | null = null;

  try {
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const before = (await pool.query(`SELECT max(id)::int m FROM email_campaigns`)).rows[0].m ?? 0;
    const send = await fetch(`${BASE}/api/admin/mailer/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS },
      body: JSON.stringify({
        subject: "ClubOS sender check — please ignore",
        body: "<p>Automated check that ClubOS records who pressed send. No action needed.</p>",
        segmentType: "custom",
        manualEmails: ["delivered@resend.dev"],
      }),
    });
    console.log("send:", send.status, (await send.text()).slice(0, 120));

    for (let i = 0; i < 20 && !campaignId; i++) {
      await wait(1500);
      const r = await pool.query(`SELECT id FROM email_campaigns WHERE id > $1 ORDER BY id DESC LIMIT 1`, [before]);
      if (r.rows[0]) campaignId = r.rows[0].id;
    }
    if (!campaignId) throw new Error("no campaign row appeared");

    const { rows: [c] } = await pool.query(
      `SELECT c.id, c.sender_source, c.created_by_user_id, u.first_name||' '||u.last_name nm
       FROM email_campaigns c LEFT JOIN users u ON u.id=c.created_by_user_id WHERE c.id=$1`, [campaignId]);
    console.log(`\n  campaign #${c.id}`);
    console.log(`  created_by_user_id : ${c.created_by_user_id}  (probe user ${uid})`);
    console.log(`  sender name        : ${c.nm}`);
    console.log(`  sender_source      : ${c.sender_source}`);
    console.log(c.created_by_user_id === uid && c.sender_source === "authenticated"
      ? "  ✓ STAMPED AND AUTHENTICATED — the tick will render"
      : "  ✗ NOT stamped");

    // …and see it on the page.
    const [n, v] = cookie.split("=");
    const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
    const p = await b.newPage(); await p.setViewport({ width: 1440, height: 700, deviceScaleFactor: 2 });
    await p.setCookie({ name: n, value: v, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await p.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WS);
    await p.goto(`${BASE}/admin/mailer/history`, { waitUntil: "networkidle2" }); await wait(4000);
    const shown = await p.evaluate((id: number) => {
      const el = document.querySelector(`[data-testid="sender-${id}"]`) as HTMLElement | null;
      return el ? { text: el.innerText.trim(), verified: el.getAttribute("data-verified"), hasTick: !!el.querySelector("svg") } : null;
    }, campaignId);
    console.log("  on the page        :", JSON.stringify(shown));
    await p.screenshot({ path: "/tmp/sender-proof.png" });
    await b.close();
  } finally {
    // Leave nothing behind.
    if (campaignId) {
      await pool.query(`DELETE FROM email_campaign_recipients WHERE campaign_id=$1`, [campaignId]);
      await pool.query(`DELETE FROM email_campaigns WHERE id=$1`, [campaignId]);
      console.log(`\n  cleaned up campaign #${campaignId}`);
    }
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(async () => {
      await pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid]);
      console.log("  probe account held by an audit row — retired instead");
    });
    await pool.end();
  }
})();
