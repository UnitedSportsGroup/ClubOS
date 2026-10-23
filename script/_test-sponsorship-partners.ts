/**
 * shared/sponsorship-partners.ts — the deciders, proven on fixed dates.
 *   npx tsx script/_test-sponsorship-partners.ts
 */
import {
  addMonths, comparePartners, contractState, currentContract, daysBetween, fmtDateNz, nextPayment,
  partnerFlags, partnerSince, partnerStatus, paymentState, type ContractLike, type PaymentLike,
} from "../shared/sponsorship-partners";

let n = 0; const bad: string[] = [];
const eq = (label: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); console.log(`  ✗ ${label}`); } else console.log(`  ✓ ${label}`); };

const TODAY = "2026-10-23";
const c = (o: Partial<ContractLike> & { id: number }): ContractLike => ({ startDate: null, endDate: null, openEnded: false, signedOn: null, signatureStatus: "both_parties", cashPerYearCents: null, contraPerYearCents: null, noticeDays: null, ...o });
const p = (o: Partial<PaymentLike> & { id: number; contractId: number; amountCents: number }): PaymentLike => ({ label: null, dueOn: null, paidOn: null, ...o });

eq("daysBetween same day", daysBetween("2026-10-23", "2026-10-23"), 0);
eq("daysBetween forward", daysBetween("2026-10-23", "2026-11-08"), 16);
eq("daysBetween backward", daysBetween("2026-10-23", "2026-10-01"), -22);
eq("fmtDateNz", fmtDateNz("2026-11-08"), "8 Nov 2026");
eq("fmtDateNz blank", fmtDateNz(null), "—");
eq("addMonths clamps 31 Jan → 28 Feb", addMonths("2026-01-31", 1), "2026-02-28");
eq("addMonths a year", addMonths("2026-01-15", 12), "2027-01-15");

eq("expired", contractState(c({ id: 1, startDate: "2024-10-01", endDate: "2026-10-01" }), TODAY), "expired");
eq("ending soon (16 days)", contractState(c({ id: 2, startDate: "2025-11-08", endDate: "2026-11-08" }), TODAY), "ending_soon");
eq("ending soon boundary (90 days)", contractState(c({ id: 3, endDate: "2027-01-21" }), TODAY), "ending_soon");
eq("active (91 days)", contractState(c({ id: 4, endDate: "2027-01-22" }), TODAY), "active");
eq("open ended", contractState(c({ id: 5, startDate: "2025-11-08", openEnded: true }), TODAY), "open_ended");
eq("not started", contractState(c({ id: 6, startDate: "2027-02-01", endDate: "2028-02-01" }), TODAY), "not_started");
eq("undated", contractState(c({ id: 7 }), TODAY), "undated");
eq("ends today is still ending soon, not expired", contractState(c({ id: 8, endDate: TODAY }), TODAY), "ending_soon");

// Heartland: a 2024 agreement to Aug 2027 and a 2026 one to Aug 2027 — the LATEST START wins among live ones.
const h24 = c({ id: 10, startDate: "2024-08-10", endDate: "2027-08-10" });
const h26 = c({ id: 11, startDate: "2026-08-20", endDate: "2027-08-19" });
eq("current = latest live start", currentContract([h24, h26], TODAY)?.id, 11);
eq("current falls back to the most recently expired", currentContract([c({ id: 12, endDate: "2025-01-01" }), c({ id: 13, endDate: "2026-04-30" })], TODAY)?.id, 13);
eq("current prefers live over not-started", currentContract([c({ id: 14, startDate: "2027-01-01", endDate: "2028-01-01" }), c({ id: 15, endDate: "2027-06-01" })], TODAY)?.id, 15);
eq("no contracts → null", currentContract([], TODAY), null);
eq("since = earliest date we hold", partnerSince([h26, h24]), "2024-08-10");

eq("payment paid", paymentState(p({ id: 1, contractId: 1, amountCents: 100, dueOn: "2026-01-01", paidOn: "2026-02-13" }), TODAY), "paid");
eq("payment overdue", paymentState(p({ id: 2, contractId: 1, amountCents: 100, dueOn: "2026-10-20" }), TODAY), "overdue");
eq("payment due soon (30d boundary)", paymentState(p({ id: 3, contractId: 1, amountCents: 100, dueOn: "2026-11-22" }), TODAY), "due_soon");
eq("payment scheduled (31d)", paymentState(p({ id: 4, contractId: 1, amountCents: 100, dueOn: "2026-11-23" }), TODAY), "scheduled");
eq("payment unscheduled", paymentState(p({ id: 5, contractId: 1, amountCents: 100 }), TODAY), "unscheduled");
eq("next payment = oldest overdue first", nextPayment([p({ id: 6, contractId: 1, amountCents: 1, dueOn: "2026-11-01" }), p({ id: 7, contractId: 1, amountCents: 1, dueOn: "2026-09-01" }), p({ id: 8, contractId: 1, amountCents: 1, dueOn: "2026-08-01" })], TODAY)?.id, 8);

// Pak'nSave: 12-month term to 8 Nov 2026, 30 days' notice — the window has passed.
const pak = c({ id: 20, startDate: "2025-11-08", endDate: "2026-11-08", noticeDays: 30, cashPerYearCents: 1_200_000 });
const pakFlags = partnerFlags({ contracts: [pak], payments: [], today: TODAY });
eq("notice passed is red", pakFlags.map(f => f.kind), ["notice_passed"]);
eq("notice passed → status attention", partnerStatus(pakFlags, pak, TODAY), "attention");

// 83 days left with 30 days' notice: the window is still open, so this is amber, not red.
const fus = c({ id: 21, startDate: "2026-01-15", endDate: "2027-01-14", noticeDays: 30, cashPerYearCents: 6_000_000 });
const fusFlags = partnerFlags({ contracts: [fus], payments: [p({ id: 30, contractId: 21, amountCents: 575_000, dueOn: "2026-11-15" })], today: TODAY });
eq("renewal due + payment due soon", fusFlags.map(f => f.kind), ["renewal_due", "payment_due"]);
eq("renewal due → status renewal_due (no red)", partnerStatus(fusFlags, fus, TODAY), "renewal_due");
const fus90 = c({ id: 24, startDate: "2026-01-15", endDate: "2027-01-14", noticeDays: 90 });
eq("83 days left with 90 days' notice = notice passed (red)", partnerFlags({ contracts: [fus90], payments: [], today: TODAY }).map(f => `${f.kind}:${f.severity}`), ["notice_passed:red"]);

const yl = c({ id: 22, startDate: "2024-10-01", endDate: "2026-10-01", cashPerYearCents: 400_000 });
eq("expired flag", partnerFlags({ contracts: [yl], payments: [], today: TODAY }).map(f => f.kind), ["expired"]);
eq("expired → status expired", partnerStatus(partnerFlags({ contracts: [yl], payments: [], today: TODAY }), yl, TODAY), "expired");

const uns = c({ id: 23, startDate: "2026-02-20", endDate: "2027-02-19", signatureStatus: "club_only" });
eq("club_only is a red unsigned flag", partnerFlags({ contracts: [uns], payments: [], today: TODAY }).map(f => `${f.kind}:${f.severity}`), ["unsigned:red"]);

const od = partnerFlags({ contracts: [fus], payments: [p({ id: 31, contractId: 21, amountCents: 575_000, dueOn: "2026-09-15" }), p({ id: 32, contractId: 21, amountCents: 575_000, dueOn: "2026-10-15" })], today: TODAY });
eq("overdue sums both instalments", od.find(f => f.kind === "payment_overdue")?.text, "$11,500 overdue — 2 instalments, oldest 15 Sep 2026");

eq("no contract flag", partnerFlags({ contracts: [], payments: [], today: TODAY }).map(f => f.kind), ["no_contract"]);
eq("no contract → status", partnerStatus([], null, TODAY), "no_contract");

const rows = [
  { company: "B", annualValueCents: 100, since: null, renewalOn: "2026-12-01", status: "active" as const },
  { company: "a", annualValueCents: 300, since: "2024-01-01", renewalOn: null, status: "expired" as const },
  { company: "C", annualValueCents: 200, since: "2025-01-01", renewalOn: "2026-11-01", status: "attention" as const },
];
eq("sort by company is case-insensitive", rows.slice().sort(comparePartners("company", "asc")).map(r => r.company), ["a", "B", "C"]);
eq("sort by value desc", rows.slice().sort(comparePartners("value", "desc")).map(r => r.company), ["a", "C", "B"]);
eq("blank since sorts LAST ascending", rows.slice().sort(comparePartners("since", "asc")).map(r => r.company), ["a", "C", "B"]);
eq("blank since sorts LAST descending too", rows.slice().sort(comparePartners("since", "desc")).map(r => r.company), ["C", "a", "B"]);
eq("blank renewal sorts LAST", rows.slice().sort(comparePartners("renewal", "asc")).map(r => r.company), ["C", "B", "a"]);
eq("status sort: attention first", rows.slice().sort(comparePartners("status", "asc")).map(r => r.company), ["C", "a", "B"]);

console.log(`\n${bad.length ? "✗" : "✓"} ${n - bad.length}/${n} passed`);
for (const b of bad) console.log("  - " + b);
process.exit(bad.length ? 1 : 0);
