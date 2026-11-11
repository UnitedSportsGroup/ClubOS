/**
 * United Sports Group — home. Just Rambo for now (Daniel, 2026-11-11, of the old cross-workspace overview: "remove this
 * from dashboard on usg workspace too keep it blank with just rambo on it for now"). The old page read
 * /api/admin/registrations without a workspace and showed 0 registrations and $0 — it is in git history if wanted.
 */
import { RamboPromptBox } from "@/components/rambo/rambo-prompt-box";

export default function GroupDashboard() {
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6" data-testid="group-dashboard">
      <RamboPromptBox />
    </div>
  );
}
