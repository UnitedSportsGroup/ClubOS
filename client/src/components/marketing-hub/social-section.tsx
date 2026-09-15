import { workspaceName } from "./palette";
import { useQuery } from "@tanstack/react-query";
import { Facebook, Instagram } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OrganicResponse } from "@shared/marketing-hub";
import { Loading, LoadError, Unavailable } from "./section-state";
import { TrendChart } from "./trend-chart";
import { compact } from "./format";

export function SocialSection({ query }: { query: string }) {
  const url = `/api/admin/marketing-hub/organic?${query}`;
  const { data, isLoading, isError, error, refetch } = useQuery<OrganicResponse>({
    queryKey: [url],
    staleTime: 60_000,
  });

  if (isLoading) return <Loading rows={5} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  if (data.status === "not_connected") {
    return <Unavailable title="No social accounts connected yet" />;
  }

  return (
    <div className="space-y-6">
      {data.notSplitByProgramme && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 p-3">
          Can't be split by programme yet — these numbers are for the whole workspace.
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">Followers</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">New follows</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Interactions</TableHead>
                  <TableHead className="text-right">Profile views</TableHead>
                  <TableHead className="text-right">Website clicks</TableHead>
                  <TableHead className="text-right">Avg daily reach</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.accounts.map((a) => {
                  const change =
                    a.followers == null || a.followersAtStart == null ? null : a.followers - a.followersAtStart;
                  return (
                    <TableRow key={a.sourceId}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          {a.platform === "facebook_page" ? (
                            <Facebook className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <Instagram className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          {a.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{workspaceName(a.workspace)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.followers == null ? "—" : compact(a.followers)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {change == null ? "—" : `${change > 0 ? "+" : ""}${compact(change)}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{compact(a.newFollows)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(a.views)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(a.interactions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(a.profileViews)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(a.websiteClicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.avgReach == null ? "—" : compact(a.avgReach)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">Followers</h3>
        </CardHeader>
        <CardContent>
          {data.series.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              Follower history builds up from the first day ClubOS collected it.
            </p>
          ) : (
            <TrendChart title="Followers" kind="count" data={data.series.map((s) => ({ date: s.date, value: s.followers }))} />
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
        Follower totals are read once a day, so history starts the day collection began.
      </p>
    </div>
  );
}
