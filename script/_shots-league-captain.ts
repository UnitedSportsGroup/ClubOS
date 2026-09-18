// Screenshots + measurements of the MFL captain's pages, from the preview harness.
//   npx vite --config preview/vite.config.ts --port 5209 --strictPort &   (from apps/clubos or the worktree)
//   npx tsx script/_shots-league-captain.ts
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";
import { join } from "path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE || "http://localhost:5209";
const OUT = join(process.cwd(), "..", "..", "..", "..", "outputs", "mfl-captain", "screens");
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { width: 1440, height: 900, deviceScaleFactor: 1 };

const PAGES = [
  { name: "teams", url: "/league-captain.html?p=teams", wait: "Your teams" },
  { name: "team-weekly", url: "/league-captain.html?p=league&v=weekly", wait: "Your squad" },
  { name: "team-split", url: "/league-captain.html?p=league&v=split", wait: "Your squad" },
  { name: "reply-game", url: "/league-captain.html?p=reply", wait: "Can you play" },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const report: string[] = [];
  try {
    for (const vp of [PHONE, DESK]) {
      const tag = vp.width === 390 ? "phone" : "desk";
      for (const pg of PAGES) {
        const page = await browser.newPage();
        await page.setViewport(vp);
        await page.goto(`${BASE}${pg.url}`, { waitUntil: "networkidle0" });
        await page.waitForFunction((t: string) => document.body.innerText.includes(t), { timeout: 15000 }, pg.wait);
        await new Promise((r) => setTimeout(r, 400));
        const m = await page.evaluate(() => {
          const overflow = document.documentElement.scrollWidth - window.innerWidth;
          const small: string[] = [];
          for (const el of Array.from(document.querySelectorAll("button, a, input, textarea, [role=button]"))) {
            const r = (el as HTMLElement).getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 44 && (el as HTMLElement).tagName !== "A") small.push(`${(el as HTMLElement).tagName.toLowerCase()} "${((el as HTMLElement).innerText || (el as HTMLInputElement).placeholder || "").slice(0, 30)}" ${Math.round(r.height)}px`);
            else if (r.height < 36) small.push(`a "${(el as HTMLElement).innerText.slice(0, 30)}" ${Math.round(r.height)}px`);
          }
          return { overflow, small, height: document.documentElement.scrollHeight };
        });
        await page.screenshot({ path: join(OUT, `${pg.name}-${tag}.png`), fullPage: true });
        report.push(`${pg.name}-${tag}: overflow ${m.overflow}px · height ${m.height} · small targets ${m.small.length}${m.small.length ? " → " + m.small.join(" | ") : ""}`);

        // The fill-in drawer, in night mode, on the team page.
        if (pg.name === "team-weekly") {
          const [btn] = await page.$$("xpath/.//button[contains(., 'Find a fill-in')]");
          if (btn) {
            await btn.click();
            await page.waitForFunction(() => document.body.innerText.includes("Players looking for a game"), { timeout: 5000 });
            const [night] = await page.$$("xpath/.//button[contains(., 'Cover one night')]");
            if (night) await night.click();
            await new Promise((r) => setTimeout(r, 400));
            await page.screenshot({ path: join(OUT, `team-drawer-${tag}.png`), fullPage: false });
            report.push(`team-drawer-${tag}: captured`);
          }
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(report.join("\n"));
  console.log(`\nscreens → ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
