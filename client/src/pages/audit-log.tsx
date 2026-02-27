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
      <div>
        <h1 className="text-2xl font-semibold text-white tracking-tight" data-testid="text-page-title">Audit Log</h1>
        <p className="text-white/40 text-[13px] mt-1">
          Track all system activity and changes
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {isLoading ? (
          <div className="divide-y divide-white/[0.04]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-5 py-3">
                <Skeleton className="h-8 w-full bg-white/[0.04]" />
              </div>
            ))}
          </div>
        ) : logs && logs.length > 0 ? (
          <div>
            <div className="grid grid-cols-[100px_100px_80px_1fr_160px] gap-3 px-5 py-3 text-[11px] font-medium text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
              <span>Action</span>
              <span>Entity</span>
              <span>ID</span>
              <span>Details</span>
              <span>Timestamp</span>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[100px_100px_80px_1fr_160px] gap-3 px-5 py-3 items-center hover:bg-white/[0.02] transition-colors"
                  data-testid={`row-audit-${log.id}`}
                >
                  <span className={`text-[10px] font-medium capitalize px-2 py-0.5 rounded-md border w-fit ${actionColors[log.action] || "text-white/40 bg-white/[0.04] border-white/[0.06]"}`}>
                    {log.action}
                  </span>
                  <span className="text-[13px] text-white/60 capitalize">{log.entity}</span>
                  <span className="text-[13px] text-white/30 font-mono">{log.entityId ?? "—"}</span>
                  <span className="text-[13px] text-white/40 truncate">{log.details || "—"}</span>
                  <span className="text-[11px] text-white/30">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-5">
              <Shield className="w-6 h-6 text-white/20" />
            </div>
            <p className="text-[14px] font-medium text-white/50">No audit entries yet</p>
            <p className="text-[12px] text-white/35 mt-1.5">
              Activity will be logged here as you use the system
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
