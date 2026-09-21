// POS in the System section of EVERY workspace, Projects hidden in the group
// workspace — checked in a REAL browser as ORDINARY staff.
//
// Daniel, 2026-09-21: "POS could also probably be moved to the system for all
// the workspaces, just because it works across multiple things… find there at
// any time when you need it quickly." / "Projects… can just be hidden now
// because the task tracker is essentially the same thing."
//
// Two people: a SELLER (POS ticked in CUFC, an unrelated tab in USG) who must
// see the register in USG's System section anyway, and an OUTSIDER (USG only,
// no POS anywhere) who must see no link and be refused by the API.
//
//   npx tsx --env-file=.env script/_verify-system-pos-browser.ts
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const made: number[] = [];
let browser: any = null;
const settle = (ms = 2600) => new Promise((r) => setTimeout(r, ms));

async function mkUser(memberships: { slug: string; tabs: string[] | null }[]) {
  const email = `_syspos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@usg.co.nz`;
  const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active)
     VALUES ($1,'System','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(pw, 10)]);
  const id = rows[0].id; made.push(id);
  for (const m of memberships) {
    const { rows: org } = await pool.query(`SELECT id FROM organizations WHERE slug=$1`, [m.slug]);
    await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,$2,'team_member',$3)`,
      [id, org[0].id, m.tabs === null ? null : JSON.stringify(m.tabs)]);
  }
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const [n, v] = (res.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { cookie: { name: n, value: v }, raw: `${n}=${v}` };
}
async function sidebar(page: any) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href^="/admin"]')) as HTMLAnchorElement[];
    return links.map((a) => ({ href: a.getAttribute("href") || "", text: (a.innerText || "").replace(/\s+/g, " ").trim() }));
  });
}
async function shot(page: any, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  const seller = await mkUser([{ slug: "christchurch-united", tabs: ["pos"] }, { slug: "united-sports-group", tabs: ["hiring"] }]);
  const outsider = await mkUser([{ slug: "united-sports-group", tabs: ["hiring"] }]);

  console.log(`\nAPI — the grant is honoured from anywhere, and only the grant\n`);
  const s1 = await fetch(`${BASE}/api/admin/pos/bootstrap`, { headers: { cookie: seller.raw, "X-Workspace-Slug": "united-sports-group" } });
  ok("a seller (POS in CUFC) reaches the register while standing in USG", s1.status === 200, `HTTP ${s1.status}`);
  const s2 = await fetch(`${BASE}/api/admin/pos/bootstrap`, { headers: { cookie: outsider.raw, "X-Workspace-Slug": "united-sports-group" } });
  ok("an outsider (no POS anywhere) is refused", s2.status === 403, `HTTP ${s2.status}`);

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  for (const [who, u, expectPos] of [["seller", seller, true], ["outsider", outsider, false]] as const) {
    console.log(`\nSidebar as the ${who}, standing in United Sports Group  (desktop 1440)\n`);
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCookie({ ...u.cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), "united-sports-group");
    await page.goto(`${BASE}/admin/hiring`, { waitUntil: "networkidle2", timeout: 60000 });
    await settle();
    await shot(page, `01-sidebar-${who}`);
    const links = await sidebar(page);
    const pos = links.filter((l) => l.href === "/admin/pos");
    ok(expectPos ? "the POS link is drawn in USG, where this person holds no POS tab (the CUFC grant carries)" : "no POS link for someone who holds it nowhere",
      expectPos ? pos.length >= 1 : pos.length === 0, `${pos.length} POS links; ${links.map((l) => l.text).filter(Boolean).join(" · ")}`);
    ok("no Projects link in USG", !links.some((l) => l.href === "/admin/projects"));
    if (expectPos) {
      // POS sits in the System section, beside Task Tracker — not among the workspace's own tabs.
      const order = await page.evaluate(() => {
        const heads = Array.from(document.querySelectorAll("*")).filter((el) => /^SYSTEM$/i.test((el as HTMLElement).innerText?.trim() || "") && el.children.length === 0);
        const sys = heads[0];
        if (!sys) return { found: false, posAfterSystem: false };
        const posLink = document.querySelector('a[href="/admin/pos"]');
        return { found: true, posAfterSystem: !!posLink && !!(sys.compareDocumentPosition(posLink) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      ok("POS is listed under the System heading", order.found && order.posAfterSystem);
      await page.click('a[href="/admin/pos"]');
      await settle(3500);
      await shot(page, `02-pos-${who}`);
      const body = await page.evaluate(() => document.body.innerText || "");
      ok("clicking it opens the register from USG", /\/admin\/pos/.test(page.url()) && /All brands|Charge|Takings|Sales/.test(body), page.url().replace(BASE, ""));
    }
    ok(`no React error (${who})`, errors.length === 0, errors.slice(0, 2).join(" · "));
    await page.close();
  }

  // The seller in CUFC (which used to list POS in Navigation) sees it ONCE, in System.
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setCookie({ ...seller.cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), "christchurch-united");
    await page.goto(`${BASE}/admin/pos`, { waitUntil: "networkidle2", timeout: 60000 });
    await settle();
    const links = await sidebar(page);
    ok("in CUFC the POS link appears exactly once (System), not twice", links.filter((l) => l.href === "/admin/pos").length === 1, `${links.filter((l) => l.href === "/admin/pos").length}`);
    await page.close();
  }
}

main()
  .catch((e) => { console.error("\nthrew:", e.message); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const id of made) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
