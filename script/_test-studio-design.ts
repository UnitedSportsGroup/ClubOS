// Content Studio designer engine — the safety walls, then (with --live) a real
// piece made end to end: design → render → look → fix, saved as HTML + PNGs.
//
//   npx tsx --env-file=.env script/_test-studio-design.ts            (checks only, free)
//   npx tsx --env-file=.env script/_test-studio-design.ts --live page cufc "brief…"
//   npx tsx --env-file=.env script/_test-studio-design.ts --live graphic siu "brief…" [story]
//
// --live spends real Anthropic credit (~US$0.30–1.50) and writes one
// studio_generations usage row; it creates no piece.
import fs from "node:fs";
import path from "node:path";
import { checkDesignedDoc, sanitiseDesignHtml, scrubCss, generateDesigned, renderShot } from "../server/studio-design";
import { renderDesignedGraphic, renderDesignedPage } from "../shared/studio-designed";
import { graphicSize } from "../shared/studio";

let pass = 0, fail = 0;
const ok = (cond: boolean, label: string) => { if (cond) pass++; else { fail++; console.log("  ✗", label); } };

// ── Wall 2: the allowlist ──
const s1 = sanitiseDesignHtml(`<div onclick="steal()" class="a"><script>alert(1)</script><a href="javascript:alert(1)">{{t:x}}</a><a href="{{href:book}}">{{t:y}}</a><img src="https://evil.test/x.png"><img src="{{img:hero}}" onerror="x()"><iframe src="https://evil.test"></iframe><svg viewBox="0 0 10 10"><path d="M0 0" onload="x()"/><use href="#a"/></svg><style>body{background:url(https://evil.test/t.gif)}</style></div>`);
ok(!/script|alert|onclick|onerror|onload|iframe|evil\.test|javascript/i.test(s1.html + s1.css), "script, handlers, frames and outside urls all removed");
ok(/href="\{\{href:book\}\}"/.test(s1.html), "token link kept");
ok(/src="\{\{img:hero\}\}"/.test(s1.html), "token picture kept");
ok(!/src="https/.test(s1.html), "raw picture url dropped");
ok(/viewbox="0 0 10 10"/.test(s1.html), "svg drawing kept");
ok(s1.dropped.includes("script") && s1.dropped.includes("iframe"), "dropped tags are reported");
ok(/background:none/.test(s1.css.replace(/\s/g, "")), "a stray <style> is moved into css with its outside url neutralised");
const s2 = sanitiseDesignHtml(`<h1>Book now</h1><p>{{t:sub}}</p><span>→</span>`);
ok(s2.literalWords.length === 1 && /Book now/.test(s2.literalWords[0]), "a word written straight into the html is caught (and an arrow is not)");
ok(scrubCss(`@import url(x.css); a{b:expression(alert(1))} .h{background:url("{{img:hero}}")} </style><script>`).indexOf("<") === -1, "css cannot close its <style>");
ok(/url\("\{\{img:hero\}\}"\)/.test(scrubCss(`.h{background:url('{{img:hero}}')}`)), "css token picture kept");

// ── The document check ──
const good = {
  title: "Test", fonts: ["Oswald:wght@500;700", "Inter:wght@400;600;800", "bad font!"], css: ".h{color:var(--x)}",
  html: `<section class="h"><h1>{{t:headline}}</h1><img src="{{img:hero}}"><a href="{{href:book}}">{{t:cta}}</a>{{form}}</section>`,
  texts: [{ key: "headline", label: "Headline", value: "Hi *there*" }, { key: "cta", label: "Button", value: "Book" }, { key: "form_button", label: "Form button", value: "Send it" }, { key: "form_sent", label: "Thanks", value: "Thanks" }, { key: "unused", label: "x", value: "x" }],
  images: [{ key: "hero", label: "Hero", src: "https://app.usg.co.nz/mailer/cufc/lib/x.jpg", alt: "kids" }],
  links: [{ key: "book", label: "Book", href: "https://join.cufc.co.nz/x" }],
};
const c1 = checkDesignedDoc(good);
ok(c1.ok, `a good document passes (${c1.problems.join("; ")})`);
ok(c1.doc.fonts.length === 2, "an invalid font parameter is dropped");
ok(!c1.doc.texts.some((t) => t.key === "unused"), "an unused word box is dropped");
const c2 = checkDesignedDoc({ ...good, images: [{ key: "hero", label: "Hero", src: "https://evil.test/x.jpg", alt: "" }], links: [{ key: "book", label: "B", href: "javascript:alert(1)" }] });
ok(!c2.ok && c2.doc.images[0].src === "" && c2.doc.links[0].href === "", "an outside picture and a script link are refused and blanked");
const c3 = checkDesignedDoc({ ...good, html: good.html + "{{t:ghost}}" });
ok(!c3.ok && /ghost/.test(c3.problems.join()), "a token with no box is refused");
const page = renderDesignedPage(c1.doc, "cufc", { form: { action: "/api/public/studio/enquiry/1", token: "abc.def" } });
ok(/<em>there<\/em>/.test(page) && /Content-Security-Policy/.test(page) && /name="formToken" value="abc.def"/.test(page) && /name="website"/.test(page), "page renders words, CSP, the form token and the honeypot");
ok(/--brand-|:root\{/.test(page), "brand variables are on :root");
const preview = renderDesignedPage(c1.doc, "cufc", {});
ok(/disabled/.test(preview), "a preview's form cannot be sent");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// ── Live ──
(async () => {
  const at = process.argv.indexOf("--live");
  if (at === -1) return;
  const kind = (process.argv[at + 1] === "graphic" ? "graphic" : "page") as "page" | "graphic";
  const brand = process.argv[at + 2] || "cufc";
  const brief = process.argv[at + 3] || "A landing page for the January 2027 FUNdamentals holiday camp for 4 to 8 year olds.";
  const sizeKey = process.argv[at + 4] || "portrait";
  const orgId = brand === "siu" ? 2 : brand === "mfl" ? 3 : brand === "cic" ? 5 : brand === "cugc" ? 6 : 1;
  const out = path.resolve(process.cwd(), "../../../../outputs/content-studio/2026-11-01-quality-gap/live");
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const r = await generateDesigned({ kind, brandKey: brand, orgId, userId: null, userLabel: "test script", brief, sizeKey, onStage: (s) => console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${s}`) });
  console.log(r.ok ? `✓ ${r.title} · ${r.model} · looked ${r.looked}× · US$${(r.costCents / 100).toFixed(2)} · ${Math.round((Date.now() - t0) / 1000)}s` : `✗ ${r.error}`);
  if (!r.doc) process.exit(1);
  console.log("  reply:", r.reply);
  const stem = `${brand}-${kind}-${Date.now().toString(36)}`;
  fs.writeFileSync(path.join(out, `${stem}.json`), JSON.stringify(r.doc, null, 1));
  if (kind === "page") {
    const html = renderDesignedPage(r.doc, brand, {});
    fs.writeFileSync(path.join(out, `${stem}.html`), html);
    for (const w of [390, 1440]) {
      const shot = await renderShot({ html, width: w, height: w === 390 ? 844 : 900, fullPage: true, maxHeight: 9000, format: "jpeg", quality: 80 });
      if (shot) fs.writeFileSync(path.join(out, `${stem}-${w}.jpg`), shot.buffer);
    }
  } else if (r.png) {
    fs.writeFileSync(path.join(out, `${stem}.png`), r.png.buffer);
    fs.writeFileSync(path.join(out, `${stem}.html`), renderDesignedGraphic(r.doc, brand, graphicSize(sizeKey).width, graphicSize(sizeKey).height));
  }
  console.log("  saved:", path.join(out, stem));
  process.exit(0);
})();
