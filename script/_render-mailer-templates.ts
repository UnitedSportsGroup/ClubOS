// Render every starter template for every brand to HTML + screenshots, so a
// template can be LOOKED AT before it reaches the gallery.
//
//   npx tsx script/_render-mailer-templates.ts [templateId] [brand,brand,…]
//
// Writes outputs/mailer-templates/<template>-<brand>.html and two PNGs per
// pair (a 700px laptop view and a 390px phone view, both full page), and
// fails on any MJML error. 🔴 mjml-browser is a BROWSER bundle (it reads
// `window` at load), so the compile runs inside headless Chrome — the same
// compiler, the same way the gallery runs it.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { STARTER_TEMPLATES, templateDoc } from "../client/src/components/marketing/grapes/templates/index";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "outputs", "mailer-templates");
const MJML_BROWSER = join(process.cwd(), "node_modules", "mjml-browser", "lib", "index.js");
const onlyId = process.argv[2];
const brands = (process.argv[3] || "siu,cufc,cugc,mfl,cic,usc,prints").split(",").filter(Boolean);

mkdirSync(OUT, { recursive: true });
let fail = 0;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  const compiler = await browser.newPage();
  await compiler.setContent("<!doctype html><html><body></body></html>");
  await compiler.addScriptTag({ path: MJML_BROWSER });
  const compile = (mjml: string) =>
    compiler.evaluate((src: string) => {
      const res = (window as any).mjml(src, { validationLevel: "soft" });
      return { html: res.html as string, errors: (res.errors || []).map((e: any) => `${e.tagName}: ${e.message}`) as string[] };
    }, mjml);

  for (const t of STARTER_TEMPLATES) {
    if (onlyId && t.id !== onlyId) continue;
    for (const brand of brands) {
      const { mjml } = templateDoc(t, brand);
      const { html, errors } = await compile(mjml);
      const bytes = Buffer.byteLength(html, "utf8");
      writeFileSync(join(OUT, `${t.id}-${brand}.html`), html);
      console.log(`${errors.length ? "FAIL" : "ok  "} ${t.id} · ${brand} · ${(bytes / 1024).toFixed(0)}KB${errors.length ? "\n      " + errors.join("\n      ") : ""}`);
      if (errors.length) fail++;
      for (const [label, width] of [["laptop", 700], ["phone", 390]] as const) {
        const page = await browser.newPage();
        await page.setViewport({ width, height: 900, deviceScaleFactor: 2, isMobile: width < 500 });
        // Photos not yet deployed read from disk, so the screenshot shows the
        // design, not a broken image. The page itself must be a file:// URL for
        // Chrome to let it load file:// images (setContent is about:blank).
        const local = html.split("https://app.usg.co.nz/mailer/").join("file://" + join(process.cwd(), "client", "public", "mailer") + "/");
        const localFile = join(OUT, `.${t.id}-${brand}-local.html`);
        writeFileSync(localFile, local);
        await page.goto("file://" + localFile, { waitUntil: "networkidle0", timeout: 60000 });
        await page.screenshot({ path: join(OUT, `${t.id}-${brand}-${label}.png`), fullPage: true });
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(fail ? `\n${fail} with MJML errors` : "\nall compiled clean");
process.exit(fail ? 1 : 0);
