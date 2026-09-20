/**
 * Which training group a player is in — U9, U10, U11, U12 — and the ONE place
 * that is decided.
 *
 * Daniel, 2026-09-20, of the Pre-Academy Players tab: "here needs to split up
 * into U9 Training Group, U10 Training Group, U11 Training Group and U12
 * Training Group and show which players in which will be more accurate and
 * what we need." And: "those then get linked with coach platform for term 4
 * for taking rolls."
 *
 * 🔴 DERIVED FROM DATE OF BIRTH, NOT TYPED IN. The club already grades by year
 * of birth — `ageGradeFor()`, the NZF rule that decides squad eligibility — and
 * every one of the 12 Term 4 Pre-Academy players has a date of birth on file.
 * Deriving it means the split is right the day a new player registers and stays
 * right next term, with nobody maintaining a list. A hand-assigned group starts
 * empty, which makes the tab look broken, and then drifts from the DOB.
 *
 * 🔴 AN AGE IN YEARS IS NOT A GRADE. A child who is 10 today is U11 for the
 * 2026 season if they were born in 2015. The Players tab shows both, and they
 * will disagree for most of the year — that is NZF's rule, not a bug.
 *
 * 🔴 AN OVERRIDE IS A HUMAN DECISION AND IS RECORDED AS ONE. Playing up a grade
 * is normal and legal; playing down is what gets a club sanctioned. So a coach
 * can move one player, and who moved them is kept. `null` means nobody has
 * overridden anything — never "no group".
 *
 * 🔴 IT NEVER CLAMPS TO THE PROGRAMME'S BAND. A U13 sitting in a U9–U12
 * programme reads U13, because that is the truth and it is worth seeing.
 * Whether they belong there is `checkEligibility()`'s question, not this one.
 */
import { ageGradeFor } from "./academy";

export type TrainingGroupSource = "override" | "derived" | "unknown";

export interface TrainingGroupResult {
  /** "U9", "U11"… or null when there is no usable date of birth. */
  group: string | null;
  source: TrainingGroupSource;
  /** The NZF grade as a number, for sorting. Null when ungraded. */
  grade: number | null;
}

/** The label for a grade number. One place, so "U9" is spelled the same on the
 *  Players tab, in a group heading and in whatever the coach app is told. */
export function trainingGroupLabel(grade: number): string {
  return `U${grade}`;
}

/** Parse "U11" back to 11. Null on anything else — an override we cannot read
 *  is ignored in favour of the derived answer, never allowed to blank a player. */
export function gradeFromLabel(label: string | null | undefined): number | null {
  if (typeof label !== "string") return null;
  const m = /^U(\d{1,2})$/i.exec(label.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 21 ? n : null;
}

export function trainingGroupFor(
  dobIso: string | null | undefined,
  seasonYear: number,
  override?: string | null,
): TrainingGroupResult {
  const overrideGrade = gradeFromLabel(override);
  if (overrideGrade !== null) {
    return { group: trainingGroupLabel(overrideGrade), source: "override", grade: overrideGrade };
  }
  const grade = ageGradeFor(dobIso, seasonYear);
  if (grade === null) return { group: null, source: "unknown", grade: null };
  return { group: trainingGroupLabel(grade), source: "derived", grade };
}

/**
 * Order a set of groups for display: youngest first, and anyone we could not
 * grade LAST under an honest heading.
 *
 * 🔴 "Not graded" is its own bucket and is never folded into a real group. A
 * child with no date of birth has an unanswered question, and putting them in
 * U9 to tidy the screen up is how they turn up to the wrong session.
 */
export const UNGRADED_LABEL = "Not graded";

export function sortGroups(labels: (string | null)[]): string[] {
  const real = labels.filter((l): l is string => !!l);
  const uniq = Array.from(new Set(real));
  uniq.sort((a, b) => (gradeFromLabel(a) ?? 999) - (gradeFromLabel(b) ?? 999));
  return labels.some((l) => !l) ? [...uniq, UNGRADED_LABEL] : uniq;
}
