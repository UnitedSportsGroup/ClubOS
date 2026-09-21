/**
 * The MFL captain's dashboard — the shared rules.
 *
 * Daniel, 2026-09-18: the Ethnic Cup captain login, for Mini Football Leagues.
 * A captain manages their squad list, sees how their team's fee is being paid
 * (weekly plan, Player Pay, or paid up front), which competitions they are in,
 * the ladder, and pulls a fill-in from the marketplace — for the rest of the
 * term, or for one night they are short.
 *
 * 🔴 NOTHING IN HERE DECIDES AN AMOUNT. An MFL team's money is on its
 * registration (upfront / deposit + weekly / Player Pay split) and is charged
 * by the paths that already exist — the weekly subscription, the balance
 * payoff page, the split hub. This file only DESCRIBES that position, read off
 * the registration and the split, so the captain can see it. A third way to
 * charge an MFL team is exactly what this build must not become.
 *
 * Pure functions, no database: shared by the server (which assembles the view)
 * and the browser (which formats it), and unit-testable without either.
 */
import { missedPayments, weeklyAnchorMs } from "./league-weekly";

// ── nights ───────────────────────────────────────────────────────────────────

export const MFL_DAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
] as const;
export type MflDay = (typeof MFL_DAYS)[number];

export function isMflDay(v: unknown): v is MflDay {
  return typeof v === "string" && (MFL_DAYS as readonly string[]).includes(v);
}

/** Today in New Zealand as yyyy-mm-dd. Never `toISOString().slice(0,10)` — that is UTC. */
export function nzTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function parts(iso: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) throw new Error(`league-captain: not a yyyy-mm-dd date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The weekday of a bare ISO date, from its PARTS — a local-time Date would shift it near midnight. */
export function isoWeekday(iso: string): MflDay {
  const [y, m, d] = parts(iso);
  // 0 = Sunday in JS; MFL_DAYS starts on Monday.
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return MFL_DAYS[(js + 6) % 7];
}

/** "Wed 15 Oct" — from the parts, so it reads the same on every machine. */
export function nzDateLabel(iso: string): string {
  const [y, m, d] = parts(iso);
  const at = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short" }).format(at);
  const mon = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", month: "short" }).format(at);
  return `${wd} ${d} ${mon}`;
}

/**
 * "Mini Football Leagues — Term 4" → "Term 4". The competition names all carry
 * the brand as a prefix, and on a phone that prefix is what pushes the night
 * off the end of the line. Display only.
 */
export function shortCompetitionName(name: string | null | undefined): string {
  return String(name ?? "").replace(/^Mini Football Leagues\s*[—–-]\s*/i, "");
}

/**
 * "term-4" → "Term 4". The MFL league_team programmes are slugged by term and
 * the URL is known before the programme has loaded, which is when the Meta
 * ViewContent event fires. Anything else comes back empty.
 */
export function termLabelFromSlug(slug: string | null | undefined): string {
  const m = /^term-(\d{1,2})$/i.exec(String(slug ?? "").trim());
  return m ? `Term ${m[1]}` : "";
}

/**
 * The Meta event label for an MFL team registration. It read "MFL Term 3 Team
 * Registration" as a constant in six places and stayed on Term 3 when Term 4
 * opened. Derived now, from the slug (before load) or the programme name.
 */
export function mflPixelContent(slugOrName: string | null | undefined): string {
  // A slug that is not a term ("split-test") must not become the label.
  const raw = String(slugOrName ?? "");
  const term = termLabelFromSlug(raw) || (/\s/.test(raw) ? shortCompetitionName(raw) : "");
  return `MFL ${term || "League"} Team Registration`;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * The nights a division plays between two dates, from today onwards.
 *
 * Used when the draw has not been generated yet — Term 4's fixtures do not
 * exist on the day this shipped — so a captain can still say "I'm short next
 * Wednesday". Once fixtures exist, the real games are offered instead.
 */
export function nightDates(opts: {
  dayOfWeek: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  todayIso: string;
  limit?: number;
}): string[] {
  if (!isMflDay(opts.dayOfWeek) || !opts.endDate) return [];
  const start = opts.startDate && opts.startDate > opts.todayIso ? opts.startDate : opts.todayIso;
  const end = String(opts.endDate).slice(0, 10);
  const limit = opts.limit ?? 10;
  const out: string[] = [];
  let cur = String(start).slice(0, 10);
  let guard = 0;
  while (cur <= end && out.length < limit && guard++ < 400) {
    if (isoWeekday(cur) === opts.dayOfWeek) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// ── asks ─────────────────────────────────────────────────────────────────────

export type LeagueAskKind = "season" | "game";
export const LEAGUE_ASK_KINDS: readonly LeagueAskKind[] = ["season", "game"] as const;
export function isLeagueAskKind(v: unknown): v is LeagueAskKind {
  return typeof v === "string" && (LEAGUE_ASK_KINDS as readonly string[]).includes(v);
}

/** A team can have this many unanswered asks out at once — stops one side parking the pool. */
export const LEAGUE_MAX_ACTIVE_ASKS = 3;
/** After a player says no, that team cannot ask them again for this long. */
export const LEAGUE_REASK_COOLDOWN_DAYS = 7;
/** How long a player has to answer. */
export const LEAGUE_ASK_HOURS = 48;

export const MAX_SQUAD_LIST = 30;
export const MIN_SHIRT_NUMBER = 0;
export const MAX_SHIRT_NUMBER = 99;

export const SQUAD_POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Anywhere"] as const;

/** "to join for the rest of the term" / "to cover Wed 15 Oct, 7:00pm". */
export function askLabel(kind: LeagueAskKind, gameDate?: string | null, startTime?: string | null): string {
  if (kind === "season" || !gameDate) return "to join the squad for the rest of the term";
  return `to cover ${nzDateLabel(gameDate)}${startTime ? `, ${hm(startTime)}` : ""}`;
}

/** "19:00" → "7:00pm". Anything unparseable comes back untouched. */
export function hm(t: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  if (!m) return String(t ?? "");
  const h = Number(m[1]);
  const suffix = h >= 12 ? "pm" : "am";
  return `${((h + 11) % 12) + 1}:${m[2]}${suffix}`;
}

// ── the team's money, described ──────────────────────────────────────────────

export interface RegistrationMoneyFacts {
  status?: string | null;
  paymentMode?: string | null;
  totalCents?: number | null;
  /** Decimal string on the row ("120.00"). */
  amountPaid?: string | number | null;
  depositCents?: number | null;
  balanceCents?: number | null;
  balanceDueDate?: string | null;
  balanceStatus?: string | null;
  weeklyAmountCents?: number | null;
  weeksPaid?: number | null;
  weeksTotal?: number | null;
  weeklyFirstChargeDate?: string | null;
  createdAt?: string | Date | null;
}

export interface SplitMoneyFacts {
  status: string;
  totalCents: number;
  targetCount: number | null;
  settledAt?: string | Date | null;
  members: Array<{
    id: number; name: string | null; email: string; phone: string | null;
    role: string; status: string; chargedCents: number | null; paidAt: string | Date | null;
  }>;
}

export interface LeaguePaymentSummary {
  mode: "upfront" | "deposit_weekly" | "split" | "installment" | "unknown";
  label: string;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  isPaidUp: boolean;
  percentPaid: number;
  weekly?: {
    depositCents: number;
    weeklyAmountCents: number;
    weeksPaid: number;
    weeksTotal: number;
    nextChargeDate: string | null;
    missedCount: number;
    missedCents: number;
    payoffCents: number;
  };
  split?: {
    status: string;
    targetCount: number | null;
    paidCount: number;
    shareCents: number;
    settled: boolean;
    members: SplitMoneyFacts["members"];
  };
  installment?: {
    depositCents: number;
    balanceCents: number;
    balanceDueDate: string | null;
    balanceStatus: string;
  };
}

function cents(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * The registration's money position, as the captain should read it.
 *
 * 🔴 Described, not decided. `paidCents` is what the rows say landed;
 * `outstandingCents` is what the existing pay paths would ask for. Neither is
 * an instruction to charge anything.
 */
export function paymentSummary(
  reg: RegistrationMoneyFacts,
  split: SplitMoneyFacts | null,
  opts: { compStartDate?: string | null; nowMs: number },
): LeaguePaymentSummary {
  const total = reg.totalCents ?? 0;
  const done = (paid: number, outstanding: number): Pick<LeaguePaymentSummary, "paidCents" | "outstandingCents" | "isPaidUp" | "percentPaid"> => ({
    paidCents: paid,
    outstandingCents: Math.max(0, outstanding),
    isPaidUp: outstanding <= 0,
    percentPaid: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : (outstanding <= 0 ? 100 : 0),
  });

  if (reg.paymentMode === "deposit_weekly") {
    const deposit = reg.depositCents ?? 0;
    const weekly = reg.weeklyAmountCents ?? 0;
    const weeksTotal = reg.weeksTotal ?? 0;
    const weeksPaid = Math.max(0, reg.weeksPaid ?? 0);
    const paid = deposit + weeksPaid * weekly;
    const remaining = Math.max(0, (weeksTotal - weeksPaid) * weekly);
    const missed = missedPayments({
      status: reg.status, paymentMode: reg.paymentMode,
      weeksTotal, weeksPaid, weeklyAmountCents: weekly,
      weeklyFirstChargeDate: reg.weeklyFirstChargeDate ?? null,
      compStartDate: opts.compStartDate ?? null,
      registeredAt: reg.createdAt ?? null,
      nowMs: opts.nowMs,
    });
    const anchor = weeklyAnchorMs({
      weeklyFirstChargeDate: reg.weeklyFirstChargeDate ?? null,
      compStartDate: opts.compStartDate ?? null,
      registeredAt: reg.createdAt ?? null,
    });
    const nextChargeDate = anchor != null && weeksPaid < weeksTotal
      ? new Date(anchor + weeksPaid * 7 * 86_400_000).toISOString().slice(0, 10)
      : null;
    return {
      mode: "deposit_weekly",
      label: "Deposit, then weekly",
      totalCents: total,
      ...done(paid, remaining),
      weekly: {
        depositCents: deposit, weeklyAmountCents: weekly, weeksPaid, weeksTotal,
        nextChargeDate, missedCount: missed.missedCount, missedCents: missed.missedCents,
        payoffCents: missed.payoffCents || remaining,
      },
    };
  }

  if (reg.paymentMode === "split" && split) {
    const active = split.members.filter((m) => m.status !== "removed");
    const paidMembers = active.filter((m) => m.status === "paid");
    const paid = paidMembers.reduce((s, m) => s + (m.chargedCents ?? 0), 0);
    const n = split.targetCount && split.targetCount > 0 ? split.targetCount : 1;
    const shareCents = Math.round(split.totalCents / n);
    const settled = split.status === "settled";
    return {
      mode: "split",
      label: "Player Pay",
      totalCents: split.totalCents,
      ...done(paid, settled ? 0 : Math.max(0, split.totalCents - paid)),
      split: {
        status: split.status, targetCount: split.targetCount, paidCount: paidMembers.length,
        shareCents, settled, members: active,
      },
    };
  }

  if (reg.paymentMode === "installment") {
    const deposit = reg.depositCents ?? 0;
    const balance = reg.balanceCents ?? 0;
    const balancePaid = reg.balanceStatus === "paid";
    return {
      mode: "installment",
      label: "Deposit, then the balance",
      totalCents: total,
      ...done(deposit + (balancePaid ? balance : 0), balancePaid ? 0 : balance),
      installment: {
        depositCents: deposit, balanceCents: balance,
        balanceDueDate: reg.balanceDueDate ?? null, balanceStatus: reg.balanceStatus ?? "none",
      },
    };
  }

  // Up front — or a mode this file does not know, which is read as "paid what
  // the row says was paid" rather than invented.
  const recorded = cents(reg.amountPaid);
  const paid = recorded > 0 ? recorded : (reg.status === "confirmed" ? total : 0);
  return {
    mode: reg.paymentMode === "upfront" ? "upfront" : "unknown",
    label: reg.paymentMode === "upfront" ? "Paid up front" : "Paid",
    totalCents: total,
    ...done(paid, total - paid),
  };
}
