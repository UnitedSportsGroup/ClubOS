// Rambo's HISTORY tools, run for real against the live database (READ ONLY)
// as a super admin standing in Christchurch United — no model, no browser:
//   npx tsx --env-file=.env script/_test-rambo-history-tools.ts
//
// Proves the shapes Daniel asked for on 2026-10-27 ("he's only giving me data
// for April and October … we have the historical data, the lifetime value, and
// the cycles of the customers"): a calendar year of camps includes the one that
// ran in January; the term history reaches back to 2017; the lifetime engine
// reconciles with the 20 Oct report; every view answers; the MFL tool reads the
// Analytics tab's own figures; a person's record is found by name; and the
// honest refusals — a coach without Registrations, a CUFC-only viewer asking
// for MFL, another workspace asking for CUFC's lifetime model.
import type { Viewer } from "../shared/knowledge-base";
import { HISTORY_TOOL_HANDLERS } from "../server/rambo-history-tools";
import { RAMBO_TOOLS, ramboToolsFor } from "../shared/knowledge-base";
import { getYouthDataset, cohortMembers, cohortBlock, conversion, streamFromText } from "../server/youth-lifetime";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 240)}` : ""}`); good ? pass++ : fail++; };
const money = (s: string, re: RegExp) => { const m = re.exec(s); return m ? Number(m[1].replace(/,/g, "")) : NaN; };

const daniel: Viewer = { userId: 0, name: "Probe Super", globalRole: "super_admin", memberships: [{ orgSlug: "christchurch-united", orgName: "Christchurch United", role: "admin", tabs: null }, { orgSlug: "mini-football-leagues", orgName: "Mini Football Leagues", role: "admin", tabs: null }], workspaceSlug: "christchurch-united" };
const coach: Viewer = { userId: 0, name: "Probe Coach", globalRole: "coach", memberships: [{ orgSlug: "christchurch-united", orgName: "Christchurch United", role: "team_member", tabs: ["academy"] }], workspaceSlug: "christchurch-united" };
const siu: Viewer = { userId: 0, name: "Probe SIU", globalRole: "coach", memberships: [{ orgSlug: "south-island-united", orgName: "South Island United", role: "admin", tabs: null }], workspaceSlug: "south-island-united" };
const run = (name: string, viewer: Viewer, input: any) => HISTORY_TOOL_HANDLERS[name](viewer, input).then((r) => r.text);

async function main() {
  console.log("\nRambo history tools — live, read only\n");

  // ── registry ────────────────────────────────────────────────────────────
  const names = ["camp_history", "programme_history", "customer_lifetime", "league_lifetime", "person_history"];
  ok("all five tools are registered", names.every((n) => RAMBO_TOOLS.some((t) => t.name === n) && !!HISTORY_TOOL_HANDLERS[n]));
  const forDaniel = ramboToolsFor(daniel).map((t) => t.name);
  ok("a super admin in CUFC+MFL is offered all five", names.every((n) => forDaniel.includes(n)), forDaniel.join(","));
  const forCoach = ramboToolsFor(coach).map((t) => t.name);
  ok("a coach without Registrations is offered NONE of them (absent, not refused)", names.every((n) => !forCoach.includes(n)), forCoach.join(","));
  const cufcOnly: Viewer = { ...daniel, globalRole: "coach", memberships: [daniel.memberships[0]] };
  ok("a CUFC-only admin is not offered the MFL tool", !ramboToolsFor(cufcOnly).some((t) => t.name === "league_lifetime") && ramboToolsFor(cufcOnly).some((t) => t.name === "camp_history"));
  const rev = RAMBO_TOOLS.find((t) => t.name === "programme_revenue")!;
  ok("programme_revenue now says it is 2026-only and points at the history tools", /2026/.test(rev.description) && /camp_history/.test(rev.description));
  ok("streamFromText reads staff nicknames", streamFromText("U4-U8") === "u48" && streamFromText("pre academy") === "pre_academy" && streamFromText("the academy") === "academy" && streamFromText("fundamentals camp") === "camp_fundamentals" && streamFromText("world cup") === "camp_worldcup" && streamFromText("all") === "all" && streamFromText("rugby") === null);

  // ── camp_history ────────────────────────────────────────────────────────
  const camps = await run("camp_history", daniel, { series: "fundamentals", year: "this year" });
  ok("this year's FUNdamentals camps include the one that ran in January", /Dec 2025 – Jan 2026/.test(camps) && /Apr 2026/.test(camps) && /Sep–Oct 2026/.test(camps), camps.slice(0, 200));
  const jan = money(camps, /Dec 2025 – Jan 2026: \$([\d,]+\.\d\d)/), apr = money(camps, /Apr 2026: \$([\d,]+\.\d\d)/), sep = money(camps, /Sep–Oct 2026: \$([\d,]+\.\d\d)/), total = money(camps, /calendar 2026: \$([\d,]+\.\d\d)/);
  ok("the year's total is the sum of its three holidays", Math.abs(jan + apr + sep - total) < 0.01, `${jan}+${apr}+${sep} vs ${total}`);
  ok("January was sold through Shopify, Sep–Oct through ClubOS", /Jan 2026.*Shopify/.test(camps) && /Sep–Oct 2026.*ClubOS/.test(camps));
  ok("a single series never shows another series' dollar split", !/Jan 2026.*Shopify \$/.test(camps));
  ok("last year is given for comparison with growth", /Calendar 2025 for comparison/.test(camps) && /%/.test(camps));
  ok("Xero's yearly line is given as a check, labelled", /Xero's holiday-camp income line for 2026/.test(camps));
  const allCamps = await run("camp_history", daniel, { series: "all" });
  ok("all camps reach back years and roll up by calendar year", /- 2022: \$/.test(allCamps) && /- 2024: \$/.test(allCamps) && /By holiday:/.test(allCamps));
  ok("the Dec–Jan summer camp is keyed to the January year", /Dec 2024 – Jan 2025/.test(allCamps));
  const wc = await run("camp_history", daniel, { series: "world cup", year: "2025" });
  ok("World Cup 2025 answers on its own", /World Cup camp \(U9–U13\) — calendar 2025/.test(wc));

  // ── programme_history ───────────────────────────────────────────────────
  const u48 = await run("programme_history", daniel, { programme: "U4-U8", by: "year" });
  ok("U4–U8 by year reaches 2017 and the current year", /- 2017: \$/.test(u48) && /- 2026: \$/.test(u48) && /year in progress/.test(u48));
  ok("…with the fee charged each term", /Term 4 2026: U4–U8 \$160\.00/.test(u48) && /\$150\.00/.test(u48));
  const acad = await run("programme_history", daniel, { programme: "academy", year: "2025" });
  ok("Academy 2025 by term lists four terms with children and growth", /Term 1 2025: \$/.test(acad) && /Term 4 2025: \$/.test(acad) && /vs Term 1 2024/.test(acad));
  ok("a single stream shows where it was sold without another stream's dollars", /sold through Xero invoices/.test(acad) && !/Term 1 2025.*Xero invoices \$/.test(acad));
  const allP = await run("programme_history", daniel, { programme: "all" });
  ok("every programme by year splits the streams", /\[Pre-Academy \(U9–U12\) \$[\d,]+, /.test(allP) || /\[Academy \(U13\+\) \$/.test(allP));
  ok("camps are refused here and routed", /camp_history/.test(await run("programme_history", daniel, { programme: "holiday camps" })));
  ok("an unknown programme lists the choices", /Say one of/.test(await run("programme_history", daniel, { programme: "rugby" })));

  // ── customer_lifetime: the engine reconciles with the 20 Oct report ──────
  const ds = await getYouthDataset(1);
  const clean = cohortMembers(ds, "u48", "clean");
  ok("clean U4–U8 cohort = 625 children (20 Oct: 625)", clean.length === 625, String(clean.length));
  const b = cohortBlock(clean, "u48");
  ok("join age median 6, stay median 2 / mean 3 (20 Oct: 6 · 2 / 3.0)", b.ageAtJoin.median === 6 && b.termsInFirst.median === 2 && b.termsInFirst.mean === 3, JSON.stringify({ age: b.ageAtJoin.median, stay: b.termsInFirst }));
  ok("20% move up to Pre-Academy, 19% come to a camp, 23% buy uniform", Math.abs(b.progressedPct.pre_academy - 20) < 1 && Math.abs(b.progressedPct.any_camp_after_first - 19) < 1 && Math.abs(b.progressedPct.uniform - 23) < 1, JSON.stringify(b.progressedPct));
  ok("lifetime revenue per child $785 mean / $265 median (20 Oct: $785 / $265)", Math.abs(b.revenue.programmes.meanCents - 78546) < 200 && b.revenue.programmes.medianCents === 26500, JSON.stringify(b.revenue.programmes));
  const conv = conversion(ds, "fundamentals_to_u48")!;
  ok("FUNdamentals camp → U4–U8: 54 of 228 mature-eligible (20 Oct: 54 of 228)", conv.mature.converted === 54 && conv.mature.eligible === 228, JSON.stringify(conv.mature));

  const cohort = await run("customer_lifetime", daniel, { view: "cohort", programme: "U4-U8" });
  ok("cohort view reads as a brief: age, stay, what they did after, lifetime revenue", /Age when they joined: median 6/.test(cohort) && /Pre-Academy 20\.\d%/.test(cohort) && /mean \$785\.\d\d, median \$265\.00/.test(cohort), cohort.slice(0, 160));
  ok("…ages in order, youngest first", /3 or under: \d+ · 4: \d+ · 5: \d+/.test(cohort));
  const ret = await run("customer_lifetime", daniel, { view: "retention", programme: "u4-u8" });
  ok("retention names typical, best and worst steps and splits moved from gone", /Typical: \d+(\.\d)?%/.test(ret) && /Best:/.test(ret) && /moved to another programme/.test(ret));
  const yr = await run("customer_lifetime", daniel, { view: "year", programme: "U4-U8", year: "2026" });
  ok("the 2026 picture gives new vs returning per term with brand-new to the club", /2026-T1: \d+ children — \d+ new to/.test(yr) && /brand-new to the club/.test(yr) && /distinct children/.test(yr));
  const fun = await run("customer_lifetime", daniel, { view: "funnel" });
  ok("the funnel names the paths and the conditional shares", /U4–U8 → Pre-Academy → Academy: \d+/.test(fun) && /of children who did Pre-Academy, share who later did Academy: \d+(\.\d)?%/.test(fun));
  const ten = await run("customer_lifetime", daniel, { view: "tenure" });
  ok("tenure gives years with us, one-and-done, survival by join year", /years with us median/.test(ten) && /One-and-done: \d+(\.\d)?% did exactly one term ever/.test(ten) && /by the year they joined: 2021/.test(ten));
  const jo = await run("customer_lifetime", daniel, { view: "journey", programme: "fundamentals camp" });
  ok("journey after a FUNdamentals camp: 202 clean children, ~51% bought nothing more (20 Oct: 202 · 51%)", /202 children/.test(jo) && /Bought nothing more: 5[01](\.\d)?%/.test(jo), jo.slice(0, 200));
  const cv = await run("customer_lifetime", daniel, { view: "conversion", transition: "fundamentals camp to U4-U8" });
  ok("'fundamentals camp to U4-U8' resolves to THAT transition (the dash trap)", /\*\*FUNdamentals camp → U4–U8 term programme\*\*/.test(cv) && /54 of 228/.test(cv), cv.slice(0, 120));
  ok("…with the best holiday named", /Dec–Jan summer \d+(\.\d)?%/.test(cv));
  const cv2 = await run("customer_lifetime", daniel, { view: "conversion", transition: "pre-academy → academy" });
  ok("'pre-academy → academy' resolves too", /\*\*Pre-Academy → Academy\*\*/.test(cv2), cv2.slice(0, 80));
  const tot = await run("customer_lifetime", daniel, { view: "totals", year: "2024" });
  ok("totals by year give money, distinct children and growth per stream", /- 2024: \$[\d,]+\.\d\d · \d+ distinct children/.test(tot) && /- 2025: .*vs 2024: [+-]\d+%/.test(tot));
  ok("an unknown view lists the views", /Say one of: cohort/.test(await run("customer_lifetime", daniel, { view: "vibes" })));

  // ── league_lifetime ─────────────────────────────────────────────────────
  const mfl = await run("league_lifetime", { ...daniel, workspaceSlug: "mini-football-leagues" }, {});
  ok("MFL: stay, retention, LTV, formats, acquisition, in one brief", /How long a team stays: mean [\d.]+ terms, median \d/.test(mfl) && /Lifetime value per team: revenue mean \$/.test(mfl) && /Acquisition \(ad spend ÷ new teams\)/.test(mfl) && /LTGP:CAC/.test(mfl), mfl.slice(0, 160));
  ok("…the came-back share is a percentage, not a fraction", /\b\d{1,2}% ever came back/.test(mfl), /(\d+(\.\d+)?%) ever came back/.exec(mfl)?.[1] ?? "");
  ok("an unknown league term is refused with the shape", /Say it like/.test(await run("league_lifetime", daniel, { term: "Term 9" })));

  // ── person_history ──────────────────────────────────────────────────────
  const who = await run("person_history", daniel, { name: "Zhu" });
  ok("a surname finds people with programme records by year and a link to their page", /people match "Zhu"/.test(who) && /https:\/\/app\.usg\.co\.nz\/admin\/people\/(contact|child)-\d+/.test(who) && /- 20\d\d: /.test(who), who.slice(0, 160));
  ok("a nobody is a nobody", /Nobody called/.test(await run("person_history", daniel, { name: "Zzyzxq" })));

  // ── refusals ────────────────────────────────────────────────────────────
  for (const n of ["camp_history", "programme_history", "customer_lifetime", "person_history"]) {
    const t = await run(n, coach, {});
    ok(`${n}: a coach without Registrations is refused by name, no figure`, /Registrations area in Christchurch United/.test(t) && /Daniel/.test(t) && !/\$[\d,]+/.test(t), t.slice(0, 120));
  }
  ok("a CUFC-only viewer is refused the MFL tool by its own gate", /Analytics area in Mini Football Leagues/.test(await run("league_lifetime", coach, {})));
  const siuT = await run("customer_lifetime", siu, {});
  ok("another workspace is told the lifetime model is CUFC-only, no figure", /Christchurch United's youth programmes only|Registrations area in South Island United/.test(siuT) && !/\$[\d,]+/.test(siuT), siuT.slice(0, 160));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
