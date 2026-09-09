// ─────────────────────────────────────────────────────────────────────────────
// The dashboard, for every workspace.
//
// Daniel, 2026-09-10, of the Christchurch United one: "this dashboard is good
// but let's now roll out this new simple design for dashboard across other
// workspaces." So it is one component rather than a copy per workspace — a
// heading, a period picker, and one card per number that workspace actually
// has.
//
// 🔴 The list of cards comes from the SERVER, not from the page. Each dashboard
// used to hardcode its own tiles, which is how Mini Football ended up with four
// counters nobody read and the Cup with none at all. The registry in
// shared/dashboard.ts decides what a workspace charts; this asks it. Adding a
// number to a workspace is a registry entry and no page change.
//
// 🔴 A workspace that charts nothing says so. It must never fall back to a
// zero: six of the nine have no `programs` row, and the Cup's team entries all
// carry paid_amount_cents = 0, so "$0.00" would state in a club's own dashboard
// that it earned nothing rather than that we are not measuring it.
//
// The period lives in the URL (?period=30d, or ?period=custom&from=&to=), so a
// dashboard someone is looking at can be sent to someone else.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { RevenueWidget } from "@/components/dashboard/revenue-widget";
import {
  DASHBOARD_PERIODS,
  resolvePeriod,
  type DashboardPeriod,
  type DateRange,
  type MetricKind,
} from "@shared/dashboard";

type MetricCard = { key: string; kind: MetricKind; title: string; label: string };

export function MetricDashboard({
  title = "Dashboard",
  subtitle,
  basePath = "/admin",
  view = null,
}: {
  title?: string;
  /** Usually the workspace name — says WHOSE numbers these are. */
  subtitle?: string;
  /** Where the period picker writes the query string back to. */
  basePath?: string;
  /** Sub-view inside a workspace — the Cup's Youth / 7's / Ethnic toggle. */
  view?: string | null;
}) {
  const search = useSearch();
  const [, navigate] = useLocation();

  const { period, custom } = useMemo(() => {
    const p = new URLSearchParams(search);
    const raw = p.get("period") ?? "30d";
    const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(raw)
      ? (raw as DashboardPeriod)
      : "30d";
    // Fall back to the resolved 30-day window so the custom inputs open on a
    // sensible range rather than empty boxes.
    const fallback = resolvePeriod("30d");
    const custom: DateRange = {
      from: p.get("from") || fallback.from,
      to: p.get("to") || fallback.to,
    };
    return { period, custom };
  }, [search]);

  const onChange = useCallback(
    (next: DashboardPeriod, nextCustom?: DateRange) => {
      const p = new URLSearchParams();
      p.set("period", next);
      if (next === "custom") {
        const r = nextCustom ?? custom;
        p.set("from", r.from);
        p.set("to", r.to);
      }
      navigate(`${basePath}?${p.toString()}`, { replace: true });
    },
    [navigate, custom, basePath],
  );

  const metricsUrl = `/api/admin/dashboard/metrics${view ? `?view=${encodeURIComponent(view)}` : ""}`;
  const { data, isLoading } = useQuery<{ metrics: MetricCard[] }>({
    queryKey: [metricsUrl],
    staleTime: 5 * 60_000, // the registry does not change between page views
  });
  const metrics = data?.metrics ?? [];

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight text-foreground"
            data-testid="text-page-title"
          >
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle ?? "Loading…"}</p>
        </div>
        <PeriodPicker period={period} custom={custom} onChange={onChange} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading ? (
          <Card>
            <CardContent className="py-10">
              <Skeleton className="h-6 w-40 mb-4" />
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        ) : metrics.length === 0 ? (
          // Not "$0.00". This workspace has nothing wired up, and saying so is
          // the whole point — see the note at the top of this file.
          <Card>
            <CardContent className="py-12 text-center">
              <BarChart3 className="w-7 h-7 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Nothing charted here yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                This workspace has no number wired into ClubOS. That is not the same as zero —
                the work may be real and simply recorded somewhere else.
              </p>
            </CardContent>
          </Card>
        ) : (
          metrics.map((m) => (
            <RevenueWidget
              key={m.key}
              period={period}
              custom={custom}
              metric={m.key}
              view={view}
            />
          ))
        )}
      </div>
    </div>
  );
}
