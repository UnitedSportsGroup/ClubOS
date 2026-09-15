import { hubWorkspace } from "@shared/marketing-hub";
import { HUB_WORKSPACES } from "@shared/marketing-hub";

/**
 * A workspace's chart colour is its POSITION in HUB_WORKSPACES (slot n of this
 * validated palette), never its rank in a table — see the note on
 * HUB_WORKSPACES. Filtering or sorting a table must not repaint the rows that
 * survive.
 */
export const SERIES: readonly string[] = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

/** Unknown, null, or unassigned workspaces get this neutral grey — never a
 *  colour that could be mistaken for a real workspace's series. */
export const UNKNOWN_COLOR = "#898781";

export function workspaceColor(slug: string | null | undefined): string {
  if (!slug) return UNKNOWN_COLOR;
  const index = HUB_WORKSPACES.findIndex((w) => w.slug === slug);
  if (index === -1) return UNKNOWN_COLOR;
  return SERIES[index % SERIES.length];
}

/** A workspace's name for display — never its internal slug ("christchurch-united"). */
export function workspaceName(slug: string | null | undefined): string {
  if (!slug) return "—";
  return hubWorkspace(slug)?.name ?? slug;
}
