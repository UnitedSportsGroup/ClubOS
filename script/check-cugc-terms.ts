/**
 * Keep cugc.co.nz and ClubOS telling the same story about terms and prices.
 *
 *   npx tsx script/check-cugc-terms.ts
 *
 * The gymnastics website and ClubOS are separate apps on separate hosts, so the
 * term list and the price list exist twice. That duplication is deliberate — a
 * paying parent should not wait on a network call to be shown a price — but it
 * is only SAFE if something checks it.
 *
 * 🔴 What a drift actually does: the server re-prices every enrolment from its
 * own copy and ignores whatever the browser sent. So a mismatch is not a wrong
 * charge in the database — it is a parent reading $165 on the page and being
 * charged $33, or the reverse. That is worse than an error, because nothing
 * looks broken.
 *
 * Run by deploy.sh. Exits 1 on any difference, and exits 1 — loudly — if it
 * cannot find the website to check against, because a guard that cannot say
 * "I could not check" reports success while checking nothing.
 */
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const SITE = fileURLToPath(new URL("../../cugc-website/src/lib/terms.ts", import.meta.url));
const SITE_DATA = fileURLToPath(new URL("../../cugc-website/src/site.ts", import.meta.url));

let fail = 0;
const bad = (msg: string) => { console.error(`  ✗ ${msg}`); fail++; };
const good = (msg: string) => console.log(`  ✓ ${msg}`);

async function main() {
  console.log("\nCUGC — do the website and ClubOS agree?\n");

  if (!existsSync(SITE) || !existsSync(SITE_DATA)) {
    console.error("  ✗ COULD NOT CHECK — apps/cugc-website is not next to apps/clubos.");
    console.error("    This is a failure, not a pass: the copies may have drifted and");
    console.error("    nothing here can tell. Run from a full workspace checkout.");
    process.exit(1);
  }

  const mine = await import("../shared/cugc-terms");
  const theirs = await import(SITE);
  const mineProgs = (await import("../server/cugc-pricing")).CUGC_PROGRAMS;
  const theirProgs = (await import(SITE_DATA)).programs;

  // ── Terms ────────────────────────────────────────────────────────────────
  const key = (t: any) => `${t.id}|${t.name}|${t.start}|${t.end}|${t.weeks}|${t.enrolmentOpen}`;
  const a = mine.CUGC_TERMS.map(key);
  const b = theirs.terms.map(key);

  if (a.length !== b.length) bad(`ClubOS has ${a.length} terms, the website has ${b.length}`);
  for (const line of a) if (!b.includes(line)) bad(`the website is MISSING or differs on: ${line}`);
  for (const line of b) if (!a.includes(line)) bad(`ClubOS is MISSING or differs on: ${line}`);
  if (!fail) good(`${a.length} terms identical — ${mine.CUGC_TERMS.map((t) => t.name).join(", ")}`);

  // ── Prices ───────────────────────────────────────────────────────────────
  // The number a family reads must be the number the server charges.
  const priceKey = (p: any) => p.options.map((o: any) => `${p.slug}|${o.label}|${o.price}`);
  const mp = mineProgs.flatMap(priceKey).sort();
  const tp = (theirProgs as any[]).flatMap(priceKey).sort();

  const before = fail;
  for (const line of mp) if (!tp.includes(line)) bad(`the website does not offer, or prices differently: ${line}`);
  for (const line of tp) if (!mp.includes(line)) bad(`ClubOS cannot price what the website sells: ${line}`);
  if (fail === before) good(`${mp.length} program options identical, price for price`);

  // ── Every sellable option must be on the timetable ────────────────────────
  // Not a duplication check — a completeness one. A new option with no classes
  // silently produces an empty roll, and nobody reports a roll they have never
  // seen.
  const { CUGC_OPTION_CLASSES, optionKey } = await import("../shared/cugc-classes");
  const missing = mineProgs
    .filter((p) => !p.inviteOnly)
    .flatMap((p) => p.options.map((o) => optionKey(p.slug, o.label)))
    .filter((k) => !CUGC_OPTION_CLASSES[k]);
  if (missing.length) {
    for (const k of missing) bad(`no timetable for "${k}" — children who buy it land on NO roll`);
  } else {
    good("every bookable option maps to real classes");
  }

  // 🔴 The class times a parent picks from. The website keeps its own list
  // (`times`) and the server accepts only a choice that runs in the term being
  // bought — so a website offering a class the timetable does not have is a
  // parent who fills in the whole form and is refused at the last step.
  // Checked for every term that can be SOLD today, because the website shows
  // one list: two open terms with different timetables fail here on purpose.
  const { optionTimes } = await import("../shared/cugc-classes");
  const selling = mine.sellableTerms();
  const beforeTimes = fail;
  for (const t of selling) {
    for (const p of mineProgs.filter((x) => !x.inviteOnly)) {
      for (const o of p.options) {
        const want = optionTimes(p.slug, o.label, t.id).join(" · ");
        const serverSays = o.times.join(" · ");
        const site = (theirProgs as any[]).find((x) => x.slug === p.slug)?.options?.find((x: any) => x.label === o.label);
        const siteSays = (site?.times ?? []).join(" · ");
        if (serverSays !== want) bad(`${t.name} ${p.slug} "${o.label}": ClubOS lists [${serverSays}] but the timetable runs [${want}]`);
        if (siteSays !== want) bad(`${t.name} ${p.slug} "${o.label}": the website offers [${siteSays}] but the timetable runs [${want}]`);
      }
    }
  }
  if (fail === beforeTimes) good(`class times match the timetable for ${selling.map((t) => t.name).join(", ") || "no open term"}`);

  console.log(fail ? `\n${fail} problem(s). Fix before deploying.\n` : "\nAll good.\n");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
