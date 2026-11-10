// ─────────────────────────────────────────────────────────────────────────────
// One campaign: its goal against real sales, the work-back timeline, each
// channel with its own numbers, and the split tests.
// United Sports Group → Marketing → Campaigns → a campaign.
//
// Daniel, 2026-11-10: "set the targets … see that updating and tracking live …
// map out the tasks and the timeline … add channels … track the conversions …
// can we track the sales we get organically … an A/B split test."
//
// The open section lives in the URL (?tab=), and Back goes where the person
// came from (?from=), falling back to the campaign list.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Circle, Pencil, Plus, Trophy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarList } from "@/components/marketing-hub/bar-list";
import { Loading, LoadError } from "@/components/marketing-hub/section-state";
import { StatTile } from "@/components/marketing-hub/stat-tile";
import { TrendChart } from "@/components/marketing-hub/trend-chart";
import {
  CampaignDialog,
  ChannelDialog,
  GoalBar,
  TaskDialog,
  TestDialog,
  dayRange,
  dollars,
  errorText,
  niceDay,
  num,
  refreshCampaigns,
} from "@/components/campaigns/parts";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  CAMPAIGN_STATUS_LABEL,
  CHANNEL_STATUS_LABEL,
  TASK_KIND_LABEL,
  TEST_STATUS_LABEL,
  addDays,
  channelKind,
  daysBetween,
  paceOf,
  testVerdict,
  type CampaignDetail,
  type ChannelRow,
  type Pace,
  type TaskRow,
  type TestRow,
} from "@shared/campaigns";
import { socialBrand } from "@shared/social";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "timeline", label: "Timeline" },
  { key: "channels", label: "Channels" },
  { key: "tests", label: "Split tests" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TONE: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-800",
  running: "bg-emerald-100 text-emerald-800",
  planning: "bg-blue-100 text-blue-800",
  planned: "bg-blue-100 text-blue-800",
  paused: "bg-amber-100 text-amber-900",
  done: "bg-muted text-muted-foreground",
  dropped: "bg-muted text-muted-foreground",
};
const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", TONE[tone] ?? "bg-muted text-muted-foreground")}>{children}</span>
);

function paceSentence(p: Pace, unit: (v: number) => string): string | null {
  if (p.state === "none") return null;
  if (p.state === "reached") return "The goal has been reached.";
  if (p.state === "not_started") return "Selling has not started yet.";
  if (p.state === "missed") return `Selling has finished, ${unit(p.remaining ?? 0)} short of the goal.`;
  const need = p.neededPerDay ?? 0;
  const recent = p.recentPerDay ?? 0;
  return `${unit(p.remaining ?? 0)} to go in ${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"}: that needs ${unit(need)} a day. The last week brought ${unit(recent)} a day.`;
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [channelForm, setChannelForm] = useState<{ channel: ChannelRow | null } | null>(null);
  const [taskForm, setTaskForm] = useState<{ task: TaskRow | null } | null>(null);
  const [testForm, setTestForm] = useState<{ test: TestRow | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const { tab, from } = useMemo(() => {
    const p = new URLSearchParams(search);
    const tab = (TABS.find((t) => t.key === p.get("tab"))?.key ?? "overview") as TabKey;
    const raw = p.get("from");
    // Only an in-app path is honoured as a way back.
    const from = raw && raw.startsWith("/admin/") ? raw : "/admin/campaigns";
    return { tab, from };
  }, [search]);
  const setTab = (next: TabKey) => {
    const p = new URLSearchParams(search);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    const qs = p.toString();
    navigate(`/admin/campaigns/${params.id}${qs ? `?${qs}` : ""}`, { replace: true });
  };

  const url = `/api/admin/campaigns/${params.id}`;
  const { data, isLoading, isError, error, refetch } = useQuery<CampaignDetail>({ queryKey: [url], staleTime: 30_000 });

  const toggleTask = useMutation({
    mutationFn: async (t: TaskRow) => {
      await apiRequest("PATCH", `${url}/tasks/${t.id}`, { done: !t.doneAt });
    },
    onSettled: () => refreshCampaigns(),
  });
  const suggest = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${url}/suggest-timeline`)).json() as Promise<{ added: number; skipped: number }>,
    onSuccess: async (r) => {
      setNotice(r.added ? `Added ${r.added} task${r.added === 1 ? "" : "s"}. Change any of them to suit.` : "Nothing to add: every suggested date has already passed, or the tasks are already here.");
      await refreshCampaigns();
    },
    onError: (e) => setNotice(errorText(e)),
  });
  const setStatus = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      await apiRequest("PATCH", url, body);
    },
    onSuccess: async (_r, body) => {
      await refreshCampaigns();
      if (body.archived === true) navigate("/admin/campaigns");
    },
  });

  const backLabel = from.startsWith("/admin/campaigns") ? "Campaigns" : from.startsWith("/admin/marketing-hub") ? "Marketing" : "Back";

  if (isLoading) return <div className="p-4 md:p-6 max-w-7xl mx-auto"><Loading rows={5} /></div>;
  if (isError || !data) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <Link href="/admin/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px] md:min-h-0"><ArrowLeft className="w-4 h-4" />Campaigns</Link>
        <LoadError error={error} onRetry={refetch} />
      </div>
    );
  }

  const c = data.campaign;
  const r = data.result;
  const today = data.today;
  const signupPace = paceOf({ goal: c.goalSignups, actual: r.signups ?? 0, startsOn: c.startsOn, endsOn: c.endsOn, today, daily: r.daily.map((d) => ({ day: d.day, value: d.signups })) });
  const revenuePace = paceOf({ goal: c.goalRevenueCents, actual: r.revenueCents ?? 0, startsOn: c.startsOn, endsOn: c.endsOn, today, daily: r.daily.map((d) => ({ day: d.day, value: d.revenueCents })) });
  const openTasks = data.tasks.filter((t) => !t.doneAt);
  const overdue = openTasks.filter((t) => t.dueOn && t.dueOn < today);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5 min-w-0">
      <Link href={from} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground min-h-[44px] md:min-h-0" data-testid="campaign-back">
        <ArrowLeft className="w-4 h-4" aria-hidden />
        {backLabel}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground break-words" data-testid="campaign-title">{c.name}</h1>
            <Pill tone={c.status}>{CAMPAIGN_STATUS_LABEL[c.status]}</Pill>
            {c.archived && <Pill tone="done">Archived</Pill>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {[
              socialBrand(c.brand)?.name,
              c.eventStartsOn ? `On ${dayRange(c.eventStartsOn, c.eventEndsOn)}` : null,
              c.startsOn || c.endsOn ? `Selling ${dayRange(c.startsOn, c.endsOn)}` : null,
              c.ownerName ? `Run by ${c.ownerName}` : null,
            ].filter(Boolean).join(" · ") || "No dates set yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {c.status === "planning" && (
            <Button variant="outline" className="h-11 md:h-9" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "live" })}>Mark as live</Button>
          )}
          {c.status === "live" && (
            <Button variant="outline" className="h-11 md:h-9" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "done" })}>Mark as finished</Button>
          )}
          <Button className="h-11 md:h-9" onClick={() => setEditing(true)} data-testid="campaign-edit">
            <Pencil className="w-4 h-4 mr-1.5" aria-hidden />
            Edit
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 whitespace-nowrap">
          {TABS.map((t) => {
            const count = t.key === "timeline" ? openTasks.length : t.key === "channels" ? data.channels.length : t.key === "tests" ? data.tests.length : null;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                data-testid={`campaign-tab-${t.key}`}
                className={cn("px-3 h-11 md:h-9 rounded-md text-[13px] font-medium transition-colors", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted")}
              >
                {t.label}
                {count ? <span className="ml-1.5 opacity-70 tabular-nums">{count}</span> : null}
                {t.key === "timeline" && overdue.length > 0 && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-destructive align-middle" title={`${overdue.length} overdue`} />}
              </button>
            );
          })}
        </div>
      </div>

      {notice && (
        <p role="status" className="text-sm text-foreground rounded-lg border border-border bg-muted/40 px-3 py-2 flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button type="button" className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardContent className="pt-5 space-y-2">
              <GoalBar label="Sign-ups" actual={r.signups} goal={c.goalSignups} format={num} pace={signupPace} />
              {paceSentence(signupPace, (v) => (v >= 10 || Number.isInteger(v) ? num(Math.round(v)) : v.toFixed(1))) && (
                <p className="text-xs text-muted-foreground">{paceSentence(signupPace, (v) => (v >= 10 || Number.isInteger(v) ? num(Math.round(v)) : v.toFixed(1)))}</p>
              )}
            </CardContent></Card>
            <Card><CardContent className="pt-5 space-y-2">
              <GoalBar label="Revenue" actual={r.revenueCents} goal={c.goalRevenueCents} format={dollars} pace={revenuePace} />
              {paceSentence(revenuePace, (v) => dollars(Math.round(v))) && <p className="text-xs text-muted-foreground">{paceSentence(revenuePace, (v) => dollars(Math.round(v)))}</p>}
              {r.refundedCents > 0 && <p className="text-xs text-muted-foreground">After {dollars(r.refundedCents)} refunded.</p>}
            </CardContent></Card>
          </div>

          {!r.live && (
            <p className="text-sm text-muted-foreground rounded-xl border border-dashed border-border p-4">
              {c.manualSignups != null || c.manualRevenueCents != null
                ? "These numbers were typed in. Link what ClubOS is selling (Edit → What is being sold) and they update on their own."
                : "Nothing is linked yet, so there is nothing to count. Press Edit and pick what is being sold."}
            </p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Spent" value={data.spendCents > 0 || c.budgetCents != null ? dollars(data.spendCents) : "—"} note={c.budgetCents != null ? `of ${dollars(c.budgetCents)} budget` : data.spendCents > 0 ? "no budget set" : "No spend linked yet"} />
            <StatTile label="Cost per sign-up" value={data.spendCents > 0 && (r.signups ?? 0) > 0 ? dollars(Math.round(data.spendCents / (r.signups ?? 1))) : "—"} note="All spend ÷ all sign-ups" />
            <StatTile
              label={c.eventStartsOn && c.eventStartsOn >= today ? "Days to go" : "Selling days left"}
              value={c.eventStartsOn && c.eventStartsOn >= today ? num(daysBetween(today, c.eventStartsOn)) : c.endsOn && c.endsOn >= today ? num(daysBetween(today, c.endsOn) + 1) : "—"}
              note={c.eventStartsOn ? `Starts ${niceDay(c.eventStartsOn)}` : c.endsOn ? `Ends ${niceDay(c.endsOn)}` : "No dates set"}
            />
            <StatTile label="Tasks to do" value={num(openTasks.length)} note={overdue.length ? `${overdue.length} overdue` : openTasks.length ? "none overdue" : "nothing open"} />
          </div>

          {r.live && r.daily.length > 0 && <CumulativeChart data={data} />}

          {r.live && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <h3 className="text-sm font-medium text-foreground">Where the sign-ups came from</h3>
                  <p className="text-xs text-muted-foreground">Read off each booking's own record: the ad or link it arrived on, or the office.</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.sources.length ? (
                    <>
                      <p className="text-sm text-foreground" data-testid="campaign-paid-split">
                        {num(data.sources.filter((s) => s.paid).reduce((a, s) => a + s.signups, 0))} from paid ads, {num(data.sources.filter((s) => !s.paid).reduce((a, s) => a + s.signups, 0))} without.
                      </p>
                      <BarList kind="count" items={data.sources.map((s) => ({ key: s.key, label: `${s.label} · ${dollars(s.revenueCents)}`, value: s.signups }))} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No sign-ups in the selling window yet.</p>
                  )}
                </CardContent>
              </Card>
              <Card className="min-w-0">
                <CardHeader className="pb-2"><h3 className="text-sm font-medium text-foreground">What is being sold</h3></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Programme</TableHead><TableHead className="text-right">Sign-ups</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {data.programmes.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="min-w-0"><span className="block">{p.name}</span>{p.workspace && <span className="text-xs text-muted-foreground">{p.workspace}</span>}</TableCell>
                            <TableCell className="text-right tabular-nums">{num(p.signups)}</TableCell>
                            <TableCell className="text-right tabular-nums">{dollars(p.revenueCents)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {c.summary && (
            <Card><CardHeader className="pb-2"><h3 className="text-sm font-medium text-foreground">Notes</h3></CardHeader><CardContent><p className="text-sm text-foreground whitespace-pre-wrap break-words">{c.summary}</p></CardContent></Card>
          )}

          <div className="pt-2">
            {confirmArchive ? (
              <span className="inline-flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Archive this campaign? It moves out of the list and can be brought back.</span>
                <Button variant="destructive" className="h-11 md:h-9" onClick={() => setStatus.mutate({ archived: true })}>Archive</Button>
                <Button variant="ghost" className="h-11 md:h-9" onClick={() => setConfirmArchive(false)}>Keep</Button>
              </span>
            ) : c.archived ? (
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setStatus.mutate({ archived: false })}>Bring back from the archive</Button>
            ) : (
              <button type="button" className="text-sm text-muted-foreground hover:text-foreground min-h-[44px] md:min-h-0" onClick={() => setConfirmArchive(true)}>Archive this campaign</button>
            )}
          </div>
        </div>
      )}

      {tab === "timeline" && (
        <TimelineView
          data={data}
          onAdd={() => setTaskForm({ task: null })}
          onEdit={(task) => setTaskForm({ task })}
          onToggle={(task) => toggleTask.mutate(task)}
          onSuggest={() => suggest.mutate()}
          suggesting={suggest.isPending}
        />
      )}

      {tab === "channels" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Every way this campaign reaches people, each with the numbers ClubOS can tie to it.</p>
            <Button className="h-11 md:h-9" onClick={() => setChannelForm({ channel: null })} data-testid="channel-add"><Plus className="w-4 h-4 mr-1.5" aria-hidden />Add a channel</Button>
          </div>
          {data.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-8 text-center">
              No channels yet. Add the ads, the emails, an early-bird offer, a shoot day: whatever this campaign is made of.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.channels.map((ch) => <ChannelCard key={ch.id} ch={ch} linked={r.live} onEdit={() => setChannelForm({ channel: ch })} />)}
            </div>
          )}
        </div>
      )}

      {tab === "tests" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Change one thing, run both versions, and see which one books more.</p>
            <Button className="h-11 md:h-9" onClick={() => setTestForm({ test: null })} data-testid="test-add"><Plus className="w-4 h-4 mr-1.5" aria-hidden />New split test</Button>
          </div>
          {data.tests.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-8 text-center">
              No split tests yet. A good first one: two headlines on the landing page, each on its own link.
            </p>
          ) : (
            data.tests.map((t) => <TestCard key={t.id} test={t} onEdit={() => setTestForm({ test: t })} />)
          )}
        </div>
      )}

      <CampaignDialog open={editing} onClose={() => setEditing(false)} campaign={c} onSaved={() => {}} />
      <ChannelDialog open={!!channelForm} onClose={() => setChannelForm(null)} campaignId={c.id} channel={channelForm?.channel ?? null} />
      <TaskDialog open={!!taskForm} onClose={() => setTaskForm(null)} campaignId={c.id} task={taskForm?.task ?? null} channels={data.channels} />
      <TestDialog open={!!testForm} onClose={() => setTestForm(null)} campaignId={c.id} test={testForm?.test ?? null} channels={data.channels} />
    </div>
  );
}

// ── Sign-ups building up, day by day ────────────────────────────────────────

function CumulativeChart({ data }: { data: CampaignDetail }) {
  const { campaign: c, result: r, today } = data;
  const first = c.startsOn ?? r.daily[0].day;
  const last = c.endsOn && c.endsOn < today ? c.endsOn : today;
  const byDay = new Map(r.daily.map((d) => [d.day, d.signups]));
  const points: { date: string; value: number }[] = [];
  let total = 0;
  // Sales before the chart's first day (no start date set) still count in the line.
  for (const d of r.daily) if (d.day < first) total += d.signups;
  for (let day = first, i = 0; day <= last && i < 800; day = addDays(day, 1), i++) {
    total += byDay.get(day) ?? 0;
    points.push({ date: day, value: total });
  }
  if (points.length < 2) return null;
  return <TrendChart title={`Sign-ups so far${c.goalSignups != null ? ` (goal ${num(c.goalSignups)})` : ""}`} kind="count" data={points} />;
}

// ── Timeline ────────────────────────────────────────────────────────────────

function TimelineView({
  data,
  onAdd,
  onEdit,
  onToggle,
  onSuggest,
  suggesting,
}: {
  data: CampaignDetail;
  onAdd: () => void;
  onEdit: (t: TaskRow) => void;
  onToggle: (t: TaskRow) => void;
  onSuggest: () => void;
  suggesting: boolean;
}) {
  const { campaign: c, tasks, channels, today } = data;
  const dated = [c.startsOn, c.endsOn, c.eventStartsOn, c.eventEndsOn, ...tasks.map((t) => t.dueOn), ...channels.flatMap((ch) => [ch.startsOn, ch.endsOn])].filter((d): d is string => !!d);
  const min = dated.length ? addDays(dated.reduce((a, b) => (a < b ? a : b)), -2) : null;
  const max = dated.length ? addDays(dated.reduce((a, b) => (a > b ? a : b)), 2) : null;
  const span = min && max ? Math.max(1, daysBetween(min, max)) : 1;
  const at = (d: string) => `${Math.min(100, Math.max(0, (daysBetween(min!, d) / span) * 100))}%`;
  const width = (a: string, b: string) => `${Math.max(0.8, ((daysBetween(a, b) + 1) / span) * 100)}%`;

  const open = tasks.filter((t) => !t.doneAt);
  const groups: { title: string; tone?: string; rows: TaskRow[] }[] = [
    { title: "Overdue", tone: "text-destructive", rows: open.filter((t) => t.dueOn && t.dueOn < today) },
    { title: "Next 7 days", rows: open.filter((t) => t.dueOn && t.dueOn >= today && t.dueOn <= addDays(today, 7)) },
    { title: "Later", rows: open.filter((t) => t.dueOn && t.dueOn > addDays(today, 7)) },
    { title: "No date yet", rows: open.filter((t) => !t.dueOn) },
    { title: "Done", rows: tasks.filter((t) => t.doneAt) },
  ].filter((g) => g.rows.length);
  const channelName = (id: number | null) => (id == null ? null : channels.find((ch) => ch.id === id)?.name ?? null);

  // Month marks along the strip.
  const months: { day: string; label: string }[] = [];
  if (min && max) {
    let [y, m] = min.split("-").map(Number);
    for (let i = 0; i < 36; i++) {
      m++;
      if (m > 12) { m = 1; y++; }
      const day = `${y}-${String(m).padStart(2, "0")}-01`;
      if (day > max) break;
      months.push({ day, label: niceDay(day, false).replace(/^1 /, "") });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Everything that has to happen, counted back from the day it starts.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 md:h-9" disabled={suggesting} onClick={onSuggest} data-testid="timeline-suggest">
            <Wand2 className="w-4 h-4 mr-1.5" aria-hidden />
            {suggesting ? "Adding…" : "Add a suggested plan"}
          </Button>
          <Button className="h-11 md:h-9" onClick={onAdd} data-testid="task-add"><Plus className="w-4 h-4 mr-1.5" aria-hidden />Add a task</Button>
        </div>
      </div>

      {min && max && (
        <Card className="min-w-0">
          <CardContent className="pt-5">
            <div className="overflow-x-auto">
              <div className="relative min-w-[640px] space-y-2" data-testid="timeline-strip">
                <div className="relative h-5 text-[11px] text-muted-foreground">
                  {months.map((mo) => <span key={mo.day} className="absolute top-0 border-l border-border pl-1" style={{ left: at(mo.day) }}>{mo.label}</span>)}
                </div>
                <Lane label="Selling">
                  {c.startsOn && c.endsOn && <span className="absolute top-1 h-4 rounded bg-primary/25 border border-primary/40" style={{ left: at(c.startsOn), width: width(c.startsOn, c.endsOn) }} title={`Selling ${dayRange(c.startsOn, c.endsOn)}`} />}
                </Lane>
                <Lane label="The event">
                  {c.eventStartsOn && <span className="absolute top-1 h-4 rounded bg-emerald-600" style={{ left: at(c.eventStartsOn), width: width(c.eventStartsOn, c.eventEndsOn ?? c.eventStartsOn) }} title={dayRange(c.eventStartsOn, c.eventEndsOn)} />}
                </Lane>
                {channels.filter((ch) => ch.startsOn).map((ch) => (
                  <Lane key={ch.id} label={ch.name}>
                    <span className={cn("absolute top-1 h-4 rounded border", ch.status === "live" ? "bg-emerald-200 border-emerald-500" : "bg-muted border-border")} style={{ left: at(ch.startsOn!), width: width(ch.startsOn!, ch.endsOn ?? ch.startsOn!) }} title={`${ch.name}: ${dayRange(ch.startsOn, ch.endsOn)}`} />
                  </Lane>
                ))}
                <Lane label="Tasks">
                  {tasks.filter((t) => t.dueOn).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onEdit(t)}
                      title={`${t.title} · ${niceDay(t.dueOn)}`}
                      aria-label={`${t.title}, due ${niceDay(t.dueOn)}`}
                      className={cn("absolute top-1 -ml-2 w-4 h-4 rounded-full border-2 border-background", t.doneAt ? "bg-emerald-600" : t.dueOn! < today ? "bg-destructive" : "bg-primary")}
                      style={{ left: at(t.dueOn!) }}
                    />
                  ))}
                </Lane>
                {today >= min && today <= max && (
                  <span
                    className="pointer-events-none absolute top-5 bottom-0 w-px bg-foreground/50"
                    style={{ left: `calc(120px + (100% - 120px) * ${daysBetween(min, today) / span})` }}
                    title="Today"
                    data-testid="timeline-today"
                  />
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">Dots are tasks: blue to do, red overdue, green done. The line is today.</p>
          </CardContent>
        </Card>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-xl border border-border bg-card p-8 text-center">
          No tasks yet. "Add a suggested plan" drops in a draft counted back from the first day{c.eventStartsOn ? ` (${niceDay(c.eventStartsOn)})` : ""}: shoot, edit, ads live, emails, review. Change or remove any of it.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.title} className="space-y-1.5">
            <h3 className={cn("text-xs font-medium uppercase tracking-wide text-muted-foreground", g.tone)}>{g.title} · {g.rows.length}</h3>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {g.rows.map((t) => (
                <div key={t.id} className="flex items-start gap-2 px-2 py-1.5" data-testid="task-row">
                  <button
                    type="button"
                    onClick={() => onToggle(t)}
                    aria-label={t.doneAt ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                    aria-pressed={!!t.doneAt}
                    className="shrink-0 w-11 h-11 md:w-8 md:h-8 inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                    data-testid="task-toggle"
                  >
                    {t.doneAt ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Circle className="w-5 h-5" />}
                  </button>
                  <button type="button" onClick={() => onEdit(t)} className="flex-1 min-w-0 text-left py-1.5 md:py-1">
                    <span className={cn("block text-sm break-words", t.doneAt ? "text-muted-foreground line-through" : "text-foreground")}>{t.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[
                        t.dueOn ? niceDay(t.dueOn) : null,
                        t.kind !== "task" ? TASK_KIND_LABEL[t.kind] : null,
                        t.ownerName,
                        channelName(t.channelId),
                        t.doneAt ? `done${t.doneByName ? ` by ${t.doneByName}` : ""}` : null,
                      ].filter(Boolean).join(" · ") || "No date"}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Lane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-0">
      <span className="w-[120px] shrink-0 pr-2 text-xs text-muted-foreground truncate" title={label}>{label}</span>
      <div className="relative flex-1 h-6 rounded bg-muted/40">{children}</div>
    </div>
  );
}

// ── Channel ─────────────────────────────────────────────────────────────────

function ChannelCard({ ch, linked, onEdit }: { ch: ChannelRow; linked: boolean; onEdit: () => void }) {
  const s = ch.stats;
  const kind = channelKind(ch.kind);
  const stats: { label: string; value: string }[] = [];
  if (s.spendCents != null) stats.push({ label: s.spendSource === "typed" ? "Spent (typed in)" : "Spent", value: dollars(s.spendCents) });
  if (s.impressions != null) stats.push({ label: "Times shown", value: num(s.impressions) });
  if (s.clicks != null) stats.push({ label: "Link clicks", value: num(s.clicks) });
  if (s.emailsDelivered != null) stats.push({ label: "Delivered", value: num(s.emailsDelivered) });
  if (s.emailsOpened != null) stats.push({ label: "Opened", value: s.emailsDelivered ? `${num(s.emailsOpened)} (${Math.round((s.emailsOpened / s.emailsDelivered) * 100)}%)` : num(s.emailsOpened) });
  if (s.emailsClicked != null) stats.push({ label: "Clicked", value: num(s.emailsClicked) });
  if (s.visitors != null) stats.push({ label: "Visitors", value: num(s.visitors) });
  if (s.signups != null) stats.push({ label: s.platformPurchases != null ? "Sign-ups ClubOS can tie" : "Sign-ups", value: num(s.signups) });
  if (s.platformPurchases != null) stats.push({ label: "Purchases Meta counts", value: num(s.platformPurchases) });
  if (s.revenueCents != null) stats.push({ label: "Revenue", value: dollars(s.revenueCents) });
  if (s.signups && s.spendCents) stats.push({ label: "Cost per sign-up", value: dollars(Math.round(s.spendCents / s.signups)) });
  if (s.discountGivenCents != null) stats.push({ label: "Discount given", value: dollars(s.discountGivenCents) });
  const hasLink = ch.metaCampaignIds.length || ch.emailCampaignIds.length || ch.utmCampaign || ch.discountCode;

  return (
    <Card className="min-w-0" data-testid="channel-card">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground break-words">{ch.name}</h3>
          <p className="text-xs text-muted-foreground">{[kind.label !== ch.name ? kind.label : null, ch.startsOn || ch.endsOn ? dayRange(ch.startsOn, ch.endsOn) : "No dates", ch.budgetCents != null ? `${dollars(ch.budgetCents)} budget` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Pill tone={ch.status}>{CHANNEL_STATUS_LABEL[ch.status]}</Pill>
          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" onClick={onEdit} aria-label={`Edit ${ch.name}`}><Pencil className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats.length ? (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
            {stats.map((x) => (
              <div key={x.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{x.label}</dt>
                <dd className="text-base font-semibold tabular-nums text-foreground">{x.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {hasLink && !linked ? "Linked. Sign-ups show once the campaign says what is being sold." : "Nothing linked yet, so there are no numbers. Edit it to pick the ads, emails, link name or code."}
          </p>
        )}
        {ch.notes && <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{ch.notes}</p>}
      </CardContent>
    </Card>
  );
}

// ── Split test ──────────────────────────────────────────────────────────────

function TestCard({ test, onEdit }: { test: TestRow; onEdit: () => void }) {
  const verdict = testVerdict(test.variants.map((v) => ({ id: v.id, label: v.label, visitors: v.visitors, conversions: v.conversions })));
  const winner = test.variants.find((v) => v.id === test.winnerVariantId);
  return (
    <Card className="min-w-0" data-testid="test-card">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground break-words">{test.name}</h3>
          <p className="text-xs text-muted-foreground">{[test.variable ? `Testing: ${test.variable}` : null, test.startsOn || test.endsOn ? dayRange(test.startsOn, test.endsOn) : null].filter(Boolean).join(" · ") || "No dates"}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Pill tone={test.status}>{TEST_STATUS_LABEL[test.status]}</Pill>
          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" onClick={onEdit} aria-label={`Edit ${test.name}`}><Pencil className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {test.hypothesis && <p className="text-sm text-muted-foreground">{test.hypothesis}</p>}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[170px]">Version</TableHead>
                <TableHead className="text-right">Visitors</TableHead>
                <TableHead className="text-right">Sign-ups</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {test.variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      {v.label}
                      {test.winnerVariantId === v.id && <Trophy className="w-3.5 h-3.5 text-amber-600" aria-label="Chosen as the winner" />}
                      {verdict.leaderId === v.id && test.winnerVariantId == null && <span className="text-[11px] font-normal text-emerald-700">ahead</span>}
                    </span>
                    {v.description && <span className="block text-xs text-muted-foreground">{v.description}</span>}
                    <span className="block text-[11px] text-muted-foreground">
                      {v.counted === "live" ? `Counted from ${v.utmContent ? `the link tag "${v.utmContent}"` : `the page ${v.landingPath}`}` : v.counted === "typed" ? "Typed in" : "No link or page yet"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num(v.visitors)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(v.conversions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{v.visitors && v.conversions != null ? `${((v.conversions / v.visitors) * 100).toFixed(1)}%` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{dollars(v.revenueCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-foreground" data-testid="test-verdict">{winner ? `Our call: ${winner.label} wins.${test.conclusion ? ` ${test.conclusion}` : ""}` : verdict.sentence}</p>
        {winner && verdict.state !== "leading" && <p className="text-xs text-muted-foreground">The numbers on their own: {verdict.sentence}</p>}
      </CardContent>
    </Card>
  );
}
