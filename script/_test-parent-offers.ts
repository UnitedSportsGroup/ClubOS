// Unit checks for the option-name → age-grade reader behind the parent
// account's "Register for Term N" buttons. A U10 child shown the U9 button
// would be sold the wrong option; a U11 shown U9 pays $405 instead of $540.
import { gradesForOptionName } from "../shared/parent";
import { checkEligibility } from "../shared/academy";

let pass = 0, fail = 0;
const eq = (got: unknown, want: unknown, label: string) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "  ok " : " FAIL"}  ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// The live option names (join.cufc.co.nz, 2026-09-28).
eq(gradesForOptionName("U9"), [9, 9], "U9");
eq(gradesForOptionName("U12"), [12, 12], "U12");
eq(gradesForOptionName("U9–U10"), [9, 10], "U9–U10 (en dash)");
eq(gradesForOptionName("U11-U12"), [11, 12], "U11-U12 (hyphen)");
eq(gradesForOptionName("U4-U8 All-Access Pass"), [4, 8], "U4-U8 All-Access Pass");
eq(gradesForOptionName("U13–U20"), [13, 20], "U13–U20");
eq(gradesForOptionName("U13 – U15"), [13, 15], "spaced dash");
eq(gradesForOptionName("All-Access Pass"), null, "no grade named → null (offered to all)");
eq(gradesForOptionName("Tuesday group"), null, "no grade named");
eq(gradesForOptionName("U12–U9"), null, "a backwards range is refused");
eq(gradesForOptionName(null), null, "null name");

// NZF: grade = season year − birth year. The families who emailed:
eq(checkEligibility("2017-07-04", 2026, 9, 12).grade, 9, "Alex Mullaney (b. 2017) is U9 in 2026");
eq(checkEligibility("2014-06-11", 2026, 9, 12).grade, 12, "Isaac Li (b. 2014) is U12 in 2026");
eq(checkEligibility("2018-12-11", 2026, 4, 8).eligible, true, "Ernest Li (b. 2018, U8) fits FUNiño U4–U8");
eq(checkEligibility("2018-12-11", 2026, 9, 12).eligible, false, "…and not the Pre-Academy");

// Which Pre-Academy option each grade gets.
const pre = ["U9", "U10", "U11", "U12"];
const fits = (grade: number) => pre.filter((n) => { const g = gradesForOptionName(n)!; return grade >= g[0] && grade <= g[1]; });
eq(fits(9), ["U9"], "a U9 sees only the U9 option");
eq(fits(11), ["U11"], "a U11 sees only the U11 option ($540, not $405)");
const tech = ["U9–U10", "U11–U12"];
const techFits = (grade: number) => tech.filter((n) => { const g = gradesForOptionName(n)!; return grade >= g[0] && grade <= g[1]; });
eq(techFits(10), ["U9–U10"], "Technification: a U10 sees U9–U10");
eq(techFits(12), ["U11–U12"], "Technification: a U12 sees U11–U12");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
