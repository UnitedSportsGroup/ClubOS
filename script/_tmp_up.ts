import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
async function main() {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 1000 });
  const errs: string[] = []; p.on("pageerror", (e: any) => errs.push(String(e.message).slice(0, 120)));
  await p.goto("https://unitedprints.co.nz/instant-quote", { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 3500));
  // choose corflute so the presets show
  await p.evaluate(() => {
    const sel = Array.from(document.querySelectorAll("select")).find(s => Array.from(s.options).some(o => /corflute/i.test(o.text)));
    if (sel) { const o = Array.from(sel.options).find(o => /corflute/i.test(o.text))!;
      (sel as HTMLSelectElement).value = o.value;
      sel.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  await new Promise(r => setTimeout(r, 1500));
  await p.screenshot({ path: "/tmp/up-quote.png", fullPage: false });
  console.log("runtime errors:", errs.length ? errs.join(" | ") : "none");
  const t = await p.evaluate(() => document.body.innerText);
  console.log(t.split("\n").filter(l => /Signage|merch|Custom size|600|900|1200|Corflute/i.test(l)).slice(0, 14).join("\n"));
  await b.close(); process.exit(0);
}
main();
