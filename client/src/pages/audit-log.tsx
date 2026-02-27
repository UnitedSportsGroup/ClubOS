import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield } from "lucide-react";
import type { AuditLog } from "@shared/schema";

const actionColors: Record<string, string> = {
  create: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  update: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  delete: "text-red-400 bg-red-500/10 border-red-500/20",
};

export default function AuditLogPage() {
  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-logs"],
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Audit Log</h1>
        <p className="text-blue-400/35 text-[13px] mt-1">
          Track all system activity and changes
        </p>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden animate-fade-in-up" style={{ animationDelay: '100ms', opacity: 0 }}>
        {isLoading ? (
          <div className="divide-y divide-blue-500/[0.04]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-5 py-3">
                <Skeleton className="h-8 w-full bg-blue-500/[0.04]" />
              </div>
            ))}
          </div>
        ) : logs && logs.length > 0 ? (
          <div>
            <div className="grid grid-cols-[100px_100px_80px_1fr_160px] gap-3 px-5 py-3 text-[10px] font-semibold text-blue-300/25 uppercase tracking-[0.15em] border-b border-blue-500/[0.08]">
              <span>Action</span>
              <span>Entity</span>
              <span>ID</span>
              <span>Details</span>
              <span>Timestamp</span>
            </div>
            <div className="divide-y divide-blue-500/[0.04]">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[100px_100px_80px_1fr_160px] gap-3 px-5 py-3 items-center row-hover"
                  data-testid={`row-audit-${log.id}`}
                >
                  <span className={`text-[10px] font-medium capitalize px-2.5 py-0.5 rounded-lg border w-fit ${actionColors[log.action] || "text-white/35 bg-blue-500/[0.04] border-blue-500/[0.08]"}`}>
                    {log.action}
                  </span>
                  <span className="text-[13px] text-white/50 capitalize">{log.entity}</span>
                  <span className="text-[13px] text-white/25 font-mono">{log.entityId ?? "—"}</span>
                  <span className="text-[13px] text-white/35 truncate">{log.details || "—"}</span>
                  <span className="text-[11px] text-white/25">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-500/[0.04] border border-blue-500/[0.1] flex items-center justify-center mb-5 animate-pulse-glow">
              <Shield className="w-6 h-6 text-blue-400/15" />
            </div>
            <p className="text-[14px] font-medium text-white/45">No audit entries yet</p>
            <p className="text-[12px] text-white/30 mt-1.5">
              Activity will be logged here as you use the system
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
