// The Mailer assistant's pure rules, proven without a model or a database:
//   npx tsx script/_test-mailer-ai.ts
//
// - every starter template, in every brand, passes the checks a model's answer
//   must pass (so the rules can't refuse the club's own designs);
// - a made-up picture, an unsupported tag, mj-head, a picture followed by text
//   in one column, and an unknown merge tag are each refused by name;
// - edits apply only when the find is exact and unique;
// - a prompt's cost is worked out from the real price table.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STARTER_TEMPLATES } from "../client/src/components/marketing/grapes/templates/index";
import { BRAND_KITS, CLUB_LOGOS, SOCIAL_ICON } from "../client/src/components/marketing/grapes/templates/brand-kit";
import { LETTERHEADS } from "../client/src/components/marketing/grapes/letterheads";
import {
  applyMjmlEdits,
  mailerAiCostCents,
  mailerAiDailyLimitFor,
  mjmlImageSrcs,
  validateMailerAiMjml,
  MAILER_AI_DEFAULT_DAILY_LIMIT,
} from "../shared/mailer-ai";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

function allowedFor(brand: string, mjml: string): Set<string> {
  const kit = BRAND_KITS[brand];
  const s = new Set<string>();
  if (kit) { s.add(kit.crest); kit.photos.forEach((p) => s.add(p.src)); (kit.products ?? []).forEach((p) => s.add(p.src)); }
  Object.values(SOCIAL_ICON).forEach((x) => s.add(x.src));
  LETTERHEADS.forEach((l) => s.add(l.src));
  mjmlImageSrcs(mjml).forEach((x) => s.add(x));
  return s;
}

console.log("\nMailer assistant — rules\n");

// ── The club's own templates pass ─────────────────────────────────────────────
let templatesChecked = 0;
for (const t of STARTER_TEMPLATES) {
  for (const brand of Object.keys(BRAND_KITS)) {
    let mjml = "";
    try { mjml = t.build(brand); } catch (e: any) { ok(`${t.id} × ${brand} builds`, false, e.message); continue; }
    const kit = BRAND_KITS[brand];
    const allowed = new Set<string>();
    allowed.add(kit.crest); kit.photos.forEach((p) => allowed.add(p.src)); (kit.products ?? []).forEach((p) => allowed.add(p.src));
    Object.values(SOCIAL_ICON).forEach((x) => allowed.add(x.src));
    LETTERHEADS.forEach((l) => allowed.add(l.src));
    const problems = validateMailerAiMjml(mjml, allowed);
    templatesChecked++;
    if (problems.length) ok(`${t.id} × ${brand} passes the checks`, false, problems.join(" | "));
  }
}
ok(`every starter template in every brand passes the checks (${templatesChecked} documents)`, fail === 0);

// ── Each rule refuses by name ─────────────────────────────────────────────────
const base = STARTER_TEMPLATES[0].build("siu");
const baseAllowed = allowedFor("siu", base);
ok("the SIU newsletter itself passes", validateMailerAiMjml(base, baseAllowed).length === 0);

const stray = base.replace(/<mj-image([^>]*)src="[^"]+"/, '<mj-image$1src="https://example.com/made-up.jpg"');
ok("a made-up picture is refused by name", validateMailerAiMjml(stray, baseAllowed).some((p) => /unknown picture https:\/\/example\.com\/made-up\.jpg/.test(p)));

const head = base.replace("<mj-body", "<mj-head><mj-style>a{}</mj-style></mj-head><mj-body");
ok("mj-head is refused", validateMailerAiMjml(head, baseAllowed).some((p) => /mj-head/.test(p)));

const table = base.replace("<mj-body", "<mj-table></mj-table><mj-body");
ok("an unsupported tag is refused", validateMailerAiMjml(table, baseAllowed).some((p) => /mj-table/.test(p)));

const trap = `<mjml><mj-body><mj-section><mj-column><mj-image src="${[...baseAllowed][0]}" /><mj-text>after the picture</mj-text></mj-column></mj-section></mj-body></mjml>`;
const trapProblems = validateMailerAiMjml(trap, baseAllowed);
ok("a picture followed by text in one column is refused (the export drops the text)", trapProblems.some((p) => /mj-image> must be the last thing/.test(p)), trapProblems.join(" | "));

const lastOk = `<mjml><mj-body><mj-section><mj-column><mj-text>before</mj-text><mj-image src="${[...baseAllowed][0]}" /></mj-column></mj-section></mj-body></mjml>`;
ok("a picture LAST in its column is fine", validateMailerAiMjml(lastOk, baseAllowed).length === 0, validateMailerAiMjml(lastOk, baseAllowed).join(" | "));

const tag = base.replace("</mj-body>", "<mj-section><mj-column><mj-text>{{parent_phone}}</mj-text></mj-column></mj-section></mj-body>");
ok("an unknown merge tag is refused", validateMailerAiMjml(tag, baseAllowed).some((p) => /parent_phone/.test(p)));

const known = base.replace("</mj-body>", "<mj-section><mj-column><mj-text>Hi {{first_name}}, {{ player_first_name }}</mj-text></mj-column></mj-section></mj-body>");
ok("the real merge tags pass, spaces and all", validateMailerAiMjml(known, baseAllowed).length === 0);

const unbalanced = base.replace("</mj-section>", "");
ok("an unclosed section is refused", validateMailerAiMjml(unbalanced, baseAllowed).some((p) => /mj-section> opens/.test(p)));

ok("a script is refused", validateMailerAiMjml(base.replace("</mj-body>", "<mj-raw><script>x()</script></mj-raw></mj-body>"), baseAllowed).some((p) => /scripts/.test(p)));
ok("an empty document is refused", validateMailerAiMjml("", baseAllowed)[0] === "the document is empty");

// ── Edits ─────────────────────────────────────────────────────────────────────
const doc = "<mjml><mj-body><mj-text>Hello</mj-text><mj-text>World</mj-text></mj-body></mjml>";
const e1 = applyMjmlEdits(doc, [{ find: "Hello", replace: "Kia ora" }]);
ok("an exact, unique find is replaced", e1.failures.length === 0 && e1.mjml.includes("Kia ora") && !e1.mjml.includes("Hello"));
const e2 = applyMjmlEdits(doc, [{ find: "<mj-text>", replace: "<mj-text color=\"red\">" }]);
ok("a find that occurs twice is refused, not guessed", e2.failures.length === 1 && /more than once/.test(e2.failures[0]) && e2.mjml === doc);
const e3 = applyMjmlEdits(doc, [{ find: "Goodbye", replace: "x" }]);
ok("a find that isn't there is reported", e3.failures.length === 1 && /not found/.test(e3.failures[0]));
const e4 = applyMjmlEdits(doc, [{ find: "Hello", replace: "A" }, { find: "World", replace: "B" }]);
ok("edits apply in order", e4.failures.length === 0 && e4.mjml.includes("A") && e4.mjml.includes("B"));

// ── Club logos — every brand's crest is a picture Rambo and the picker may use ─
// Daniel, 2026-10-26, after Rambo left "[CUGC logo]" as text: the list is read
// off the kits, each file exists on disk, and a logo from another brand passes
// the checks on this brand's email once it is in the allowed set.
ok("the club-logo list has every brand", CLUB_LOGOS.length === 7 && ["cufc", "siu", "cugc", "mfl", "cic", "usg", "prints"].every((k) => CLUB_LOGOS.some((l) => l.key === k)), CLUB_LOGOS.map((l) => l.key).join(","));
ok("every crest URL is served by ClubOS and the file exists", CLUB_LOGOS.every((l) => l.src.startsWith("https://app.usg.co.nz/mailer/crests/") && existsSync(join(process.cwd(), "client/public", l.src.replace("https://app.usg.co.nz/", "")))), CLUB_LOGOS.map((l) => l.src.split("/").pop()).join(","));
ok("every crest carries a label and a header width", CLUB_LOGOS.every((l) => l.label.length > 3 && l.width > 0));
const cugc = CLUB_LOGOS.find((l) => l.key === "cugc")!;
const twoCrests = `<mjml><mj-body><mj-section><mj-column><mj-image src="${[...baseAllowed][0]}" width="64px" /></mj-column><mj-column><mj-image src="${cugc.src}" width="64px" /></mj-column></mj-section></mj-body></mjml>`;
// The finding behind the fix: the CUGC crest was ALREADY an allowed picture
// (every crest doubles as a letterhead) — the first "[CUGC logo]" placeholder
// came from Rambo not being TOLD the URL, never from the checks refusing it.
ok("the CUGC crest was already an allowed picture through the letterheads (the model wasn't told)", baseAllowed.has(cugc.src));
const withLogos = new Set(baseAllowed); CLUB_LOGOS.forEach((l) => withLogos.add(l.src));
ok("two crests side by side, one per column, pass the checks", validateMailerAiMjml(twoCrests, withLogos).length === 0, validateMailerAiMjml(twoCrests, withLogos).join(" | "));

// ── Money + limits ────────────────────────────────────────────────────────────
const cents = mailerAiCostCents("claude-sonnet-5-5", { input: 9000, output: 6000, cacheRead: 0, cacheWrite: 0 });
ok("a full-rewrite prompt on Sonnet costs about 8 US cents", Math.abs(cents - 7.8) < 0.01, `${cents}c`);
const cached = mailerAiCostCents("claude-sonnet-5-5", { input: 6000, output: 1000, cacheRead: 8000, cacheWrite: 0 });
ok("a cached, edit-sized prompt costs about 2 cents", cached < 2.5 && cached > 1.5, `${cached}c`);
ok("an unknown model is priced as the default, never free", mailerAiCostCents("claude-mystery", { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }) > 0);
ok("no personal limit → the default", mailerAiDailyLimitFor(null) === MAILER_AI_DEFAULT_DAILY_LIMIT && mailerAiDailyLimitFor(undefined) === MAILER_AI_DEFAULT_DAILY_LIMIT);
ok("0 is a real limit (switched off)", mailerAiDailyLimitFor(0) === 0);
ok("a personal limit wins", mailerAiDailyLimitFor(7) === 7);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
