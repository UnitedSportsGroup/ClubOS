/**
 * Social media → Feed and Labels, driven in a real browser as an ORDINARY staff
 * member holding only the Social media tab, at laptop and phone size.
 *
 *   npx tsx --env-file=.env script/_verify-social-labels-browser.ts [screenshot-dir]
 *
 * It makes one label named "_probe …", puts it on a post through the page,
 * takes it off again, and removes everything it made (label, login). It never
 * confirms or rejects one of Rambo's real suggestions.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import puppeteer from "puppeteer-core";

const BASE = process.env.VERIFY_BASE || "https://app.usg.co.nz";
const SHOTS = process.argv[2] || null;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
const ok = (label: string, good: boolean, detail = "") => {
  console.log(`  ${good ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let userId: number | null = null;
const probeName = `_probe ${Date.now()}`;

async function main() {
  const email = `_social_labels_${Date.now()}@usg.co.nz`;
  const pw = `S${Math.random().toString(36).slice(2)}!aA9`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, first_name, last_name, password, role, active) VALUES ($1, 'Labels', 'Probe', $2, 'team_member', true) RETURNING id`,
    [email, await bcrypt.hash(pw, 10)],
  );
  userId = rows[0].id;
  await pool.query(
    `INSERT INTO user_organizations (user_id, organization_id, role, tabs) SELECT $1, id, 'team_member', $2 FROM organizations WHERE slug = 'united-sports-group'`,
    [userId, JSON.stringify(["marketing-hub", "social-media"])],
  );
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  const raw = (login.headers.get("set-cookie") || "").split(";")[0];
  const [name, ...rest] = raw.split("=");
  const cookie = { name, value: rest.join("=") };
  const api = (path: string, init: RequestInit = {}, slug = "united-sports-group") =>
    fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: raw, "X-Workspace-Slug": slug, ...(init.headers || {}) } });

  console.log("\ngates");
  ok("signed out is refused", (await fetch(`${BASE}/api/admin/social/labels`)).status === 401);
  // This login belongs to the group workspace only, so another workspace refuses it at the tab check (403) or the hub check (404).
  const other = (await api("/api/admin/social/labels", {}, "christchurch-united")).status;
  ok("another workspace is refused", other === 403 || other === 404, String(other));
  const labelsRes = await api("/api/admin/social/labels");
  const labels = (await labelsRes.json()).labels as { id: number; kind: string; name: string }[];
  ok("the label list loads with content types and sponsors", labels.some((l) => l.kind === "asset") && labels.some((l) => l.kind === "sponsor"), `${labels.length} labels`);
  const lineup = labels.find((l) => l.name === "Starting line-up");
  ok("Starting line-up is a label", !!lineup);

  console.log("\nnumbers");
  const made = await api("/api/admin/social/labels", { method: "POST", body: JSON.stringify({ kind: "asset", name: probeName }) });
  const probe = await made.json();
  ok("a label can be made", made.status === 201 && probe.id > 0);
  ok("the same name twice is refused in words", (await api("/api/admin/social/labels", { method: "POST", body: JSON.stringify({ kind: "asset", name: probeName.toUpperCase() }) })).status === 400);
  const feed = await (await api("/api/admin/social/feed?brand=cufc&period=12m&limit=3")).json();
  const [p1, p2] = feed.posts;
  await api(`/api/admin/social/posts/${p1.id}/labels`, { method: "POST", body: JSON.stringify({ labelId: probe.id }) });
  await api(`/api/admin/social/posts/${p2.id}/labels`, { method: "POST", body: JSON.stringify({ labelId: probe.id }) });
  // One of Rambo's, unconfirmed, on a third post: it must not be counted.
  await pool.query(`INSERT INTO social_post_labels (post_id, label_id, source, reason) VALUES ($1, $2, 'rambo', 'probe')`, [feed.posts[2].id, probe.id]);
  const report = await (await api(`/api/admin/social/labels/${probe.id}/report?brand=cufc&year=all`)).json();
  const want = [p1, p2].reduce((t: number, p: any) => t + (p.views ?? 0), 0);
  ok("the report counts the two confirmed posts and not Rambo's unchecked one", report.row.posts === 2 && report.row.toCheck === 1, `posts ${report.row.posts}, to check ${report.row.toCheck}`);
  ok("its views are those two posts' views added up", report.row.views === want, `${report.row.views} vs ${want}`);
  ok("the by-platform rows add up to the total", report.row.byPlatform.reduce((t: number, r: any) => t + r.posts, 0) === 2);
  const confirmed = await (await api(`/api/admin/social/labels/${probe.id}/confirm`, { method: "POST", body: JSON.stringify({ postIds: [feed.posts[2].id] }) })).json();
  ok("confirming Rambo's suggestion counts it", confirmed.confirmed === 1);
  await api(`/api/admin/social/posts/${feed.posts[2].id}/labels/${probe.id}`, { method: "DELETE" });
  const kept = await pool.query(`SELECT rejected_at FROM social_post_labels WHERE post_id = $1 AND label_id = $2`, [feed.posts[2].id, probe.id]);
  ok("taking off one of Rambo's keeps it as rejected, so it is not suggested again", kept.rows[0]?.rejected_at != null);
  for (const p of [p1, p2]) await api(`/api/admin/social/posts/${p.id}/labels/${probe.id}`, { method: "DELETE" });
  const gone = await pool.query(`SELECT count(*)::int AS n FROM social_post_labels WHERE label_id = $1 AND rejected_at IS NULL`, [probe.id]);
  ok("taking off a person's label removes it", gone.rows[0].n === 0);
  // Bulk: one label on several posts, then off again.
  const all = await (await api("/api/admin/social/feed?brand=cufc&limit=3")).json();
  ok("with no year the feed is every post, not the last 30 days", all.total > feed.total, `${all.total} all time vs ${feed.total} in 12 months`);
  const page2 = await (await api("/api/admin/social/feed?brand=cufc&limit=3&offset=3")).json();
  ok("the next page is different posts", page2.posts.length === 3 && !page2.posts.some((p: any) => all.posts.some((a: any) => a.id === p.id)));
  const ids = all.posts.map((p: any) => p.id);
  const bulkOn = await (await api("/api/admin/social/posts/bulk-labels", { method: "POST", body: JSON.stringify({ postIds: ids, labelId: probe.id }) })).json();
  ok("a label goes on several posts at once", ids.every((id: number) => bulkOn.labels[id]?.some((l: any) => l.labelId === probe.id && l.status === "confirmed")));
  const bulkOff = await (await api("/api/admin/social/posts/bulk-labels", { method: "POST", body: JSON.stringify({ postIds: ids, labelId: probe.id, remove: true }) })).json();
  ok("and comes off them at once", ids.every((id: number) => !bulkOff.labels[id]?.some((l: any) => l.labelId === probe.id)));
  ok("bulk with no posts is refused", (await api("/api/admin/social/posts/bulk-labels", { method: "POST", body: JSON.stringify({ postIds: [], labelId: probe.id }) })).status === 400);
  const find = await (await api("/api/admin/social/labels/find?brand=cufc&year=2026")).json();
  ok("the Rambo search reports where it is up to", typeof find.unchecked === "number" && typeof find.estimateCents === "number", `${find.unchecked} not looked at`);

  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [w, h, tag] of [[1440, 900, "laptop"], [390, 844, "phone"]] as const) {
    console.log(`\n${tag} ${w}×${h}`);
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.setCookie({ ...cookie, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const shot = async (n: string) => {
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/labels-${n}-${tag}.png` });
    };

    // ── Feed ──
    await page.goto(`${BASE}/admin/social-media?brand=cufc&view=feed&cols=1&ly=2026`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="feed-post"]', { timeout: 40_000 });
    const count = (await page.$$('[data-testid="feed-post"]')).length;
    ok("the feed shows posts", count >= 5, `${count} posts`);
    ok("the feed has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    const pic = await page.evaluate(async () => {
      const img = document.querySelector('[data-testid="feed-post"] img') as HTMLImageElement | null;
      if (!img) return { ok: false, why: "no picture" };
      if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; setTimeout(r, 15000); });
      return { ok: img.naturalWidth > 300, why: `${img.naturalWidth}×${img.naturalHeight}` };
    });
    ok("the first post's picture loads at full size", pic.ok, pic.why);
    const card = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="feed-post"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth, text: el.innerText };
    });
    ok("a post sits inside the screen", card.left >= 0 && card.right <= card.vw + 1, `${Math.round(card.left)}–${Math.round(card.right)} of ${card.vw}`);
    ok("a post shows its numbers", /views/i.test(card.text) && /likes/i.test(card.text));
    await shot("feed");

    // Put the probe label on the first post through the page, then take it off.
    await page.click('[data-testid="feed-post"] [data-testid="feed-add-label"]');
    await page.waitForSelector('[data-testid="feed-label-search"]', { timeout: 10_000 });
    await page.type('[data-testid="feed-label-search"]', probeName);
    await wait(300);
    const picker = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="feed-label-search"]')!.closest('[role="dialog"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: innerWidth };
    });
    ok("the label picker fits the screen", picker.left >= -1 && picker.right <= picker.vw + 1, `${Math.round(picker.left)}–${Math.round(picker.right)} of ${picker.vw}`);
    await shot("picker");
    await page.click('[data-testid="feed-label-option"]');
    await page.waitForFunction((n) => Array.from(document.querySelectorAll('[data-testid="feed-post"]'))[0]?.querySelector('[data-testid="feed-labels"]')?.textContent?.includes(n), { timeout: 15_000 }, probeName).catch(() => {});
    const chip = await page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('[data-testid="feed-post"]:first-of-type [data-testid="feed-label"]')).find((c) => c.textContent?.includes(n)) as HTMLElement | undefined;
      return el ? el.dataset.status : null;
    }, probeName);
    ok("picking a label puts it on the post, confirmed", chip === "confirmed", String(chip));
    const tap = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="feed-label-remove"]') as HTMLElement | null;
      const a = document.querySelector('[data-testid="feed-add-label"]') as HTMLElement;
      return { remove: b ? Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) : 0, add: a.getBoundingClientRect().height };
    });
    ok("the label controls are big enough to press", tag === "laptop" ? tap.remove >= 28 && tap.add >= 32 : tap.remove >= 36 && tap.add >= 40, `remove ${Math.round(tap.remove)}px, add ${Math.round(tap.add)}px`);
    await page.evaluate((n) => {
      const el = Array.from(document.querySelectorAll('[data-testid="feed-post"]:first-of-type [data-testid="feed-label"]')).find((c) => c.textContent?.includes(n)) as HTMLElement;
      (el.querySelector('[data-testid="feed-label-remove"]') as HTMLElement).click();
    }, probeName);
    await page.waitForFunction((n) => !document.querySelector('[data-testid="feed-post"]:first-of-type [data-testid="feed-labels"]')?.textContent?.includes(n), { timeout: 15_000 }, probeName).catch(() => {});
    ok("the cross takes it off again", !(await page.evaluate((n) => document.querySelector('[data-testid="feed-post"]:first-of-type [data-testid="feed-labels"]')?.textContent?.includes(n), probeName)));

    // Scrolling loads more.
    // The admin page scrolls inside its own panel, so bring the last post into view rather than scrolling the window.
    await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="feed-post"]')).pop()?.scrollIntoView({ block: "end" }));
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="feed-post"]').length > n, { timeout: 30_000 }, count).catch(() => {});
    ok("scrolling down loads more posts", (await page.$$('[data-testid="feed-post"]')).length > count, `${(await page.$$('[data-testid="feed-post"]')).length}`);

    // ── Feed as a grid ──
    const wide = w < 640 ? 3 : 6;
    const firstTwo = (n: string) => page.evaluate((name) => Array.from(document.querySelectorAll('[data-testid="feed-tile"]')).slice(0, 2).map((t) => Boolean(t.querySelector('[data-testid="feed-tile-labels"]')?.textContent?.includes(name))), n);
    const clickTwo = () => page.evaluate(() => { const t = document.querySelectorAll('[data-testid="feed-tile"] > button'); (t[0] as HTMLElement).click(); (t[1] as HTMLElement).click(); });
    await page.goto(`${BASE}/admin/social-media?brand=cufc&view=feed&cols=${wide}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="feed-tile"]', { timeout: 40_000 });
    const perRow = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('[data-testid="feed-tile"]')) as HTMLElement[];
      const top = tiles[0].getBoundingClientRect().top;
      return tiles.filter((t) => Math.abs(t.getBoundingClientRect().top - top) < 2).length;
    });
    ok(`the grid is ${wide} posts wide`, perRow === wide, `${perRow}`);
    ok("the grid has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    const totalText = await page.evaluate(() => (document.querySelector('[data-testid="feed-total"]') as HTMLElement).innerText);
    ok("the feed is all time by default", Number(totalText.split(" of ")[1]?.replace(/[^0-9]/g, "")) > 500, totalText);
    const tiles0 = (await page.$$('[data-testid="feed-tile"]')).length;
    await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="feed-tile"]')).pop()?.scrollIntoView({ block: "end" }));
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="feed-tile"]').length > n, { timeout: 30_000 }, tiles0).catch(() => {});
    const tiles1 = (await page.$$('[data-testid="feed-tile"]')).length;
    ok("scrolling the grid loads more", tiles1 > tiles0, `${tiles0} to ${tiles1}`);
    await page.evaluate(() => document.querySelector('[data-testid="feed-tile"]')?.scrollIntoView({ block: "center" }));
    // Select two, label both at once.
    await clickTwo();
    await page.waitForSelector('[data-testid="feed-bulk-bar"]', { timeout: 10_000 });
    ok("clicking two posts selects two", (await page.evaluate(() => (document.querySelector('[data-testid="feed-bulk-bar"]') as HTMLElement).innerText)).includes("2 selected"));
    ok("the bulk bar is on screen", await page.evaluate(() => { const r = document.querySelector('[data-testid="feed-bulk-bar"]')!.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0 && r.right <= window.innerWidth + 1; }));
    await shot("grid");
    await page.click('[data-testid="feed-bulk-bar"] [data-testid="feed-add-label"]');
    await page.waitForSelector('[data-testid="feed-label-search"]', { timeout: 10_000 });
    await page.type('[data-testid="feed-label-search"]', probeName);
    await page.waitForSelector('[data-testid="feed-label-option"]', { timeout: 10_000 });
    await page.click('[data-testid="feed-label-option"]');
    for (let i = 0; i < 30 && !(await firstTwo(probeName)).every(Boolean); i++) await new Promise((r) => setTimeout(r, 500));
    ok("the label shows on both posts", (await firstTwo(probeName)).every(Boolean));
    ok("the selection clears after labelling", !(await page.$('[data-testid="feed-bulk-bar"]')));
    await clickTwo();
    await page.waitForSelector('[data-testid="feed-bulk-remove"]', { timeout: 10_000 });
    await page.click('[data-testid="feed-bulk-remove"]');
    await page.waitForFunction((n) => Array.from(document.querySelectorAll('[role="dialog"] button')).some((b) => b.textContent?.includes(n)), { timeout: 10_000 }, probeName);
    await page.evaluate((n) => (Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent?.includes(n)) as HTMLElement).click(), probeName);
    for (let i = 0; i < 30 && (await firstTwo(probeName)).some(Boolean); i++) await new Promise((r) => setTimeout(r, 500));
    ok("and comes off both again", !(await firstTwo(probeName)).some(Boolean));
    await page.click('[data-testid="feed-tile-open"]');
    const opened = await page.waitForSelector('[role="dialog"] [data-testid="feed-post"]', { timeout: 10_000 }).then(() => true).catch(() => false);
    ok("a tile opens the whole post", opened);
    await page.keyboard.press("Escape");
    if (w >= 640) {
      await page.click('[data-testid="feed-cols-4"]');
      await page.waitForFunction(() => location.search.includes("cols=4"), { timeout: 10_000 }).catch(() => {});
      ok("the row size is in the URL", page.url().includes("cols=4"), page.url());
    }

    // ── Labels ──
    await page.goto(`${BASE}/admin/social-media?brand=cufc&view=labels&ly=2026`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="label-row"]', { timeout: 40_000 });
    ok("the Labels list shows a row for each content type", (await page.$$('[data-testid="label-row"]')).length >= 5);
    ok("the Rambo search card is there", !!(await page.$('[data-testid="label-find"]')));
    ok("the Labels list has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("labels");
    await page.click('[data-testid="labels-kind-sponsor"]');
    await page.waitForFunction(() => /Fusion5/.test(document.body.innerText), { timeout: 20_000 }).catch(() => {});
    ok("Sponsors lists the signed partners", /Fusion5/.test(await page.evaluate(() => document.body.innerText)));
    ok("the chosen list is in the URL", page.url().includes("lk=sponsor"), page.url());
    await shot("sponsors");

    await page.goto(`${BASE}/admin/social-media?brand=cufc&view=labels&ly=2026&open=${lineup!.id}`, { waitUntil: "networkidle2", timeout: 90_000 });
    await page.waitForSelector('[data-testid="label-report"]', { timeout: 40_000 });
    const rep = await page.evaluate(() => (document.querySelector('[data-testid="label-report"]') as HTMLElement).innerText);
    ok("a label's report opens from its link", /Starting line-up/i.test(rep) && /By platform/i.test(rep));
    ok("it has the update to send", !!(await page.$('[data-testid="label-message"]')) && !!(await page.$('[data-testid="label-copy"]')));
    ok("the report has no sideways scroll", (await overflow()) <= 0, `${await overflow()}px`);
    await shot("report");
    await page.click('[data-testid="label-back"]');
    await page.waitForSelector('[data-testid="label-row"]', { timeout: 20_000 }).catch(() => {});
    ok("Labels goes back to the list", !page.url().includes("open="), page.url());
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
    await pool.query(`DELETE FROM social_post_labels WHERE label_id IN (SELECT id FROM social_labels WHERE name LIKE '\\_probe %')`).catch(() => {});
    await pool.query(`DELETE FROM social_labels WHERE name LIKE '\\_probe %'`).catch(() => {});
    if (userId) {
      await pool.query(`DELETE FROM user_organizations WHERE user_id = $1`, [userId]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    }
    const left = await pool.query(`SELECT (SELECT count(*) FROM social_labels WHERE name LIKE '\\_probe %')::int AS labels, (SELECT count(*) FROM users WHERE email LIKE '\\_social\\_labels\\_%')::int AS users`).catch(() => ({ rows: [{}] }));
    console.log("left behind:", left.rows[0]);
    await pool.end();
    process.exit(fail ? 1 : 0);
  });
