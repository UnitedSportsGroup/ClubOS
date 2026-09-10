/**
 * What KIND of thing a registration is for — and the one place its colour is
 * decided.
 *
 * Daniel, 2026-09-10, of the Registrations list: "let's make these colour coded
 * too so that technification and all additional academy programs show one
 * colour, academy programs show another colour and holiday camps another
 * colour."
 *
 * 🔴 ONE DECIDER. A colour that means "this is a holiday camp" has to mean the
 * same thing on the Registrations list, a person's history and anywhere it
 * lands next; a page that picks its own amber is how two screens end up
 * disagreeing about what amber means.
 *
 * 🔴 It reuses `academy_section`, which ALREADY splits these three ways — it is
 * what decides the 5% full-year discount (training fees only, never
 * Technification or Goalkeeper). Inventing a second taxonomy for a colour would
 * mean two answers to "is Technification an academy programme", and they would
 * drift the first time somebody added a programme.
 */
export type ProgrammeKind = "academy" | "additional" | "camp" | "other";

export type ProgrammeLike = {
  type?: string | null;
  /** `programs.academy_section` — 'core' | 'additional'. */
  academySection?: string | null;
} | null | undefined;

/**
 * 🔴 A missing `academySection` reads as CORE academy, never as "additional".
 * Only the programmes a human deliberately marked `additional` (Technification,
 * Goalkeeper, Morning) get that colour — a null must not quietly recolour
 * FUNiño, and it must not exclude it from the full-year discount either, which
 * is the same distinction.
 */
export function programmeKind(program: ProgrammeLike): ProgrammeKind {
  const type = String(program?.type ?? "").toLowerCase();
  if (type === "holiday_camp" || type === "camp") return "camp";
  if (type === "academy") {
    return String(program?.academySection ?? "").toLowerCase() === "additional" ? "additional" : "academy";
  }
  return program?.type ? "other" : "other";
}

/**
 * The look of each kind. Tailwind classes are written out IN FULL — never
 * built by interpolation — because the light-theme generator reads the literal
 * utilities present in `client/src`, and a class assembled at runtime is
 * invisible to it (`npm run build:light-theme` after changing these).
 */
export const PROGRAMME_KIND_META: Record<ProgrammeKind, {
  label: string;
  /** The icon tile on a list row. */
  tile: string;
  icon: string;
  /** 🔴 The legend swatch is its OWN class, not the tile reused. The tile sits
   *  behind an icon and works at 8%; the same 8% as a bare 10px square was
   *  invisible on a white page, so the legend's "Term academy" dot did not
   *  render at all. Caught by looking at a screenshot, not by any check. */
  dot: string;
  /** A small chip beside the programme name. */
  chip: string;
  /** What this colour means, for the page's own legend. */
  note: string;
}> = {
  academy: {
    label: "Academy",
    tile: "bg-blue-500/8 border-blue-500/15",
    icon: "text-blue-400/70",
    dot: "bg-blue-500/60 border-blue-500/70",
    chip: "border-blue-500/20 text-blue-400/70 bg-blue-500/[0.06]",
    note: "Term academy — FUNiño, Pre-Academy, Academy",
  },
  additional: {
    label: "Additional",
    tile: "bg-violet-500/10 border-violet-500/20",
    icon: "text-violet-400/80",
    dot: "bg-violet-500/60 border-violet-500/70",
    chip: "border-violet-500/25 text-violet-400/80 bg-violet-500/[0.08]",
    note: "Additional programmes — Technification, Goalkeeper, Morning",
  },
  camp: {
    label: "Holiday camp",
    tile: "bg-amber-500/10 border-amber-500/20",
    icon: "text-amber-400/80",
    dot: "bg-amber-500/60 border-amber-500/70",
    chip: "border-amber-500/25 text-amber-400/80 bg-amber-500/[0.08]",
    note: "Holiday camps",
  },
  other: {
    label: "Other",
    tile: "bg-white/[0.04] border-white/10",
    icon: "text-white/40",
    dot: "bg-white/30 border-white/40",
    chip: "border-white/12 text-white/45 bg-white/[0.03]",
    note: "Everything else",
  },
};

/** The kinds worth putting in a legend, in the order they read. */
export const PROGRAMME_KIND_ORDER: ProgrammeKind[] = ["academy", "additional", "camp"];
