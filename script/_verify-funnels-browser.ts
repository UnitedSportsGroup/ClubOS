/**
 * Funnels — drive the REAL pages in a real browser, as an ORDINARY staff member
 * holding only the Campaigns tab, at laptop and phone size: open a campaign's
 * Funnels tab, make a funnel through the form, read its numbers against the
 * API, try the what-if sums, and remove it.
 *
 *   npx tsx --env-file=.env script/_verify-funnels-browser.ts [screenshot-dir]
 *   VERIFY_BASE=http://localhost:5240 …   (the local preview: no sign-in)
 *
 * It makes one campaign named "_probe funnels …" (selling the FUNdamentals
 * summer camp, read-only on its bookings) and removes it at the end, along
 * with the throwaway login.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const LOCAL = BASE.startsWith("http://localhost");
const SHOTS = process.argv[2] || null;
const PROGRAM = 65;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
let userId: number | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (s: string | null | undefined) => Number(String(s ?? "").replace(/[^0-9.]/g, ""));
/** The dollar figure on a tile: the first line that carries a $. */
const money = (s: string | null | undefined) => digits(String(s ?? "").split("\n").find((l) => l.includes("$")));

async function dialogFits(page: Page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    if (!d) return { ok: false, why: "no dialog" };
    const r = d.getBoundingClientRect();
    let widest = 0;
    d.querySelectorAll("*").forEach((el) => {
      const b = (el as HTMLElement).getBoundingClientRect();
      if (b.width > 0) widest = Math.max(widest, b.right);
    });
    const good = r.left >= -1 && r.right <= innerWidth + 1 && widest <= r.right + 1;
    return { ok: good, why: `dialog ${Math.round(r.left)}–${Math.round(r.right)} of ${innerWidth}, widest child reaches ${Math.round(widest)}` };
  });
}

async function main() {
  let cookie: { name: string; value: string } | null = null;
  if (!LOCAL) {
    const email = `_funnel_browser_${Date.now()}@usg.co.nz`;
    const pw = `C${Math.random().toString(36).slice(2)}!aA9`;
    const { rows } = await pool.query(
      `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Funnel', 'Probe', $2, 'team_member', true) RETURNING id`,
      [email, await bcrypt.hash(pw, 10)],
    );
    userId = rows[0].id;
    await pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $2 FROM organizations WHERE slug = 'united-sports-group'`,
      [userId, JSON.stringify(["marketing-hub", "campaign-planner"])],
    );
    const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
    const [name, ...rest] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");
    cookie = { name, value: rest.join("=") };
  }

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    if (cookie) await page.setCookie({ ...cookie, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string, full = true) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/funnel-${n}-${tag}.png`, fullPage: full });
    };
    const name = `_probe funnels ${tag} ${Date.now()}`;
    const { rows: made } = await pool.query(
      `INSERT INTO cmp_campaigns (name, status, starts_on, program_ids) VALUES ($1, 'live', '2026-10-29', $2) RETURNING id`,
      [name, [PROGRAM]],
    );
    const campaignId: number = made[0].id;

    if (!LOCAL && tag === "laptop") {
      await page.goto(`${BASE}/admin`, { waitUntil: "networkidle2", timeout: 90_000 });
      let link = await page.$('a[href="/admin/funnels"]');
      if (!link) {
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll("button, a")).find((e) => /^Marketing$/.test((e.textContent || "").trim())) as HTMLElement | undefined;
          b?.click();
        });
        await wait(1000);
        link = await page.$('a[href="/admin/funnels"]');
      }
      ok("the sidebar has a Funnels link under Marketing", !!link);
    }

    // ── The campaign's Funnels tab ──
    await page.goto(`${BASE}/admin/campaigns/${campaignId}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="campaign-tab-funnels"]', { timeout: 40_000 });
    await page.click('[data-testid="campaign-tab-funnels"]');
    ok("the Funnels section is in the URL", page.url().includes("tab=funnels"), page.url());
    await page.waitForSelector('[data-testid="funnel-new"]', { timeout: 20_000 });
    const empty = await page.evaluate(() => document.body.innerText);
    ok("an empty campaign says so, with no numbers", /No funnels yet/i.test(empty));

    // ── Make one through the form ──
    await page.click('[data-testid="funnel-new"]');
    await page.waitForSelector('[data-testid="funnel-name-input"]', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="funnel-landing"] [role="checkbox"][data-state="checked"]').length > 0, { timeout: 20_000 }).catch(() => {});
    await wait(400);
    const ticked = await page.evaluate(() => ({
      landing: Array.from(document.querySelectorAll('[data-testid="funnel-landing"] label')).filter((l) => l.querySelector('[data-state="checked"]')).map((l) => (l.textContent || "").trim()),
      checkout: Array.from(document.querySelectorAll('[data-testid="funnel-checkout"] label')).filter((l) => l.querySelector('[data-state="checked"]')).map((l) => (l.textContent || "").trim()),
    }));
    ok("the camp's own page is offered and already ticked", ticked.landing.some((t) => t.includes("join.cufc.co.nz/fundamentals")), JSON.stringify(ticked.landing));
    ok("its booking form is offered and already ticked", ticked.checkout.some((t) => t.includes("/fundamentals/book")), JSON.stringify(ticked.checkout));
    const fit = await dialogFits(page);
    ok("the new-funnel form fits the screen", fit.ok, fit.why);
    await shot("form", false);
    await page.type('[data-testid="funnel-name-input"]', "Everyone to the camp");
    await page.click('[data-testid="form-save"]');
    await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 30_000 }).catch(() => {});
    await page.waitForSelector('[data-testid="funnel-name"]', { timeout: 30_000 });
    await wait(600);

    // ── The numbers on the card are the API's numbers ──
    const api = await page.evaluate(async (id) => {
      const r = await fetch(`/api/admin/campaigns/${id}/funnels`, { headers: { "X-Workspace-Slug": "united-sports-group" }, credentials: "include" });
      return r.json();
    }, campaignId);
    const fn = api.funnels?.[0];
    ok("the funnel was saved", !!fn && fn.name === "Everyone to the camp");
    const stages: { key: string; count: number }[] = fn?.stages ?? [];
    ok("it has the four steps from the page to paid", stages.map((s) => s.key).join(",") === "landed,checkout,payment,paid", stages.map((s) => s.key).join(","));
    ok("each step is no bigger than the one before", stages.every((s, i) => i === 0 || s.count <= stages[i - 1].count), JSON.stringify(stages.map((s) => s.count)));
    const direct = await pool.query(
      `select count(*)::int n, coalesce(sum(coalesce(total_cents,0) - coalesce(refunded_amount_cents,0)),0)::bigint cents from registrations r
       where r.program_id = $1 and r.status in ('confirmed','refunded','partially_refunded')
         and (coalesce(r.paid_at, r.registered_at at time zone 'UTC') at time zone 'Pacific/Auckland')::date between $2 and $3`,
      [PROGRAM, fn?.from, fn?.to],
    );
    ok("all paid bookings matches a direct count of the table", fn?.allBookings === direct.rows[0].n, `${fn?.allBookings} vs ${direct.rows[0].n}`);
    ok("the funnel's own bookings and revenue never exceed the total", fn?.bookings <= direct.rows[0].n && fn?.revenueCents <= Number(direct.rows[0].cents));
    const shown = await page.evaluate((wide) => {
      const root = document.querySelector(wide ? '[data-testid="funnel-wide"]' : '[data-testid="funnel-tall"]') as HTMLElement | null;
      const visible = !!root && root.getBoundingClientRect().width > 0;
      const text = root?.innerText ?? "";
      return { visible, text, revenue: (document.querySelector('[data-testid="funnel-revenue"]') as HTMLElement | null)?.innerText ?? "" };
    }, w >= 1024);
    ok(`the ${w >= 1024 ? "wide" : "stacked"} drawing is the one shown`, shown.visible);
    ok("every step's count is drawn as the API gave it", stages.every((s) => shown.text.includes(s.count.toLocaleString("en-NZ"))), shown.text.replace(/\s+/g, " ").slice(0, 160));
    ok("revenue is shown in dollars, as the API gave it", money(shown.revenue) === (fn?.revenueCents ?? 0) / 100, shown.revenue.replace(/\n/g, " | "));
    if (w >= 1024) {
      const band = await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="funnel-wide"] svg path') as SVGPathElement | null;
        const b = svg?.getBoundingClientRect();
        return b ? { w: Math.round(b.width), h: Math.round(b.height), fill: getComputedStyle(svg!).fill } : null;
      });
      ok("the funnel band is really drawn (has size and a fill)", !!band && band.w > 400 && band.h > 40 && band.fill !== "none", JSON.stringify(band));
      const chips = await page.$$eval('[data-testid^="funnel-rate-"]', (els) => els.map((e) => (e.textContent || "").trim()));
      ok("a rate sits between each pair of steps", chips.length === stages.length - 1 && chips.every((c) => /%|—/.test(c)), chips.join(" "));
    }
    ok("the page has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("card");

    // ── What if ──
    await page.click('[data-testid="funnel-whatif-toggle"]');
    await page.waitForSelector('[data-testid="funnel-whatif"]', { timeout: 10_000 });
    const before = money(await page.$eval('[data-testid="whatif-revenue"]', (e) => (e as HTMLElement).innerText.split("now")[0]));
    ok("what-if opens on today's revenue", Math.abs(before - Math.round((fn?.revenueCents ?? 0) / 100)) <= 1, `${before}`);
    const body = await page.evaluate(() => document.body.innerText);
    ok("the sums are labelled a projection", /Projection, not a result/i.test(body));
    if ((fn?.bookings ?? 0) < 10) ok("few bookings: the page warns the sums are rough", /read these sums as rough/i.test(body));
    await page.type('[data-testid="whatif-target"]', "50000");
    await page.click('[data-testid="whatif-target-go"]');
    await wait(400);
    const after = money(await page.$eval('[data-testid="whatif-revenue"]', (e) => (e as HTMLElement).innerText.split("now")[0]));
    ok("working back from $50,000 lands on about $50,000", Math.abs(after - 50000) <= 600, `${after}`);
    const vol = await page.$eval('[data-testid="whatif-volume"]', (e) => (e as HTMLElement).innerText);
    ok("…and says how many more people that needs", /→/.test(vol) && /×/.test(vol), vol.replace(/\s+/g, " "));
    ok("the page still has no sideways scroll with what-if open", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("whatif");

    // ── Every funnel on one page, and Back ──
    await page.goto(`${BASE}/admin/funnels`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid^="funnel-card-"]', { timeout: 40_000 });
    const listed = await page.evaluate(() => document.body.innerText);
    ok("the Funnels page lists it", listed.includes("Everyone to the camp"));
    ok("the Funnels page has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("list");
    const href = await page.evaluate((id) => (Array.from(document.querySelectorAll('[data-testid="funnel-open-campaign"]')).find((a) => (a.getAttribute("href") || "").includes(`/admin/campaigns/${id}?`)) as HTMLAnchorElement | undefined)?.getAttribute("href") ?? "", campaignId);
    ok("its link opens the campaign's Funnels tab and remembers where it came from", href.includes("tab=funnels") && href.includes("from=/admin/funnels"), href);
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="campaign-back"]', { timeout: 30_000 });
    const back = await page.$eval('[data-testid="campaign-back"]', (e) => ({ text: (e.textContent || "").trim(), href: e.getAttribute("href") }));
    ok("Back goes to Funnels, where the person came from", back.text === "Funnels" && back.href === "/admin/funnels", JSON.stringify(back));

    // ── Remove it ──
    await page.waitForSelector('[data-testid="funnel-edit"]', { timeout: 20_000 });
    await page.click('[data-testid="funnel-edit"]');
    await page.waitForSelector('[data-testid="funnel-name-input"]', { timeout: 10_000 });
    await wait(300);
    const clickBtn = (re: string) => page.evaluate((src) => {
      const b = Array.from(document.querySelectorAll('[role="dialog"] button')).find((x) => new RegExp(src).test((x.textContent || "").trim())) as HTMLElement | undefined;
      b?.click();
      return !!b;
    }, re);
    await clickBtn("^Remove funnel$");
    await wait(250);
    await clickBtn("^Remove funnel$");
    await page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 20_000 }).catch(() => {});
    await wait(800);
    const kept = await pool.query(`select archived_at is not null as archived from cmp_funnels where campaign_id = $1`, [campaignId]);
    ok("removing a funnel archives it (the row is kept)", kept.rowCount === 1 && kept.rows[0].archived === true);
    const gone = await page.evaluate(() => document.body.innerText);
    ok("…and it is gone from the page", /No funnels yet/i.test(gone));
    ok("no errors in the browser", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }
  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await pool.query(`DELETE FROM cmp_campaigns WHERE name LIKE '\\_probe funnels %'`).catch(() => {});
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    }
    await pool.end();
    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
  });
