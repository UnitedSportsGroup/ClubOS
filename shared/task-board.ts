/**
 * Task Board — Daniel + Isaac's MFL project board (2026-09-25).
 * Separate from the org-wide Task Tracker (tt_*): own tables tb_*, own tab.
 * The ONE place a status or priority is decided — server validates with these,
 * the client draws with these.
 */
export const TB_STATUSES = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "In progress" },
  { key: "waiting", label: "Waiting on" },
  { key: "done", label: "Done" },
] as const;
export type TbStatus = (typeof TB_STATUSES)[number]["key"];
export const TB_STATUS_KEYS: string[] = TB_STATUSES.map((s) => s.key);
export const isTbStatus = (v: unknown): v is TbStatus => typeof v === "string" && TB_STATUS_KEYS.includes(v);

export const TB_PRIORITIES = ["high", "normal"] as const;
export type TbPriority = (typeof TB_PRIORITIES)[number];
export const isTbPriority = (v: unknown): v is TbPriority => v === "high" || v === "normal";

export const TB_COLORS = ["gold", "blue", "green", "violet", "rose", "slate"] as const;
export const isTbColor = (v: unknown) => typeof v === "string" && (TB_COLORS as readonly string[]).includes(v);

export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Overdue is DERIVED, never stored: not done, due before today (NZ). */
export function tbIsOverdue(t: { status: string; dueOn: string | null }, todayIso: string) {
  return t.status !== "done" && !!t.dueOn && t.dueOn < todayIso;
}
