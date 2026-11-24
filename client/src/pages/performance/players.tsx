import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { formatMetric, metricByKey } from "@shared/performance";
import { ktwTone, massTone, signed } from "@shared/perf-squad";
import { Pill, AvailBadge, BandPill, DemoBanner, Empty, LevelDot, Loading, LoadError, PageHead, Panel, ScoreFlag, TableWrap, isDemo, td, th, useOverview, niceDay, type BoardPlayer } from "./ui";
import { AppStaffPanel } from "./app-staff";

export const ACCOUNT_WORD: Record<string, string> = { none: "No account", invited: "Invited", active: "Active", disabled: "Disabled" };
export const ACCOUNT_TONE: Record<string, "grey" | "amber" | "green" | "red"> = { none: "grey", invited: "amber", active: "green", disabled: "red" };

// One squad, six ways to look at it: everything in one table, or one focused view per question.
// The view lives in the URL (?view=) so Back and a shared link land on the same view.
const VIEWS = [
  { key: "all", label: "Everything" },
  { key: "readiness", label: "Readiness" },
  { key: "wellness", label: "Check-in" },
  { key: "physical", label: "Physical (GPS)" },
  { key: "body", label: "Weight & knee to wall" },
  { key: "testing", label: "Testing" },
  { key: "availability", label: "Availability" },
  { key: "profile", label: "Profile" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const dash = <span className="text-xs text-muted-foreground">—</span>;
const gps = (p: BoardPlayer, key: string): ReactNode => {
  const g = p.gps[key];
  return g ? <span className="tabular-nums">{formatMetric(g.value, metricByKey(key))}</span> : dash;
};
const gpsDay = (p: BoardPlayer): string | null => Object.values(p.gps).map((g) => g.date).sort().pop() ?? null;

type Col = { head: string; cell: (p: BoardPlayer) => ReactNode };

const readyCol: Col = { head: "Ready?", cell: (p) => (
  <>
    <LevelDot level={p.readiness.level} />
    {p.readiness.reasons.length > 0 && <div className="text-xs text-muted-foreground max-w-[14rem]">{p.readiness.reasons.join(", ")}</div>}
  </>
) };
const availCol: Col = { head: "Availability", cell: (p) => <AvailBadge state={p.availability.state} /> };
const checkCol: Col = { head: "Check-in today", cell: (p) => p.checkIn
  ? (p.checkIn.flag ? <Pill tone={p.checkIn.flag}>{p.checkIn.flag === "red" ? "Concern" : "Take care"}</Pill> : <Pill tone="green">Checked in</Pill>)
  : p.wellness ? <ScoreFlag score={p.wellness.score} flag={p.wellness.flag} /> : <span className="text-xs text-muted-foreground">No check-in</span> };
const load7Col: Col = { head: "Load (7 days)", cell: (p) => (p.load.acute7 != null ? <span className="tabular-nums">{p.load.acute7}</span> : dash) };
const acwrCol: Col = { head: "ACWR", cell: (p) => p.load.acwr != null
  ? <div className="space-y-0.5"><span className="font-medium tabular-nums">{p.load.acwr}</span><div><BandPill band={p.load.band} /></div></div>
  : <span className="text-xs text-muted-foreground">{p.load.acwrNote ?? "—"}</span> };
const rpeCol: Col = { head: "Effort (RPE)", cell: (p) => p.rpe.length
  ? <>{p.rpe.map((r, i) => <div key={i} className="text-xs">{niceDay(r.date)} · <span className="font-medium">{r.rpe}</span>/10{r.minutes ? ` · ${r.minutes} min` : ""}</div>)}</>
  : dash };
const gpsCols: Col[] = [
  { head: "Last GPS session", cell: (p) => { const d = gpsDay(p); return d ? <span className="text-xs">{niceDay(d)}</span> : dash; } },
  { head: "Distance", cell: (p) => gps(p, "total_distance_m") },
  { head: "Sprint distance", cell: (p) => gps(p, "sprint_distance_m") },
  { head: "Top speed", cell: (p) => gps(p, "top_speed_kmh") },
  { head: "m/min", cell: (p) => gps(p, "distance_per_min") },
  { head: "Player Load", cell: (p) => gps(p, "player_load") },
  { head: "Power plays", cell: (p) => gps(p, "power_plays") },
];

const reading = (r: { value: number; date: string } | null, unit: string, today: string): ReactNode => r
  ? <span className="tabular-nums">{r.value} {unit}{r.date !== today && <span className="block text-xs text-muted-foreground">{niceDay(r.date)}</span>}</span> : dash;
const bodyCols = (today: string): Col[] => [
  { head: "Weight before", cell: (p) => reading(p.body.weightPre, "kg", today) },
  { head: "Weight after", cell: (p) => reading(p.body.weightPost, "kg", today) },
  { head: "Change", cell: (p) => p.body.changePct == null ? dash : <Pill tone={massTone(p.body.changePct) === "amber" ? "amber" : "green"}>{signed(p.body.changePct, "%")}</Pill> },
  { head: "Knee to wall L", cell: (p) => reading(p.body.ktwLeft, "cm", today) },
  { head: "Knee to wall R", cell: (p) => reading(p.body.ktwRight, "cm", today) },
  { head: "L − R", cell: (p) => p.body.ktwDiff == null ? dash : <Pill tone={ktwTone(p.body.ktwDiff) === "amber" ? "amber" : "green"}>{signed(p.body.ktwDiff, " cm")}</Pill> },
];
/** One column per test anyone on the squad has a result for; the arrow is against their own last result. */
const testCols = (players: BoardPlayer[]): Col[] => Array.from(new Set(players.flatMap((p) => p.tests.map((t) => t.name)))).sort().map((name) => ({
  head: name.replace(/^ForceDecks |^NordBord · |^ForceFrame · /, ""),
  cell: (p) => {
    const t = p.tests.find((x) => x.name === name);
    if (!t) return dash;
    const d = t.prev == null || t.prev === 0 ? null : Math.round(((t.value - t.prev) / t.prev) * 1000) / 10;
    const good = d == null || d === 0 ? null : (d > 0) === t.higherIsBetter;
    return <span className="tabular-nums whitespace-nowrap">{t.value}{t.unit ? ` ${t.unit}` : ""}{d != null && d !== 0 && <span className={`ml-1 text-xs ${good ? "text-emerald-700" : "text-red-700"}`}>{d > 0 ? "▲" : "▼"} {Math.abs(d)}%</span>}</span>;
  },
}));
const reportCol: Col = { head: "Reported", cell: (p) => p.checkIn?.report.length ? <span className="text-xs">{p.checkIn.report.join(" · ")}</span> : dash };

const COLS: Record<Exclude<View, "body" | "testing">, Col[]> = {
  all: [readyCol, availCol, checkCol, rpeCol, load7Col, acwrCol, gpsCols[1], gpsCols[2], gpsCols[3], gpsCols[5]],
  readiness: [
    readyCol,
    { head: "Built from", cell: (p) => (p.readiness.used.length ? <span className="text-xs">{p.readiness.used.join(", ")}</span> : dash) },
    { head: "No data for", cell: (p) => (p.readiness.missing.length ? <span className="text-xs text-muted-foreground">{p.readiness.missing.join(", ")}</span> : <span className="text-xs">Nothing missing</span>) },
    availCol, checkCol, acwrCol,
  ],
  wellness: [
    checkCol, reportCol,
    { head: "Answers", cell: (p) => p.checkIn
      ? <div className="text-xs text-muted-foreground max-w-[26rem]">{p.checkIn.summary.map((x) => `${x.label} ${x.text}`).join(" · ")}</div>
      : dash },
    { head: "Flagged because", cell: (p) => (p.checkIn?.reasons.length ? <span className="text-xs">{p.checkIn.reasons.join(", ")}</span> : dash) },
    { head: "Entered by", cell: (p) => (p.checkIn ? <span className="text-xs">{p.checkIn.byAthlete ? "Player" : "Staff"}</span> : dash) },
    rpeCol,
  ],
  physical: [...gpsCols, { head: "Max accel", cell: (p) => gps(p, "max_acceleration") }, { head: "Max decel", cell: (p) => gps(p, "max_deceleration") }, rpeCol, load7Col, acwrCol],
  availability: [
    availCol,
    { head: "Since", cell: (p) => (p.availability.since ? <span className="text-xs">{niceDay(p.availability.since, true)}</span> : dash) },
    { head: "Expected back", cell: (p) => (p.availability.expectedReturn ? <span className="text-xs">{niceDay(p.availability.expectedReturn, true)}</span> : dash) },
    { head: "Body area", cell: (p) => (p.availability.bodyArea ? <span className="text-xs">{p.availability.bodyArea}</span> : dash) },
  ],
  profile: [
    { head: "Squad", cell: (p) => p.squad },
    { head: "Position", cell: (p) => p.position ?? dash },
    { head: "#", cell: (p) => (p.squadNumber != null ? p.squadNumber : dash) },
    { head: "Check-in app", cell: (p) => <Pill tone={ACCOUNT_TONE[p.account]}>{ACCOUNT_WORD[p.account]}</Pill> },
    { head: "Last sign-in", cell: (p) => (p.lastSignIn ? <span className="text-xs text-muted-foreground">{niceDay(p.lastSignIn.slice(0, 10), true)}</span> : dash) },
  ],
};

const readView = (): View => {
  const v = new URLSearchParams(window.location.search).get("view");
  return (VIEWS.find((x) => x.key === v)?.key ?? "all") as View;
};

export default function Players() {
  const q = useOverview();
  const [, navigate] = useLocation();
  const [view, setViewState] = useState<View>(readView);
  const [find, setFind] = useState("");
  useEffect(() => {
    const onPop = () => setViewState(readView());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    const u = new URL(window.location.href);
    if (v === "all") u.searchParams.delete("view"); else u.searchParams.set("view", v);
    window.history.replaceState(null, "", u.pathname + u.search);
  };

  const d = q.data;
  const cols = view === "body" ? bodyCols(d?.today ?? "") : view === "testing" ? testCols(d?.players ?? []) : COLS[view];
  const demo = isDemo();
  const toDemo = () => { const u = new URL(window.location.href); u.searchParams.set("demo", "1"); window.location.assign(u.pathname + u.search); };
  const here = `/admin/performance/players${view === "all" ? "" : `?view=${view}`}`;
  const players = d ? d.players.filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase())) : [];
  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Players" blurb="The South Island United squad. See everything in one table, or pick one view. Open a player for their own page."
        right={demo ? undefined : <button type="button" onClick={toDemo} className="h-11 md:h-9 px-3 rounded-md border border-border text-sm hover:bg-muted" data-testid="perf-demo-on">See it with demo data</button>} />
      <DemoBanner />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (d.players.length === 0 ? (
        <Empty>No players on the squad yet. Add players to a South Island United squad in the Squads tab.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1" role="tablist" data-testid="perf-players-views">
              {VIEWS.map((v) => (
                <button key={v.key} type="button" role="tab" aria-selected={view === v.key} data-testid={`perf-view-${v.key}`}
                  onClick={() => setView(v.key)}
                  className={`h-11 md:h-9 px-3 rounded-md text-sm ${view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a player" aria-label="Find a player"
              className="h-11 md:h-9 w-full md:w-56 rounded-md border border-border bg-background px-3 text-sm" />
            <span className="text-xs text-muted-foreground">{players.length} of {d.players.length} players · {niceDay(d.today, true)}</span>
          </div>
          <Panel>
            <TableWrap>
              <table className="w-full" data-testid="perf-players">
                <thead><tr>{["Player", ...cols.map((c) => c.head)].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.contactId} className={demo ? "" : "cursor-pointer hover:bg-muted/50"} onClick={() => { if (!demo) navigate(`/admin/performance/players/${p.contactId}?from=${encodeURIComponent(here)}`); }}>
                      <td className={td}>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{[p.position, p.squadNumber != null ? `#${p.squadNumber}` : null].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      {cols.map((c) => <td key={c.head} className={td}>{c.cell(p)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
          {view === "physical" && <p className="text-xs text-muted-foreground">GPS figures are each player's most recent Catapult session. A dash means the pod recorded nothing for that measure.</p>}
          {view === "body" && <p className="text-xs text-muted-foreground">Players type these into the app each training day. Change is weight after against weight before on the same day; amber at 2% or more lost. Knee to wall is amber when left and right are 2 cm or more apart. Both lines are starting points for the performance staff to set.</p>}
          {view === "testing" && cols.length === 0 && <Empty>No test results yet. Add them in Testing.</Empty>}
          {view === "testing" && cols.length > 0 && <p className="text-xs text-muted-foreground">Each player's latest result per test. The arrow compares it with their own result before that.</p>}
          {view === "profile" && !demo && <AppStaffPanel />}
        </>
      ))}
    </div>
  );
}
