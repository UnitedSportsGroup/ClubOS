import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield } from "lucide-react";
import type { AuditLog } from "@shared/schema";

export default function AuditLogPage() {
  const { data: logs, isLoading } = useQuery<AuditLog[]>({
    queryKey: ["/api/audit-logs"],
  });

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Audit Log</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Track all system activity and changes
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="px-5 py-3">
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="divide-y">
              <div className="grid grid-cols-[120px_100px_100px_1fr_160px] gap-3 px-5 py-2 text-xs font-medium text-muted-foreground border-b">
                <span>Action</span>
                <span>Entity</span>
                <span>Entity ID</span>
                <span>Details</span>
                <span>Timestamp</span>
              </div>
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="grid grid-cols-[120px_100px_100px_1fr_160px] gap-3 px-5 py-3 items-center"
                  data-testid={`row-audit-${log.id}`}
                >
                  <Badge variant="outline" className="capitalize text-[10px] w-fit">
                    {log.action}
                  </Badge>
                  <span className="text-sm capitalize">{log.entity}</span>
                  <span className="text-sm text-muted-foreground">{log.entityId ?? "—"}</span>
                  <span className="text-sm text-muted-foreground truncate">{log.details || "—"}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Shield className="w-12 h-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">No audit entries yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Activity will be logged here as you use the system
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
