// Email History, checked against production as ORDINARY STAFF.
//   npx tsx --env-file=.env script/_verify-mailer-history-live.ts
import pg from "pg";
import bcrypt from "bcryptjs";
const BASE = process.env.VERIFY_BASE ?? "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, m: string, x = "") => { c ? (pass++, console.log(`  ✓ ${m}`)) : (fail++, console.log(`  ✗ ${m}${x ? ` — ${x}` : ""}`)); };

async function main() {
  const email = `_mh_${Date.now()}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows: u } = await pool.query(
    `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Hist','Probe',$2,'team_member',true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)]);
  const uid = u[0].id;
  const { rows: o } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [WS]);
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,$2,'admin',NULL)`, [uid, o[0].id]);
  try {
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    const get = async (p: string) => { const r = await fetch(`${BASE}${p}`, { headers: { cookie, "X-Workspace-Slug": WS } }); return { status: r.status, body: await r.json().catch(() => null) as any }; };

    console.log(`\nEmail History — ${BASE}\n`);

    const list = await get(`/api/admin/mailer/campaigns?limit=20&offset=0`);
    ok(list.status === 200, "the history list answers", `HTTP ${list.status}`);
    const rows: any[] = list.body?.campaigns ?? [];
    ok(rows.length > 0, `campaigns come back (${rows.length} of ${list.body?.total ?? 0})`);
    ok(typeof list.body?.total === "number", "a total comes back, so the page can say 'X of Y entries'");
    ok(rows.every(r => "senderName" in r), "every row carries senderName");
    ok(rows.every(r => "createdByUserId" in r), "every row carries createdByUserId");

    // 🔴 The 24 campaigns that predate the column must read honestly, never as
    // an invented person.
    const { rows: [{ n: unrecorded }] } = await pool.query(`SELECT count(*)::int n FROM email_campaigns WHERE created_by_user_id IS NULL`);
    ok(rows.filter(r => r.createdByUserId == null).every(r => r.senderName == null),
      `a campaign with no sender returns senderName null, not a guess (${unrecorded} such campaigns)`);

    // Search must actually narrow.
    const one = rows[0];
    const searched = await get(`/api/admin/mailer/campaigns?q=${encodeURIComponent(String(one.subject).slice(0, 12))}`);
    ok(searched.status === 200 && (searched.body?.campaigns ?? []).length > 0, "search finds a known subject");
    ok((searched.body?.total ?? 0) <= (list.body?.total ?? 0), "search narrows rather than widens");

    // Recipients.
    const rec = await get(`/api/admin/mailer/campaigns/${one.id}/recipients`);
    ok(rec.status === 200, "the recipients endpoint answers", `HTTP ${rec.status}`);
    ok("tracked" in (rec.body ?? {}), "it says whether a per-person list exists at all");
    ok(typeof rec.body?.recipientCount === "number", "it returns the count even when no list exists");
    const people: any[] = rec.body?.people ?? [];
    ok(people.every(p => "name" in p && "email" in p && "firstOpenedAt" in p),
      "each person carries a name, an address and whether they opened it");

    // 🔴 The whole point of the ask: a real NAME beside the address, wherever we
    // can resolve one. Find a campaign that has a tracked list and check it.
    const { rows: [tracked] } = await pool.query(
      `SELECT campaign_id FROM email_campaign_recipients GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
    if (tracked) {
      const big = await get(`/api/admin/mailer/campaigns/${tracked.campaign_id}/recipients`);
      const named = (big.body?.people ?? []).filter((p: any) => p.name);
      ok(big.body?.tracked === true, "a queued send has a real per-person list");
      ok(named.length > 0, `real names resolve beside the addresses (${named.length} of ${(big.body?.people ?? []).length})`);
      // 🔴 A merged duplicate must never SUPPLY the name.
      //
      // ⚠️ The obvious check — "is this address also on a retired record" — is
      // WRONG and passed for the wrong reason at first. A family shares one
      // mailbox, so a retired sibling record carries the same address as the
      // live one; measured on production, ZERO retired records have an email
      // without a live twin. Assert what actually matters: every name returned
      // is a name a LIVE contact with that address really has.
      const { rows: liveNames } = await pool.query(
        `SELECT lower(email) e, first_name||' '||last_name AS n FROM contacts
         WHERE merged_into_contact_id IS NULL AND email IS NOT NULL`);
      const liveByEmail = new Map<string, Set<string>>();
      for (const r of liveNames as any[]) {
        const k = String(r.e);
        if (!liveByEmail.has(k)) liveByEmail.set(k, new Set());
        liveByEmail.get(k)!.add(String(r.n).trim());
      }
      const bad = named.filter((p: any) => !liveByEmail.get(String(p.email).toLowerCase())?.has(String(p.name).trim()));
      ok(bad.length === 0, "every name shown belongs to a LIVE contact at that address",
        bad.slice(0, 3).map((b: any) => `${b.name} <${b.email}>`).join("; "));
    }

    // One campaign in full, for View Message.
    const full = await get(`/api/admin/mailer/campaigns/${one.id}`);
    ok(full.status === 200 && typeof full.body?.body === "string", "the sent HTML comes back for View Message");

    // The page itself renders (a white screen is invisible to every other check).
    const page = await fetch(`${BASE}/admin/mailer/history`, { headers: { cookie } });
    ok(page.status === 200, "the history page is served", `HTTP ${page.status}`);

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
  } finally {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]);
    await pool.end();
  }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("\n✗", e.message ?? e); process.exit(1); });
