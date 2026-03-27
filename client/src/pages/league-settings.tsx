import { Settings } from "lucide-react";

export default function LeagueSettings() {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1100px]">
      <div>
        <h1 className="text-2xl font-bold text-white" data-testid="text-league-settings-title">Settings</h1>
        <p className="text-sm text-white/40 mt-1">Configure your league workspace</p>
      </div>
      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-5">
        <div className="flex flex-col items-center justify-center py-16 text-white/20">
          <Settings className="w-12 h-12 mb-3" />
          <p className="text-sm">League settings coming soon</p>
          <p className="text-xs mt-1 text-white/15">Point systems, scoring rules, and more</p>
        </div>
      </div>
    </div>
  );
}
