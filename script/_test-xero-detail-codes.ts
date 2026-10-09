// npx tsx script/_test-xero-detail-codes.ts
import { detailCodeFor, gradeFor } from "../shared/xero-detail-codes";

let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${String(got)}${ok ? "" : ` (want ${String(want)})`}`);
};
const base = { programId: null, programName: null, programType: null, optionName: null, dob: null, seasonYear: 2026, divisionName: null } as const;

eq("Pre-Academy U9 option", detailCodeFor({ ...base, programId: 16, programType: "academy", optionName: "U9" }), "101-02-01");
eq("Pre-Academy U12 option", detailCodeFor({ ...base, programId: 16, programType: "academy", optionName: "U12" }), "101-02-04");
eq("Pre-Academy legacy pair U11–U12 + DOB 2015", detailCodeFor({ ...base, programId: 16, optionName: "U11–U12", dob: "2015-03-01" }), "101-02-03");
eq("Pre-Academy legacy pair, Term 4 lead-in clamps up", detailCodeFor({ ...base, programId: 16, optionName: "U9–U10", dob: "2018-05-01" }), "101-02-01");
eq("Pre-Academy no option no DOB → keep mapped", detailCodeFor({ ...base, programId: 16 }), null);
eq("FUNiño U6 by DOB", detailCodeFor({ ...base, programId: 4, optionName: "U4-U8 All-Access Pass", dob: "2020-07-07" }), "101-01-03");
eq("FUNiño U3 lead-in clamps to U4", detailCodeFor({ ...base, programId: 4, optionName: "U4-U8 All-Access Pass", dob: "2023-01-01" }), "101-01-01");
eq("Academy U13–U15 + DOB 2012 → U14", detailCodeFor({ ...base, programId: 17, optionName: "U13–U15", dob: "2012-02-02" }), "101-03-02");
eq("Academy U17", detailCodeFor({ ...base, programId: 17, optionName: "U17" }), "101-03-05");
eq("Academy U20", detailCodeFor({ ...base, programId: 17, dob: "2006-01-01" }), "101-04");
eq("World Cup camp", detailCodeFor({ ...base, programId: 39, programType: "holiday_camp", programName: "World Cup Holiday Camp Term 3 2026" }), "103-02");
eq("Fundamentals camp", detailCodeFor({ ...base, programId: 30, programType: "holiday_camp", programName: "FUNdamentals Holiday Camp Term 3 2026" }), "103-01");
eq("SIU camp U15", detailCodeFor({ ...base, programType: "holiday_camp", programName: "SIU October Holiday Camp", dob: "2011-04-04" }), "103-04");
eq("SIU camp no age → keep mapped", detailCodeFor({ ...base, programType: "holiday_camp", programName: "SIU October Holiday Camp" }), null);
eq("Ballers", detailCodeFor({ ...base, programId: 44, programType: "academy", programName: "Ballers Youth League — U9" }), "104-01");
eq("MFL 7's", detailCodeFor({ ...base, programType: "league_team", programName: "Mini Football Leagues — Term 4", divisionName: "Tuesday 7's" }), "104-02");
eq("MFL 5's", detailCodeFor({ ...base, programType: "league_team", divisionName: "Monday 5's" }), "104-01");
eq("MFL unknown division → keep mapped", detailCodeFor({ ...base, programType: "league_team", divisionName: null }), null);
eq("Technification untouched", detailCodeFor({ ...base, programId: 5, programType: "academy", optionName: "U9–U10" }), null);
eq("grade from single option wins over DOB", gradeFor({ programId: 16, optionName: "U10", dob: "2018-01-01", seasonYear: 2026 }), 10);

console.log(fail ? `\n${fail} FAILED` : "\nall passed");
process.exit(fail ? 1 : 0);
