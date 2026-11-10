// ─────────────────────────────────────────────────────────────────────────────
// Website analytics — one website (or all of them) in depth.
// United Sports Group → Marketing → Website analytics.
//
// Daniel, 2026-11-10: "now add websites tab to see analytics".
//
// Period, workspace and website live in the URL. Everything is from ClubOS's
// own tracker, so every site is counted the same way. A behaviour number the
// tracker did not record on a site is "—" with the reason, never 0.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarList } from "@/components/marketing-hub/bar-list";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { StatTile } from "@/components/marketing-hub/stat-tile";
import { TrendChart } from "@/components/marketing-hub/trend-chart";
import { workspaceColor, workspaceName } from "@/components/marketing-hub/palette";
import { DASHBOARD_PERIODS, resolvePeriod, type DashboardPeriod, type DateRange } from "@shared/dashboard";
import { HUB_WORKSPACES, SITES } from "@shared/marketing-hub";
import { formatSeconds, type WebAnalyticsResponse } from "@shared/web-analytics";

const n = (v: number) => v.toLocaleString("en-NZ");
const DEVICE: Record<string, string> = { desktop: "Computer", mobile: "Phone", tablet: "Tablet", "not recorded": "Not recorded" };

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>;

export default function WebAnalytics() {
  const search = useSearch();
  const [, navigate] = useLocation();

  const { period, custom, scope } = useMemo(() => {
    const p = new URLSearchParams(search);
    const raw = p.get("period") ?? "30d";
    const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(raw) ? (raw as DashboardPeriod) : "30d";
    const fallback = resolvePeriod("30d");
    const custom: DateRange = { from: p.get("from") || fallback.from, to: p.get("to") || fallback.to };
    const site = p.get("site");
    const workspace = p.get("workspace");
    // One value for the picker: "all", "ws:<slug>" or "site:<host>".
    const scope = site ? `site:${site}` : workspace ? `ws:${workspace}` : "all";
    return { period, custom, scope };
  }, [search]);

  const write = useCallback(
    (next: { period?: DashboardPeriod; custom?: DateRange; scope?: string }) => {
      const p = new URLSearchParams();
      const per = next.period ?? period;
      p.set("period", per);
      if (per === "custom") {
        const r = next.custom ?? custom;
        p.set("from", r.from);
        p.set("to", r.to);
      }
      const sc = next.scope ?? scope;
      if (sc.startsWith("site:")) p.set("site", sc.slice(5));
      else if (sc.startsWith("ws:")) p.set("workspace", sc.slice(3));
      navigate(`/admin/web-analytics?${p.toString()}`, { replace: true });
    },
    [navigate, period, custom, scope],
  );

  const query = useMemo(() => {
    const p = new URLSearchParams({ period });
    if (period === "custom") {
      p.set("from", custom.from);
      p.set("to", custom.to);
    }
    if (scope.startsWith("site:")) p.set("site", scope.slice(5));
    else if (scope.startsWith("ws:")) p.set("workspace", scope.slice(3));
    return p.toString();
  }, [period, custom, scope]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<WebAnalyticsResponse>({
    queryKey: [`/api/admin/web-analytics/report?${query}`],
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const oneSite = scope.startsWith("site:") ? scope.slice(5) : null;
  const sitesByWorkspace = HUB_WORKSPACES.map((w) => ({
    ...w,
    hosts: Object.entries(SITES).filter(([, s]) => s.workspace === w.slug && s.kind !== "alias").map(([host]) => host),
  })).filter((w) => w.hosts.length);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Website analytics</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Who visits each website, what they look at and where they came from.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={(v) => write({ scope: v })}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[300px]" aria-label="Website" data-testid="web-site">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[70vh]">
            <SelectItem value="all">All websites</SelectItem>
            {sitesByWorkspace.map((w) => (
              <SelectGroup key={w.slug}>
                <SelectLabel className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: workspaceColor(w.slug) }} />
                  {w.name}
                </SelectLabel>
                {w.hosts.length > 1 && <SelectItem value={`ws:${w.slug}`}>All {w.short} websites</SelectItem>}
                {w.hosts.map((h) => (
                  <SelectItem key={h} value={`site:${h}`}>{h}</SelectItem>
                ))}
              </SelectGroup>
            ))}
            {/* A site the tracker saw that is not in the list above. */}
            {oneSite && !SITES[oneSite] && <SelectItem value={`site:${oneSite}`}>{oneSite}</SelectItem>}
          </SelectContent>
        </Select>
        <PeriodPicker period={period} custom={custom} onChange={(next, c) => write({ period: next, custom: c })} />
        {isFetching && !isLoading && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>

      {isLoading ? (
        <Loading rows={5} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : !data ? null : data.status === "no_data" ? (
        <Card>
          <CardContent className="py-10 text-center space-y-1">
            <p className="text-sm font-medium text-foreground">No visits recorded{oneSite ? ` on ${oneSite}` : ""} in this period.</p>
            <p className="text-sm text-muted-foreground">
              {data.untrackedSites.length ? "The ClubOS tracker is not on this website yet, so there is nothing to count." : "Try a longer period."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Report data={data} oneSite={oneSite} onSite={(host) => write({ scope: `site:${host}` })} />
      )}
    </div>
  );
}

function Report({ data, oneSite, onSite }: { data: WebAnalyticsResponse; oneSite: string | null; onSite: (host: string) => void }) {
  const b = data.behaviour;
  const t = data.totals;
  const bounceRate = b.sessionsStarted && b.bounces != null ? Math.round((b.bounces / b.sessionsStarted) * 100) : null;
  const newShare = b.sessionsStarted && b.newVisitorSessions != null ? Math.round((b.newVisitorSessions / b.sessionsStarted) * 100) : null;
  const noBehaviour = "Only the booking and checkout sites record this";
  const showHost = !oneSite;
  const pageLabel = (p: { host: string; path: string }) => (showHost ? `${p.host}${p.path}` : p.path);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="web-tiles">
        <StatTile label="Visitors" value={n(t.visitors)} current={t.visitors} previous={data.previous.visitors} />
        <StatTile label="Visits" value={n(t.sessions)} current={t.sessions} previous={data.previous.sessions} />
        <StatTile label="Pages viewed" value={n(t.pageViews)} current={t.pageViews} previous={data.previous.pageViews} />
        <StatTile label="On the site now" value={n(data.liveNow)} note="visitors in the last 30 minutes" />
        <StatTile label="Pages per visit" value={t.sessions ? (t.pageViews / t.sessions).toFixed(1) : "—"} />
        <StatTile label="Left after one page" value={bounceRate == null ? "—" : `${bounceRate}%`} note={bounceRate == null ? noBehaviour : `${n(b.bounces ?? 0)} of ${n(b.sessionsStarted ?? 0)} visits`} />
        <StatTile label="Typical time on a page" value={formatSeconds(b.medianSeconds)} note={b.medianSeconds == null ? noBehaviour : "the middle visit, not the average"} />
        <StatTile label="First-time visitors" value={newShare == null ? "—" : `${newShare}%`} note={newShare == null ? noBehaviour : "of visits"} />
      </div>

      <TrendChart title="Visitors per day" kind="count" data={data.series.map((s) => ({ date: s.date, value: s.visitors }))} />

      {data.sites.length > 1 && (
        <Panel title="Websites" note="Click a website to see it on its own. Visitors are counted once per site, so the rows do not add up to the total.">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Website</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Visitors</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Pages viewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.sites.map((s) => (
                  <TableRow key={s.host} className="cursor-pointer" onClick={() => onSite(s.host)} data-testid="web-site-row">
                    <TableCell className="font-medium whitespace-nowrap">
                      <button type="button" className="hover:underline text-left min-h-[44px] md:min-h-0" onClick={(e) => { e.stopPropagation(); onSite(s.host); }}>
                        {s.host}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{s.workspace ? workspaceName(s.workspace) : "Not listed"}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(s.visitors)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{n(s.visitorsPrevious)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(s.sessions)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(s.pageViews)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {data.untrackedSites.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              No visits recorded on {data.untrackedSites.map((u) => u.host).join(", ")}. The ClubOS tracker is not on {data.untrackedSites.length === 1 ? "that site" : "those sites"} yet.
            </p>
          )}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where visitors came from">
          <BarList kind="count" items={data.channels.map((c) => ({ key: c.key, label: c.label, value: c.visitors }))} />
        </Panel>
        <Panel title="Devices">
          <BarList kind="count" items={data.devices.map((d) => ({ key: d.key, label: DEVICE[d.key] ?? d.key, value: d.visitors }))} />
        </Panel>
      </div>

      <Panel title="Most viewed pages" note="Time and scroll show on pages of the booking and checkout sites, which record them.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Visitors</TableHead>
                <TableHead className="text-right whitespace-nowrap">Typical time</TableHead>
                <TableHead className="text-right whitespace-nowrap">Scrolled</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pages.map((p) => (
                <TableRow key={`${p.host}|${p.path}`} data-testid="web-page-row">
                  <TableCell className="max-w-[420px]"><span className="block truncate" title={`${p.host}${p.path}`}>{pageLabel(p)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{n(p.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(p.visitors)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatSeconds(p.medianSeconds)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.avgScrollPercent == null ? "—" : `${Math.round(p.avgScrollPercent)}%`}</TableCell>
                  <TableCell className="text-right">
                    <a href={`https://${p.host}${p.path}`} target="_blank" rel="noreferrer" aria-label={`Open ${p.host}${p.path}`} className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 text-muted-foreground hover:text-foreground">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Other websites that sent visitors">
          {data.referrers.length ? (
            <BarList kind="count" items={data.referrers.slice(0, 12).map((r) => ({ key: r.host, label: r.host, value: r.visitors }))} />
          ) : (
            <Empty>No other website sent visitors in this period.</Empty>
          )}
        </Panel>
        <Panel title="Campaigns" note="Visitors who arrived on a tagged link (an ad, an email, a QR code).">
          {data.campaigns.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead className="text-right">Visitors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.campaigns.slice(0, 12).map((c) => (
                    <TableRow key={`${c.source}|${c.medium}|${c.campaign}`}>
                      <TableCell className="max-w-[240px]"><span className="block truncate" title={c.campaign ?? ""}>{c.campaign ?? "No campaign name"}</span></TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{c.source}{c.medium ? ` · ${c.medium}` : ""}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(c.visitors)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty>No visitor arrived on a tagged link in this period.</Empty>
          )}
        </Panel>
        <Panel title="Where visits started" note="The first page of a visit.">
          {data.entryPages.length ? (
            <BarList kind="count" items={data.entryPages.slice(0, 10).map((e) => ({ key: `${e.host}|${e.path}`, label: pageLabel(e), value: e.sessions }))} />
          ) : (
            <Empty>{noBehaviour}.</Empty>
          )}
        </Panel>
        <Panel title="Buttons pressed" note="By the words on the button.">
          {data.buttons.length ? (
            <BarList kind="count" items={data.buttons.slice(0, 10).map((x) => ({ key: x.text, label: x.text, value: x.clicks }))} />
          ) : (
            <Empty>{noBehaviour}.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
