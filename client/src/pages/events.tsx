import { Calendar } from "lucide-react";

export default function EventsPage() {
  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Events</h1>
        <p className="text-white/40 text-[13px] mt-1">
          Event calendar and scheduling
        </p>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-5">
            <Calendar className="w-6 h-6 text-white/20" />
          </div>
          <p className="text-[14px] font-medium text-white/50">Events calendar coming soon</p>
          <p className="text-[12px] text-white/35 mt-1.5 max-w-sm">
            This module will include calendar views, session scheduling, and event management
          </p>
        </div>
      </div>
    </div>
  );
}
