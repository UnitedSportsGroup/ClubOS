import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { addDaysIso } from "@shared/dashboard";
import type { WebsitesResponse } from "@shared/marketing-hub";
import { Loading, LoadError, Unavailable } from "./section-state";
import { TrendChart } from "./trend-chart";
import { BarList } from "./bar-list";
import { SERIES } from "./palette";
import { compact } from "./format";

export function WebsitesSection({ query }: { query: string }) {
  const url = `/api/admin/marketing-hub/websites?${query}`;
  const { data, isLoading, isError, error, refetch } = useQuery<WebsitesResponse>({
    queryKey: [url],
    staleTime: 60_000,
  });

  if (isLoading) return <Loading rows={6} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  const { firstParty, ga4, range } = data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">ClubOS tracking</h3>
        </CardHeader>
        <CardContent className="space-y-6">
          {firstParty.status === "no_data" ? (
            <Unavailable title="No visits recorded in this period" />
          ) : (
            <>
              <TrendChart
                title="Visitors"
                kind="count"
                data={firstParty.series.map((s) => ({ date: s.date, value: s.visitors }))}
              />

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead className="text-right">Visitors</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Page views</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {firstParty.sites.map((site) => {
                      const change =
                        site.visitorsPrevious === 0
                          ? null
                          : ((site.visitors - site.visitorsPrevious) / site.visitorsPrevious) * 100;
                      return (
                        <TableRow key={site.host}>
                          <TableCell>{site.label}</TableCell>
                          <TableCell className="text-muted-foreground">{site.workspace ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(site.visitors)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(0)}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{compact(site.pageViews)}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(site.sessions)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-3">Where visitors came from</h4>
                <BarList
                  kind="count"
                  items={firstParty.channels.map((c, i) => ({
                    key: c.channel,
                    label: c.label,
                    value: c.visitors,
                    color: SERIES[i % SERIES.length],
                  }))}
                />
              </div>

              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-3">Top pages</h4>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead className="text-right">Views</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {firstParty.topPages.map((p, i) => (
                        <TableRow key={`${p.host}${p.path}-${i}`}>
                          <TableCell className="max-w-md truncate">
                            {p.host}
                            {p.path}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{compact(p.views)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {firstParty.untrackedSites.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  No ClubOS tracking seen on: {firstParty.untrackedSites.map((s) => s.label).join(", ")}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">Google Analytics</h3>
        </CardHeader>
        <CardContent className="space-y-6">
          {ga4.status === "not_connected" ? (
            <Unavailable title="Google Analytics isn't connected yet" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Property</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Change</TableHead>
                      <TableHead className="text-right">Engaged sessions</TableHead>
                      <TableHead className="text-right">Page views</TableHead>
                      <TableHead className="text-right">Key events</TableHead>
                      <TableHead>Last day</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ga4.properties.map((prop) => {
                      const change =
                        prop.sessionsPrevious === 0
                          ? null
                          : ((prop.sessions - prop.sessionsPrevious) / prop.sessionsPrevious) * 100;
                      const stale =
                        !prop.lastDay || prop.lastDay < addDaysIso(range.to, -3);
                      return (
                        <TableRow key={prop.sourceId}>
                          <TableCell>{prop.label}</TableCell>
                          <TableCell className="text-muted-foreground">{prop.site ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(prop.sessions)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {change == null ? "—" : `${change > 0 ? "+" : ""}${change.toFixed(0)}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{compact(prop.engagedSessions)}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(prop.pageViews)}</TableCell>
                          <TableCell className="text-right tabular-nums">{compact(prop.keyEvents)}</TableCell>
                          <TableCell>
                            {stale ? (
                              <Badge className="bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-100">
                                No data since {prop.lastDay ?? "ever"}
                              </Badge>
                            ) : (
                              prop.lastDay
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <TrendChart title="Sessions" kind="count" data={ga4.series.map((s) => ({ date: s.date, value: s.sessions }))} />

              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-3">Channels</h4>
                <BarList
                  kind="count"
                  items={ga4.channels.map((c, i) => ({
                    key: c.channel,
                    label: c.channel,
                    value: c.sessions,
                    color: SERIES[i % SERIES.length],
                  }))}
                />
              </div>

              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                Google Analytics and ClubOS count visits differently, so the two won't match. Only
                sites with Google Analytics installed appear here.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
