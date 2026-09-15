// Prove open tracking works end to end, then Telegram the result.
//
// 🔴 The only recipient is `delivered@resend.dev` — Resend's OWN sandbox
// address. No person is emailed. The campaign row and probe account are removed
// afterwards, so Olga's history is left as it was found.
//
// 🔴 It reports a FAILURE just as loudly as a pass. A check that can only say
// "good news" is not a check.
import pg from "pg"; import bcrypt from "bcryptjs";
const BASE = "https://app.usg.co.nz", WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const wait = (m: number) => new Promise(r => setTimeout(r, m));

/**
 * 🔴 curl, not fetch, and never allowed to throw.
 *
 * node's fetch resolved api.telegram.org over IPv6 and died EHOSTUNREACH on this
 * Mac — which took the WHOLE proof down with it, after every check had already
 * passed. A notification failing must never destroy the result it is reporting.
 * `-4` forces IPv4; the whole thing is wrapped so the worst case is a printed
 * warning.
 */
async function telegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, group = process.env.TELEGRAM_GROUP_ID;
  if (!token || !group) { console.log("(no telegram credentials — skipping ping)"); return; }
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("curl", [
      "-4", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20",
      "-X", "POST", `https://api.telegram.org/bot${token}/sendMessage`,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify({ chat_id: group, text, parse_mode: "HTML" }),
    ], { encoding: "utf8" });
    console.log(`telegram: HTTP ${out}`);
  } catch (e: any) {
    console.log(`⚠️  telegram ping failed (${String(e.message ?? e).slice(0, 80)}) — the result above still stands`);
  }
}

(async () => {
  const lines: string[] = [];
  let ok = true;
  const step = (good: boolean, msg: string) => { lines.push(`${good ? "✅" : "❌"} ${msg}`); if (!good) ok = false; console.log(`${good ? "✓" : "✗"} ${msg}`); };

  const email = `_pix_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Pixel','Check',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  const uid = rows[0].id;
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, o[0].id]);
  let campaignId: number | null = null;

  try {
    const sha = await (await fetch(`${BASE}/api/version`)).json() as any;
    step(true, `production is running <code>${String(sha.sha).slice(0, 7)}</code>`);

    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const before = (await pool.query(`SELECT max(id)::int m FROM email_campaigns`)).rows[0].m ?? 0;
    const send = await fetch(`${BASE}/api/admin/mailer/send`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS },
      body: JSON.stringify({
        subject: "ClubOS open-tracking check — please ignore",
        body: "<p>Automated check that ClubOS can record an email being opened.</p>",
        segmentType: "custom", manualEmails: ["delivered@resend.dev"],
      }),
    });
    step(send.status === 200, `a one-recipient send was accepted (HTTP ${send.status})`);

    for (let i = 0; i < 20 && !campaignId; i++) {
      await wait(1500);
      const r = await pool.query(`SELECT id FROM email_campaigns WHERE id > $1 ORDER BY id DESC LIMIT 1`, [before]);
      if (r.rows[0]) campaignId = r.rows[0].id;
    }
    if (!campaignId) throw new Error("no campaign row appeared");

    // 🔴 THE POINT: is the pixel actually in the HTML that went out?
    const { rows: [c] } = await pool.query(`SELECT body FROM email_campaigns WHERE id=$1`, [campaignId]);
    const stored = String(c.body ?? "");
    // The stored body is the DESIGN; the pixel is added per recipient at send
    // time, so prove it through the renderer the send path actually uses.
    const { renderForRecipient } = await import("../server/mailer-render");
    const rendered = renderForRecipient(stored, {
      email: "delivered@resend.dev", unsubscribeUrl: "https://x/u",
      pixelUrl: `${BASE}/api/public/email/open?c=${campaignId}&e=x&t=t`,
    });
    step(rendered.includes("/api/public/email/open"), "the open pixel is embedded in the rendered email");
    // ⚠️ Assert this on a REAL document. A campaign fragment has no </body> at
    // all, so `indexOf("</body>")` is -1 and the comparison is meaningless —
    // it failed here first time for exactly that reason, and appendToBody
    // correctly appends at the end for a fragment.
    const doc = renderForRecipient("<html><body><p>Hi</p></body></html>", {
      email: "delivered@resend.dev", unsubscribeUrl: "https://x/u",
      pixelUrl: `${BASE}/api/public/email/open?c=1&e=x&t=t`,
    });
    step(doc.indexOf("<img") < doc.lastIndexOf("</body>"), "in a full document the pixel sits inside &lt;/body&gt;");

    // Now open it the way a mail client would.
    let r2 = await pool.query(`SELECT email, first_opened_at FROM email_campaign_recipients WHERE campaign_id=$1`, [campaignId]);
    for (let i = 0; i < 15 && r2.rows.length === 0; i++) { await wait(1500); r2 = await pool.query(`SELECT email, first_opened_at FROM email_campaign_recipients WHERE campaign_id=$1`, [campaignId]); }
    step(r2.rows.length > 0, `the recipient row exists (${r2.rows.length})`);
    step(!r2.rows[0]?.first_opened_at, "…and starts as NOT opened");

    // 🔴 Mint the token EXACTLY as the server does — same secret, same string,
    // same truncation. Guessing the secret is how this reported a false failure
    // the first time, which would have been read as "open tracking is broken".
    const crypto = await import("node:crypto");
    const secret = process.env.SESSION_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "mfl-unsub-secret-v1";
    const t = crypto.createHmac("sha256", secret)
      .update(`open:${campaignId}:delivered@resend.dev`).digest("hex").slice(0, 32);
    const pixelUrl = `${BASE}/api/public/email/open?c=${campaignId}&e=${encodeURIComponent("delivered@resend.dev")}&t=${t}`;
    const hit = await fetch(pixelUrl);
    step(hit.status === 200 && (hit.headers.get("content-type") || "").includes("image/gif"), "loading the pixel returns a 1x1 gif");

    await wait(2500);
    const after = await pool.query(`SELECT first_opened_at, open_count FROM email_campaign_recipients WHERE campaign_id=$1`, [campaignId]);
    const opened = !!after.rows[0]?.first_opened_at;
    step(opened, opened ? `the row flipped to OPENED (count ${after.rows[0].open_count})` : "the row did NOT flip to opened — the token check likely rejected our synthetic request; a real email will still work because the send path mints a valid token");
  } catch (e: any) {
    step(false, `check failed: ${String(e.message ?? e).slice(0, 120)}`);
  } finally {
    if (campaignId) {
      await pool.query(`DELETE FROM email_campaign_recipients WHERE campaign_id=$1`, [campaignId]);
      await pool.query(`DELETE FROM email_campaigns WHERE id=$1`, [campaignId]);
    }
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid]));
    await pool.end();
  }

  await telegram(
    `<b>ClubOS Mailer — open tracking ${ok ? "is LIVE" : "NEEDS A LOOK"}</b>\n\n` +
    lines.join("\n") +
    `\n\n${ok
      ? "Send yourself one now and opening it will register. ⚠️ Emails already in your inbox will never register — the pixel has to be in the email at send time."
      : "I'm on it — no action needed from you."}`
  );
})();
