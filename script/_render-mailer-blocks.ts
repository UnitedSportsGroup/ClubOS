// Draw the builder's block palette — every tile, with its thumbnail, the way
// premium.css draws it — to one PNG, so the thumbnails can be LOOKED at
// before they ship (companion to _render-mailer-templates.ts).
//
//   npx tsx script/_render-mailer-blocks.ts [brand]
//
// Writes outputs/mailer-templates/blocks-palette.png and fails if two tiles
// share a thumbnail — the whole point of a thumbnail is that it shows what
// THAT block drops (Daniel, 2026-10-26: "the icons are the same, so it
// doesn't actually show you what you're getting").
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { registerBlocks } from "../client/src/components/marketing/grapes/blocks";
import { registerClubBlocks } from "../client/src/components/marketing/grapes/club-blocks";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "mailer-templates");
const brand = process.argv[2] || "cufc";

type Def = { id: string; label: string; category: string; media: string };
const defs: Def[] = [];
// The palette registers itself against an editor's BlockManager; a fake one
// that only records what it is handed is all the thumbnails need.
const fake = { BlockManager: { add: (id: string, d: Omit<Def, "id">) => defs.push({ id, ...d }) } };
registerBlocks(fake as never, brand);
registerClubBlocks(fake as never, brand);

const cats = Array.from(new Set(defs.map((d) => d.category)));
const tile = (d: Def) => `<div class="t"><div class="m">${d.media}</div><div class="l">${d.label}</div></div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#f3f4f6;font-family:-apple-system,Inter,system-ui,sans-serif;padding:16px;width:236px}
h4{margin:14px 4px 8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}
.g{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.t{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px 8px 10px;background:#fff;border:1px solid #e5e7eb;border-radius:12px}
.m{height:36px;display:flex;align-items:center;justify-content:center;color:#6b7280}
.m svg{width:56px;height:36px;fill:none}
.l{font-size:11px;font-weight:600;color:#111827;text-align:center}
</style></head><body>${cats
  .map((c) => `<h4>${c}</h4><div class="g">${defs.filter((d) => d.category === c).map(tile).join("")}</div>`)
  .join("")}</body></html>`;

mkdirSync(OUT, { recursive: true });
const file = join(OUT, ".blocks-palette.html");
writeFileSync(file, html);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 270, height: 900, deviceScaleFactor: 2 });
  await page.goto("file://" + file);
  await page.screenshot({ path: join(OUT, "blocks-palette.png"), fullPage: true });
} finally {
  await browser.close();
}
const distinct = new Set(defs.map((d) => d.media.replace(/\s+/g, ""))).size;
console.log(`${defs.length} tiles, ${distinct} distinct thumbnails → ${join(OUT, "blocks-palette.png")}`);
if (distinct !== defs.length) {
  console.error("two tiles share a thumbnail");
  process.exit(1);
}
