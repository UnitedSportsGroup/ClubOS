// A/B tests + click tracking, end to end on PRODUCTION.
//   npx tsx --env-file=.env script/_verify-mailer-ab-live.ts
//
// 🔴 The only recipients are `delivered+…@resend.dev` — Resend's OWN sandbox
// address with labels, so the list has twelve "people" and no human is
// emailed. Every row this writes (campaign, test, links, clicks, recipients,
// email logs, the probe account) is removed in `finally`.
//
// Three sends, as a real send would run them:
//   1. A LINK test on 12 people at 50%: 3 get A ("Register now"), 3 get B
//      ("Save my spot"), 6 wait. A person clicks A's button; a scanner clicks
//      it; a sweep walks every link in a B email. The winner is picked by hand
//      of the tick (the route), the rest go out with A's wording.
//   2. A SUBJECT test on 4 people at 100%: everyone in, half and half, nobody
//      waits, B's half get subject B.
//   3. A plain send: links wrapped, rows queued then sent, status 'sent'.
import pg from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const WS = "christchurch-united";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const wait = (m: number) => new Promise((r) => setTimeout(r, m));
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

const stamp = Date.now();
const addr = (n: number | string) => `delivered+ab${stamp}_${n}@resend.dev`;
const BODY = (label: string) => `<!doctype html><html><body style="font-family:Arial">
<p>Hi {{first_name}}, this is an automated ClubOS check (${label}). Please ignore.</p>
<table role="presentation"><tr><td align="center" bgcolor="#1d4ed8" style="border-radius:6px"><a href="https://cufc.co.nz/register" style="display:inline-block;background:#1d4ed8;color:#ffffff;padding:12px 28px;text-decoration:none">Register now</a></td></tr></table>
<p><a href="https://cufc.co.nz/programmes">See the programmes</a></p>
</body></html>`;

const campaignIds: number[] = [];
let uid: number | null = null;

async function api(cookie: string, path: string, body?: any, method = body ? "POST" : "GET") {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", cookie, "X-Workspace-Slug": WS },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function campaignFor(subject: string): Promise<number> {
  for (let i = 0; i < 30; i++) {
    const r = await pool.query(`SELECT id FROM email_campaigns WHERE subject = $1 ORDER BY id DESC LIMIT 1`, [subject]);
    if (r.rows[0]) return r.rows[0].id;
    await wait(1000);
  }
  throw new Error("no campaign row appeared");
}

async function waitForStatus(id: number, statuses: string[], seconds: number): Promise<string> {
  let last = "";
  for (let i = 0; i < seconds; i++) {
    const r = await pool.query(`SELECT status FROM email_campaigns WHERE id = $1`, [id]);
    last = r.rows[0]?.status ?? "";
    if (statuses.includes(last)) return last;
    await wait(1000);
  }
  return last;
}

async function loggedBody(to: string): Promise<{ subject: string; body: string } | null> {
  for (let i = 0; i < 20; i++) {
    const r = await pool.query(`SELECT subject, body FROM email_logs WHERE to_email = $1 ORDER BY id DESC LIMIT 1`, [to]);
    if (r.rows[0]) return r.rows[0];
    await wait(1000);
  }
  return null;
}

try {
  console.log(`\nMailer A/B tests — live against ${BASE}\n`);
  const version = await (await fetch(`${BASE}/api/version`)).json().catch(() => ({})) as any;
  console.log(`  production runs ${String(version?.sha ?? "?").slice(0, 7)}`);

  // The canary, before anything else.
  const canary = await fetch(`${BASE}/api/admin/mailer/tests`);
  ok("the canary /api/admin/mailer/tests answers 401 unauthenticated", canary.status === 401, String(canary.status));

  const email = `_ablive_${stamp}@usg.co.nz`, pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(`INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'AB','Check',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  uid = rows[0].id;
  await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,'admin',NULL)`, [uid]);
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!login.ok) throw new Error(`login HTTP ${login.status}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  // ── 1. A link test, 12 people, 50% ────────────────────────────────────────
  const subj1 = `ClubOS A/B check ${stamp} — link`;
  const list1 = Array.from({ length: 12 }, (_, i) => addr(i + 1));
  const bad = await api(cookie, "/api/admin/mailer/send", {
    subject: subj1, body: BODY("link"), fromEmail: "Christchurch United FC <noreply@cufc.co.nz>", replyTo: "info@cufc.co.nz",
    segmentType: "custom", manualEmails: list1, test: { kind: "link", target: "Buy tickets", b: "x", samplePct: 50, waitMinutes: 60 },
  });
  ok("a link test naming a wording the email lacks is refused before anything is written", bad.status === 400 && /No link in this email/.test(bad.j.message || ""), `${bad.status} ${bad.j.message}`);
  const same = await api(cookie, "/api/admin/mailer/send", {
    subject: subj1, body: BODY("link"), fromEmail: "Christchurch United FC <noreply@cufc.co.nz>",
    segmentType: "custom", manualEmails: list1, test: { kind: "subject", b: subj1, samplePct: 50, waitMinutes: 60 },
  });
  ok("a subject test with the same subject twice is refused", same.status === 400, `${same.status} ${same.j.message}`);

  const send1 = await api(cookie, "/api/admin/mailer/send", {
    subject: subj1, body: BODY("link"), fromEmail: "Christchurch United FC <noreply@cufc.co.nz>", replyTo: "info@cufc.co.nz",
    segmentType: "custom", manualEmails: list1, test: { kind: "link", target: "Register now", b: "Save my spot", samplePct: 50, waitMinutes: 60 },
  });
  ok("the link test send is accepted", send1.status === 200 && send1.j.queued === true, `${send1.status} ${JSON.stringify(send1.j).slice(0, 200)}`);
  ok("…3 get A, 3 get B, 6 wait, judged by clicks", send1.j.test?.aCount === 3 && send1.j.test?.bCount === 3 && send1.j.test?.restCount === 6 && send1.j.test?.metric === "clicks", JSON.stringify(send1.j.test));
  ok("…and the plan is in words", /A to 3 and B to 3 now, then whichever has more clicks goes to the other 6 after 1 hour\./.test(send1.j.test?.plan || ""), send1.j.test?.plan);
  const c1 = send1.j.campaignId as number;
  campaignIds.push(c1);

  const rowsNow = await pool.query(`SELECT status, variant, in_test, count(*)::int n FROM email_campaign_recipients WHERE campaign_id = $1 GROUP BY 1,2,3 ORDER BY 1,2`, [c1]);
  ok("all 12 are on the list from the start (6 queued with no letter, 6 in the test)",
    rowsNow.rows.reduce((n, r) => n + r.n, 0) === 12 && rowsNow.rows.some((r) => r.status === "queued" && r.variant === null && r.n === 6),
    JSON.stringify(rowsNow.rows));
  const links1 = await pool.query(`SELECT idx, url, label, kind FROM email_campaign_links WHERE campaign_id = $1 ORDER BY idx`, [c1]);
  ok("the email's two links are recorded, the button as a button", links1.rows.length === 2 && links1.rows.some((l) => l.label === "Register now" && l.kind === "button") && links1.rows.some((l) => l.label === "See the programmes"), JSON.stringify(links1.rows));
  const t1 = (await pool.query(`SELECT * FROM email_campaign_tests WHERE campaign_id = $1`, [c1])).rows[0];
  ok("the test row says 50%, 60 minutes, decide in about an hour", t1 && t1.sample_pct === 50 && t1.wait_minutes === 60 && t1.decide_at && Math.abs(new Date(t1.decide_at).getTime() - (Date.now() + 3600_000)) < 120_000, t1 ? `decide_at ${t1.decide_at}` : "no row");

  const st1 = await waitForStatus(c1, ["testing", "sent", "failed"], 90);
  ok("the sample went out and the campaign is 'testing'", st1 === "testing", st1);
  const sent1 = (await pool.query(`SELECT email, variant, status FROM email_campaign_recipients WHERE campaign_id = $1 AND in_test ORDER BY variant, email`, [c1])).rows;
  ok("the six in the test are sent (Resend took the labelled sandbox addresses)", sent1.length === 6 && sent1.every((r) => r.status === "sent"), JSON.stringify(sent1.map((r) => `${r.variant}:${r.status}`)));
  const aPerson = sent1.find((r) => r.variant === "A")!;
  const bPerson = sent1.find((r) => r.variant === "B")!;
  const aMail = await loggedBody(aPerson.email);
  const bMail = await loggedBody(bPerson.email);
  ok("A's email still reads 'Register now'", !!aMail && aMail.body.includes(">Register now</a>"), aMail ? "" : "no log");
  ok("B's email reads 'Save my spot' and nothing else changed", !!bMail && bMail.body.includes(">Save my spot</a>") && !bMail.body.includes(">Register now</a>") && bMail.body.includes("See the programmes"), bMail ? "" : "no log");
  const trackedRe = /https:\/\/app\.usg\.co\.nz\/e\/c\/(\d+)\/(\d+)\/(\d+)\/([a-f0-9]+)/g;
  const aLinks = Array.from((aMail?.body || "").matchAll(trackedRe));
  // (The open pixel has always carried the address in its query; the tracked
  // links are what must not.)
  ok("every link in A's email is a tracked redirect carrying the campaign and the row id, never the address", aLinks.length === 2 && aLinks.every((m) => Number(m[1]) === c1 && !m[0].includes("@") && !m[0].includes("%40")), String(aLinks.length));
  ok("the unsubscribe link is NOT wrapped", /\/api\/public\/unsubscribe\?o=/.test(aMail?.body || ""));
  ok("the open pixel is still there", /\/api\/public\/email\/open\?c=/.test(aMail?.body || ""));
  ok("the subject carries no test change on a link test", aMail?.subject === subj1 && bMail?.subject === subj1, `${aMail?.subject} | ${bMail?.subject}`);

  const buttonIdx = links1.rows.find((l) => l.label === "Register now")!.idx;
  const aButton = aLinks.find((m) => Number(m[3]) === buttonIdx)![0];
  const aOther = aLinks.find((m) => Number(m[3]) !== buttonIdx)![0];
  // A person clicks A's button.
  const click = await fetch(aButton, { redirect: "manual", headers: { "user-agent": PHONE_UA } });
  const loc = click.headers.get("location") || "";
  ok("a click answers 302 to the real page, with email attribution on it", click.status === 302 && loc.startsWith("https://cufc.co.nz/register") && /utm_source=email/.test(loc) && /[?&]ci=emc/.test(loc), `${click.status} ${loc}`);
  ok("…and never caches", /no-store/.test(click.headers.get("cache-control") || ""));
  await wait(1500);
  const aRow = (await pool.query(`SELECT first_clicked_at, click_count, first_opened_at FROM email_campaign_recipients WHERE campaign_id=$1 AND email=$2`, [c1, aPerson.email])).rows[0];
  ok("the person's row shows one click, and counts as opened", !!aRow.first_clicked_at && aRow.click_count === 1 && !!aRow.first_opened_at, JSON.stringify(aRow));
  // A scanner clicks the same button.
  const bot = await fetch(aButton, { redirect: "manual", headers: { "user-agent": "curl/8.4.0" } });
  await wait(1200);
  const aRow2 = (await pool.query(`SELECT click_count FROM email_campaign_recipients WHERE campaign_id=$1 AND email=$2`, [c1, aPerson.email])).rows[0];
  const botRows = (await pool.query(`SELECT suspected_bot FROM email_campaign_clicks WHERE campaign_id=$1 ORDER BY id`, [c1])).rows;
  ok("a scanner's click is sent on but flagged, and not counted", bot.status === 302 && aRow2.click_count === 1 && botRows.length === 2 && botRows[1].suspected_bot === true && botRows[0].suspected_bot === false, JSON.stringify({ status: bot.status, count: aRow2.click_count, rows: botRows }));
  // A sweep: B's email has every link walked within a second.
  const bLinks = Array.from((bMail?.body || "").matchAll(trackedRe)).map((m) => m[0]);
  await fetch(bLinks[0], { redirect: "manual", headers: { "user-agent": PHONE_UA } });
  await fetch(bLinks[1], { redirect: "manual", headers: { "user-agent": PHONE_UA } });
  await wait(1500);
  const bRow = (await pool.query(`SELECT click_count, first_clicked_at FROM email_campaign_recipients WHERE campaign_id=$1 AND email=$2`, [c1, bPerson.email])).rows[0];
  const bClicks = (await pool.query(`SELECT suspected_bot FROM email_campaign_clicks k JOIN email_campaign_recipients r ON r.id = k.recipient_id WHERE r.email=$1 ORDER BY k.id`, [bPerson.email])).rows;
  ok("two different links within three seconds is a scanner's sweep: both flagged, nothing counted, no first click left on the person", bRow.click_count === 0 && bRow.first_clicked_at === null && bClicks.length === 2 && bClicks.every((k) => k.suspected_bot), JSON.stringify({ count: bRow.click_count, first: bRow.first_clicked_at, clicks: bClicks }));
  // Tampering.
  const forged = await fetch(aButton.replace(/[a-f0-9]+$/, "deadbeefdeadbeefdeadbeef"), { redirect: "manual" });
  ok("a forged signature is a 404, not a redirect", forged.status === 404, String(forged.status));
  const wrongIdx = await fetch(aOther.replace(/\/(\d+)\/([a-f0-9]+)$/, "/99/$2"), { redirect: "manual" });
  ok("a signature for another link is a 404", wrongIdx.status === 404, String(wrongIdx.status));
  const head = await fetch(aButton, { method: "HEAD", redirect: "manual" });
  ok("a HEAD probe is answered 200 and logs nothing", head.status === 200 && (await pool.query(`SELECT count(*)::int n FROM email_campaign_clicks WHERE campaign_id=$1`, [c1])).rows[0].n === 4, String(head.status));

  // The scoreboard before the decision.
  const res1 = await api(cookie, `/api/admin/mailer/campaigns/${c1}/results`);
  ok("the results read A: 1 of 3 clicked the button, B: 0 of 3, A ahead by clicks", res1.j.variants?.A?.targetClicked === 1 && res1.j.variants?.B?.targetClicked === 0 && res1.j.test?.leading === "A" && res1.j.test?.leadingReason === "clicks", JSON.stringify({ A: res1.j.variants?.A, B: res1.j.variants?.B, lead: res1.j.test?.leading }));
  ok("the tested button is marked and shows one person", res1.j.links?.some((l: any) => l.isTarget && l.people === 1 && l.clicks === 1), JSON.stringify(res1.j.links));
  const running = await api(cookie, "/api/admin/mailer/tests");
  ok("the running-tests list carries it", running.j.tests?.some((t: any) => t.campaign_id === c1), JSON.stringify(running.j).slice(0, 200));
  const rec1 = await api(cookie, `/api/admin/mailer/campaigns/${c1}/recipients`);
  ok("the recipients endpoint says 6 waiting, 1 clicked, status testing", rec1.j.queuedCount === 6 && rec1.j.clickedCount === 1 && rec1.j.status === "testing" && rec1.j.people?.some((p: any) => p.status === "queued" && p.variant === null), JSON.stringify({ q: rec1.j.queuedCount, c: rec1.j.clickedCount, s: rec1.j.status }));

  // Preview as a person (an unknown address reads "there").
  const pv = await api(cookie, "/api/admin/mailer/preview-as", { email: aPerson.email, subject: "Hi {{first_name}}", body: BODY("preview"), variant: "B", test: { kind: "link", variantA: "Register now", variantB: "Save my spot" } });
  ok("preview-as resolves the subject, swaps B's wording, carries the unsubscribe link and no pixel, and wraps no link", pv.status === 200 && pv.j.subject === "Hi there" && pv.j.html.includes(">Save my spot</a>") && /\/api\/public\/unsubscribe\?o=/.test(pv.j.html) && !/email\/open\?c=/.test(pv.j.html) && !/\/e\/c\//.test(pv.j.html), `${pv.status} ${pv.j.subject}`);

  // Decide now (the numbers say A).
  const dec = await api(cookie, `/api/admin/mailer/campaigns/${c1}/test/decide`, {});
  ok("deciding now picks A by clicks", dec.status === 200 && dec.j.winner === "A" && dec.j.decidedBy === "clicks", JSON.stringify(dec.j));
  const st1b = await waitForStatus(c1, ["sent", "failed"], 90);
  ok("the rest went out and the campaign is 'sent'", st1b === "sent", st1b);
  const t1b = (await pool.query(`SELECT winner, decided_by, decided_at, rest_sent_at, deciding_at, attachments FROM email_campaign_tests WHERE campaign_id = $1`, [c1])).rows[0];
  ok("the verdict is stamped and the rest marked sent, the claim released", t1b.winner === "A" && t1b.decided_by === "clicks" && !!t1b.decided_at && !!t1b.rest_sent_at && t1b.deciding_at === null, JSON.stringify(t1b));
  const rest1 = (await pool.query(`SELECT email, variant, in_test, status FROM email_campaign_recipients WHERE campaign_id = $1 AND NOT in_test ORDER BY email`, [c1])).rows;
  ok("the six who waited got A, outside the test, and are sent", rest1.length === 6 && rest1.every((r) => r.variant === "A" && r.status === "sent"), JSON.stringify(rest1.map((r) => `${r.variant}:${r.status}`)));
  const restMail = await loggedBody(rest1[0].email);
  ok("…with A's wording and tracked links", !!restMail && restMail.body.includes(">Register now</a>") && /\/e\/c\//.test(restMail.body), restMail ? "" : "no log");
  const again = await api(cookie, `/api/admin/mailer/campaigns/${c1}/test/decide`, { winner: "B" });
  ok("deciding again is refused — the winner has gone to everyone", again.status === 409, `${again.status} ${again.j.message}`);
  const res1b = await api(cookie, `/api/admin/mailer/campaigns/${c1}/results`);
  ok("the results now say A won by clicks and the rest got A", res1b.j.test?.winner === "A" && res1b.j.test?.decidedBy === "clicks" && res1b.j.variants?.rest?.sent === 6, JSON.stringify({ w: res1b.j.test?.winner, rest: res1b.j.variants?.rest }));
  const running2 = await api(cookie, "/api/admin/mailer/tests");
  ok("…and it has left the running list", !running2.j.tests?.some((t: any) => t.campaign_id === c1));

  // ── 2. A subject test on everyone (100%) ──────────────────────────────────
  const subj2 = `ClubOS A/B check ${stamp} — subject A`;
  const subj2b = `ClubOS A/B check ${stamp} — subject B`;
  const list2 = ["s1", "s2", "s3", "s4"].map(addr);
  const send2 = await api(cookie, "/api/admin/mailer/send", {
    subject: subj2, body: BODY("subject"), fromEmail: "Christchurch United FC <noreply@cufc.co.nz>",
    segmentType: "custom", manualEmails: list2, test: { kind: "subject", b: subj2b, samplePct: 100, waitMinutes: 120 },
  });
  ok("a subject test on everyone is accepted: 2 A, 2 B, nobody waits", send2.status === 200 && send2.j.test?.aCount === 2 && send2.j.test?.bCount === 2 && send2.j.test?.restCount === 0 && send2.j.test?.decideAt === null, JSON.stringify(send2.j.test));
  const c2 = send2.j.campaignId as number;
  campaignIds.push(c2);
  const st2 = await waitForStatus(c2, ["sent", "failed"], 60);
  ok("it ends 'sent' straight away (no winner to send)", st2 === "sent", st2);
  const bSubj = (await pool.query(`SELECT email FROM email_campaign_recipients WHERE campaign_id=$1 AND variant='B' LIMIT 1`, [c2])).rows[0];
  const aSubj = (await pool.query(`SELECT email FROM email_campaign_recipients WHERE campaign_id=$1 AND variant='A' LIMIT 1`, [c2])).rows[0];
  const bm = await loggedBody(bSubj.email);
  const am = await loggedBody(aSubj.email);
  ok("B's half got subject B, A's half subject A", bm?.subject === subj2b && am?.subject === subj2, `${am?.subject} | ${bm?.subject}`);
  const res2 = await api(cookie, `/api/admin/mailer/campaigns/${c2}/results`);
  ok("its results show no hold-out and a tie so far (A keeps it)", res2.j.test?.restCount === 0 && res2.j.test?.leading === "A" && res2.j.test?.leadingReason === "tie", JSON.stringify(res2.j.test));
  const dec2 = await api(cookie, `/api/admin/mailer/campaigns/${c2}/test/decide`, {});
  ok("deciding a test with nobody waiting is refused with the reason", dec2.status === 409 && /nobody waiting/i.test(dec2.j.message || ""), `${dec2.status} ${dec2.j.message}`);

  // ── 3. A plain send still tracks its links ────────────────────────────────
  const subj3 = `ClubOS A/B check ${stamp} — plain`;
  const list3 = ["p1", "p2"].map(addr);
  const send3 = await api(cookie, "/api/admin/mailer/send", {
    subject: subj3, body: BODY("plain"), fromEmail: "Christchurch United FC <noreply@cufc.co.nz>", segmentType: "custom", manualEmails: list3,
  });
  ok("a plain send is accepted with no test", send3.status === 200 && send3.j.test === null, JSON.stringify(send3.j).slice(0, 120));
  const c3 = send3.j.campaignId as number;
  campaignIds.push(c3);
  const st3 = await waitForStatus(c3, ["sent", "failed"], 60);
  const plainRows = (await pool.query(`SELECT status, variant, in_test FROM email_campaign_recipients WHERE campaign_id=$1`, [c3])).rows;
  ok("it ends 'sent', both rows sent with no letter", st3 === "sent" && plainRows.length === 2 && plainRows.every((r) => r.status === "sent" && r.variant === null && !r.in_test), JSON.stringify(plainRows));
  const pm = await loggedBody(list3[0]);
  ok("…and its links are tracked too", !!pm && (pm.body.match(/\/e\/c\//g) || []).length === 2, pm ? String((pm.body.match(/\/e\/c\//g) || []).length) : "no log");
  const res3 = await api(cookie, `/api/admin/mailer/campaigns/${c3}/results`);
  ok("its results carry the links and no test", res3.j.test === null && res3.j.links?.length === 2, JSON.stringify(res3.j).slice(0, 160));
} catch (e: any) {
  ok(`the proof ran to the end`, false, String(e?.message ?? e).slice(0, 200));
} finally {
  for (const id of campaignIds) {
    await pool.query(`DELETE FROM email_campaigns WHERE id = $1`, [id]).catch(() => {});
  }
  await pool.query(`DELETE FROM email_logs WHERE to_email LIKE $1`, [`delivered+ab${stamp}_%@resend.dev`]).catch(() => {});
  await pool.query(`DELETE FROM email_click_tokens WHERE email LIKE $1`, [`delivered+ab${stamp}_%@resend.dev`]).catch(() => {});
  if (uid) {
    await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => pool.query(`UPDATE users SET active=false WHERE id=$1`, [uid]));
  }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
