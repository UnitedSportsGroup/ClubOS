/**
 * Marketing → Ideas — prove on PRODUCTION, as ORDINARY staff, that the gates
 * hold and the real pages work at laptop and phone size: log an idea through
 * the form, see it in the backlog, move it to the plan, find it on its own
 * section's page behind the Ideas button, move it back, remove it.
 *
 *   npx tsx --env-file=.env script/_verify-marketing-ideas-browser.ts [screenshot-dir]
 *
 * Ideas it adds are titled "_probe …" and deleted at the end, with its logins.
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
type C = { name: string; value: string };

async function account(tag: string, workspace: string, tabs: string[]): Promise<C> {
  const email = `_ideas_${tag}_${Date.now()}@usg.co.nz`;
  const pw = `I${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Ideas', 'Probe', $2, 'team_member', true) RETURNING id`,
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
const call = (c: C | null, path: string, ws: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/admin/marketing-ideas${path}`, {
    ...init,
    headers: { ...(c ? { cookie: `${c.name}=${c.value}` } : {}), ...(ws ? { "X-Workspace-Slug": ws } : {}), "Content-Type": "application/json", ...(init.headers || {}) },
  });
const post = (c: C, body: object) => call(c, "", USG, { method: "POST", body: JSON.stringify(body) });
const patch = (c: C, id: number, body: object) => call(c, `/${id}`, USG, { method: "PATCH", body: JSON.stringify(body) });

async function pick(page: Page, trigger: string, option: string) {
  await page.click(`[data-testid="${trigger}"]`);
  await page.waitForSelector('[role="option"]', { timeout: 10_000 });
  const opts = await page.$$('[role="option"]');
  for (const o of opts) {
    if ((await o.evaluate((e) => (e.textContent || "").trim())) === option) {
      await o.click();
      await wait(300);
      return true;
    }
  }
  return false;
}
const cardWith = (page: Page, group: string, title: string) =>
  page.evaluate(
    (g, t) => {
      const card = Array.from(document.querySelectorAll(`[data-testid="${g}"] [data-testid="idea-card"]`)).find((c) => (c as HTMLElement).innerText.includes(t)) as HTMLElement | undefined;
      return card ? card.innerText : null;
    },
    group,
    title,
  );
async function clickInCard(page: Page, title: string, testid: string) {
  const done = await page.evaluate(
    (t, id) => {
      const card = Array.from(document.querySelectorAll('[data-testid="idea-card"]')).find((c) => (c as HTMLElement).innerText.includes(t));
      const b = card?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      b?.click();
      return !!b;
    },
    title,
    testid,
  );
  await wait(1500);
  return done;
}

async function main() {
  // ── Gates ──
  console.log("\ngates");
  ok("no login is refused", (await call(null, "", USG)).status === 401);
  const ideas = await account("all", USG, ["marketing-ideas", "flyers-print"]);
  const signage = await account("signage", USG, ["signage"]);
  const cufc = await account("cufc", "christchurch-united", ["marketing-ideas", "signage"]);
  ok("another workspace gets 404", (await call(cufc, "", "christchurch-united")).status === 404);
  ok("the Ideas tab reads every idea", (await call(ideas, "", USG)).status === 200);
  ok("a Signage-only person cannot read every idea", (await call(signage, "", USG)).status === 403);
  const own = await call(signage, "?section=signage", USG);
  const ownBody = own.status === 200 ? await own.json() : null;
  ok("…but reads Signage's ideas", own.status === 200 && Array.isArray(ownBody?.ideas));
  ok("…and may log against Signage only", JSON.stringify(ownBody?.sections) === JSON.stringify(["signage"]), JSON.stringify(ownBody?.sections));
  ok("…and not another section's", (await call(signage, "?section=billboards", USG)).status === 403);
  ok("an unknown section is 404", (await call(ideas, "?section=nope", USG)).status === 404);
  ok("logging against a section you do not hold is refused", (await post(signage, { title: "_probe gate", section: "billboards" })).status === 403);
  ok("no title is refused", (await post(ideas, { title: " ", section: "signage" })).status === 400);
  ok("no section is refused", (await post(ideas, { title: "_probe gate" })).status === 400);
  const mk = await post(signage, { title: "_probe signage idea", section: "signage" });
  const mkId = mk.status === 201 ? (await mk.json()).id : 0;
  ok("a Signage person logs a Signage idea", mk.status === 201);
  const row = (await (await call(ideas, "", USG)).json()).ideas.find((i: any) => i.id === mkId);
  ok("blank cost and time are stored blank, in the backlog", row && row.costCents === null && row.timeEstimate === null && row.stage === "idea");
  const other = await post(ideas, { title: "_probe flyers idea", section: "flyers-print", costCents: 12345, timeEstimate: "3 days" });
  const otherId = (await other.json()).id;
  ok("a Signage person cannot change a Flyers idea (404)", (await patch(signage, otherId, { stage: "plan" })).status === 404);
  ok("…nor move their own idea into a section they do not hold", (await patch(signage, mkId, { title: "_probe signage idea", section: "flyers-print" })).status === 403);
  await patch(ideas, otherId, { stage: "plan" });
  const first = (await (await call(ideas, "", USG)).json()).ideas.find((i: any) => i.id === otherId);
  await patch(ideas, otherId, { stage: "plan" });
  const again = (await (await call(ideas, "", USG)).json()).ideas.find((i: any) => i.id === otherId);
  ok("promoting stamps who and when, and a second press does not restamp", first.stage === "plan" && !!first.promotedAt && first.promotedByName === "Ideas Probe" && again.promotedAt === first.promotedAt);
  await patch(ideas, otherId, { stage: "idea" });
  const back = (await (await call(ideas, "", USG)).json()).ideas.find((i: any) => i.id === otherId);
  ok("moving back clears the stamp and keeps the cost and time", back.stage === "idea" && back.promotedAt === null && back.costCents === 12345 && back.timeEstimate === "3 days");
  await patch(ideas, mkId, { archived: true });
  const gone = (await (await call(ideas, "", USG)).json()).ideas.some((i: any) => i.id === mkId);
  const kept = (await (await call(ideas, "?removed=1", USG)).json()).ideas.find((i: any) => i.id === mkId);
  ok("removing hides it and keeps the row", !gone && kept?.archived === true);

  // ── The real pages ──
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCookie({ ...ideas, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/ideas-${n}-${tag}.png` });
    };
    const title = `_probe ${tag} ${Date.now()}`;

    if (tag === "laptop") {
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
      let link = await page.$('a[href="/admin/marketing-ideas"]');
      if (!link) {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button, a")).find((e) => /^Marketing$/.test((e.textContent || "").trim())) as HTMLElement | undefined;
          b?.click();
        });
        await wait(1000);
        link = await page.$('a[href="/admin/marketing-ideas"]');
      }
      ok("the sidebar has an Ideas link under Marketing", !!link);
    }

    await page.goto(`${BASE}/admin/marketing-ideas`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="ideas-board"]', { timeout: 40_000 });
    ok("the page shows the plan and the backlog", !!(await page.$('[data-testid="ideas-plan"]')) && !!(await page.$('[data-testid="ideas-backlog"]')));
    ok("no Ideas button on the Ideas page itself", !(await page.$('[data-testid="section-ideas-button"]')));
    ok("no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);

    // Log an idea through the form.
    await page.click('[data-testid="idea-log"]');
    await page.waitForSelector('[data-testid="idea-input-title"]', { timeout: 10_000 });
    await wait(500);
    const fit = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') as HTMLElement;
      const r = d.getBoundingClientRect();
      let widest = 0;
      d.querySelectorAll("*").forEach((el) => {
        const b = (el as HTMLElement).getBoundingClientRect();
        if (b.width > 0) widest = Math.max(widest, b.right);
      });
      return { good: r.left >= -1 && r.right <= innerWidth + 1 && widest <= r.right + 1, why: `dialog ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}, widest ${Math.round(widest)}` };
    });
    ok("the form fits the screen", fit.good, fit.why);
    await page.type('[data-testid="idea-input-title"]', title);
    await page.type('[data-testid="idea-input-description"]', "Line one\nLine two");
    await page.click('[data-testid="idea-save"]');
    await wait(500);
    ok("saving with no section says what is missing", /Choose which part of marketing/.test(await page.evaluate(() => document.body.innerText)));
    ok("the section list offers Flyers & Print", await pick(page, "idea-input-section", "Flyers & Print"));
    await page.type('[data-testid="idea-input-cost"]', "250");
    await page.type('[data-testid="idea-input-time"]', "2 weeks");
    await shot("form");
    await page.click('[data-testid="idea-save"]');
    await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 }).catch(() => {});
    await wait(1500);
    const inBacklog = (await cardWith(page, "ideas-backlog", title)) || "";
    ok("the idea is in the backlog with its section, cost and time", /Flyers & Print/.test(inBacklog) && /\$250\.00/.test(inBacklog) && /2 weeks/.test(inBacklog) && /by Ideas Probe/i.test(inBacklog), inBacklog.replace(/\s+/g, " ").slice(0, 160));

    // Promote, and it survives a reload.
    ok("Move to plan is there", await clickInCard(page, title, "idea-promote"));
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="ideas-board"]', { timeout: 40_000 });
    const inPlan = (await cardWith(page, "ideas-plan", title)) || "";
    ok("after a reload it is in the plan, and says who moved it", /Moved to the plan/i.test(inPlan) && !(await cardWith(page, "ideas-backlog", title)));
    await shot("page");
    ok("no sideways scroll with ideas listed", (await overflow()) <= 0, `${await overflow()}px`);

    // The section filter lives in the URL.
    await pick(page, "ideas-filter-section", "Signage");
    ok("filtering to another section hides it, and the filter is in the URL", !(await cardWith(page, "ideas-plan", title)) && page.url().includes("section=signage"), page.url());

    // Its own section's page carries it behind the Ideas button.
    await page.goto(`${BASE}/admin/flyers-print`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="section-ideas-button"]', { timeout: 40_000 }).catch(() => {});
    const btn = await page.$('[data-testid="section-ideas-button"]');
    ok("Flyers & Print has an Ideas button", !!btn);
    if (btn) {
      const box = await btn.boundingBox();
      ok("the button is on screen and big enough to tap", !!box && box.height >= 44 && box.x >= 0 && box.x + box.width <= w && box.y + box.height <= h, box ? `${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` : "");
      const n = Number(await page.$eval('[data-testid="section-ideas-count"]', (e) => e.textContent));
      ok("it counts this section's ideas", n >= 1, String(n));
      await shot("section-button");
      await btn.click();
      await page.waitForSelector('[role="dialog"] [data-testid="ideas-board"]', { timeout: 20_000 }).catch(() => {});
      await wait(800);
      const sheet = await page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement | null)?.innerText || "");
      ok("the panel is this section's plan and backlog", /Ideas for Flyers & Print/i.test(sheet) && sheet.includes(title));
      const sfit = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]') as HTMLElement;
        const r = d.getBoundingClientRect();
        let widest = 0;
        d.querySelectorAll("*").forEach((el) => {
          const b = (el as HTMLElement).getBoundingClientRect();
          if (b.width > 0) widest = Math.max(widest, b.right);
        });
        return { good: r.right <= innerWidth + 1 && r.left >= -1 && widest <= r.right + 1, why: `panel ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}, widest ${Math.round(widest)}` };
      });
      ok("the panel fits the screen", sfit.good, sfit.why);
      await shot("section-panel");
      ok("Back to ideas is there", await clickInCard(page, title, "idea-demote"));
      const sheet2 = await page.evaluate(() => {
        const g = document.querySelector('[role="dialog"] [data-testid="ideas-backlog"]') as HTMLElement | null;
        return g?.innerText || "";
      });
      ok("it moves back to the backlog", sheet2.includes(title));
      // Remove it from the edit form.
      await clickInCard(page, title, "idea-edit");
      await page.waitForSelector('[data-testid="idea-remove"]', { timeout: 10_000 }).catch(() => {});
      await wait(400);
      await page.click('[data-testid="idea-remove"]').catch(() => {});
      await wait(2000);
      const after = await page.evaluate(() => document.body.innerText);
      ok("Remove takes it off the list", !after.includes(title));
    }
    // A page that is not a Marketing section has no button.
    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
    await wait(1500);
    ok("the dashboard has no Ideas button", !(await page.$('[data-testid="section-ideas-button"]')));
    ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
    await page.close();
  }

  // A person without the section's tab sees no button there… and one with it does.
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ ...signage, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
  await page.goto(`${BASE}/admin/signage`, { waitUntil: "networkidle2", timeout: 90_000 });
  await page.waitForSelector('[data-testid="section-ideas-button"]', { timeout: 30_000 }).catch(() => {});
  console.log("\nsignage-only person");
  ok("Signage shows them the Ideas button", !!(await page.$('[data-testid="section-ideas-button"]')));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed\n`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.query(`DELETE FROM marketing_ideas WHERE title LIKE '\\_probe %'`).catch(() => {});
    for (const id of users) {
      await pool.query(`UPDATE marketing_ideas SET created_by = NULL WHERE created_by = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [id]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => {});
    }
    const left = await pool.query(`SELECT (SELECT count(*) FROM marketing_ideas WHERE title LIKE '\\_probe %') AS ideas, (SELECT count(*) FROM users WHERE email LIKE '\\_ideas\\_%') AS users`).catch(() => null);
    console.log("left behind:", left?.rows[0]);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
