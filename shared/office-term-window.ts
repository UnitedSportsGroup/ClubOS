/**
 * Which terms the OFFICE may sell at the counter.
 *
 * Daniel, 2026-11-05, after two U4–U8 walk-ups paid for Term 4 2026 were
 * filed under Term 4 2027: "only showing the current one and the next one
 * until further notice." The 2027 terms were added on 11 Oct, and from then
 * the counter's term picker listed every term that had not finished, newest
 * first — so Term 4 2027 sat at the TOP of the grid, also at $160, beside
 * Term 4 2026.
 *
 * The window is the first TWO terms that have not ended, by start date:
 * during a term that is the term running now and the next one; in the
 * holidays it is the next two. Pure, so the picker and the sale refuse the
 * same terms. Dates are compared as ISO y-m-d strings, never through a Date.
 */
export const OFFICE_TERM_WINDOW = 2;

export function isoDay(d: unknown): string {
  if (d instanceof Date) {
    // pg hands DATE back as local midnight; read its own calendar parts.
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return String(d ?? "").slice(0, 10);
}

export function officeSellableTerms<T extends { id: number; startDate: unknown; endDate: unknown }>(
  terms: T[],
  todayIso: string,
  size = OFFICE_TERM_WINDOW,
): T[] {
  return terms
    .filter((t) => isoDay(t.endDate) >= todayIso)
    .sort((a, b) => (isoDay(a.startDate) < isoDay(b.startDate) ? -1 : isoDay(a.startDate) > isoDay(b.startDate) ? 1 : a.id - b.id))
    .slice(0, size);
}
