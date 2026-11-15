/**
 * Signage · Billboards · Traditional Media · Branding — prove on PRODUCTION, as
 * an ORDINARY staff member holding only these four tabs, that the gates hold
 * and the real pages work in a real browser at laptop and phone size.
 *
 *   npx tsx --env-file=.env script/_verify-offline-marketing-browser.ts [screenshot-dir]
 *
 * Everything it adds is named "_probe …" and removed at the end, the one
 * branding board it edits is put back as it was, and its logins are deleted.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const USG = "united-sports-group";
const SHOTS = process.argv[2] || null;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const users: number[] = [];
const BOARD = "ethniccup";
let boardBefore: any = undefined;

async function account(tag: string, workspace: string, tabs: string[]): Promise<{ name: string; value: string }> {
  const email = `_offm_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `O${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Offline', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  users.push(rows[0].id);
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $3 FROM organizations WHERE slug = $2`,
    [rows[0].id, workspace, JSON.stringify(tabs)],
  );
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const [name, ...rest] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
  return { name, value: rest.join("=") };
}
const call = (c: { name: string; value: string } | null, path: string, ws: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/admin/${path}`, {
    ...init,
    headers: { ...(c ? { cookie: `${c.name}=${c.value}` } : {}), ...(ws ? { "X-Workspace-Slug": ws } : {}), "Content-Type": "application/json", ...(init.headers || {}) },
  });

async function pick(page: Page, triggerSelector: string, option: RegExp) {
  await page.click(triggerSelector);
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  const opts = await page.$$('[role="option"]');
  for (const o of opts) {
    if (option.test(((await o.evaluate((el) => el.textContent)) || "").trim())) {
      await o.click();
      await wait(250);
      return true;
    }
  }
  return false;
}

async function main() {
  boardBefore = (await pool.query(`SELECT * FROM brand_workboards WHERE brand = $1`, [BOARD])).rows[0] ?? null;
  const staff = await account("all", USG, ["signage", "billboards", "traditional-media", "branding"]);
  const signOnly = await account("sign", USG, ["signage"]);

  console.log("\nGates");
  ok("signed out is refused", (await call(null, "offline-marketing/signage", USG)).status === 401);
  ok("staff with the tab can read Signage", (await call(staff, "offline-marketing/signage", USG)).status === 200);
  ok("…Billboards", (await call(staff, "offline-marketing/billboards", USG)).status === 200);
  ok("…both Traditional Media lists", (await call(staff, "offline-marketing/media-outlets", USG)).status === 200 && (await call(staff, "offline-marketing/media-coverage", USG)).status === 200);
  ok("…Branding", (await call(staff, "branding/boards", USG)).status === 200);
  ok("a person with only Signage cannot read Billboards", (await call(signOnly, "offline-marketing/billboards", USG)).status === 403);
  ok("…or Traditional Media", (await call(signOnly, "offline-marketing/media-coverage", USG)).status === 403);
  ok("…or Branding", (await call(signOnly, "branding/boards", USG)).status === 403);
  ok("another workspace gets 404", [404, 403].includes((await call(staff, "offline-marketing/signage", "christchurch-united")).status));
  ok("an unknown list is 404", (await call(staff, "offline-marketing/nonsense", USG)).status === 404);
  const bad = await call(staff, "offline-marketing/signage", USG, { method: "POST", body: JSON.stringify({ title: "_probe bad", endsOn: "2026-01-01", startsOn: "2026-02-01" }) });
  ok("an end date before the start is refused with a reason", bad.status === 400 && /before/.test((await bad.json()).message));
  const neg = await call(staff, "offline-marketing/signage", USG, { method: "POST", body: JSON.stringify({ title: "_probe neg", costCents: -5 }) });
  ok("a negative cost is refused", neg.status === 400);
  const blank = await call(staff, "offline-marketing/billboards", USG, { method: "POST", body: JSON.stringify({ title: "_probe blank cost" }) });
  const blankId = (await blank.json()).id;
  const list = await (await call(staff, "offline-marketing/billboards", USG)).json();
  ok("a blank cost is stored as nothing, not zero", list.items.find((i: any) => i.id === blankId)?.costCents === null);
  ok("a bad link on a branding board is refused", (await call(staff, `branding/boards/${BOARD}`, USG, { method: "PUT", body: JSON.stringify({ notes: "", links: [{ label: "x", url: "javascript:alert(1)" }], todos: [] }) })).status === 400);
  ok("an unknown brand board is 404", (await call(staff, "branding/boards/nope", USG, { method: "PUT", body: JSON.stringify({}) })).status === 404);

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCookie({ ...staff, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/offm-${n}-${tag}.png` });
    };

    if (tag === "laptop") {
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button, a")).find((e) => /^Marketing$/.test((e.textContent || "").trim())) as HTMLElement | undefined;
        if (!document.querySelector('a[href="/admin/signage"]')) b?.click();
      });
      await wait(1000);
      for (const [href, label] of [["/admin/signage", "Signage"], ["/admin/billboards", "Billboards"], ["/admin/traditional-media", "Traditional Media"], ["/admin/branding", "Branding"]]) {
        ok(`the sidebar has a ${label} link`, !!(await page.$(`a[href="${href}"]`)));
      }
    }

    for (const [path, heading, name] of [["/admin/signage", "Signage", `_probe sign ${tag}`], ["/admin/billboards", "Billboards", `_probe board ${tag}`], ["/admin/traditional-media", "Traditional Media", `_probe story ${tag}`]] as const) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90_000 });
      await page.waitForSelector('[data-testid="offline-add"]', { timeout: 40_000 });
      const h1 = await page.$eval("h1", (e) => e.textContent);
      ok(`${heading} opens`, h1 === heading, String(h1));
      ok(`${heading}: no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      await page.click('[data-testid="offline-add"]');
      await page.waitForSelector('[data-testid="offline-title"]', { timeout: 10_000 });
      await wait(400);
      const fit = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]') as HTMLElement;
        const r = d.getBoundingClientRect();
        let widest = 0;
        d.querySelectorAll("*").forEach((el) => {
          const b = (el as HTMLElement).getBoundingClientRect();
          if (b.width > 0) widest = Math.max(widest, b.right);
        });
        return { good: r.left >= -1 && r.right <= innerWidth + 1 && widest <= r.right + 1, why: `dialog ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}, widest child ${Math.round(widest)}` };
      });
      ok(`${heading}: the form fits the screen`, fit.good, fit.why);
      await shot(`${path.slice(7)}-form`);
      await page.type('[data-testid="offline-title"]', name);
      ok(`${heading}: a status can be picked`, await pick(page, "#om-status", /./));
      await page.click('[data-testid="offline-save"]');
      await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 }).catch(() => {});
      await wait(600);
      const cards = await page.$$eval('[data-testid="offline-item"]', (els) => els.map((e) => (e as HTMLElement).innerText));
      ok(`${heading}: the new row appears`, cards.some((c) => c.includes(name)));
      ok(`${heading}: its cost reads "—", not $0`, path === "/admin/traditional-media" || cards.some((c) => c.includes(name) && /Cost\s*—/.test(c)), cards.find((c) => c.includes(name))?.replace(/\s+/g, " ").slice(0, 120));
      ok(`${heading}: still no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      const small = await page.$$eval('[data-testid="offline-item"] button, [data-testid="offline-item"] a', (els) => els.map((e) => Math.round((e as HTMLElement).getBoundingClientRect().height)).filter((x) => x > 0));
      ok(`${heading}: buttons are big enough to tap`, tag === "laptop" || small.every((x) => x >= 44), `smallest ${Math.min(...small)}px`);
      await shot(path.slice(7));
    }

    await page.goto(`${BASE}/admin/traditional-media`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="offline-list-media-outlets"]');
    await page.click('[data-testid="offline-list-media-outlets"]');
    await wait(800);
    ok("Traditional Media: the Outlets list is in the URL", page.url().includes("list=media-outlets"), page.url());
    await page.reload({ waitUntil: "networkidle2" });
    ok("…and a reload stays on it", (await page.$eval('[data-testid="offline-list-media-outlets"]', (e) => e.getAttribute("aria-pressed"))) === "true");

    // ── Branding ──
    await page.goto(`${BASE}/admin/branding?brand=${BOARD}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="brand-todo-input"]', { timeout: 40_000 });
    ok("Branding opens on the brand in the URL", (await page.$eval(`[data-testid="brand-${BOARD}"]`, (e) => e.getAttribute("aria-selected"))) === "true");
    ok("the brand's own guidelines site is shown", (await page.$eval('[data-testid="brand-frame"]', (e) => (e as HTMLIFrameElement).src)).startsWith("https://brand.ethniccup.com"));
    ok("Branding: no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    const todo = `_probe todo ${tag}`;
    await page.type('[data-testid="brand-todo-input"]', todo);
    await page.click('[data-testid="brand-todo-add"]');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('[data-testid="brand-save-state"]')?.textContent || ""), { timeout: 20_000 }).catch(() => {});
    const note = `_probe note ${tag} ${Date.now()}`;
    await page.click('[data-testid="brand-notes"]');
    await page.type('[data-testid="brand-notes"]', note);
    await wait(2500);
    await shot("branding");
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="brand-notes"]', { timeout: 40_000 });
    const after = await page.evaluate(() => ({ notes: (document.querySelector('[data-testid="brand-notes"]') as HTMLTextAreaElement).value, todos: Array.from(document.querySelectorAll('[data-testid="brand-todo"]')).map((e) => (e as HTMLElement).innerText) }));
    ok("a to-do is still there after a reload", after.todos.some((t) => t.includes(todo)));
    ok("typed notes are still there after a reload", after.notes.includes(note));
    await page.click('[data-testid="brand-siu"]');
    await wait(800);
    ok("picking another brand changes the URL and the site shown", page.url().includes("brand=siu") && (await page.$eval('[data-testid="brand-frame"]', (e) => (e as HTMLIFrameElement).src)).startsWith("https://brand.southislandunited.com"), page.url());
    ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
    await page.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.query(`DELETE FROM offline_marketing_items WHERE title LIKE '\\_probe %'`).catch(() => {});
    if (boardBefore === null) await pool.query(`DELETE FROM brand_workboards WHERE brand = $1`, [BOARD]).catch(() => {});
    else if (boardBefore) {
      await pool
        .query(`UPDATE brand_workboards SET notes = $2, links = $3::jsonb, todos = $4::jsonb, updated_by = $5, updated_at = $6 WHERE brand = $1`, [
          BOARD, boardBefore.notes, JSON.stringify(boardBefore.links), JSON.stringify(boardBefore.todos), boardBefore.updated_by, boardBefore.updated_at,
        ])
        .catch(() => {});
    }
    for (const id of users) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch((e) => console.error("could not remove probe user", id, e.message));
    }
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
