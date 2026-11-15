// Website tab — a real browser at 1440 and 390, through the preview harness.
//   1. npx tsx --env-file=.env script/_serve-sites-public.ts 5322 --as 1
//   2. npx vite --config preview/sites.vite.config.ts --port 5198 --strictPort
//   3. node script/_verify-sites-browser.mjs <outDir>
// LOOKS only — it clicks navigation (filters, views, an article, history),
// never Save, Publish or a grant.
import { createRequire } from "module";
import { mkdirSync } from "fs";
const require = createRequire("/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/package.json");
const puppeteer = require("puppeteer-core");
const OUT = process.argv[2] || "/tmp/sites-browser";
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5198/sites.html";
let pass = 0; const fails = [];
const t = (l, c, x) => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fails.push(l); console.log(`  ✗ ${l}`, x ?? ""); } };

const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new" });
for (const [label, w, h, mobile] of [["desktop", 1440, 900, false], ["phone", 390, 844, true]]) {
  console.log(`\n  ${label} ${w}×${h}`);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const small = () => page.evaluate(() => [...document.querySelectorAll("button, a, input, [role=tab]")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 36 && getComputedStyle(el).visibility !== "hidden"; })
    .map((el) => (el.getAttribute("data-testid") || el.textContent || el.tagName).trim().slice(0, 30)));
  const shot = (n) => page.screenshot({ path: `${OUT}/${label}-${n}.png`, fullPage: true });

  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.waitForSelector('[data-testid="article-list"]', { timeout: 20000 });
  const rows = await page.$$eval('[data-testid^="article-row-"]', (x) => x.length);
  t("the article list renders real articles", rows >= 20, rows);
  t("your level is shown (Super admin)", (await page.$eval('[data-testid="site-level"]', (e) => e.textContent)) === "Super admin");
  t("the live-site status line is there", !!(await page.$('[data-testid="site-live-status"]')));
  t("no horizontal overflow (list)", (await overflow()) <= 0, await overflow());
  if (mobile) t("tap targets ≥ 36px on the phone (list)", (await small()).length === 0, await small());
  await shot("1-list");

  await page.click('[data-testid="article-filter-published"]');
  await page.waitForFunction(() => location.search.includes("status=published"));
  t("a filter lives in the URL", true);
  await page.waitForSelector('[data-testid="article-list"] [data-testid^="article-row-"]', { timeout: 20000 });

  await page.click('[data-testid^="article-row-"]');
  await page.waitForSelector('[data-testid="article-editor"] [data-testid="article-title"]', { timeout: 20000 });
  t("opening an article puts it in the URL", (await page.evaluate(() => location.search)).includes("article="));
  t("the headline field holds the article's title", ((await page.$eval('[data-testid="article-title"]', (e) => e.value)) || "").length > 5);
  t("no horizontal overflow (editor)", (await overflow()) <= 0, await overflow());
  if (mobile) t("tap targets ≥ 36px on the phone (editor)", (await small()).length === 0, await small());
  await shot("2-editor");
  await page.click('[data-testid="article-mode-preview"]');
  await page.waitForSelector('[data-testid="article-preview"]');
  const paras = await page.$$eval('[data-testid="article-preview"] p', (x) => x.length);
  t("the preview draws the body as paragraphs", paras >= 3, paras);
  await page.click('[data-testid="article-history-toggle"]');
  await page.waitForSelector('[data-testid="article-versions"]');
  t("history lists the import as version 1", (await page.$eval('[data-testid="article-versions"]', (e) => e.textContent)).includes("imported from"));
  await shot("3-preview-history");
  await page.goBack();
  await page.waitForSelector('[data-testid="article-list"]', { timeout: 10000 });
  t("browser Back returns to the list, filter kept", (await page.evaluate(() => location.search)).includes("status=published") && !(await page.evaluate(() => location.search)).includes("article="));

  await page.click('[data-testid="site-view-people"]');
  await page.waitForSelector('[data-testid="people-panel"]');
  const people = await page.$eval('[data-testid="people-panel"]', (e) => e.textContent);
  t("People shows Travis as approver", /Travis Graham/.test(people) && /Approver/.test(people));
  t("no horizontal overflow (people)", (await overflow()) <= 0, await overflow());
  await shot("4-people");
  await page.click('[data-testid="site-view-activity"]');
  await page.waitForSelector('[data-testid="activity-panel"]');
  await shot("5-activity");
  t("no page errors", errors.length === 0, errors.slice(0, 3));
  await page.close();
}
await browser.close();
console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
if (fails.length) process.exit(1);
