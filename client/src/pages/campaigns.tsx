// ─────────────────────────────────────────────────────────────────────────────
// Campaigns — every campaign and where it stands against its goal.
// United Sports Group → Marketing → Campaigns.
//
// Daniel, 2026-11-10: "In the overview, I can see all different campaigns that
// are currently active. Then I can click into them."
//
// The numbers on each card are read live from ClubOS sales; nothing is typed in
// unless a campaign has nothing linked to it. Filters live in the URL.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { CampaignDialog, GoalBar, dayRange, dollars, niceDay, num } from "@/components/campaigns/parts";
import { CAMPAIGN_STATUS_LABEL, daysBetween, paceOf, type CampaignListItem } from "@shared/campaigns";
import { SOCIAL_BRANDS, socialBrand } from "@shared/social";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "planning", label: "Planning" },
  { key: "done", label: "Finished" },
  { key: "all", label: "All" },
  { key: "archived", label: "Archived" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const STATUS_TONE: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800",
  planning: "bg-blue-100 text-blue-800",
  paused: "bg-amber-100 text-amber-900",
  done: "bg-muted text-muted-foreground",
};

export default function Campaigns() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);

  const { filter, brand } = useMemo(() => {
    const p = new URLSearchParams(search);
    const filter = (FILTERS.find((f) => f.key === p.get("show"))?.key ?? "active") as FilterKey;
    return { filter, brand: p.get("brand") || "all" };
  }, [search]);
  const write = (next: { filter?: FilterKey; brand?: string }) => {
    const p = new URLSearchParams();
    const f = next.filter ?? filter;
    const b = next.brand ?? brand;
    if (f !== "active") p.set("show", f);
    if (b !== "all") p.set("brand", b);
    const qs = p.toString();
    navigate(`/admin/campaigns${qs ? `?${qs}` : ""}`, { replace: true });
  };

  const { data, isLoading, isError, error, refetch } = useQuery<{ today: string; campaigns: CampaignListItem[] }>({
    queryKey: [`/api/admin/campaigns${filter === "archived" ? "?archived=1" : ""}`],
    staleTime: 30_000,
  });

  const shown = (data?.campaigns ?? []).filter((c) => {
    if (brand !== "all" && c.brand !== brand) return false;
    if (filter === "active") return c.status === "live" || c.status === "paused";
    if (filter === "planning") return c.status === "planning";
    if (filter === "done") return c.status === "done";
    return true;
  });
  const counts = (key: FilterKey) =>
    (data?.campaigns ?? []).filter((c) => (key === "active" ? c.status === "live" || c.status === "paused" : key === "planning" ? c.status === "planning" : key === "done" ? c.status === "done" : true)).length;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Set a goal, plan the work, and watch the bookings come in against it.</p>
        </div>
        <Button className="h-11 md:h-9" onClick={() => setCreating(true)} data-testid="campaign-new">
          <Plus className="w-4 h-4 mr-1.5" aria-hidden />
          New campaign
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="overflow-x-auto max-w-full">
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 whitespace-nowrap">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => write({ filter: f.key })}
                aria-pressed={filter === f.key}
                className={cn(
                  "px-3 h-11 md:h-9 rounded-md text-[13px] font-medium transition-colors",
                  filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                {f.label}
                {data && f.key !== "archived" && filter !== "archived" && <span className="ml-1.5 opacity-70 tabular-nums">{counts(f.key)}</span>}
              </button>
            ))}
          </div>
        </div>
        <Select value={brand} onValueChange={(v) => write({ brand: v })}>
          <SelectTrigger className="h-11 md:h-9 w-full sm:w-[230px]" aria-label="Brand"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every brand</SelectItem>
            {SOCIAL_BRANDS.map((b) => <SelectItem key={b.key} value={b.key}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Loading rows={3} />
      ) : isError ? (
        <LoadError error={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center space-y-3" data-testid="campaigns-empty">
          <p className="text-sm font-medium text-foreground">
            {(data?.campaigns ?? []).length === 0 && filter !== "archived" ? "No campaigns yet" : "No campaign matches"}
          </p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {(data?.campaigns ?? []).length === 0 && filter !== "archived"
              ? "Create one for whatever you are selling next. Pick the camp or programme, set a goal, and ClubOS counts the bookings against it from then on."
              : "Try another filter."}
          </p>
          {(data?.campaigns ?? []).length === 0 && filter !== "archived" && (
            <Button className="h-11 md:h-9" onClick={() => setCreating(true)}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden />
              New campaign
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((c) => (
            <CampaignCard key={c.id} c={c} today={data!.today} />
          ))}
        </div>
      )}

      <CampaignDialog open={creating} onClose={() => setCreating(false)} campaign={null} onSaved={(id) => navigate(`/admin/campaigns/${id}?from=${encodeURIComponent("/admin/campaigns")}`)} />
    </div>
  );
}

function CampaignCard({ c, today }: { c: CampaignListItem; today: string }) {
  const daily = c.result.daily;
  const signupPace = paceOf({ goal: c.goalSignups, actual: c.result.signups ?? 0, startsOn: c.startsOn, endsOn: c.endsOn, today, daily: daily.map((d) => ({ day: d.day, value: d.signups })) });
  const revenuePace = paceOf({ goal: c.goalRevenueCents, actual: c.result.revenueCents ?? 0, startsOn: c.startsOn, endsOn: c.endsOn, today, daily: daily.map((d) => ({ day: d.day, value: d.revenueCents })) });
  const toEvent = c.eventStartsOn ? daysBetween(today, c.eventStartsOn) : null;
  const sellingLeft = c.endsOn ? daysBetween(today, c.endsOn) + 1 : null;
  const when =
    toEvent != null && toEvent > 0 ? `${toEvent} day${toEvent === 1 ? "" : "s"} to go`
    : toEvent === 0 ? "Starts today"
    : sellingLeft != null && sellingLeft > 0 ? `${sellingLeft} selling day${sellingLeft === 1 ? "" : "s"} left`
    : c.eventStartsOn || c.endsOn ? "Finished" : null;
  const costPer = c.spendCents > 0 && (c.result.signups ?? 0) > 0 ? Math.round(c.spendCents / (c.result.signups ?? 1)) : null;

  return (
    <Link
      href={`/admin/campaigns/${c.id}?from=${encodeURIComponent("/admin/campaigns")}`}
      className="block rounded-xl border border-border bg-card p-4 md:p-5 hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors min-w-0"
      data-testid="campaign-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground break-words">{c.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {[socialBrand(c.brand)?.name, c.eventStartsOn ? dayRange(c.eventStartsOn, c.eventEndsOn) : c.startsOn || c.endsOn ? `Selling ${dayRange(c.startsOn, c.endsOn)}` : null, c.ownerName].filter(Boolean).join(" · ") || "No dates set"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", STATUS_TONE[c.status])}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
          {when && <span className="text-xs text-muted-foreground whitespace-nowrap">{when}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <GoalBar label="Sign-ups" actual={c.result.signups} goal={c.goalSignups} format={num} pace={signupPace} />
        <GoalBar label="Revenue" actual={c.result.revenueCents} goal={c.goalRevenueCents} format={dollars} pace={revenuePace} />
      </div>
      {!c.result.live && c.result.signups == null && (
        <p className="text-xs text-muted-foreground mt-2">Nothing linked yet. Pick what is being sold and the numbers fill in on their own.</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
        <span>Spent <span className="text-foreground tabular-nums">{c.spendCents > 0 || c.budgetCents != null ? dollars(c.spendCents) : "—"}</span>{c.budgetCents != null ? ` of ${dollars(c.budgetCents)}` : ""}</span>
        {costPer != null && <span><span className="text-foreground tabular-nums">{dollars(costPer)}</span> a sign-up</span>}
        <span>{c.channels ? `${c.channelsLive} of ${c.channels} channel${c.channels === 1 ? "" : "s"} live` : "No channels yet"}</span>
        {c.tasksOverdue > 0 ? (
          <span className="text-destructive font-medium">{c.tasksOverdue} task{c.tasksOverdue === 1 ? "" : "s"} overdue</span>
        ) : c.nextTask ? (
          <span className="inline-flex items-center gap-1 min-w-0">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate">Next: {c.nextTask.title} ({niceDay(c.nextTask.dueOn, false)})</span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}
