import { workspaceName } from "./palette";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AdsResponse, CampaignBasis, TrackedResponse } from "@shared/marketing-hub";
import { Loading, LoadError, Unavailable } from "./section-state";
import { StatTile } from "./stat-tile";
import { TrendChart } from "./trend-chart";
import { BarList } from "./bar-list";
import { workspaceColor } from "./palette";
import { money, compact, relativeTime } from "./format";

const BASIS_LABEL: Record<CampaignBasis, string> = {
  name: "matched by name",
  account: "account default",
  unassigned: "unassigned",
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : (numerator / denominator) * 100;
}

/** Plain division, "—" when there is nothing to divide by (0 clicks). */
function divide(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function AdsSection({ query }: { query: string }) {
  const url = `/api/admin/marketing-hub/ads?${query}`;
  const trackedUrl = `/api/admin/marketing-hub/tracked?${query}`;

  const { data, isLoading, isError, error, refetch } = useQuery<AdsResponse>({
    queryKey: [url],
    staleTime: 60_000,
  });
  const tracked = useQuery<TrackedResponse>({
    queryKey: [trackedUrl],
    staleTime: 60_000,
  });

  if (isLoading) return <Loading rows={6} />;
  if (isError) return <LoadError error={error} onRetry={refetch} />;
  if (!data) return null;

  const ctrCurrent = ratio(data.totals.linkClicks.current, data.totals.impressions.current);
  const ctrPrevious = ratio(data.totals.linkClicks.previous, data.totals.impressions.previous);
  const cpcCurrent = divide(data.totals.spendCents.current, data.totals.linkClicks.current);
  const cpcPrevious = divide(data.totals.spendCents.previous, data.totals.linkClicks.previous);

  const sortedCampaigns = [...data.campaigns].sort((a, b) => b.spendCents - a.spendCents);

  return (
    <div className="space-y-6">
      {data.notSplitByProgramme && (
        <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 p-3">
          Ads can't be split by programme yet — these numbers are for the whole workspace.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {data.platforms.map((p) => (
          <Card key={p.key}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground leading-snug">{p.label}</p>
                <PlatformBadge status={p.status} />
              </div>
              {p.status === "error" && p.lastError && (
                <p className="text-xs text-rose-600 leading-relaxed">{p.lastError}</p>
              )}
              {p.lastSyncAt && (
                <p className="text-xs text-muted-foreground">Last pulled {relativeTime(p.lastSyncAt)}</p>
              )}
              {p.setup && p.setup.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    What's needed to connect
                    <ChevronDown className="w-3 h-3" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground list-decimal pl-4">
                      {p.setup.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatTile
          label="Spend"
          value={money(data.totals.spendCents.current)}
          current={data.totals.spendCents.current}
          previous={data.totals.spendCents.previous}
          neutral
        />
        <StatTile
          label="Impressions"
          value={compact(data.totals.impressions.current)}
          current={data.totals.impressions.current}
          previous={data.totals.impressions.previous}
        />
        <StatTile
          label="Link clicks"
          value={compact(data.totals.linkClicks.current)}
          current={data.totals.linkClicks.current}
          previous={data.totals.linkClicks.previous}
        />
        <StatTile
          label="CTR"
          value={ctrCurrent == null ? "—" : `${ctrCurrent.toFixed(2)}%`}
          current={ctrCurrent ?? undefined}
          previous={ctrPrevious}
        />
        <StatTile
          label="Cost per click"
          value={cpcCurrent == null ? "—" : money(cpcCurrent)}
          current={cpcCurrent ?? undefined}
          previous={cpcPrevious}
          neutral
        />
        <StatTile
          label="Leads"
          value={compact(data.totals.leads.current)}
          current={data.totals.leads.current}
          previous={data.totals.leads.previous}
        />
        <StatTile
          label="Purchases"
          value={compact(data.totals.purchases.current)}
          current={data.totals.purchases.current}
          previous={data.totals.purchases.previous}
        />
      </div>

      <TrendChart title="Spend" kind="money" data={data.series.map((s) => ({ date: s.date, value: s.spendCents }))} />

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">Spend by workspace</h3>
        </CardHeader>
        <CardContent>
          <BarList
            kind="money"
            items={data.byWorkspace.map((w) => ({
              key: w.workspace ?? "unassigned",
              label: w.workspace ? workspaceName(w.workspace) : "Unassigned",
              value: w.spendCents,
              color: workspaceColor(w.workspace),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <h3 className="text-sm font-medium text-foreground">Campaigns</h3>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Impressions</TableHead>
                  <TableHead className="text-right">Link clicks</TableHead>
                  <TableHead className="text-right">CTR</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCampaigns.map((c) => {
                  const ctr = ratio(c.linkClicks, c.impressions);
                  return (
                    <TableRow key={c.sourceId + c.campaignId}>
                      <TableCell className="max-w-xs truncate">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {workspaceName(c.workspace)}
                        <span className="block text-[11px]">{BASIS_LABEL[c.basis]}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(c.spendCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(c.impressions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(c.linkClicks)}</TableCell>
                      <TableCell className="text-right tabular-nums">{ctr == null ? "—" : `${ctr.toFixed(2)}%`}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(c.leads)}</TableCell>
                      <TableCell className="text-right tabular-nums">{compact(c.purchases)}</TableCell>
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
          <h3 className="text-sm font-medium text-foreground">Sign-ups ClubOS tracked, by channel</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          {tracked.isLoading && <Loading rows={3} />}
          {tracked.isError && <LoadError error={tracked.error} onRetry={tracked.refetch} />}
          {tracked.data?.status === "no_data" && <Unavailable title="No tracked sign-ups in this period" />}
          {tracked.data && tracked.data.status !== "no_data" && (
            <>
              {tracked.data.status === "not_split" && (
                <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/40 p-3">
                  Can't be split by programme yet — these numbers are for the whole workspace.
                </p>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Sign-ups</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tracked.data.channels.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>{c.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(c.conversions)}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(c.leads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{compact(c.sales)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.revenueCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                ClubOS's own record of which channel each sign-up came from. Meta counts leads and
                purchases its own way, so the two won't match.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlatformBadge({ status }: { status: "connected" | "not_connected" | "not_built" | "error" }) {
  if (status === "connected") {
    return (
      <Badge className="bg-emerald-100 text-emerald-900 border-emerald-200 hover:bg-emerald-100">Connected</Badge>
    );
  }
  if (status === "error") {
    return <Badge className="bg-rose-100 text-rose-900 border-rose-200 hover:bg-rose-100">Error</Badge>;
  }
  return <Badge variant="secondary" className="text-muted-foreground">Not connected</Badge>;
}
