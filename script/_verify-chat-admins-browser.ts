// Room admins in the Members dialog — a REAL browser, as the room's owner.
// The live verifier proves the rules at the API; this proves a person can
// actually find and use them: the badge, the row menu, appoint, remove.
//   npx tsx --env-file=.env script/_verify-chat-admins-browser.ts
//   SHOTS=/dir … saves screenshots.
import "dotenv/config";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.SHOTS || "";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (c: boolean, l: string, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${l}${d ? " — " + d : ""}`); };
const users: number[] = []; const channels: number[] = [];
let browser: any = null;
const settle = (ms = 2200) => new Promise((r) => setTimeout(r, ms));

async function mkUser(name: string, leadership: boolean) {
  const email = `chatadminui-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  const r = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,$2,'UiProbe',$3,'team_member',true) RETURNING id`, [email, name, await bcrypt.hash(password, 10)]);
  const id = r.rows[0].id; users.push(id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs) VALUES ($1,1,$2,NULL)`, [id, leadership ? "admin" : "team_member"]);
  const lr = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!lr.ok) throw new Error(`login ${name}: ${lr.status}`);
  const [n, v] = (lr.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { id, name, cookie: { name: n, value: v }, raw: `${n}=${v}` };
}
async function shot(page: any, name: string) {
  if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function main() {
  const A = await mkUser("Owner", true), B = await mkUser("Bella", false), C = await mkUser("Cody", false);
  const hdr = { Cookie: A.raw, "X-Workspace-Slug": "christchurch-united", "Content-Type": "application/json" };
  const created = await fetch(`${BASE}/api/admin/chat/channels`, { method: "POST", headers: hdr, body: JSON.stringify({ name: `probe-ui-${crypto.randomBytes(3).toString("hex")}`, isPrivate: true }) });
  const ch = (await created.json()).id as number; channels.push(ch);
  await fetch(`${BASE}/api/admin/chat/channels/${ch}/members`, { method: "POST", headers: hdr, body: JSON.stringify({ userIds: [B.id, C.id] }) });

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e.message).slice(0, 120)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...A.cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), "christchurch-united");
  await page.goto(`${BASE}/admin/chat?c=${ch}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3000);

  console.log(`\nMembers dialog as the OWNER  (${BASE})\n`);
  const opened = await page.evaluate(() => { const b = document.querySelector('[data-testid="button-members"]') as HTMLElement | null; if (!b) return false; b.click(); return true; });
  ok(opened, "the members button is on the channel header");
  await settle(1500);
  await shot(page, "01-members-owner");
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="members-row-"]')).map((r) => ({
    id: Number((r.getAttribute("data-testid") || "").replace("members-row-", "")),
    role: (r.querySelector('[data-testid^="members-role-"]') as HTMLElement | null)?.innerText.trim().toLowerCase() ?? "",
    menu: !!r.querySelector('[data-testid^="members-menu-"]'),
  })));
  ok(rows.length === 3, "three people are listed", `${rows.length}`);
  ok(rows.find((r) => r.id === A.id)?.role === "owner", "the creator carries the OWNER badge");
  ok(rows.find((r) => r.id === A.id)?.menu === false, "no menu on the owner's own row — nobody manages the owner");
  ok(rows.filter((r) => r.id !== A.id).every((r) => r.menu), "every other member has a row menu");

  // Make Bella an admin.
  await page.click(`[data-testid="members-menu-${B.id}"]`);
  await settle(800);
  const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) => (el as HTMLElement).innerText.trim()));
  ok(items.some((t) => /make admin/i.test(t)) && items.some((t) => /remove from/i.test(t)), "the menu offers Make admin and Remove", items.join(" | "));
  await shot(page, "02-row-menu");
  await page.click('[data-testid="members-make-admin"]');
  await settle(2500);
  const bRole = await page.evaluate((id: number) => (document.querySelector(`[data-testid="members-role-${id}"]`) as HTMLElement | null)?.innerText.trim().toLowerCase() ?? "", B.id);
  ok(bRole === "admin", "Bella now carries the ADMIN badge", bRole);
  await shot(page, "03-admin-badge");

  // Remove Cody, with the inline confirm.
  await page.click(`[data-testid="members-menu-${C.id}"]`);
  await settle(800);
  await page.click('[data-testid="members-remove"]');
  await settle(800);
  const confirmShown = await page.evaluate(() => !!document.querySelector('[data-testid="members-remove-confirm"]'));
  ok(confirmShown, "removing asks once, inline — never a browser dialog");
  await shot(page, "04-remove-confirm");
  await page.click('[data-testid="members-remove-confirm"]');
  await settle(2500);
  const after = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="members-row-"]')).map((r) => Number((r.getAttribute("data-testid") || "").replace("members-row-", ""))));
  ok(!after.includes(C.id) && after.length === 2, "Cody is gone from the list", after.join(","));
  const gone = await pool.query(`SELECT left_at FROM staff_channel_members WHERE channel_id=$1 AND user_id=$2`, [ch, C.id]);
  ok(gone.rows[0]?.left_at != null, "…and the server agrees (left_at set)");
  await shot(page, "05-after-remove");
  await page.close();

  // As Bella (now admin): she gets the menus; as a plain member she would not.
  console.log(`\nMembers dialog as the new ADMIN\n`);
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 390, height: 844 });
  await p2.setCookie({ ...B.cookie, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
  await p2.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p2.evaluate((s: string) => localStorage.setItem("clubos_workspace", s), "christchurch-united");
  await p2.goto(`${BASE}/admin/chat?c=${ch}`, { waitUntil: "networkidle2", timeout: 60000 });
  await settle(3000);
  await p2.evaluate(() => (document.querySelector('[data-testid="button-members"]') as HTMLElement | null)?.click());
  await settle(1500);
  await shot(p2, "06-members-admin-phone");
  const rows2 = await p2.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="members-row-"]')).map((r) => ({
    id: Number((r.getAttribute("data-testid") || "").replace("members-row-", "")),
    menu: !!r.querySelector('[data-testid^="members-menu-"]'),
  })));
  ok(rows2.find((r) => r.id === A.id)?.menu === false, "an admin sees no menu on the owner's row");
  ok(rows2.find((r) => r.id === B.id)?.menu === false, "…and none on her own row");
  const width = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(width.sw <= width.iw + 1, "the dialog fits a phone", `${width.sw}/${width.iw}`);
  ok(errors.length === 0, "no React error", errors.slice(0, 2).join(" · "));
  await p2.close();
}

main()
  .catch((e) => { console.error("\nthrew:", e); fail++; })
  .finally(async () => {
    if (browser) await browser.close().catch(() => {});
    for (const id of channels) await pool.query(`DELETE FROM staff_channels WHERE id=$1`, [id]).catch(() => {});
    for (const id of users) {
      await pool.query(`DELETE FROM staff_channel_members WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM staff_chat_presence WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch(() => {});
    }
    await pool.end();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
