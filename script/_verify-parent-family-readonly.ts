// READ-ONLY. Runs the parent account's family view against real families on the
// production database, with the programme list read from the live public API
// (priced by the same academyQuoteFor the checkout charges with). Writes nothing.
//   npx tsx --env-file=.env script/_verify-parent-family-readonly.ts
import { __parentInternals as P, type OpenAcademyProgramme } from "../server/parent-routes";

const FAMILIES = ["m.mullaney18@gmail.com", "yuweili@yahoo.com"];
let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => {
  console.log(`${c ? "  ok " : " FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  c ? pass++ : fail++;
};

async function livePrograms(): Promise<OpenAcademyProgramme[]> {
  const list = await (await fetch("https://join.cufc.co.nz/api/public/academy/programmes")).json();
  const out: OpenAcademyProgramme[] = [];
  for (const p of list.programmes) {
    if (!p.registrationOpen || p.isFull) continue;
    const d = await (await fetch(`https://join.cufc.co.nz/api/public/academy/programmes/${p.slug}`)).json();
    out.push({
      id: p.id, slug: p.slug, name: p.name, section: p.section, ageMin: p.ageMin, ageMax: p.ageMax,
      seasonYear: p.seasonYear, termId: null, termLabel: d.term?.name ?? null,
      options: p.options.map((o: any) => {
        const q = d.quotes.find((x: any) => x.optionId === o.id && x.plan === "term");
        return { id: o.id, name: o.name, scheduleText: o.scheduleText, fullPriceCents: o.termPriceCents,
          priceCents: q?.totalCents ?? o.termPriceCents, sessionsRemaining: q?.sessionsRemaining ?? null,
          totalSessions: q?.totalSessions ?? null };
      }),
    });
  }
  return out;
}

const programmes = await livePrograms();
console.log(`Open programmes: ${programmes.map((p) => `${p.slug} [${p.options.map((o) => o.name).join(", ")}]`).join(" · ")}\n`);
ok(programmes.some((p) => p.slug === "pre-academy-u9-u12"), "Pre-Academy is open");

for (const email of FAMILIES) {
  const guardianIds = await P.guardianIdsForEmail(email);
  const fam = await P.familyFor({ email, guardianIds });
  const enrolled = await P.enrolledKeys(fam.flatMap(P.contactIdsOf), programmes.map((p) => p.id));
  console.log(`\n${email} — guardian rows ${guardianIds.join(", ")}`);
  for (const c of fam) {
    const offers = P.offersForChild(c, programmes, enrolled);
    const hist = P.toParentHistory(c.history);
    console.log(`  ${c.firstName} ${c.lastName} (${c.dateOfBirth}) key=${c.key} records=${(c.records ?? []).map((r) => r.key).join(",")}`);
    console.log(`     offers: ${offers.map((o) => `${o.programmeSlug}/${o.optionName} $${(o.priceCents / 100).toFixed(2)}${o.registered ? " ✓" : ""}`).join(" · ") || "—"}`);
    console.log(`     history: ${hist.programmes.length} programmes, ${hist.payments.length} payments, ${hist.termCount} terms since ${hist.firstSeason ?? "?"}`);
    for (const h of hist.programmes.slice(0, 4)) console.log(`        · ${h.seasonYear ?? "?"} ${h.termLabel ?? ""} — ${h.programme} (${h.source})`);
  }
  if (email.startsWith("m.mullaney")) {
    const alex = fam.filter((c) => c.firstName === "Alex");
    ok(alex.length === 1, "Alex Mullaney is ONE card, not two", `${alex.length}`);
    const a = alex[0];
    const offers = a ? P.offersForChild(a, programmes, enrolled) : [];
    ok(offers.some((o) => o.programmeSlug === "pre-academy-u9-u12" && o.optionName === "U9"), "Alex is offered Pre-Academy U9");
    ok(!offers.some((o) => o.programmeSlug === "pre-academy-u9-u12" && o.optionName !== "U9"), "…and no other Pre-Academy age");
    ok(offers.some((o) => o.programmeSlug === "technification" && o.optionName.startsWith("U9")), "Alex is offered Technification U9–U10");
    ok(offers.every((o) => o.registerUrl.startsWith("https://join.cufc.co.nz/academy/") && o.registerUrl.includes(`child=${encodeURIComponent(a.key)}`)), "every button carries the child and lands on join.cufc.co.nz");
  }
  if (email.startsWith("yuweili")) {
    ok(fam.length >= 3, "Yuwei sees all three children", `${fam.length}`);
    const isaac = fam.find((c) => c.firstName === "Isaac");
    const ernest = fam.find((c) => c.firstName === "Ernest");
    const io = isaac ? P.offersForChild(isaac, programmes, enrolled) : [];
    const eo = ernest ? P.offersForChild(ernest, programmes, enrolled) : [];
    ok(io.some((o) => o.optionName === "U12"), "Isaac (U12) is offered Pre-Academy U12");
    ok(eo.some((o) => o.programmeSlug === "u4-u8") && !eo.some((o) => o.programmeSlug === "pre-academy-u9-u12"), "Ernest (U8) is offered FUNiño, not the Pre-Academy");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
