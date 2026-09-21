// Zach may refund holiday camps and U4–U8, and NOTHING else. The programmes he
// must not touch share a kind with the one he may, so this is where that is
// proven.
//
//   npx tsx script/_test-refund-scope.ts
import { canRefundProgramme, isUnrestricted, refundScopeLabel } from "@shared/refund-scope";

let bad = 0;
const t = (got: unknown, want: unknown, label: string) => {
  const ok = got === want;
  console.log(`${ok ? "✅" : "❌"} ${label}${ok ? "" : ` — got ${got}, wanted ${want}`}`);
  if (!ok) bad++;
};

// The real programmes, verbatim from production.
const CAMP_FUND   = { id: 30, type: "holiday_camp", academySection: null };
const CAMP_WORLD  = { id: 39, type: "holiday_camp", academySection: null };
const CAMP_FUTURE = { id: 99, type: "holiday_camp", academySection: null };  // next term's
const U4_U8       = { id: 4,  type: "academy", academySection: "core" };
const PRE_ACADEMY = { id: 16, type: "academy", academySection: "core" };
const ACADEMY     = { id: 17, type: "academy", academySection: "core" };
const TECHNIF     = { id: 5,  type: "academy", academySection: "additional" };

const zach = { kinds: ["camp"], programIds: [4] };

t(canRefundProgramme(zach, CAMP_FUND), true, "Zach CAN refund FUNdamentals Holiday Camp");
t(canRefundProgramme(zach, CAMP_WORLD), true, "Zach CAN refund World Cup Holiday Camp");
t(canRefundProgramme(zach, CAMP_FUTURE), true, "🔴 …and next term's camp, which no id list would have covered");
t(canRefundProgramme(zach, U4_U8), true, "Zach CAN refund U4–U8 (by id)");
t(canRefundProgramme(zach, PRE_ACADEMY), false, "🔴 Zach CANNOT refund Pre-Academy — same kind as U4–U8");
t(canRefundProgramme(zach, ACADEMY), false, "🔴 Zach CANNOT refund Academy — same kind as U4–U8");
t(canRefundProgramme(zach, TECHNIF), false, "Zach CANNOT refund Technification");
t(canRefundProgramme(zach, null), false, "a programme we cannot identify is REFUSED — a refund moves money");

// Everyone who already held the right keeps it.
t(isUnrestricted({ kinds: null, programIds: null }), true, "both lists null = unrestricted");
t(canRefundProgramme({ kinds: null, programIds: null }, ACADEMY), true, "…and that person can still refund Academy");
t(canRefundProgramme(null, ACADEMY), true, "no scope at all = unrestricted");
t(canRefundProgramme(undefined, null), true, "unrestricted even when the programme is unknown");

// An empty list is not the same as no list.
t(canRefundProgramme({ kinds: [], programIds: [] }, CAMP_FUND), false,
  "🔴 empty lists mean NOTHING, not everything");

t(refundScopeLabel(zach), "holiday camps and 1 named programme", "the 403 says what they DO have");
t(refundScopeLabel(null), "every programme", "and says so when unrestricted");

console.log(bad ? `\n${bad} FAILED\n` : "\nAll passed\n");
process.exit(bad ? 1 : 0);
