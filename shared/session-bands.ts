/**
 * A term session named for an AGE BAND ("U4–U6", "U7–U8") has a roll of that
 * band only. One decider for the roll and the sessions list that counts it.
 *
 * Daniel, 28 Oct 2026: "a 4-to-6 session and a 7-to-8 session … make sure those
 * rolls are separated and that structure is all updated everywhere." Zach: "a
 * general split roll … and a way for me to move someone from the 4–6s to the
 * 7–8s when a kid's not ready" — that move is the Players tab's training-group
 * override (`registrations.training_group`, @shared/training-groups), so a
 * child moved there is on the other band's roll here.
 *
 * Before this, every U4–U8 session's roll listed every enrolled child, so the
 * Saturday U4–U6 and U7–U8 rolls were the same 170 names.
 *
 * Rules:
 *  - A session whose name is not a band ("" / null / "Squad") keeps everyone.
 *    The Mon–Fri 4:30pm session is all ages — families were told 7–8s may
 *    still come to it.
 *  - A child's grade comes from trainingGroupFor() — override, then option,
 *    then birth year — the same order the Players tab and the coach app use.
 *  - A grade outside every band the programme runs (a U9 lead-in, a U3) goes
 *    to the nearest band, never off every roll.
 *  - No date of birth → on every band's roll. Dropping a paid child off a roll
 *    is worse than showing them twice.
 */
export type SessionBand = { lo: number; hi: number; label: string };

export function sessionBand(name: string | null | undefined): SessionBand | null {
  const m = /^\s*U\s?(\d{1,2})\s*[–—-]\s*U?\s?(\d{1,2})\s*$/i.exec(String(name ?? ""));
  if (!m) return null;
  const lo = Math.min(Number(m[1]), Number(m[2]));
  const hi = Math.max(Number(m[1]), Number(m[2]));
  if (!lo || !hi || hi - lo > 15) return null;
  return { lo, hi, label: `U${lo}–U${hi}` };
}

/** Is a child of this grade on this band's roll, given every band the
 *  programme runs? */
export function inSessionBand(grade: number | null, band: SessionBand, allBands: SessionBand[]): boolean {
  if (grade == null) return true;
  const bands = allBands.length ? allBands : [band];
  const min = Math.min(...bands.map((b) => b.lo));
  const max = Math.max(...bands.map((b) => b.hi));
  const g = Math.min(max, Math.max(min, grade));
  return g >= band.lo && g <= band.hi;
}

/** Every distinct band among a programme's session names. */
export function bandsOf(names: (string | null | undefined)[]): SessionBand[] {
  const out = new Map<string, SessionBand>();
  for (const n of names) {
    const b = sessionBand(n);
    if (b) out.set(b.label, b);
  }
  return Array.from(out.values());
}
