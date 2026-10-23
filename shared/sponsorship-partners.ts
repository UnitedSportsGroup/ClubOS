// ─────────────────────────────────────────────────────────────────────────────
// Sponsorship Partners — the sponsors we have ALREADY signed, and what we owe
// them. The Pipeline is for the deals we are chasing; this is for the ones we
// must keep.
//
// Daniel, 2026-10-23: "Signed is king… a quick list of all of our sponsors…
// name of the company, main contact, when they signed on, where their renewal
// date is. If the renewal date is coming up, it needs to flag that. If they've
// paid for the first year but the payment for the second year is coming up,
// that needs to get flagged… losing a sponsor makes it really hard to get a
// new one."
//
// Shape: a PARTNER is the relationship (the company). A CONTRACT is one signed
// agreement inside it — Heartland has a 2024 one and a 2026 one, and "longest
// serving" is the FIRST contract's date. PAYMENTS are the instalments a contract
// promises. Deliverables hang off the contract (the promises are in the
// signed document, not in the company).
//
// 🔴 Every state below is DERIVED from dates against today, in this file, and
// never written into a column. A stored "renewal due" flag is wrong the day
// after it is set; a stored "overdue" is wrong the day it is paid. Same rule as
// Fines, Vehicles and Housing. Dates are y-m-d strings compared by their parts —
// never through a JS Date in local time (a 9am NZ date is yesterday in UTC).
//
// No imports: the client and the server read the same file, and the seed and
// the tests must not drag the schema in.
// ─────────────────────────────────────────────────────────────────────────────

export const SIGNATURE_STATUSES = [
  "both_parties", "sponsor_only", "club_only", "unsigned", "unclear", "not_checked",
] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const SIGNATURE_LABEL: Record<SignatureStatus, string> = {
  both_parties: "Signed by both parties",
  sponsor_only: "Signed by the sponsor only",
  club_only:    "Signed by the club only",
  unsigned:     "No signature on file",
  unclear:      "Signature unclear",
  not_checked:  "Signature not checked yet",
};

/** How far out a renewal is flagged. Three months is what a sponsorship
 *  conversation actually needs: a renewal pitch, a counter, a signature. */
export const RENEWAL_WINDOW_DAYS = 90;
/** How far out an instalment is flagged — one invoicing cycle. */
export const PAYMENT_WINDOW_DAYS = 30;

export interface ContractLike {
  id: number;
  startDate: string | null;
  endDate: string | null;
  openEnded: boolean;
  signedOn: string | null;
  signatureStatus: string;
  cashPerYearCents: number | null;
  contraPerYearCents: number | null;
  noticeDays: number | null;
  flags?: unknown;
}

export interface PaymentLike {
  id: number;
  contractId: number;
  label: string | null;
  dueOn: string | null;
  amountCents: number;
  paidOn: string | null;
}

// ── Dates ───────────────────────────────────────────────────────────────────

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days from `a` to `b` (positive when b is later), on y-m-d parts only. */
export function daysBetween(a: string, b: string): number {
  const ma = ISO.exec(a); const mb = ISO.exec(b);
  if (!ma || !mb) return NaN;
  const ua = Date.UTC(+ma[1], +ma[2] - 1, +ma[3]);
  const ub = Date.UTC(+mb[1], +mb[2] - 1, +mb[3]);
  return Math.round((ub - ua) / 86_400_000);
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-08" → "8 Nov 2026". Never through a Date. */
export function fmtDateNz(iso: string | null | undefined): string {
  if (!iso || !ISO.test(iso)) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Add whole months to a y-m-d, clamping the day (31 Jan + 1 month = 28 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12); const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

// ── Contract state ──────────────────────────────────────────────────────────

export type ContractState = "not_started" | "active" | "ending_soon" | "open_ended" | "expired" | "undated";

export const CONTRACT_STATE_LABEL: Record<ContractState, string> = {
  not_started: "Starts later",
  active:      "Active",
  ending_soon: "Renewal due",
  open_ended:  "Ongoing",
  expired:     "Expired",
  undated:     "No dates on file",
};

export function contractState(c: ContractLike, today: string): ContractState {
  if (c.startDate && isIsoDate(c.startDate) && daysBetween(today, c.startDate) > 0) return "not_started";
  if (c.openEnded) return "open_ended";
  if (!c.endDate || !isIsoDate(c.endDate)) return "undated";
  const left = daysBetween(today, c.endDate);
  if (left < 0) return "expired";
  if (left <= RENEWAL_WINDOW_DAYS) return "ending_soon";
  return "active";
}

/** The contract the list should talk about: a live one first (latest start),
 *  then one that starts later (earliest), then the most recently ended, then
 *  anything undated. A partner with no contracts has no current contract. */
export function currentContract<T extends ContractLike>(contracts: T[], today: string): T | null {
  if (!contracts.length) return null;
  const by = (states: ContractState[]) => contracts.filter(c => states.includes(contractState(c, today)));
  const live = by(["active", "ending_soon", "open_ended"]).sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  if (live.length) return live[0];
  const soon = by(["not_started"]).sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  if (soon.length) return soon[0];
  const gone = by(["expired"]).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  if (gone.length) return gone[0];
  return contracts.slice().sort((a, b) => b.id - a.id)[0];
}

/** "Signed on" for the partner = the earliest contract we hold a date for. */
export function partnerSince(contracts: ContractLike[]): string | null {
  const dates = contracts.flatMap(c => [c.signedOn, c.startDate]).filter(isIsoDate).sort();
  return dates[0] ?? null;
}

export function annualValueCents(c: ContractLike | null): number {
  if (!c) return 0;
  return (c.cashPerYearCents ?? 0) + (c.contraPerYearCents ?? 0);
}

// ── Payment state ───────────────────────────────────────────────────────────

export type PaymentState = "paid" | "overdue" | "due_soon" | "scheduled" | "unscheduled";

export function paymentState(p: PaymentLike, today: string): PaymentState {
  if (p.paidOn) return "paid";
  if (!p.dueOn || !isIsoDate(p.dueOn)) return "unscheduled";
  const left = daysBetween(today, p.dueOn);
  if (left < 0) return "overdue";
  if (left <= PAYMENT_WINDOW_DAYS) return "due_soon";
  return "scheduled";
}

export function nextPayment<T extends PaymentLike>(payments: T[], today: string): T | null {
  const open = payments.filter(p => !p.paidOn && p.dueOn && isIsoDate(p.dueOn));
  if (!open.length) return null;
  // Overdue first (oldest), then the soonest upcoming.
  const overdue = open.filter(p => daysBetween(today, p.dueOn!) < 0).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  if (overdue.length) return overdue[0];
  return open.sort((a, b) => a.dueOn!.localeCompare(b.dueOn!))[0];
}

// ── Flags — what the list must shout about ──────────────────────────────────

export type FlagKind =
  | "no_contract" | "unsigned" | "expired" | "notice_passed" | "renewal_due"
  | "payment_overdue" | "payment_due" | "contract_issue";
export type FlagSeverity = "red" | "amber" | "grey";

export interface PartnerFlag { kind: FlagKind; severity: FlagSeverity; text: string }

export function fmtCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function partnerFlags(args: { contracts: ContractLike[]; payments: PaymentLike[]; today: string }): PartnerFlag[] {
  const { contracts, payments, today } = args;
  const out: PartnerFlag[] = [];
  const cur = currentContract(contracts, today);
  if (!cur) {
    out.push({ kind: "no_contract", severity: "red", text: "No contract on file" });
    return out;
  }
  const state = contractState(cur, today);
  if (cur.signatureStatus !== "both_parties") {
    out.push({ kind: "unsigned", severity: cur.signatureStatus === "not_checked" ? "grey" : "red", text: SIGNATURE_LABEL[(cur.signatureStatus as SignatureStatus)] ?? "Signature status unknown" });
  }
  if (state === "expired") {
    out.push({ kind: "expired", severity: "red", text: `Term ended ${fmtDateNz(cur.endDate)}` });
  } else if (state === "ending_soon") {
    const left = daysBetween(today, cur.endDate!);
    const noticeBy = cur.noticeDays && cur.endDate ? daysBetween(today, cur.endDate) - cur.noticeDays : null;
    if (noticeBy !== null && noticeBy < 0) {
      out.push({ kind: "notice_passed", severity: "red", text: `Notice window passed — term ends ${fmtDateNz(cur.endDate)} (${left} day${left === 1 ? "" : "s"})` });
    } else {
      out.push({ kind: "renewal_due", severity: "amber", text: `Renewal due — term ends ${fmtDateNz(cur.endDate)} (${left} day${left === 1 ? "" : "s"})` });
    }
  }
  const mine = payments.filter(p => contracts.some(c => c.id === p.contractId));
  const overdue = mine.filter(p => paymentState(p, today) === "overdue").sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  const soon = mine.filter(p => paymentState(p, today) === "due_soon").sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  if (overdue.length) {
    const total = overdue.reduce((s, p) => s + p.amountCents, 0);
    out.push({ kind: "payment_overdue", severity: "red", text: `${fmtCents(total)} overdue — ${overdue.length === 1 ? `due ${fmtDateNz(overdue[0].dueOn)}` : `${overdue.length} instalments, oldest ${fmtDateNz(overdue[0].dueOn)}`}` });
  }
  if (soon.length) {
    out.push({ kind: "payment_due", severity: "amber", text: `${fmtCents(soon[0].amountCents)} due ${fmtDateNz(soon[0].dueOn)}` });
  }
  const issues = Array.isArray(cur.flags) ? cur.flags.length : 0;
  if (issues) out.push({ kind: "contract_issue", severity: "grey", text: `${issues} note${issues === 1 ? "" : "s"} on the contract` });
  return out;
}

export type PartnerStatus = "active" | "renewal_due" | "expired" | "attention" | "no_contract";

/** One word for the list. Red flags win, then renewal, then plain active. */
export function partnerStatus(flags: PartnerFlag[], cur: ContractLike | null, today: string): PartnerStatus {
  if (!cur) return "no_contract";
  const state = contractState(cur, today);
  if (state === "expired") return "expired";
  if (flags.some(f => f.severity === "red")) return "attention";
  if (state === "ending_soon") return "renewal_due";
  return "active";
}

export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  active: "Active",
  renewal_due: "Renewal due",
  expired: "Expired",
  attention: "Needs attention",
  no_contract: "No contract",
};

// ── Sorting the list ────────────────────────────────────────────────────────

export type PartnerSortKey = "company" | "value" | "since" | "renewal" | "status";

export interface PartnerRowLike {
  company: string;
  annualValueCents: number;
  since: string | null;
  renewalOn: string | null;
  status: PartnerStatus;
}

const STATUS_RANK: Record<PartnerStatus, number> = { attention: 0, expired: 1, renewal_due: 2, no_contract: 3, active: 4 };

export function comparePartners(key: PartnerSortKey, dir: "asc" | "desc") {
  const sign = dir === "asc" ? 1 : -1;
  return (a: PartnerRowLike, b: PartnerRowLike): number => {
    switch (key) {
      case "company": return sign * a.company.localeCompare(b.company, "en-NZ", { sensitivity: "base" });
      case "value":   return sign * (a.annualValueCents - b.annualValueCents);
      case "status":  return sign * (STATUS_RANK[a.status] - STATUS_RANK[b.status]);
      case "since":
      case "renewal": {
        // 🔴 A blank sorts LAST in both directions — an unknown date is an
        // unanswered question, not the oldest or the newest sponsor.
        const av = key === "since" ? a.since : a.renewalOn;
        const bv = key === "since" ? b.since : b.renewalOn;
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return sign * av.localeCompare(bv);
      }
    }
  };
}
