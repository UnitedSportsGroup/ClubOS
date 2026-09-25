/**
 * Task Board (MFL) — real-browser check as the people who use it.
 *   A: team_member in MFL with task-board granted by name (Isaac's shape) → sees + uses it
 *   B: MFL ADMIN without the grant (Ryan's shape)                        → refused, no link
 * Throwaway users, deleted after; the one test task is hard-deleted.
 *   npx tsx --env-file=.env script/_verify-task-board-browser.ts
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "https://app.usg.co.nz";
const WS = "mini-football-leagues";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`); };
const made: number[] = []; let browser: any = null; let testTaskId: number | null = null;

async function user(role: string, unlocked: string[] | null) {
  const email = `tb-${crypto.randomBytes(5).toString("hex")}@example.com`;
  const password = crypto.randomBytes(16).toString("base64url");
  const r = await pool.query(`INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1,'Board','Probe',$2,'team_member',true) RETURNING id`, [email, await bcrypt.hash(password, 10)]);
  made.push(r.rows[0].id);
  await pool.query(`INSERT INTO user_organizations (user_id, organization_id, role, tabs, unlocked_tabs) VALUES ($1,3,$2,NULL,$3::jsonb)`, [r.rows[0].id, role, unlocked ? JSON.stringify(unlocked) : null]);
  const lr = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (lr.headers.get("set-cookie") || "").split(";")[0];
}
const api = (cookie: string, path: string, init: any = {}) => fetch(`${BASE}${path}`, { ...init, headers: { cookie, "X-Workspace-Slug": WS, "Content-Type": "application/json", ...(init.headers || {}) } });

try {
  const a = await user("team_member", ["task-board"]);
  const b = await user("admin", null);

  const ra = await api(a, "/api/admin/task-board"); const ja = await ra.json();
  ok("granted user reads the board", ra.status === 200 && Array.isArray(ja.tasks), String(ra.status));
  ok("the meeting tasks are there", ja.tasks.filter((t: any) => t.sourceUrl?.includes("fireflies")).length >= 30, `${ja.tasks.length} tasks`);
  ok("people = those who can open it (includes Isaac)", ja.people.some((p: any) => p.id === 15), ja.people.map((p: any) => p.firstName).join(", "));
  const rb = await api(b, "/api/admin/task-board");
  ok("MFL admin WITHOUT the grant is refused", rb.status === 403, String(rb.status));
  const rx = await api(a, "/api/admin/task-board", { headers: { "X-Workspace-Slug": "christchurch-united" } });
  ok("granted user can't read it from another workspace", rx.status === 403 || rx.status === 404 || rx.status === 400, String(rx.status));

  const c = await api(a, "/api/admin/task-board/tasks", { method: "POST", body: JSON.stringify({ title: "ZZ probe task", ownerUserId: 15 }) });
  const ct = await c.json(); testTaskId = ct.id;
  ok("can add a task owned by Isaac", c.status === 200 && ct.ownerUserId === 15);
  const bad = await api(a, "/api/admin/task-board/tasks", { method: "POST", body: JSON.stringify({ title: "x", ownerUserId: 6 }) });
  ok("can't give a task to someone without access (Ryan)", bad.status === 400, String(bad.status));
  const d = await (await api(a, `/api/admin/task-board/tasks/${testTaskId}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) })).json();
  ok("done stamps completed_at server-side", !!d.completedAt);
  const u = await (await api(a, `/api/admin/task-board/tasks/${testTaskId}`, { method: "PATCH", body: JSON.stringify({ status: "doing" }) })).json();
  ok("leaving done clears completed_at", u.completedAt === null);
  const e = await api(a, "/api/admin/task-board/tasks", { method: "POST", body: JSON.stringify({ title: "   " }) });
  ok("a blank title is refused", e.status === 400);

  browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [who, cookie] of [["granted", a], ["ungranted-admin", b]] as const) {
    for (const [label, w, h] of [["desktop", 1440, 900], ["mobile", 390, 844]] as const) {
      const page = await browser.newPage(); const errors: string[] = [];
      page.on("pageerror", (x: any) => errors.push(String(x)));
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
      const [n, v] = cookie.split("=");
      await page.setCookie({ name: n, value: v, domain: "app.usg.co.nz", path: "/", httpOnly: true, secure: true });
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
      await page.evaluate((ws: string) => localStorage.setItem("clubos_workspace", ws), WS);
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 2500));
      const link = await page.evaluate(() => {
        const as = Array.from(document.querySelectorAll("a")); const i = as.findIndex((x) => /\/admin\/task-board$/.test(x.getAttribute("href") || ""));
        const dash = as.findIndex((x) => (x.getAttribute("href") || "") === "/admin");
        return { has: i >= 0, afterDashboard: i === dash + 1 };
      });
      if (who === "granted") {
        if (label === "desktop") ok(`${who}: sidebar link sits right under Dashboard`, link.has && link.afterDashboard, JSON.stringify(link));
        await page.goto(`${BASE}/admin/task-board`, { waitUntil: "networkidle2", timeout: 60000 });
        await page.waitForSelector('[data-testid="task-board"]', { timeout: 30000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200));
        const s = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
        ok(`${who} ${label}: renders with projects`, /Term 4 launch/i.test(s.text) && /Ballers Youth League/i.test(s.text));
        ok(`${who} ${label}: no sideways scroll`, s.overflow <= 0, String(s.overflow));
        ok(`${who} ${label}: no JS errors`, errors.length === 0, errors[0] ?? "");
        await page.screenshot({ path: `/tmp/claude-501/tb-${label}-list.png` });
        for (const vw of ["board", "people"]) {
          await page.click(`[data-testid="tb-view-${vw}"]`); await new Promise((r) => setTimeout(r, 600));
          const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          ok(`${who} ${label}: ${vw} view fits`, o <= 0, String(o));
          await page.screenshot({ path: `/tmp/claude-501/tb-${label}-${vw}.png` });
        }
        await page.click('[data-testid="tb-view-list"]'); await new Promise((r) => setTimeout(r, 400));
        await page.click(`[data-testid="tb-task-${testTaskId}"]`).catch(() => {});
        await page.waitForSelector('[data-testid="tb-detail"]', { timeout: 8000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 600));
        ok(`${who} ${label}: opening a task shows its detail`, !!(await page.$('[data-testid="tb-detail"]')));
        await page.screenshot({ path: `/tmp/claude-501/tb-${label}-detail.png` });
      } else if (label === "desktop") {
        ok(`${who}: no sidebar link`, !link.has);
      }
      await page.close();
    }
  }
} finally {
  if (browser) await browser.close();
  if (testTaskId) await pool.query(`DELETE FROM tb_tasks WHERE id = $1`, [testTaskId]);
  await pool.query(`DELETE FROM tb_tasks WHERE title IN ('ZZ probe task','x')`);
  for (const id of made) { await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [id]); await pool.query(`DELETE FROM sessions WHERE sess::text LIKE $1`, [`%"userId":${id}%`]).catch(() => {}); await pool.query(`DELETE FROM users WHERE id=$1`, [id]).catch((e) => console.log("  (user cleanup)", e.message)); }
  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
