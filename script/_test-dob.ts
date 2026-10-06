// The typed date-of-birth rules (shared/dob.ts), proven without a browser.
//   npx tsx script/_test-dob.ts
import assert from "node:assert/strict";
import { boxComplete, checkDobParts, dobProblemMessage, padBox, parseWholeDate, partsFromIso, ageOnDate, digits } from "../shared/dob";

let pass = 0, fail = 0;
const ok = (label: string, fn: () => void) => { try { fn(); pass++; console.log(`✓ ${label}`); } catch (e: any) { fail++; console.log(`✗ ${label}\n    ${e.message}`); } };
const TODAY = "2026-10-07";

ok("a real date becomes ISO", () => assert.equal(checkDobParts({ day: "11", month: "07", year: "2018" }, TODAY).iso, "2018-07-11"));
ok("single digits are accepted and zero-padded", () => assert.equal(checkDobParts({ day: "7", month: "3", year: "2019" }, TODAY).iso, "2019-03-07"));
ok("31 February is not a date", () => assert.equal(checkDobParts({ day: "31", month: "02", year: "2018" }, TODAY).problem, "not_a_date"));
ok("29 February 2016 is a date (leap year)", () => assert.equal(checkDobParts({ day: "29", month: "02", year: "2016" }, TODAY).iso, "2016-02-29"));
ok("29 February 2018 is not", () => assert.equal(checkDobParts({ day: "29", month: "02", year: "2018" }, TODAY).problem, "not_a_date"));
ok("month 13 is not a date", () => assert.equal(checkDobParts({ day: "01", month: "13", year: "2018" }, TODAY).problem, "not_a_date"));
ok("tomorrow is in the future", () => assert.equal(checkDobParts({ day: "08", month: "10", year: "2026" }, TODAY).problem, "future"));
ok("today is allowed (a newborn)", () => assert.equal(checkDobParts({ day: "07", month: "10", year: "2026" }, TODAY).iso, "2026-10-07"));
ok("year 1899 is a typo", () => assert.equal(checkDobParts({ day: "01", month: "01", year: "1899" }, TODAY).problem, "too_old"));
ok("a missing box is 'incomplete', not an error", () => assert.equal(checkDobParts({ day: "11", month: "07", year: "" }, TODAY).problem, "incomplete"));
ok("a 2-digit year is incomplete, never guessed", () => assert.equal(checkDobParts({ day: "11", month: "07", year: "18" }, TODAY).problem, "incomplete"));
ok("incomplete has no message; the others do", () => { assert.equal(dobProblemMessage("incomplete"), null); assert.match(dobProblemMessage("not_a_date")!, /real date/); assert.match(dobProblemMessage("future")!, /future/); });

ok("ISO → parts", () => assert.deepEqual(partsFromIso("2018-07-11"), { year: "2018", month: "07", day: "11" }));
ok("junk → empty parts", () => assert.deepEqual(partsFromIso("11/07/2018"), { day: "", month: "", year: "" }));

ok("paste 11/07/2018", () => assert.deepEqual(parseWholeDate("11/07/2018"), { day: "11", month: "07", year: "2018" }));
ok("paste 11-7-2018 (day first, NZ)", () => assert.deepEqual(parseWholeDate("11-7-2018"), { day: "11", month: "07", year: "2018" }));
ok("paste 2018-07-11 (ISO)", () => assert.deepEqual(parseWholeDate("2018-07-11"), { day: "11", month: "07", year: "2018" }));
ok("paste 11072018 (autofill, no separators)", () => assert.deepEqual(parseWholeDate("11072018"), { day: "11", month: "07", year: "2018" }));
ok("a lone '11' is not a whole date", () => assert.equal(parseWholeDate("11"), null));
ok("'2018' alone is not a whole date", () => assert.equal(parseWholeDate("2018"), null));

ok("day: '1' waits (could be 1x), '4' moves on", () => { assert.equal(boxComplete("day", "1"), false); assert.equal(boxComplete("day", "4"), true); assert.equal(boxComplete("day", "11"), true); });
ok("month: '1' waits, '2' moves on", () => { assert.equal(boxComplete("month", "1"), false); assert.equal(boxComplete("month", "2"), true); assert.equal(boxComplete("month", "12"), true); });
ok("year moves on at four digits only", () => { assert.equal(boxComplete("year", "201"), false); assert.equal(boxComplete("year", "2018"), true); });
ok("padBox: '7' → '07', '0' → '', '07' stays, year untouched", () => { assert.equal(padBox("day", "7"), "07"); assert.equal(padBox("month", "0"), ""); assert.equal(padBox("day", "07"), "07"); assert.equal(padBox("year", "7"), "7"); });
ok("digits strips everything else and caps", () => { assert.equal(digits("1a2b3", 2), "12"); assert.equal(digits("20188", 4), "2018"); });

ok("age on calendar parts: born 11 Jul 2018 is 8 on 7 Oct 2026", () => assert.equal(ageOnDate("2018-07-11", TODAY), 8));
ok("…and 7 the day before the birthday", () => assert.equal(ageOnDate("2018-07-11", "2026-07-10"), 7));
ok("…and 8 on the birthday itself", () => assert.equal(ageOnDate("2018-07-11", "2026-07-11"), 8));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
