// Live check of the e-Sign template builder + open link, as ORDINARY STAFF
// (team_member, tabs ["esign"] only, SIU workspace) — never as a super admin,
// who bypasses the checks this has to prove. Creates a PROBE template, publishes
// it, opens its link, has a stranger start + sign an agreement, and deletes
// everything it made. One real Rambo call proves the key path on production.
//
//   npx tsx --env-file=.env script/_verify-esign-templates-live.ts [--no-rambo]
//   SHOTS=/path to save screenshots
import "dotenv/config";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
const WS = "south-island-united";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${l}${d ? " — " + d : ""}`); };
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const made = { users: [] as number[], templates: [] as number[], docs: [] as number[] };
let browser: any = null;

const PNG_1x1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function main() {
  const email = `delivered+esigntpl-${crypto.randomBytes(4).toString("hex")}@resend.dev`;
  const password = crypto.randomBytes(16).toString("base64url");
  const u = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Probe','Staff',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  made.users.push(u.rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,2,'team_member','["esign"]'::jsonb)`, [u.rows[0].id]);
  const lr = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!lr.ok) throw new Error(`login: ${lr.status}`);
  const [cn, cv] = (lr.headers.get("set-cookie") || "").split(";")[0].split("=");
  const H = { Cookie: `${cn}=${cv}`, "X-Workspace-Slug": WS, "Content-Type": "application/json" };
  const api = async (method: string, path: string, body?: any) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get("content-type") || "";
    return { status: r.status, json: ct.includes("json") ? await r.json() : null, bytes: ct.includes("pdf") ? Buffer.from(await r.arrayBuffer()) : null };
  };

  console.log(`\nAPI as ordinary staff (${BASE})\n`);
  const lib = await api("GET", "/api/admin/esign/templates/library");
  ok(lib.status === 200, "library opens for a staff member with only the e-Sign tab", String(lib.status));
  ok(lib.json?.defaultBrandKey === "siu", "the SIU workspace starts templates in the SIU brand", lib.json?.defaultBrandKey);

  const created = await api("POST", "/api/admin/esign/templates", { name: "PROBE Volunteer Agreement", brandKey: "siu", form: [{ label: "Full name", type: "text" }], content: { sections: [{ heading: "Terms", items: [{ kind: "p", text: "Hi {{full_name}}" }] }] } });
  ok(created.status === 200 && created.json?.id > 0, "a blank template is created as a draft", String(created.status));
  const id = created.json?.id; made.templates.push(id);
  ok(created.json?.published === false, "a new template is a DRAFT");

  const badPub = await api("PUT", `/api/admin/esign/templates/${id}`, { name: "PROBE Volunteer Agreement", brandKey: "siu", form: [{ label: "Full name", type: "text" }], content: { docTitle: "PROBE", sections: [{ heading: "Terms", items: [{ kind: "p", text: "Pays {{mystery_fee}}" }] }] }, settings: { published: true } });
  ok(badPub.status === 400 && (badPub.json?.problems ?? []).some((p: string) => p.includes("mystery_fee")), "publishing with an unknown {{placeholder}} is refused, naming it");

  const notInList = await api("GET", "/api/admin/esign/templates");
  ok(!(notInList.json ?? []).some((t: any) => t.id === id), "a draft is NOT offered for sending");

  const good = { name: "PROBE Volunteer Agreement", description: "Probe — deleted after the check", brandKey: "siu",
    form: [{ key: "full_name", label: "Full name", type: "text", required: true }, { key: "phone", label: "Phone", type: "phone", required: true }],
    variables: [{ key: "season", label: "Season", type: "text", required: true, default: "2027" }],
    content: { docTitle: "PROBE Volunteer Agreement", partiesIntro: ["Between South Island United and {{full_name}}."], sections: [{ heading: "The Deal", items: [{ kind: "bullet", text: "Season {{season}}" }, { kind: "numbered", text: "Turn up on time." }] }], signAck: "I agree." },
    settings: { published: true, counterSignerRole: "The Club", primarySignerRole: "The Volunteer", detailsHeading: "Volunteer details" } };
  const pub = await api("PUT", `/api/admin/esign/templates/${id}`, good);
  ok(pub.status === 200 && pub.json?.published === true, "a clean template publishes", String(pub.status));
  const inList = await api("GET", "/api/admin/esign/templates");
  ok((inList.json ?? []).some((t: any) => t.id === id), "once published it is offered for sending");

  const pv = await api("POST", "/api/admin/esign/templates/preview", good);
  ok(pv.status === 200 && !!pv.bytes && pv.bytes.subarray(0, 4).toString() === "%PDF", "Preview returns the PDF", `${pv.bytes?.length ?? 0} bytes`);

  const olNoSig = await api("POST", `/api/admin/esign/templates/${id}/open-link`, { enabled: true });
  ok(olNoSig.status === 400, "an open link needs the club's signature first (we sign first)");
  const ol = await api("POST", `/api/admin/esign/templates/${id}/open-link`, { enabled: true, signatureName: "Probe Staff", signatureImage: PNG_1x1, consent: true });
  ok(ol.status === 200 && ol.json?.openLink?.enabled === true, "the link opens once the club signs", String(ol.status));
  const url: string = ol.json?.openLink?.url ?? "";
  const token = url.split("/agree/")[1] ?? "";
  ok(/^[a-f0-9]{48}$/.test(token), "the link carries a random, unguessable token");

  console.log(`\nThe open link, as a stranger\n`);
  const info = await fetch(`${BASE}/api/public/agree/${token}`).then((r) => r.json());
  ok(info?.docTitle === "PROBE Volunteer Agreement", "the public link shows the agreement title");
  const honey = await fetch(`${BASE}/api/public/agree/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bot", email: "bot@example.com", website: "spam" }) }).then((r) => r.json());
  ok(honey?.ok === true && honey?.token === null, "a bot filling the honeypot gets the same answer and nothing is made");
  const signerEmail = `delivered+esignsigner-${crypto.randomBytes(4).toString("hex")}@resend.dev`;
  const st = await fetch(`${BASE}/api/public/agree/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Pat Probe", email: signerEmail }) }).then((r) => r.json());
  ok(typeof st?.token === "string" && st.token.length > 20, "a real person gets their own signing link");
  const docRow = await pool.query(`SELECT d.id, d.status FROM esign_documents d JOIN esign_signers s ON s.document_id = d.id WHERE s.token = $1`, [st.token]);
  const docId = docRow.rows[0]?.id; if (docId) made.docs.push(docId);
  const clubRow = await pool.query(`SELECT status, signature_name FROM esign_signers WHERE document_id = $1 AND is_form_signer = false`, [docId]);
  ok(clubRow.rows[0]?.status === "signed" && clubRow.rows[0]?.signature_name === "Probe Staff", "the agreement opens ALREADY signed by the club");
  const view = await fetch(`${BASE}/api/sign/${st.token}`).then((r) => r.json());
  ok(view?.docType === "native" && !!view?.native, "their link opens the branded signing page");
  const signed = await fetch(`${BASE}/api/sign/${st.token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signatureName: "Pat Probe", signatureImage: PNG_1x1, consent: true, formData: { full_name: "Pat Probe", phone: "021 000 0000" } }) }).then((r) => r.json());
  ok(signed?.ok === true && signed?.allComplete === true, "their signature completes the agreement", JSON.stringify(signed).slice(0, 80));
  const fin = await pool.query(`SELECT status FROM esign_documents WHERE id = $1`, [docId]);
  ok(fin.rows[0]?.status === "completed", "the document is completed with a signed PDF");

  const closed = await api("POST", `/api/admin/esign/templates/${id}/open-link`, { enabled: false });
  ok(closed.json?.openLink?.enabled === false, "the link closes");
  const after = await fetch(`${BASE}/api/public/agree/${token}`);
  ok(after.status === 404, "a closed link answers 'not open'");
  const unpub = await api("PUT", `/api/admin/esign/templates/${id}`, { ...good, settings: { ...good.settings, published: false } });
  ok(unpub.json?.published === false, "unpublishing moves it back to draft");

  if (!process.argv.includes("--no-rambo")) {
    console.log(`\nRambo (one real call)\n`);
    const r = await api("POST", "/api/admin/esign/templates/rambo", { prompt: "A one-page photo and video consent form for parents of junior players at South Island United holiday camps.", brandKey: "siu" });
    ok(r.status === 200 && (r.json?.template?.content?.sections ?? []).length > 0, "Rambo drafts a template on production", `${r.status} ${r.json?.message ?? r.json?.template?.name ?? ""}`);
    ok(r.json?.template?.settings?.published === false, "Rambo's draft is never published");
  }

  console.log(`\nIn the browser\n`);
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  for (const vp of [{ w: 1440, h: 900, tag: "desktop" }, { w: 390, h: 844, tag: "phone" }]) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2 });
    await page.setCookie({ name: cn, value: cv, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), WS);
    await page.goto(`${BASE}/admin/esign#templates`, { waitUntil: "networkidle2", timeout: 60000 });
    await settle(2500);
    ok(!!(await page.$(`[data-testid="template-card-${id}"]`)), `${vp.tag}: the Templates view lists the template`);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${vp.tag}-library.png` }); }
    await page.click(`[data-testid="template-card-${id}"]`);
    await settle(2500);
    ok(!!(await page.$('[data-testid="template-editor"]')), `${vp.tag}: the editor opens`);
    ok(page.url().endsWith(`#templates/${id}`), `${vp.tag}: the open template is in the URL`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!overflow, `${vp.tag}: no sideways scroll`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.tag}-editor.png` });
    ok(errors.length === 0, `${vp.tag}: no page errors`, errors.join(" | "));
    await page.close();
  }
  // The public page on a phone, with a fresh open link.
  await api("PUT", `/api/admin/esign/templates/${id}`, good);
  await api("POST", `/api/admin/esign/templates/${id}/open-link`, { enabled: true, signatureName: "Probe Staff", signatureImage: PNG_1x1, consent: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/agree/${token}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(1500);
  ok(!!(await page.$('[data-testid="agree-form"]')), "phone: the open link page shows the start form");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-agree.png` });
  await page.type('[data-testid="agree-name"]', "Sam Probe");
  await page.type('[data-testid="agree-email"]', `delivered+esignui-${crypto.randomBytes(3).toString("hex")}@resend.dev`);
  await page.click('[data-testid="agree-start"]');
  await settle(4000);
  ok(/\/sign\/[a-f0-9]{48}$/.test(page.url()), "phone: Continue lands on their own signing page", page.url().slice(-60));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-sign.png` });
  const d2 = await pool.query(`SELECT document_id FROM esign_signers WHERE token = $1`, [page.url().split("/sign/")[1]]);
  if (d2.rows[0]) made.docs.push(d2.rows[0].document_id);
}

async function cleanup() {
  try { if (browser) await browser.close(); } catch {}
  if (made.docs.length) await pool.query(`DELETE FROM esign_documents WHERE id = ANY($1::int[])`, [made.docs]);
  if (made.templates.length) {
    await pool.query(`DELETE FROM esign_documents WHERE template_id = ANY($1::int[])`, [made.templates]);
    await pool.query(`DELETE FROM esign_templates WHERE id = ANY($1::int[])`, [made.templates]);
  }
  if (made.users.length) {
    await pool.query(`DELETE FROM esign_ai_usage WHERE user_id = ANY($1::int[])`, [made.users]);
    await pool.query(`DELETE FROM user_organizations WHERE user_id = ANY($1::int[])`, [made.users]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::int[])`, [made.users]);
  }
  await pool.end();
}

main().catch((e) => { fail++; console.error("ERROR", e); }).finally(async () => {
  await cleanup();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
