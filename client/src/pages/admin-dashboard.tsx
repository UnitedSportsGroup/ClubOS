// The Christchurch United dashboard.
//
// Rebuilt 2026-09-02 on Daniel's instruction: revenue, a period filter and a
// trend — and nothing else. What it replaced was four stat tiles, a programmes
// list and a quick-actions panel, all of which duplicated a sidebar item one
// click away, and the only number anybody cared about read $0.00 while the club
// had $53,200 of confirmed registrations on file.
//
// 2026-09-10: the layout became MetricDashboard so the same design could go to
// every other workspace, which is what Daniel asked for next. What this page
// charts is decided by the registry in shared/dashboard.ts, not here.
import { useWorkspace } from "@/lib/workspace-context";
import { MetricDashboard } from "@/components/dashboard/metric-dashboard";

export default function AdminDashboard() {
  const { currentOrg } = useWorkspace();
  return <MetricDashboard subtitle={currentOrg?.name} basePath="/admin" />;
}
