import { Dumbbell } from "lucide-react";

export default function GymnasticsDashboard() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white" data-testid="text-gymnastics-dashboard-title">Dashboard</h1>
        <p className="text-sm text-white/40 mt-1">United Gymnastics management overview</p>
      </div>

      <div className="rounded-2xl border border-blue-500/10 bg-white/[0.02] p-10">
        <div className="flex flex-col items-center justify-center py-16 text-white/20">
          <Dumbbell className="w-14 h-14 mb-4" />
          <p className="text-lg font-medium text-white/30">United Gymnastics</p>
          <p className="text-sm mt-2 text-white/15">Workspace ready — features coming soon</p>
        </div>
      </div>
    </div>
  );
}
