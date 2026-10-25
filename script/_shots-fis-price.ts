// Screenshots the "What it costs" section of a Football in Schools page at
// laptop and phone width — a full-page phone capture wraps past 16,384px, so
// the price panel has to be shot on its own.
//   npx tsx script/_shots-fis-price.ts <slug> [<slug> ...]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/ui-preflight";
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const slug of process.argv.slice(2)) {
    const dir = `${OUT}/fis-${slug}`; mkdirSync(dir, { recursive: true });
    for (const [name, w, h, mobile] of [["laptop", 1366, 768, false], ["mobile", 390, 844, true]] as const) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
      await page.goto(`https://cufc.co.nz/football-in-schools/${slug}`, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 1500));
      const found = await page.evaluate(() => {
        const h2 = Array.from(document.querySelectorAll("h2")).find((x) => /EVERYTHING THE TERM INCLUDES/i.test(x.textContent || ""));
        const sec = h2?.closest("section");
        if (!sec) return null;
        sec.scrollIntoView();
        const r = sec.getBoundingClientRect();
        return { text: (sec.textContent || "").replace(/\s+/g, " ").trim(), h: r.height };
      });
      if (!found) { console.log(`${slug} ${name}: price section NOT FOUND`); await page.close(); continue; }
      const sec = await page.evaluateHandle(() => Array.from(document.querySelectorAll("h2")).find((x) => /EVERYTHING THE TERM INCLUDES/i.test(x.textContent || ""))!.closest("section"));
      await (sec as any).screenshot({ path: `${dir}/price-${name}.png` });
      const m = found.text.match(/\$[\d,]+/g) || [];
      console.log(`${slug} ${name}: prices ${m.join(" ")} · coaches: ${/Two Christchurch United coaches/.test(found.text) ? "two" : /A Christchurch United coach/.test(found.text) ? "ONE" : "?"} · session line: ${/a session/.test(found.text) ? "yes" : "no"} → ${dir}/price-${name}.png`);
      await page.close();
    }
  }
  await browser.close();
})();
