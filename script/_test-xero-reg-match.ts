// Unit tests for shared/xero-reg-match.ts — Olga's real references and the real
// near-misses found on 2026-10-14. Run: npx tsx script/_test-xero-reg-match.ts
import { parseReference, splitContactName, isFamilyPrefix, matchChild, paymentState, normName, type Candidate } from "../shared/xero-reg-match";

let fail = 0, n = 0;
const ok = (label: string, cond: boolean, got?: unknown) => { n++; if (!cond) { fail++; console.log(`FAIL ${label}`, got ?? ""); } };
const reg = (ref: string) => { const v = parseReference(ref); return v.kind === "registration" ? v.ref : null; };

// ── references ──
ok("FS term", JSON.stringify(reg("FS 2026 - Term 4")) === JSON.stringify({ programme: "funino", year: 2026, term: 4, grades: [4, 8] }), reg("FS 2026 - Term 4"));
ok("U11/U12 → pre-academy", reg("2026 U11/U12 - Term 3")?.programme === "pre_academy" && reg("2026 U11/U12 - Term 3")?.grades?.join() === "11,12");
ok("U9/10 short form", reg("2026 U9/10 - Term 3")?.grades?.join() === "9,10");
ok("U9/U10 no space before Term", reg("2026 U9/U10 -Term 1")?.term === 1);
ok("U13 → academy", reg("2026 U13-Term 3")?.programme === "academy");
ok("U20-T2 & extras", reg("2026 U20-T2 & MF+CLP & Admin")?.term === 2 && reg("2026 U20-T2 & MF+CLP & Admin")?.programme === "academy");
ok("levies still the fee", reg("2026 U14-Term 2 & MF Leives")?.term === 2);
ok("FI add-on still academy", reg("2026 U17-Term 3 Training & Football Institute")?.programme === "academy");
ok("Technification", reg("2026 Technification - T4")?.programme === "technification" && reg("2026 Technification - T4")?.term === 4);
ok("last year's grade in the ref", reg("2025 U13-Term 4")?.year === 2025);
ok("two terms → unreadable", parseReference("2026 U10 - Term 1 & Term 2 & MF Levies").kind === "unreadable");
ok("T2,3 → unreadable", parseReference("2026 Technification - T2,3 (Unregistered attendance)").kind === "unreadable");
ok("unregistered attendance → unreadable", parseReference("2026 Technification - T3 (Unregistered attendance)").kind === "unreadable");
ok("uniform → not a fee", parseReference("2026 - Uniform kit").kind === "not_registration");
ok("referee fees → not a fee", parseReference("2026 Season - Referee Match Fees").kind === "not_registration");
ok("no year → unreadable", parseReference("U12 - Term 4").kind === "unreadable");
ok("empty → unreadable", parseReference("").kind === "unreadable");

// ── contacts ──
ok("split", splitContactName("(A U12)  Beauden Whittle").child === "Beauden Whittle" && splitContactName("(A U12) Beauden Whittle").prefix === "A U12");
for (const p of ["FS", "FS_FAM", "A", "A U9", "A U17_FI", "A U20_Over18"]) ok(`family ${p}`, isFamilyPrefix(p));
for (const p of ["C", "REF", "CIC", "SPR", "P", "G", null]) ok(`not family ${p}`, !isFamilyPrefix(p as any));
ok("apostrophes", normName("Leigh O’Regan") === normName("Leigh O'Regan"));

// ── matching ──
const ref = reg("2026 U9/10 - Term 3")!;
const kid = (id: number, dob: string | null, emails: string[], regs = 0): Candidate => ({ contactId: id, name: "x", dob, grade: dob ? 2026 - Number(dob.slice(0, 4)) : null, familyEmails: emails, registrations: regs });
const auto = matchChild({ childName: "Sam", parentEmail: "Mum@x.nz", ref, candidates: [kid(1, "2017-03-01", ["mum@x.nz"])] });
ok("auto when all three hold", auto.decision === "auto" && (auto as any).contactId === 1, auto);
ok("no candidates → review", matchChild({ childName: "Sam", parentEmail: "a@b.nz", ref, candidates: [] }).decision === "review");
// Finn Jones: invoiced U9/U10, the only Finn Jones in ClubOS is fourteen
ok("too old for the band → review (Finn Jones)", matchChild({ childName: "Finn Jones", parentEmail: "a@b.nz", ref, candidates: [kid(1, "2012-12-22", ["a@b.nz"])] }).decision === "review");
ok("playing up two years → ok", matchChild({ childName: "x", parentEmail: "a@b.nz", ref, candidates: [kid(1, "2019-02-05", ["a@b.nz"])] }).decision === "auto");
ok("three years younger in U9/10 → review", matchChild({ childName: "x", parentEmail: "a@b.nz", ref, candidates: [kid(1, "2020-02-05", ["a@b.nz"])] }).decision === "review");
const u20 = reg("2026 U20-Term 3")!;
ok("U17 in the U20s → ok", matchChild({ childName: "x", parentEmail: "a@b.nz", ref: u20, candidates: [kid(1, "2009-11-25", ["a@b.nz"])] }).decision === "auto");
ok("no DOB → review", matchChild({ childName: "x", parentEmail: "a@b.nz", ref, candidates: [kid(1, null, ["a@b.nz"])] }).decision === "review");
ok("parent email unknown → review", matchChild({ childName: "x", parentEmail: "stranger@b.nz", ref, candidates: [kid(1, "2017-01-01", ["a@b.nz"])] }).decision === "review");
ok("no parent email → review", matchChild({ childName: "x", parentEmail: null, ref, candidates: [kid(1, "2017-01-01", ["a@b.nz"])] }).decision === "review");
// two different children, same name
ok("same name, different birthdays → review", matchChild({ childName: "x", parentEmail: "a@b.nz", ref, candidates: [kid(1, "2017-01-01", ["a@b.nz"]), kid(2, "2018-05-05", ["c@d.nz"])] }).decision === "review");
// one child entered twice → the record with history
const dup = matchChild({ childName: "x", parentEmail: "a@b.nz", ref, candidates: [kid(9, "2017-01-01", ["a@b.nz"], 0), kid(3, "2017-01-01", [], 4)] });
ok("duplicate records → the one with registrations", dup.decision === "auto" && (dup as any).contactId === 3, dup);
// Gabites twins share a birthday AND a family email — names differ, so only ONE is ever a candidate
ok("twins: candidates are by NAME, so Oscar never resolves to Rosa", matchChild({ childName: "Oscar Gabites", parentEmail: "g@x.nz", ref, candidates: [kid(37933, "2017-09-01", ["g@x.nz"])] }).decision === "auto");

// ── money ──
ok("paid", paymentState({ status: "PAID", amountDue: 0, amountPaid: 405, total: 405 }) === "paid");
ok("credit note is NOT paid", paymentState({ status: "PAID", amountDue: 0, amountPaid: 0, amountCredited: 405, total: 405 }) === "credited");
ok("part paid", paymentState({ status: "AUTHORISED", amountDue: 205, amountPaid: 200, total: 405 }) === "part_paid");
ok("unpaid", paymentState({ status: "AUTHORISED", amountDue: 405, amountPaid: 0, total: 405 }) === "unpaid");
ok("voided", paymentState({ status: "VOIDED", amountDue: 0, amountPaid: 0, total: 405 }) === "void");
ok("draft", paymentState({ status: "DRAFT", amountDue: 405, amountPaid: 0, total: 405 }) === "draft");

console.log(`${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
