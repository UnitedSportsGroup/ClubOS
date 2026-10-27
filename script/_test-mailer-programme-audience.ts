// The Mailer's "By programme" audience, against the live database (read-only):
//   npx tsx --env-file=.env script/_test-mailer-programme-audience.ts
//
// Zach, 27 Oct 2026: "send to the 4-8s" · Daniel: "all u4-u8 or all pre
// academy or all u9". The catalogue the picker draws and the resolver the send
// uses must agree, an age-group pick must narrow, a term pick must narrow, a
// camp edition must reach its families, and nothing must widen quietly.
import { mailerAudienceCatalogue, resolveMailerAudience, keepByAgeGroup } from "../server/mailer-audience";
import { audienceLabel, gradesInName, parseAudienceGroups, termIdsFor, type AudienceCatalogue } from "../shared/mailer-audiences";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d}` : ""}`); good ? pass++ : fail++; };

async function main() {
  console.log("\nMailer — programme audiences (live, read-only)\n");

  // ── pure helpers ────────────────────────────────────────────────────────
  ok("gradesInName: U9 → [9]", JSON.stringify(gradesInName("U9")) === "[9]");
  ok("gradesInName: U9–U10 → [9,10]", JSON.stringify(gradesInName("U9–U10")) === "[9,10]");
  ok("gradesInName: U4-U8 All-Access Pass → [4..8]", JSON.stringify(gradesInName("U4-U8 All-Access Pass")) === "[4,5,6,7,8]");
  ok("gradesInName: U13–U15 → [13,14,15]", JSON.stringify(gradesInName("U13–U15")) === "[13,14,15]");
  ok("gradesInName: no grade → []", gradesInName("Morning Programme").length === 0);
  ok("parseAudienceGroups: optionId, optionIds and nothing", JSON.stringify(parseAudienceGroups([{ programId: 16, optionId: 30 }, { programId: "4" }, { programId: 5, optionIds: [13, "14", 14] }, { nope: 1 }]))
    === JSON.stringify([{ programId: 16, optionIds: [30] }, { programId: 4, optionIds: null }, { programId: 5, optionIds: [13, 14] }]));

  // ── the catalogue ───────────────────────────────────────────────────────
  const cat = await mailerAudienceCatalogue(1);
  const now = cat.terms.find((t) => t.current);
  ok("the current term is found by today's date", !!now && now.id === cat.currentTermId, JSON.stringify(now));
  ok("term names carry the year ('Term 4 2026')", !!now && /Term \d 20\d\d/.test(now.name), now?.name);
  const funino = cat.programmes.find((p) => p.id === 4);
  const pre = cat.programmes.find((p) => p.id === 16);
  const tech = cat.programmes.find((p) => p.id === 5);
  const oct = cat.programmes.find((p) => p.id === 30);
  ok("FUNiño (4) has 100+ families this term", !!funino && (funino.families.byTerm[String(cat.currentTermId)] ?? 0) > 100, JSON.stringify(funino?.families));
  ok("FUNiño all-time is more than this term", !!funino && funino.families.all > (funino.families.byTerm[String(cat.currentTermId)] ?? 0));
  ok("Pre-Academy (16) lists its four age groups with counts this term", !!pre && [30, 31, 32, 33].every((id) => (pre.optionFamilies[String(id)]?.byTerm[String(cat.currentTermId)] ?? 0) > 0), JSON.stringify(pre?.optionFamilies));
  ok("Technification (5) lists U9–U10 and U11–U12", !!tech && (tech.optionFamilies["13"]?.all ?? 0) > 0 && (tech.optionFamilies["14"]?.all ?? 0) > 0);
  ok("the October FUNdamentals camp (30) has 200+ families, none per term", !!oct && oct.families.all > 200 && Object.keys(oct.families.byTerm).every((k) => k === "none"), JSON.stringify(oct?.families));
  ok("no programme outside CUFC is listed", cat.programmes.every((p) => [1, 2, 4, 5, 16, 17, 19, 20, 30, 39, 58, 65, 66].includes(p.id)), cat.programmes.map((p) => p.id).join(","));
  const term = cat.currentTermId!;

  // ── the resolver ────────────────────────────────────────────────────────
  const whole = await resolveMailerAudience("programme", { groups: [{ programId: 4 }], termIds: [term] });
  ok("all U4–U8 this term resolves to 100+ addresses", whole.emails.length > 100, String(whole.emails.length));
  ok("…every one of them registered now", whole.emails.every((e) => whole.byEmail.get(e)?.registered === "current"));
  ok("…and the catalogue's family count is within reach of it (same decider, both ends)",
    Math.abs(whole.emails.length - (funino!.families.byTerm[String(term)] ?? 0)) <= Math.ceil(whole.emails.length * 0.15),
    `resolver ${whole.emails.length} vs catalogue ${funino!.families.byTerm[String(term)]}`);
  const anyTime = await resolveMailerAudience("programme", { groups: [{ programId: 4 }], termIds: null });
  ok("any time is at least this term", anyTime.emails.length >= whole.emails.length, `${anyTime.emails.length} vs ${whole.emails.length}`);
  const lastTerm = await resolveMailerAudience("programme", { groups: [{ programId: 4 }], termIds: [7] });
  ok("Term 3 alone is a different, non-empty list", lastTerm.emails.length > 50 && lastTerm.emails.length !== whole.emails.length, String(lastTerm.emails.length));

  const preAll = await resolveMailerAudience("programme", { groups: [{ programId: 16 }], termIds: [term] });
  const u9 = await resolveMailerAudience("programme", { groups: [{ programId: 16, optionIds: [30] }], termIds: [term] });
  ok("all Pre-Academy this term has addresses", preAll.emails.length > 50, String(preAll.emails.length));
  ok("just U9 is fewer than all Pre-Academy", u9.emails.length > 10 && u9.emails.length < preAll.emails.length, `${u9.emails.length} of ${preAll.emails.length}`);
  ok("…and every U9 address has a child in U9 (or on the old U9–U10 pair)", u9.emails.every((e) => (u9.byEmail.get(e)?.players ?? []).some((p) => p.ageGroup === "U9" || p.ageGroup === "U9–U10")),
    u9.emails.filter((e) => !(u9.byEmail.get(e)?.players ?? []).some((p) => p.ageGroup === "U9" || p.ageGroup === "U9–U10")).slice(0, 3).join(", "));
  const u9u10 = await resolveMailerAudience("programme", { groups: [{ programId: 16, optionIds: [30, 31] }], termIds: [term] });
  ok("U9 + U10 is more than U9 and no more than all", u9u10.emails.length > u9.emails.length && u9u10.emails.length <= preAll.emails.length, `${u9.emails.length} < ${u9u10.emails.length} <= ${preAll.emails.length}`);

  const camp = await resolveMailerAudience("programme", { groups: [{ programId: 30 }], termIds: [term] });
  ok("a camp edition resolves even with a term chosen (its rows carry no term)", camp.emails.length > 200, String(camp.emails.length));
  ok("…and its recipients carry the children booked", camp.emails.slice(0, 50).every((e) => (camp.byEmail.get(e)?.players.length ?? 0) > 0));
  const mixed = await resolveMailerAudience("programme", { groups: [{ programId: 4 }, { programId: 30 }], termIds: [term] });
  ok("FUNiño + the October camp together is at least the larger, fewer than the sum", mixed.emails.length >= Math.max(whole.emails.length, camp.emails.length) && mixed.emails.length < whole.emails.length + camp.emails.length, `${mixed.emails.length}`);

  const none = await resolveMailerAudience("programme", { groups: [] });
  ok("no groups → nobody (never 'everyone')", none.emails.length === 0);
  const junk = await resolveMailerAudience("programme", { groups: [{ programId: 999999 }], termIds: [term] });
  ok("an unknown programme → nobody", junk.emails.length === 0);
  const extra = await resolveMailerAudience("programme", { groups: [{ programId: 16, optionIds: [30] }], termIds: [term] }, ["someone.extra@example.com"]);
  ok("a typed extra rides on the end", extra.emails.includes("someone.extra@example.com") && extra.emails.length === u9.emails.length + 1);

  // ── the age-group rule on a retired pair ────────────────────────────────
  const rows = [
    { id: "exact", programId: 16, optionId: 30, regTermStart: "2026-10-12", registrantDob: "2017-03-03" },
    { id: "pair-u9", programId: 16, optionId: 13, regTermStart: "2026-10-12", registrantDob: "2017-03-03" },   // option 13 is named "U9–U10"
    { id: "pair-u10", programId: 16, optionId: 13, regTermStart: "2026-10-12", registrantDob: "2016-03-03" },
    { id: "pair-nodob", programId: 16, optionId: 13, regTermStart: "2026-10-12", registrantDob: null },
    { id: "other-prog", programId: 4, optionId: 7, regTermStart: "2026-10-12", registrantDob: "2017-03-03" },
  ];
  const kept = (await keepByAgeGroup(rows, [{ programId: 16, optionIds: [30] }])).map((r) => r.id);
  ok("U9 keeps the exact option and the pair with a 2017 child; drops 2016, no-DOB and other programmes", JSON.stringify(kept) === JSON.stringify(["exact", "pair-u9"]), kept.join(","));
  const kept2 = (await keepByAgeGroup(rows, [{ programId: 16, optionIds: null }, { programId: 4, optionIds: null }])).map((r) => r.id);
  ok("whole programmes keep every row", kept2.length === 5);

  // ── labels + term resolution ────────────────────────────────────────────
  const fake: AudienceCatalogue = { ...cat };
  ok("label: 'Pre-Academy: U9, U10 + FUNiño — First Kicks · Term 4 2026'", audienceLabel(fake, [{ programId: 16, optionIds: [30, 31] }, { programId: 4, optionIds: null }], null) === `Pre-Academy: U9, U10 + FUNiño — First Kicks · ${now!.name}`,
    audienceLabel(fake, [{ programId: 16, optionIds: [30, 31] }, { programId: 4, optionIds: null }], null));
  ok("label: a camp edition names its series and dates, no term suffix", /FUNdamentals Holiday Camp · Sep–Oct 2026$/.test(audienceLabel(fake, [{ programId: 30, optionIds: null }], null)), audienceLabel(fake, [{ programId: 30, optionIds: null }], null));
  ok("label: any time", /· any time$/.test(audienceLabel(fake, [{ programId: 4, optionIds: null }], "all")));
  ok("termIdsFor: null → the current term, 'all' → null, a term → itself", JSON.stringify(termIdsFor(fake, null)) === JSON.stringify([term]) && termIdsFor(fake, "all") === null && JSON.stringify(termIdsFor(fake, 7)) === "[7]");
}

main().then(() => { console.log(`\n${pass} passed, ${fail} failed\n`); process.exit(fail ? 1 : 0); }).catch((e) => { console.error(e); process.exit(1); });
