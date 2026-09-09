// The Mini Football Leagues dashboard.
//
// Daniel, 2026-09-10: "let's now roll out this new simple design for dashboard
// across other workspaces starting with MFL — make it a simple graph with
// timeframes selector to be able to track revenue."
//
// What this replaced was four counters (competitions, active, total teams,
// registration open), an active-competitions list and a teams-by-competition
// bar chart. Every one of those was a fact the Terms and Teams tabs already
// show, none of them answered "how are we doing", and none of them was money.
// Revenue with a timeframe is the number Isaac and Daniel actually open a
// dashboard for.
//
// Nothing is hardcoded here: the registry in shared/dashboard.ts says MFL
// charts confirmed registrations, and MetricDashboard asks the server which
// cards to draw.
import { useWorkspace } from "@/lib/workspace-context";
import { MetricDashboard } from "@/components/dashboard/metric-dashboard";

export default function LeagueDashboard() {
  const { currentOrg } = useWorkspace();
  return <MetricDashboard subtitle={currentOrg?.name} basePath="/admin" />;
}
