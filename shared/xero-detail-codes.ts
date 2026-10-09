// The DETAILED Xero income code for one sale — Victor's 2026 chart, three levels
// deep (101 Academy → 101-02 Pre-Academy → 101-02-01 U9).
//
// 🔴 ONE decider. The payout poster (Receive Money lines) and the per-child
// academy invoice both ask this function, so a U9 Pre-Academy fee lands on
// 101-02-01 whichever document carries it.
//
// 🔴 It only REFINES. `xero_account_map` still says where a programme goes at the
// top level; this narrows it to the age group / camp / format when the sale
// carries enough to know. Anything it cannot decide returns null and the mapped
// code stands — the parent account, never a guess at a child account. A wrong
// sub-account still balances, so nobody would ever notice it.
//
// 🔴 The term is NOT in the chart (no tracking category for it either). It rides
// in the line description and the invoice reference ("Term 4 2026").

export interface DetailInput {
  programId: number | null;
  programName: string | null;
  programType: string | null;        // 'academy' | 'holiday_camp' | 'league_team'
  optionName: string | null;         // "U9", "U13–U15", "U4-U8 All-Access Pass"
  dob: string | null;                // 'YYYY-MM-DD' (the player's)
  seasonYear: number | null;         // the term's year
  divisionName: string | null;       // MFL: "Tuesday 5's"
}

/** The programme ids whose age groups have their own account. */
export const AGE_BANDS: Record<number, { lo: number; hi: number; code: (g: number) => string; label: string }> = {
  // FUNiño — U4..U8 → 101-01-01..05
  4: { lo: 4, hi: 8, label: "FUNiño", code: (g) => `101-01-0${g - 3}` },
  // Pre-Academy — U9..U12 → 101-02-01..04
  16: { lo: 9, hi: 12, label: "Pre-Academy", code: (g) => `101-02-0${g - 8}` },
  // Academy — U13..U18 → 101-03-01..06, U19/U20 → 101-04
  17: { lo: 13, hi: 20, label: "Academy", code: (g) => (g >= 19 ? "101-04" : `101-03-0${g - 12}`) },
};

/**
 * The child's age group for this sale.
 *
 * 1. The option they bought, when it names ONE age ("U9") — what the family chose
 *    and what Olga's invoice contact already says.
 * 2. Otherwise NZF grade = season year − birth year, clamped into the range the
 *    option (or programme) covers. Term 4 sells next season's intake one grade
 *    under the band, and the clamp files that child in the band they paid for.
 */
export function gradeFor(i: Pick<DetailInput, "programId" | "optionName" | "dob" | "seasonYear">): number | null {
  const opt = String(i.optionName ?? "");
  const nums = Array.from(opt.matchAll(/U\s?(\d{1,2})/gi)).map((m) => Number(m[1]));
  if (nums.length === 1) return nums[0];
  const band = i.programId != null ? AGE_BANDS[i.programId] : undefined;
  const lo = nums.length >= 2 ? Math.min(...nums) : band?.lo;
  const hi = nums.length >= 2 ? Math.max(...nums) : band?.hi;
  if (!i.dob || !i.seasonYear || !/^\d{4}-/.test(i.dob)) return null;
  let g = i.seasonYear - Number(i.dob.slice(0, 4));
  if (lo != null && g < lo) g = lo;
  if (hi != null && g > hi) g = hi;
  return g;
}

/** The refined code, or null to keep the mapped one. */
export function detailCodeFor(i: DetailInput): string | null {
  const name = String(i.programName ?? "").toLowerCase();

  const band = i.programId != null ? AGE_BANDS[i.programId] : undefined;
  if (band) {
    const g = gradeFor(i);
    if (g == null || g < band.lo || g > band.hi) return null;
    return band.code(g);
  }

  if (i.programType === "holiday_camp") {
    if (name.includes("fundamentals")) return "103-01";
    if (name.includes("world cup")) return "103-02";
    if (name.includes("siu")) {
      const g = gradeFor({ programId: null, optionName: i.optionName, dob: i.dob, seasonYear: i.seasonYear });
      if (g == null) return null;
      if (g <= 14) return "103-03";
      if (g <= 16) return "103-04";
      return "103-05";
    }
    return null;
  }

  // Mini Football: the format is in the division's name ("Tuesday 7's").
  if (name.includes("ballers")) return "104-01";               // 5-a-side
  if (i.programType === "league_team") {
    const m = /\b(5|7|9)\s*'?s\b|\b(5|7|9)\s*-?\s*a\s*-?\s*side/i.exec(String(i.divisionName ?? ""));
    const n = m ? Number(m[1] ?? m[2]) : null;
    if (n === 5) return "104-01";
    if (n === 7) return "104-02";
    if (n === 9) return "104-03";
    return null;
  }
  return null;
}

/** "Pre-Academy U9 · Term 4 2026" — what the line and invoice say. */
export function detailLabel(i: DetailInput & { termNumber?: number | null }): string {
  const band = i.programId != null ? AGE_BANDS[i.programId] : undefined;
  const g = band ? gradeFor(i) : null;
  const what = band ? `${band.label}${g ? ` U${g}` : ""}` : String(i.programName ?? "");
  const term = i.termNumber && i.seasonYear ? ` · Term ${i.termNumber} ${i.seasonYear}` : "";
  return `${what}${term}`;
}
