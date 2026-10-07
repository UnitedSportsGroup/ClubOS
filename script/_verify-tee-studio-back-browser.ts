// Real Chrome against the LIVE tee studio (Dima, 5 Oct): the breakdown says
// "Decoration" (never DTG), the Back side can be designed, and printing both
// sides adds Dima's "Second print location" to the price. Sends nothing.
//   npx tsx script/_verify-tee-studio-back-browser.ts
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.STUDIO_URL || "https://shop.unitedprints.co.nz/print/studio";
const OUT = process.env.SHOT_DIR || "/tmp";
let fails = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" as any, args: ["--no-sandbox"] });
for (const vp of [{ w: 1440, h: 900, n: "desktop" }, { w: 390, h: 844, n: "phone" }]) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2 });
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector('[data-testid="studio-side-back"]', { timeout: 20000 });
  const breakdown = async () => page.$$eval("section ul li", (els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ")));
  const total = async () => page.evaluate(() => {
    const t = Array.from(document.querySelectorAll("span")).find((s) => s.textContent?.trim() === "Total");
    return t?.parentElement?.lastElementChild?.textContent ?? "";
  });
  // 10 × L
  await page.type("#q-L", "10");
  await page.waitForFunction(() => document.body.innerText.includes("Decoration") || document.body.innerText.includes("each"), { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const b1 = await breakdown(); const t1 = await total();
  ok(!b1.some((l) => /DTG/i.test(l)), `[${vp.n}] no "DTG" in the price breakdown (${b1.join(" | ")})`);
  // Back side
  await page.click('[data-testid="studio-side-back"]');
  await sleep(300);
  ok(await page.$eval('[data-testid="studio-side-back"]', (e) => e.getAttribute("aria-pressed") === "true"), `[${vp.n}] Back side selected`);
  ok((await page.$eval("#st-text", (e) => (e as HTMLTextAreaElement).value)) === "", `[${vp.n}] the back starts empty`);
  await page.type("#st-text", "SMITH 10");
  await page.waitForFunction(() => document.body.innerText.includes("Second print location"), { timeout: 20000 }).catch(() => {});
  await sleep(800);
  const b2 = await breakdown(); const t2 = await total();
  ok(b2.some((l) => /Second print location/.test(l)), `[${vp.n}] back print adds "Second print location" (${b2.join(" | ")})`);
  ok(t1 !== t2 && !!t2, `[${vp.n}] total moves ${t1} → ${t2}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(overflow <= 0, `[${vp.n}] no sideways scroll (${overflow}px)`);
  await page.screenshot({ path: `${OUT}/studio-back-${vp.n}.png`, fullPage: false });
  // Front still holds its own design
  await page.click('[data-testid="studio-side-front"]');
  await sleep(300);
  ok((await page.$eval("#st-text", (e) => (e as HTMLTextAreaElement).value)).includes("MERRY"), `[${vp.n}] the front kept its own design`);
  ok(errs.length === 0, `[${vp.n}] no page errors ${errs.join("; ")}`);
  await page.close();
}
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
