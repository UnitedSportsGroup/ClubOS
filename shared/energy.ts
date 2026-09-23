// ─────────────────────────────────────────────────────────────────────────────
// ENERGY — the club's power, gas and water: every site, bill and payment.
// Pure helpers shared by the server and the Energy tab. Money is integer cents
// INCLUDING GST (what the supplier charged). Nothing here is stored — every
// total, trend and rate is derived from the bills on read.
// ─────────────────────────────────────────────────────────────────────────────

export const ENERGY_UTILITIES = ["electricity", "gas", "water"] as const;
export type EnergyUtility = (typeof ENERGY_UTILITIES)[number];
export const ENERGY_UNITS: Record<EnergyUtility, "kWh" | "kg" | "m3"> = { electricity: "kWh", gas: "kg", water: "m3" };
export function isEnergyUtility(x: unknown): x is EnergyUtility {
  return typeof x === "string" && (ENERGY_UTILITIES as readonly string[]).includes(x);
}

/** LPG holds ~49.6 MJ per kg ≈ 13.8 kWh — so gas and power can be compared.
 *  An ESTIMATE of the energy in the gas, not a meter reading. */
export const LPG_KWH_PER_KG = 13.8;

/** Xero's own lines for the club's energy, per calendar year, EXCLUDING GST —
 *  the check that every bill here was paid through the club's books. Pulled
 *  23 Sep 2026 (outputs/holiday-camp-history/xero_pl_years.json); the current
 *  year is to date. 🔴 The United Sports Centre's own power and water appear
 *  in NEITHER line in any year 2015–2026: the club does not pay them. */
export const ENERGY_XERO = {
  asOf: "2026-09-23",
  residency: { account: "Residency – Power & Heating (221/04)", years: { 2024: 748_657, 2025: 1_699_567, 2026: 999_074 } as Record<number, number> },
  general: { account: "Light, Power, Heating", years: { 2015: 39_547, 2016: 44_172, 2017: 30_010, 2018: 44_198, 2019: 42_824, 2020: 45_678, 2021: 47_534, 2022: 59_470, 2023: 52_521, 2024: 25_717, 2026: 71_024 } as Record<number, number> },
};

export const exGst = (cents: number) => Math.round(cents / 1.15);

/** A bill's month for charts: the month its period ENDS (when it was used up
 *  to), falling back to the bill date. y-m string parts only. */
export function billMonth(b: { periodEnd?: string | null; billDate?: string | null }): string | null {
  const d = b.periodEnd ?? b.billDate;
  return d ? d.slice(0, 7) : null;
}

/** Days a bill covers, inclusive, from the y-m-d parts. */
export function billDays(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const n = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
  return n(end) - n(start) + 1;
}
