import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { HUB_WORKSPACES, type OverviewResponse } from "@shared/marketing-hub";
import { Loading, LoadError, Unavailable } from "./section-state";
import { StatTile } from "./stat-tile";
import { TrendChart } from "./trend-chart";
import { workspaceColor } from "./palette";
import { money, compact } from "./format";

export function OverviewSection({
  query,
  onSelectWorkspace,
}: {
  query: string;
  onSelectWorkspace: (slug: string) => void;
}) {
  const url = `/api/admin/marketing-hub/overview?${query}`;
  const { data, isLoading, isError, error, refetch } = useQuery<OverviewResponse>({
    queryKey: [url],
    staleTime: 60_000,
  });

  if (isLoading) return <Loading rows={6} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  const { tiles } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile
          label="Website visitors"
          value={compact(tiles.visitors.current)}
          current={tiles.visitors.current}
          previous={tiles.visitors.previous}
          status={tiles.visitors.status}
        />
        <StatTile
          label="Form submissions"
          value={compact(tiles.submissions.current)}
          current={tiles.submissions.current}
          previous={tiles.submissions.previous}
          status={tiles.submissions.status}
        />
        <StatTile
          label="Paid registrations"
          value={compact(tiles.paidRegistrations.current)}
          current={tiles.paidRegistrations.current}
          previous={tiles.paidRegistrations.previous}
          status={tiles.paidRegistrations.status}
        />
        <StatTile
          label="Revenue"
          value={money(tiles.revenueCents.current)}
          current={tiles.revenueCents.current}
          previous={tiles.revenueCents.previous}
          status={tiles.revenueCents.status}
          note={
            tiles.revenueCents.status === "ok"
              ? `${tiles.revenueCents.workspacesWithRevenue} of ${HUB_WORKSPACES.length} workspaces record revenue in ClubOS`
              : undefined
          }
        />
        <StatTile
          label="Ad spend"
          value={money(tiles.adSpendCents.current)}
          current={tiles.adSpendCents.current}
          previous={tiles.adSpendCents.previous}
          status={tiles.adSpendCents.status}
          neutral
        />
        <StatTile
          label="Social followers"
          value={tiles.followers.current == null ? "—" : compact(tiles.followers.current)}
          current={tiles.followers.current ?? undefined}
          previous={tiles.followers.previous}
          deltaMode="diff"
          status={tiles.followers.status}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TrendChart title="Website visitors" data={data.series.map((s) => ({ date: s.date, value: s.visitors }))} kind="count" />
        <TrendChart title="Form submissions" data={data.series.map((s) => ({ date: s.date, value: s.submissions }))} kind="count" />
        <TrendChart title="Ad spend" data={data.series.map((s) => ({ date: s.date, value: s.adSpendCents }))} kind="money" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">By workspace</h3>
        </CardHeader>
        <CardContent>
          {data.byWorkspace.length === 0 ? (
            <Unavailable title="No workspaces to show" />
          ) : (
            <TooltipProvider>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Submissions</TableHead>
                      <TableHead className="text-right">Paid registrations</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Ad spend</TableHead>
                      <TableHead className="text-right">Followers</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byWorkspace.map((row) => (
                      <TableRow
                        key={row.slug}
                        className="cursor-pointer"
                        onClick={() => onSelectWorkspace(row.slug)}
                      >
                        <TableCell>
                          <span className="inline-flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: workspaceColor(row.slug) }}
                            />
                            {row.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{compact(row.visitors)}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(row.submissions)}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(row.paidRegistrations)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.revenueCents == null ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground cursor-help">—</span>
                              </TooltipTrigger>
                              <TooltipContent>Not recorded in ClubOS</TooltipContent>
                            </Tooltip>
                          ) : (
                            money(row.revenueCents)
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(row.adSpendCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.followers == null ? <span className="text-muted-foreground">—</span> : compact(row.followers)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {data.notes.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
          {data.notes.map((note, i) => (
            <li key={i}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
