/**
 * Dashboard periods and revenue sources.
 *
 * Shared between client and server so the period the user picks and the period
 * the SQL runs are the same object, computed by the same function. A dashboard
 * whose filter and query disagree is worse than no dashboard.
 *
 * 🔴 Every date here is a bare `YYYY-MM-DD` calendar date in New Zealand, never
 * a JS `Date`. `new Date("2026-09-02")` is UTC midnight, which is midday on the
 * 2nd in NZ — and `toISOString().slice(0,10)` on a local date reads a day
 * behind for half of every day. This has bitten ClubOS repeatedly (an invoice
 * printed "18 July" when it was due the 17th).
 */

export const DASHBOARD_PERIODS = [
  "today",
  "7d",
  "30d",
  "ytd",
  "year",
  "custom",
] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  ytd: "Year to date",
  year: "This year",
  custom: "Custom",
};

/** Today in New Zealand, as `YYYY-MM-DD`. `en-CA` formats exactly that way. */
export function nzTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function parseIso(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/** Calendar-date arithmetic anchored at UTC midnight: timezone-free by design. */
export function addDaysIso(iso: string, days: number): string {
  const p = parseIso(iso);
  if (!p) return iso;
  const t = Date.UTC(p.y, p.m - 1, p.d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Inclusive whole-day span between two calendar dates. */
export function daysInclusive(fromIso: string, toIso: string): number {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  if (!a || !b) return 0;
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.floor(ms / 86_400_000) + 1;
}

export type DateRange = { from: string; to: string };

/**
 * Resolve a period to an inclusive calendar range in NZ.
 *
 * "Year to date" and "This year" are the same range today and diverge only in
 * intent, so they resolve identically — the distinction is kept because a user
 * reading the filter means different things by them, and "This year" will mean
 * the whole calendar year the moment historical comparison arrives.
 */
export function resolvePeriod(
  period: DashboardPeriod,
  custom?: Partial<DateRange>,
  today: string = nzTodayIso(),
): DateRange {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDaysIso(today, -6), to: today };
    case "30d":
      return { from: addDaysIso(today, -29), to: today };
    case "ytd":
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "custom": {
      const from = custom?.from && parseIso(custom.from) ? custom.from : addDaysIso(today, -29);
      const to = custom?.to && parseIso(custom.to) ? custom.to : today;
      // A backwards range is a user slip, not an error worth a red screen.
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/**
 * The immediately preceding range of the same length, for the "vs previous"
 * comparison. Same length, ending the day before `from` — so a 30-day period
 * compares against the 30 days before it, not against last month's calendar.
 */
export function previousRange(range: DateRange): DateRange {
  const len = daysInclusive(range.from, range.to);
  const to = addDaysIso(range.from, -1);
  return { from: addDaysIso(to, -(len - 1)), to };
}

/** Every calendar date in the range, inclusive — so a chart can show days with
 *  no revenue as real zeros rather than skipping them and lying about the shape. */
export function eachDay(range: DateRange): string[] {
  const out: string[] = [];
  const n = daysInclusive(range.from, range.to);
  for (let i = 0; i < n; i++) out.push(addDaysIso(range.from, i));
  return out;
}

// ── Revenue sources ─────────────────────────────────────────────────────────
//
// 🔴 Every workspace earns money in a DIFFERENT table, and six of the nine have
// no `programs` row at all. A revenue widget that only reads `registrations`
// therefore reports a confident $0.00 for United Sports Centre, Gymnastics,
// United Prints, the Cup and the Group — which is the exact bug this dashboard
// was rebuilt to fix, just moved somewhere less obvious.
//
// So each workspace declares its own source, and a workspace with no wired
// source says so instead of showing zero. `label` is displayed under the
// figure, because "revenue" alone is a claim and these sources do not all mean
// the same thing: a confirmed venue booking is money owed, not money banked.

/**
 * How a table is tied to a workspace.
 *
 * 🔴 `registrations` has NO `organization_id` of its own — it reaches one
 * through `program_id → programs.organization_id`. Assuming a direct column
 * is what the first run of the verification script caught, and it would have
 * been a 500 on the CUFC dashboard: the exact failure this rebuild exists to
 * end. Every source states its scoping rather than leaving it to be guessed.
 */
export type OrgScope =
  | { kind: "column"; column: string }
  | { kind: "viaPrograms"; column: string }
  // Team Pay money reaches a workspace through its competition, and the
  // competition also carries the BRAND — which is how CIC 7's money is told
  // apart from the Ethnic Cup's inside the one Cup workspace.
  | { kind: "viaTeampayCompetition"; column: string; brand: string }
  | { kind: "viaTeampayEntry"; column: string; brand: string };

export type MetricKind = "money" | "count";

/**
 * One table's contribution to a metric.
 *
 * 🔴 A metric can have MORE THAN ONE part, and Team Pay is why. A team's fee is
 * settled either by each player paying a share (`teampay_players.paid_cents`)
 * or by the manager paying the balance (`teampay_entries.team_paid_cents`), and
 * both routes settle the SAME balance. Reporting one table would quietly halve
 * the tournament's income the first time a manager cleared a team's fee.
 */
export type MetricPart = {
  table: string;
  orgScope: OrgScope;
  /** Required when the metric is money. Ignored for a count. */
  amountColumn?: string;
  dateColumn: string;
  statusColumn?: string;
  statuses: string[];
};

export type DashboardMetric = {
  /** Query key — `?metric=` on the endpoint. */
  key: string;
  kind: MetricKind;
  /** Card heading, e.g. "Revenue" or "Registrations of interest". */
  title: string;
  /** What the number actually counts, shown under it. */
  label: string;
  parts: MetricPart[];
  /** Set when the date column is a proxy — surfaced in the UI, never hidden. */
  dateCaveat?: string;
  /** Singular/plural for a count metric, e.g. ["registration","registrations"]. */
  unit?: [string, string];
};



/**
 * What each workspace's dashboard charts, in order.
 *
 * 🔴 A workspace with no entry gets an explicit "not wired up in ClubOS", never
 * a $0.00 — six of the nine have no `programs` row, and a confident zero in a
 * club's own dashboard reads as "you earned nothing" rather than "we are not
 * measuring this".
 *
 * The key is a workspace slug, optionally with a sub-view after a colon. The
 * Cup is one workspace holding three tournaments behind a Youth / 7's / Ethnic
 * toggle, and they do not share a number: Youth is measured in registrations of
 * interest, 7's in interest AND the money Team Pay has actually taken.
 */
export const DASHBOARD_METRICS: Record<string, DashboardMetric[]> = {
  "christchurch-united": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Confirmed registrations",
      dateCaveat: "By registration date — ClubOS does not record when each payment cleared.",
      parts: [{ table: "registrations", orgScope: { kind: "viaPrograms", column: "program_id" }, amountColumn: "total_cents",
                dateColumn: "registered_at", statusColumn: "status", statuses: ["confirmed"] }],
    },
  ],
  "south-island-united": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Confirmed registrations",
      dateCaveat: "By registration date — ClubOS does not record when each payment cleared.",
      parts: [{ table: "registrations", orgScope: { kind: "viaPrograms", column: "program_id" }, amountColumn: "total_cents",
                dateColumn: "registered_at", statusColumn: "status", statuses: ["confirmed"] }],
    },
  ],
  "mini-football-leagues": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Confirmed registrations",
      dateCaveat: "By registration date — ClubOS does not record when each payment cleared.",
      parts: [{ table: "registrations", orgScope: { kind: "viaPrograms", column: "program_id" }, amountColumn: "total_cents",
                dateColumn: "registered_at", statusColumn: "status", statuses: ["confirmed"] }],
    },
  ],
  // 🔴 2,259 bookings are `confirmed` and only 6 are `paid`, so this is the
  // value of confirmed bookings, NOT money received.
  "united-sports-centre": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Confirmed bookings",
      dateCaveat: "Booked value by booking date — not all of it has been paid yet.",
      parts: [{ table: "facility_bookings", orgScope: { kind: "column", column: "organization_id" },
                amountColumn: "total_cents", dateColumn: "booking_date",
                statusColumn: "status", statuses: ["confirmed", "paid"] }],
    },
  ],
  "united-gymnastics": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Paid registrations",
      parts: [{ table: "cugc_registrations", orgScope: { kind: "column", column: "organization_id" },
                amountColumn: "price_cents", dateColumn: "paid_at",
                statusColumn: "status", statuses: ["paid"] }],
    },
  ],
  "united-sports-group": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Paid invoices",
      parts: [{ table: "usg_invoices", orgScope: { kind: "column", column: "organization_id" },
                amountColumn: "total_cents", dateColumn: "paid_at",
                statusColumn: "status", statuses: ["paid"] }],
    },
  ],
  "united-prints": [
    {
      key: "revenue", kind: "money", title: "Revenue", label: "Accepted print jobs",
      dateCaveat: "By order date — print orders carry no payment timestamp.",
      parts: [{ table: "print_orders", orgScope: { kind: "column", column: "organization_id" },
                amountColumn: "total_cents", dateColumn: "created_at",
                statusColumn: "status", statuses: ["delivered", "ready", "in_production", "confirmed"] }],
    },
  ],

  // ── The Cup, one workspace, three tournaments ────────────────────────────
  //
  // 🔴 There is deliberately NO money metric for Youth. Its 132 team entries
  // all carry `paid_amount_cents = 0`: the money is real and simply is not in
  // ClubOS, and charting it as $0.00 would say in the club's own dashboard
  // that the tournament earned nothing. Interest is a number ClubOS genuinely
  // holds, so that is what it charts.
  "christchurch-international-cup": [
    {
      key: "interest", kind: "count", title: "Registrations of interest",
      label: "From the cicyouth.com register-your-interest form",
      unit: ["registration", "registrations"],
      parts: [{ table: "cic_interest_registrations",
                orgScope: { kind: "column", column: "organization_id" },
                dateColumn: "created_at", statuses: [] }],
    },
  ],
  "christchurch-international-cup:7s": [
    {
      key: "interest", kind: "count", title: "Registrations of interest",
      label: "From the cic7s.com register-your-interest form",
      unit: ["registration", "registrations"],
      parts: [{ table: "cic7s_registrations",
                orgScope: { kind: "column", column: "organization_id" },
                dateColumn: "created_at", statuses: [] }],
    },
    {
      key: "revenue", kind: "money", title: "Sales revenue",
      label: "Team Pay payments received",
      // 🔴 TWO parts on purpose. A team's fee is settled either by each player
      // paying their share or by the manager paying the balance, and both
      // settle the same one. Charting only the player table would halve the
      // tournament's income the first time a manager cleared a whole team.
      parts: [
        { table: "teampay_players",
          orgScope: { kind: "viaTeampayEntry", column: "entry_id", brand: "cic7s" },
          amountColumn: "paid_cents", dateColumn: "paid_at", statuses: [] },
        { table: "teampay_entries",
          orgScope: { kind: "viaTeampayCompetition", column: "competition_id", brand: "cic7s" },
          amountColumn: "team_paid_cents", dateColumn: "team_paid_at", statuses: [] },
      ],
    },
  ],
};

/** Metrics for a workspace, optionally narrowed to a sub-view (the Cup). */
export function metricsFor(slug: string | undefined | null, view?: string | null): DashboardMetric[] {
  if (!slug) return [];
  if (view) {
    const scoped = DASHBOARD_METRICS[`${slug}:${view}`];
    if (scoped) return scoped;
  }
  return DASHBOARD_METRICS[slug] ?? [];
}

export function metricFor(slug: string | undefined | null, view: string | null | undefined, key: string): DashboardMetric | null {
  return metricsFor(slug, view).find((m) => m.key === key) ?? null;
}

export type MetricPoint = { date: string; value: number };

export type MetricResponse = {
  /** null when this workspace charts nothing — never a zero. */
  source: { title: string; label: string; caveat?: string; kind: MetricKind; unit?: [string, string] } | null;
  range: DateRange;
  /** Cents when kind is "money", a row count when kind is "count". */
  total: number;
  /** Same-length preceding range, for the comparison line. */
  previous: number;
  /** One entry per calendar day in the range, zeros included. */
  series: MetricPoint[];
  /** Rows counted — lets the UI say "across 41 registrations". */
  count: number;
};

/** Percentage change, or null when the previous period was zero (a change from
 *  nothing is not a percentage, and rendering ∞% or +100% would be a fiction). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
