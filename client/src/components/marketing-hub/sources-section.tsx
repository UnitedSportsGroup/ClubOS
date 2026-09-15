import { useQuery, useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SourcesResponse } from "@shared/marketing-hub";
import { Loading, LoadError } from "./section-state";
import { compact, relativeTime } from "./format";

const SOURCES_URL = "/api/admin/marketing-hub/sources";

export function SourcesSection() {
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useQuery<SourcesResponse>({
    queryKey: [SOURCES_URL],
    staleTime: 30_000,
  });

  const syncNow = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/marketing-hub/sync");
      return res.json() as Promise<{ message: string }>;
    },
    onSuccess: (result) => {
      toast({ title: "Sync started", description: result.message });
      queryClient.invalidateQueries({ queryKey: [SOURCES_URL] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start a sync", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <Loading rows={6} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  const nextAllowed = data.nextManualSyncAt ? new Date(data.nextManualSyncAt) : null;
  const stillCoolingDown = !!nextAllowed && nextAllowed.getTime() > Date.now();
  const syncDisabled = !data.syncEnabled || stillCoolingDown || syncNow.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {data.syncEnabled
              ? "Automatic pulls: every 6 hours"
              : "Automatic pulls are switched off on this server"}
          </p>
          <div className="flex items-center gap-2">
            {stillCoolingDown && nextAllowed && (
              <span className="text-xs text-muted-foreground">
                Available again{" "}
                {nextAllowed.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button size="sm" variant="outline" disabled={syncDisabled} onClick={() => syncNow.mutate()}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncNow.isPending ? "animate-spin" : ""}`} />
              Sync now
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {data.platforms.map((p) => (
          <Card key={p.key}>
            <CardContent className="p-4 space-y-1.5">
              <p className="text-sm font-medium text-foreground">{p.label}</p>
              <p className="text-xs text-muted-foreground">
                {p.sourceCount} {p.sourceCount === 1 ? "account" : "accounts"}
              </p>
              {!p.built && p.setup && (
                <ol className="mt-1 space-y-1 text-[11px] text-muted-foreground list-decimal pl-4">
                  {p.setup.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">Sources</h3>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead>First day</TableHead>
                    <TableHead>Last day</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.sources.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.platform}</TableCell>
                      <TableCell>{s.label}</TableCell>
                      <TableCell className="text-muted-foreground">{s.workspace ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.firstDay ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.lastDay ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{relativeTime(s.lastRunAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <SourceStatusBadge status={s.lastStatus} />
                          {s.lastError && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-xs text-rose-600 truncate max-w-[160px] cursor-help">
                                  {s.lastError}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">{s.lastError}</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">Recent runs</h3>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{relativeTime(r.startedAt)}</TableCell>
                      <TableCell>{r.label}</TableCell>
                      <TableCell className="text-muted-foreground">{r.trigger}</TableCell>
                      <TableCell>
                        <SourceStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{compact(r.rowsWritten)}</TableCell>
                      <TableCell>
                        {r.error ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs text-rose-600 truncate max-w-[200px] inline-block cursor-help">
                                {r.error}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{r.error}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceStatusBadge({ status }: { status: string | null }) {
  if (status === "ok") {
    return <Badge className="bg-emerald-100 text-emerald-900 border-emerald-200 hover:bg-emerald-100">Ok</Badge>;
  }
  if (status === "error") {
    return <Badge className="bg-rose-100 text-rose-900 border-rose-200 hover:bg-rose-100">Error</Badge>;
  }
  if (status === "running") {
    return <Badge className="bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-100">Running</Badge>;
  }
  if (status === "skipped") {
    return <Badge variant="secondary" className="text-muted-foreground">Skipped</Badge>;
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}
