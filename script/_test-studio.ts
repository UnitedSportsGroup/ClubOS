// Content Studio — the pure rules and the renderers, proven without a
// database or a model.
//   npx tsx script/_test-studio.ts
import {
  applyField, checkGraphicDoc, checkPageDoc, checkVideoDoc, graphicFields, isAllowedHref, isAllowedPicture, pageFields, readField,
  studioBrandForHost, studioPageUrl, studioSlug, STUDIO_SLUG_RE, type GraphicDoc, type PageDoc,
} from "../shared/studio";
import { renderGraphic, renderPage, inlineWords, paragraphs, studioFontsHref } from "../shared/studio-render";
import { brandVoice, HOUSE_VOICE } from "../shared/studio-voice";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 200)}` : ""}`); good ? pass++ : fail++; };

console.log("\nContent Studio — rules and renderers\n");

// ── Pictures and links ──────────────────────────────────────────────────────
ok("a kit photo is allowed", isAllowedPicture("https://app.usg.co.nz/mailer/cugc/hero.jpg"));
ok("an uploaded picture is allowed", isAllowedPicture("https://app.usg.co.nz/mailer/img/0123456789abcdef01234567.jpg"));
ok("a Studio render is allowed", isAllowedPicture("https://app.usg.co.nz/studio/r/0123456789abcdef01234567.png"));
ok("a picture on any other host is not", !isAllowedPicture("https://cugc.co.nz/img/program-1.jpg"));
ok("a crest URL is allowed as a picture source", isAllowedPicture("https://app.usg.co.nz/mailer/crests/cufc.png"));
ok("an http picture is not", !isAllowedPicture("http://app.usg.co.nz/mailer/cugc/hero.jpg"));
ok("a javascript: href is refused", !isAllowedHref("javascript:alert(1)"));
ok("a mailto is fine", isAllowedHref("mailto:info@cufc.co.nz"));
ok("a relative href is refused", !isAllowedHref("/register"));

// ── Graphic documents ───────────────────────────────────────────────────────
const g = checkGraphicDoc({ layout: "event", headline: "October holiday camp", sub: "U4–U8 · United Sports Centre", event: { date: "Mon 28 Sep – Fri 9 Oct", time: "9am–3pm", venue: "USC", price: "$50 a day" }, cta: "cufc.co.nz/camps", theme: "dark" });
ok("an event graphic checks out", g.ok && g.doc.layout === "event" && g.doc.event?.date === "Mon 28 Sep – Fri 9 Oct", g.problems.join("; "));
const longH = checkGraphicDoc({ layout: "announcement", headline: "x".repeat(70) });
ok("a headline over 60 characters is a problem (it will not fit)", !longH.ok && /60 characters/.test(longH.problems[0]));
const badPic = checkGraphicDoc({ layout: "photo", headline: "Hi", photo: "https://example.com/x.jpg" });
ok("a photo from elsewhere is refused and the layout is told it needs one", !badPic.ok && badPic.problems.some((p) => /not one of the club's pictures/.test(p)));
const chart = checkGraphicDoc({ layout: "chart", headline: "U4–U8 by term", chart: { unit: "", items: [{ label: "T1", value: 140 }, { label: "T2", value: "155" }, { label: "bad", value: "x" }] } });
ok("a chart keeps numeric items and drops a non-number", chart.ok && chart.doc.chart?.items.length === 2 && chart.doc.chart.items[1].value === 155, chart.problems.join("; "));
const chart1 = checkGraphicDoc({ layout: "chart", headline: "x", chart: { items: [{ label: "only", value: 1 }] } });
ok("a chart with one bar is refused", !chart1.ok);
const list = checkGraphicDoc({ layout: "list", headline: "Bring", items: ["Boots", "Water", "", "Sunscreen"] });
ok("a list drops blank items and keeps order", list.ok && list.doc.items?.join(",") === "Boots,Water,Sunscreen");
const unknownLayout = checkGraphicDoc({ layout: "banner", headline: "x" });
ok("an unknown layout is refused", !unknownLayout.ok);
ok("the theme defaults to dark", checkGraphicDoc({ layout: "announcement", headline: "x" }).doc.theme === "dark");

// ── Page documents ──────────────────────────────────────────────────────────
const page = checkPageDoc({
  title: "Football in Schools", description: "A term of football at your school.",
  blocks: [
    { type: "hero", headline: "Football at your school", sub: "A coach and every ball", photo: "https://app.usg.co.nz/mailer/cufc/funino.jpg", cta: { label: "Book a free session", href: "https://cufc.co.nz/football-in-schools" } },
    { type: "text", heading: "How it works", body: "One term.\n\nTen weeks, **one coach**, every ball." },
    { type: "bullets", items: ["Balls", "Bibs", "Cones"] },
    { type: "stats", items: [{ value: "44", label: "schools" }, { value: "159", label: "pages" }] },
    { type: "faq", items: [{ q: "Cost?", a: "$1,000 a term." }] },
    { type: "cta", headline: "Book a free session", button: { label: "Book", href: "https://cufc.co.nz/football-in-schools" } },
  ],
});
ok("a page with six blocks checks out", page.ok && page.doc.blocks.length === 6, page.problems.join("; "));
const noHero = checkPageDoc({ title: "x", blocks: [{ type: "text", body: "hi" }] });
ok("a page must start with a hero", !noHero.ok && noHero.problems.some((p) => /first block must be a hero/.test(p)));
const badLink = checkPageDoc({ title: "x", blocks: [{ type: "hero", headline: "h", cta: { label: "Go", href: "/register" } }, { type: "cta", headline: "h", button: { label: "x", href: "javascript:alert(1)" } }] });
ok("a relative or javascript link is refused with the block named", !badLink.ok && badLink.problems.filter((p) => /must be a full https/.test(p)).length === 2, badLink.problems.join("; "));
const tooMany = checkPageDoc({ title: "x", blocks: Array.from({ length: 13 }, (_, i) => (i === 0 ? { type: "hero", headline: "h" } : { type: "text", body: "b" })) });
ok("more than twelve blocks is refused", !tooMany.ok);
const unknownBlock = checkPageDoc({ title: "x", blocks: [{ type: "hero", headline: "h" }, { type: "carousel" }] });
ok("an unknown block type is refused by name", !unknownBlock.ok && /carousel/.test(unknownBlock.problems.join(" ")));

// ── Video requests ──────────────────────────────────────────────────────────
const v = checkVideoDoc({ brief: "45s for Facebook", footage: ["https://app.usg.co.nz/admin/drive/x", ""], format: "both", lengthSeconds: "9999" });
ok("a video request keeps its footage, caps the length and starts requested", v.ok && v.doc.footage.length === 1 && v.doc.lengthSeconds === 600 && v.doc.status === "requested" && v.doc.format === "both");
ok("a video request without a brief is refused", !checkVideoDoc({ footage: [] }).ok);

// ── Fields: the words a person edits ────────────────────────────────────────
const gf = graphicFields(g.doc);
ok("an event graphic lists headline, sub, date, time, venue, price, cta", ["headline", "sub", "event.date", "event.time", "event.venue", "event.price", "cta"].every((p) => gf.some((f) => f.path === p)), gf.map((f) => f.path).join(","));
const edited = applyField(g.doc, "event.price", "$55 a day");
ok("applyField changes one field and nothing else", edited.event?.price === "$55 a day" && edited.headline === g.doc.headline && g.doc.event?.price === "$50 a day");
const chartEdited = applyField(chart.doc, "chart.items.0.value", "1,200");
ok("a chart value stays a number", chartEdited.chart?.items[0].value === 1200);
const pf = pageFields(page.doc);
ok("page fields cover the hero, text, bullets, stats, faq and cta", ["title", "blocks.0.headline", "blocks.0.cta.href", "blocks.1.body", "blocks.2.items.2", "blocks.3.items.1.value", "blocks.4.items.0.a", "blocks.5.button.label"].every((p) => pf.some((f) => f.path === p)), pf.map((f) => f.path).join(","));
ok("a link field is marked as an address", pf.find((f) => f.path === "blocks.0.cta.href")?.href === true);
ok("readField reads back by path", readField(page.doc, "blocks.2.items.1") === "Bibs");
const pageEdited = applyField(page.doc, "blocks.4.items.0.a", "$1,000 a term plus a $250 starter kit.");
ok("an edited page still checks out", checkPageDoc(pageEdited).ok && (pageEdited.blocks[4] as any).items[0].a.includes("starter kit"));

// ── Slugs and hosts ─────────────────────────────────────────────────────────
ok("a title becomes a slug", studioSlug("Football in Schools — Term 4, 2026!") === "football-in-schools-term-4-2026");
ok("macrons and ampersands are handled", studioSlug("Kaikōura & Sons") === "kaikoura-and-sons");
ok("a slug matches the rule the database enforces", STUDIO_SLUG_RE.test(studioSlug("Hello World")) && !STUDIO_SLUG_RE.test("Hello World"));
ok("join.cufc.co.nz serves cufc pages", studioBrandForHost("join.cufc.co.nz")?.key === "cufc");
ok("join.minifootball.co.nz:443 serves mfl pages", studioBrandForHost("join.minifootball.co.nz:443")?.key === "mfl");
ok("an unknown host serves nothing", !studioBrandForHost("evil.example.com"));
ok("a cufc page URL is on join.cufc.co.nz", studioPageUrl("cufc", "football-in-schools") === "https://join.cufc.co.nz/p/football-in-schools");
ok("a usg page falls back to the app host with the brand named", studioPageUrl("usg", "sponsors") === "https://app.usg.co.nz/p/sponsors?b=usg");

// ── Renderers ───────────────────────────────────────────────────────────────
const evil: GraphicDoc = { layout: "announcement", headline: `<img src=x onerror="alert(1)"> & "quotes"`, sub: "**bold** here", cta: "cufc.co.nz", theme: "dark" };
const rg = renderGraphic(evil, "square", "cufc");
ok("a graphic is 1080×1080 for square", rg.width === 1080 && rg.height === 1080);
ok("words are escaped — no tag from a headline reaches the artboard", !/<img src=x/.test(rg.html) && /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;quotes&quot;/.test(rg.html));
ok("**bold** becomes <strong>", /<strong>bold<\/strong>/.test(rg.html));
ok("the crest is drawn and the brand's fonts are linked", /mailer\/crests\/cufc\.png/.test(rg.html) && /fonts\.googleapis\.com/.test(rg.fontsHref));
ok("the css is scoped under .sgx", rg.css.split("\n").filter(Boolean).every((l) => l.startsWith(".sgx")));
const story = renderGraphic({ ...g.doc }, "story", "cugc");
ok("a story is 1080×1920 and an event draws its rows", story.height === 1920 && /sgx-row/.test(story.html) && /\$50 a day/.test(story.html));
const chartHtml = renderGraphic(chart.doc, "landscape", "mfl").html;
ok("a chart draws a bar per item with the longest full width", (chartHtml.match(/sgx-barfill/g) || []).length === 2 && /width:100%/.test(chartHtml));
const photoG = renderGraphic({ layout: "photo", headline: "Hero", photo: "https://app.usg.co.nz/mailer/cugc/hero.jpg", theme: "dark" }, "portrait", "cugc");
ok("a photo layout puts the picture behind a shade", /background-image:url\('https:\/\/app\.usg\.co\.nz\/mailer\/cugc\/hero\.jpg'\)/.test(photoG.html) && /sgx-shade/.test(photoG.html));
const html = renderPage(page.doc, "cufc", { noindex: true, url: "https://join.cufc.co.nz/p/football-in-schools" });
ok("a page is a full document with the title, description and canonical", /^<!doctype html>/.test(html) && /<title>Football in Schools — Christchurch United<\/title>/.test(html) && /rel="canonical" href="https:\/\/join\.cufc\.co\.nz\/p\/football-in-schools"/.test(html));
ok("…noindex when unlisted", /name="robots" content="noindex, nofollow"/.test(html));
ok("…the hero photo is the share picture", /og:image" content="https:\/\/app\.usg\.co\.nz\/mailer\/cufc\/funino\.jpg"/.test(html));
ok("…a text block's paragraphs and bold are drawn", /<p>One term\.<\/p><p>Ten weeks, <strong>one coach<\/strong>, every ball\.<\/p>/.test(html));
ok("…the faq is details/summary", (html.match(/<details>/g) || []).length === 1);
ok("…the button goes where it was told", /class="btn" href="https:\/\/cufc\.co\.nz\/football-in-schools"/.test(html));
ok("…and the crest, nav and address are in the chrome", /mailer\/crests\/cufc\.png/.test(html) && /<footer class="foot">/.test(html) && /Yaldhurst/.test(html));
const evilPage: PageDoc = { title: "<script>alert(1)</script>", blocks: [{ type: "hero", headline: "h", cta: { label: "x", href: "https://cufc.co.nz/\"><script>" } }] };
const eh = renderPage(evilPage, "cufc");
ok("a page escapes every word and attribute", !/<script>alert/.test(eh) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(eh) && !/href="https:\/\/cufc\.co\.nz\/"><script>/.test(eh));
ok("inlineWords never lets a tag through", inlineWords("<b>x</b> **y**") === "&lt;b&gt;x&lt;/b&gt; <strong>y</strong>");
ok("paragraphs split on blank lines", paragraphs("a\n\nb") === "<p>a</p><p>b</p>");
ok("every brand has a fonts link and a voice", ["cufc", "cugc", "mfl", "siu", "cic", "usc", "usg", "prints"].every((b) => studioFontsHref(b).includes("Inter") && brandVoice(b).length > 40));
ok("the house voice bans the words the brand doc bans", /elite/.test(HOUSE_VOICE) && /exclamation/.test(HOUSE_VOICE));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
