// The Christchurch International Cup dashboard — Youth, 7's and Ethnic.
//
// Daniel, 2026-09-10: "For CIC Youth make it track registrations of interest on
// the graph, for CIC 7's make it track registrations of interest and sales
// revenue and add the dashboard here."
//
// 🔴 One page, three tournaments, and they do NOT share a number. The Cup is a
// single workspace with a Youth / 7's / Ethnic toggle, so the sub-view is
// passed through and the server answers with that tournament's own metrics:
// Youth charts interest, 7's charts interest AND the money Team Pay has taken.
//
// 🔴 Youth deliberately has no money card. Its 132 team entries all carry
// paid_amount_cents = 0 — the money is real and simply is not in ClubOS, and a
// "$0.00" on the Cup's own dashboard would read as "the tournament earned
// nothing" rather than "we are not measuring this". The Ethnic Cup charts
// nothing yet for the same reason, and says so.
//
// What replaced: four counters (tournaments, active, registration open,
// published) and a list of active tournaments — all of it already on the
// Tournaments tab one click away.
import { useWorkspace } from "@/lib/workspace-context";
import { MetricDashboard } from "@/components/dashboard/metric-dashboard";

const VIEW_LABEL: Record<string, string> = {
  youth: "CIC Youth",
  "7s": "CIC 7's",
  ethnic: "Christchurch Ethnic Cup",
};

export default function TournamentDashboard() {
  const { currentOrg, cicView } = useWorkspace();
  const view = cicView ?? "youth";
  return (
    <MetricDashboard
      subtitle={`${currentOrg?.name ?? "Christchurch International Cup"} — ${VIEW_LABEL[view] ?? "Youth"}`}
      basePath="/admin"
      // "youth" is the registry's unprefixed default, so it is passed as null.
      view={view === "youth" ? null : view}
    />
  );
}
