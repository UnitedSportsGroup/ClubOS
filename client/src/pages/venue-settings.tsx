import { Settings } from "lucide-react";

export default function VenueSettings() {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1100px]">
      <div>
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-white/40" />
          <div>
            <h1 className="text-2xl font-bold text-white" data-testid="text-venue-settings-title">Settings</h1>
            <p className="text-sm text-white/40">Configure your admin preferences</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-16 text-center">
        <Settings className="w-12 h-12 text-white/10 mx-auto mb-3" />
        <p className="text-white/40 text-lg mb-1">Settings coming soon</p>
        <p className="text-white/20 text-sm">System configuration and preferences</p>
      </div>
    </div>
  );
}
