import { useRoute } from "wouter";
import { HIDDEN_BY_WORKSPACE } from "@shared/sidebar-hidden";

/**
 * Where a programme's admin pages live.
 *
 * One detail page (`admin-camp-detail`) serves every programme type, but the
 * URL it sits under is what decides which sidebar item lights up — the sidebar
 * matches on path, it has no idea what kind of record is on screen. Opening an
 * academy programme at `/admin/camps/123` therefore highlighted **Camps** while
 * the user was in Academy, which is simply wrong: academy programmes are not
 * camps.
 *
 * The fix is that the section owns the URL. Build every programme link with
 * `programDetailPath()` — never hand-write `/admin/camps/${id}` — and read the
 * id back with `useProgramRoute()`, which matches all three prefixes. Old
 * `/admin/camps/:id` links still resolve, so nothing bookmarked breaks.
 */
export const PROGRAM_BASE_PATHS = ["/admin/academy", "/admin/programs", "/admin/camps"] as const;
export type ProgramBasePath = (typeof PROGRAM_BASE_PATHS)[number];

/** The list page a programme belongs to, given its type and the workspace. */
export function programBasePath(
  program: { type?: string | null } | null | undefined,
  orgSlug?: string | null,
): ProgramBasePath {
  // Gymnastics has a single Programs list for everything it runs.
  if (orgSlug === "united-gymnastics") return "/admin/programs";
  if (program?.type === "academy") return "/admin/academy";
  // 🔴 Never route into a section this workspace does not DRAW. CUFC hides its
  // Camps item because holiday camps became a section on the Academy page
  // (Daniel, 2026-09-02) — so sending a camp to /admin/camps there lands on a
  // page with no sidebar entry and nothing highlighted, which is the dead end
  // Back was dropping him into.
  if (sectionHiddenHere("/admin/camps", orgSlug)) return "/admin/academy";
  return "/admin/camps";
}

/** The tab slug that draws a section, so we can ask whether it is hidden. */
const SECTION_TAB: Record<ProgramBasePath, string> = {
  "/admin/academy": "academy",
  "/admin/programs": "programs",
  "/admin/camps": "camps",
};

/** Is this section hidden from the sidebar in this workspace? */
export function sectionHiddenHere(base: ProgramBasePath, orgSlug?: string | null): boolean {
  return (HIDDEN_BY_WORKSPACE[orgSlug ?? ""] ?? []).includes(SECTION_TAB[base]);
}

/** Detail page for a programme, under the section that owns it. */
export function programDetailPath(
  program: { id: number; type?: string | null },
  orgSlug?: string | null,
): string {
  return `${programBasePath(program, orgSlug)}/${program.id}`;
}

/**
 * Match the current location against every programme prefix at once.
 *
 * `suffix` appends to the id segment, e.g. `/edit-page` or
 * `/session/:dateId/:sessionType`. Returns the matched base so the page can
 * keep its own links inside the section the user came in through.
 */
export function useProgramRoute(suffix = ""): {
  base: ProgramBasePath;
  id: number;
  params: Record<string, string | undefined>;
} | null {
  // Hook count is fixed and ordered — one useRoute per known prefix.
  const academy = useRoute(`/admin/academy/:id${suffix}`);
  const programs = useRoute(`/admin/programs/:id${suffix}`);
  const camps = useRoute(`/admin/camps/:id${suffix}`);

  const matches: [ProgramBasePath, typeof academy][] = [
    ["/admin/academy", academy],
    ["/admin/programs", programs],
    ["/admin/camps", camps],
  ];

  for (const [base, [matched, params]] of matches) {
    if (matched && params?.id) {
      return { base, id: parseInt(params.id), params: params as Record<string, string | undefined> };
    }
  }
  return null;
}

/**
 * Does this section's list page actually show this programme?
 *
 * 🔴 A programme can legitimately live at more than one address. Holiday camps
 * are listed in a "Holiday Camps" section ON the Academy page as well as on
 * Camps (Daniel, 2026-09-02: they don't get a tab of their own), so
 * `/admin/academy/39` for a holiday camp is a real address a person arrived at
 * by clicking — not a stale bookmark to be rewritten. Rewriting it to
 * `/admin/camps/39` is what sent Daniel back to Camps after opening a camp from
 * Academy.
 *
 * `programBasePath()` answers "where does this programme belong BY TYPE", which
 * is the right question for a search result with no origin, and the wrong one
 * for a page you are already standing on.
 */
export function sectionShowsProgram(
  base: ProgramBasePath,
  program: { type?: string | null } | null | undefined,
  orgSlug?: string | null,
): boolean {
  // A section this workspace doesn't draw shows nothing — being parked on one
  // is exactly the stranded state to heal out of, never a state to preserve.
  if (sectionHiddenHere(base, orgSlug)) return false;
  // Gymnastics has a single Programs list holding everything it runs, and that
  // URL exists in no other workspace — being on it IS being in gymnastics.
  if (base === "/admin/programs") return true;
  // Academy lists the academy sections AND holiday camps.
  if (base === "/admin/academy") return orgSlug !== "united-gymnastics";
  // Camps lists everything that is not an academy programme.
  if (base === "/admin/camps") return program?.type !== "academy";
  return false;
}
