import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMetric, metricByKey } from "@shared/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AvailBadge, BandPill, Empty, FormError, ItemCell, LevelDot, Loading, LoadError, PageHead, Panel, Pill, ScoreFlag, Spark, Stat,
  TableWrap, td, th, niceDay, send, usePerfQuery, useCatalogue, useSaver, control, type Level, type LoadSummary, type Readiness,
} from "./ui";
import { ACCOUNT_TONE, ACCOUNT_WORD } from "./players";

interface PlayerData {
  today: string; medical: boolean;
  player: { contactId: number; name: string; position: string | null; squadNumber: number | null; squad: string; email: string | null; dob: string | null };
  availability: { state: string; since: string | null; daysLost: number; spells: { id: number; status: string; startedOn: string; endedOn: string | null; expectedReturn: string | null; reason: string | null; bodyArea: string | null; notes?: string | null; hasNotes: boolean; recordedBy: string | null }[] };
  readiness: Readiness;
  wellness: { date: string; score: number | null; flag: "red" | "amber" | null; sleep: number | null; fatigue: number | null; soreness: number | null; stress: number | null; mood: number | null; sleepHours: number | null; soreAreas: string[]; byAthlete: boolean; medicalFlag?: boolean | null; note?: string | null }[];
  rpe: { id: number; date: string; kind: string; rpe: number; minutes: number | null; load: number | null; byAthlete: boolean }[];
  load: { summary: LoadSummary; series: { date: string; load: number | null }[] };
  metrics: Record<string, { date: string; value: number; source: string }[]>;
  tests: { testId: number; name: string; unit: string | null; higherIsBetter: boolean; bandRed: number | null; bandGreen: number | null; value: number; date: string; notes: string | null }[];
  media: { id: number; title: string; url: string; source: string; clip_date: string | null; tags: string[]; start_seconds: number | null; note: string | null }[];
  account: null | { email: string; state: "invited" | "active" | "disabled"; invitedAt: string | null; lastSignIn: string | null };
}

const CATEGORY_LABEL: Record<string, string> = { gps: "GPS", load: "Load", wellness: "Wellness", wearable: "Wearables", testing: "Testing", match: "Match", body: "Body" };
const sourceWord = (s: string) => s.replace(/_/g, " ");

export default function PlayerPage({ contactId }: { contactId: string }) {
  const q = usePerfQuery<PlayerData>("player", `/players/${contactId}`);
  const cat = useCatalogue();
  const search = useSearch();
  const [, navigate] = useLocation();
  const from = new URLSearchParams(search).get("from");
  const backHref = from && from.startsWith("/admin/") ? from : "/admin/performance/players";
  const backLabel = backHref === "/admin/performance" ? "Dashboard" : backHref === "/admin/performance/players" ? "Players" : "Back";
  const [email, setEmail] = useState("");
  const acct = useSaver();

  const d = q.data;
  const back = (
    <button type="button" onClick={() => navigate(backHref)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground h-9" data-testid="perf-back">
      <ArrowLeft className="w-4 h-4" aria-hidden /> {backLabel}
    </button>
  );
  if (q.isLoading) return <div className="space-y-4">{back}<Loading /></div>;
  if (q.isError || !d) return <div className="space-y-4">{back}<LoadError error={q.error} onRetry={() => q.refetch()} /></div>;

  const latestW = d.wellness[0];
  const grouped = new Map<string, string[]>();
  for (const k of Object.keys(d.metrics)) {
    const m = cat.data?.metrics.find((x) => x.key === k) ?? metricByKey(k);
    const c = m?.category ?? "other";
    grouped.set(c, [...(grouped.get(c) ?? []), k]);
  }
  const ls = d.load.summary;
  const trend = [...d.wellness].reverse().filter((w) => w.score != null);
  const days = d.availability.daysLost;

  return (
    <div className="space-y-5 min-w-0">
      {back}
      <PageHead
        title={d.player.name}
        blurb={[d.player.position, d.player.squadNumber != null ? `#${d.player.squadNumber}` : null, d.player.squad].filter(Boolean).join(" · ")}
        right={<div className="flex items-center gap-3"><AvailBadge state={d.availability.state} /><LevelDot level={d.readiness.level as Level} /></div>}
      />
      <div className="text-xs text-muted-foreground -mt-3">
        {d.readiness.reasons.length > 0 && <span>Why: {d.readiness.reasons.join(", ")}. </span>}
        <span>Based on: {d.readiness.used.join(", ") || "nothing yet"}.</span>
        {d.readiness.missing.length > 0 && <span> Not enough data for: {d.readiness.missing.join(", ")}.</span>}
      </div>

      <Panel title="Training load" note="Daily load (effort × minutes), last 6 weeks.">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Stat label="This week" value={ls.acute7 != null ? String(ls.acute7) : "—"} note="acute, 7 days" />
          <Stat label="Normal week" value={ls.chronic28 != null ? String(ls.chronic28) : "—"} note="chronic, 28 days ÷ 4" />
          <Stat label="ACWR" value={ls.acwr != null ? String(ls.acwr) : "—"} note={ls.acwr == null ? ls.acwrNote ?? undefined : undefined} />
          <Stat label="Monotony" value={ls.monotony != null ? String(ls.monotony) : "—"} note="above 2 = no easy days" />
          <Stat label="Strain" value={ls.strain != null ? String(ls.strain) : "—"} />
        </div>
        {ls.band && <div className="mb-3"><BandPill band={ls.band} /></div>}
        {d.load.series.every((s) => s.load == null) ? <Empty>No sessions logged yet. Log effort for a session on the Load &amp; GPS page.</Empty> : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.load.series.map((s) => ({ date: niceDay(s.date), load: s.load ?? 0 }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} width={36} />
                <Tooltip />
                <Bar dataKey="load" name="Load" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="Wellness" note="Daily check-in score out of 25 (higher is better).">
        {d.wellness.length === 0 ? <Empty>No check-ins yet. Invite the player to the check-in app below.</Empty> : (
          <div className="space-y-4">
            {trend.length >= 2 && (
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend.map((w) => ({ date: niceDay(w.date), score: w.score }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 25]} tick={{ fontSize: 10 }} width={28} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" name="Score" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground mb-1">Latest, {niceDay(latestW.date)} · <ScoreFlag score={latestW.score} flag={latestW.flag} /></div>
              <div className="flex flex-wrap gap-3 text-sm">
                {(cat.data?.wellnessItems ?? [{ key: "sleep", label: "Sleep quality" }, { key: "fatigue", label: "Energy" }, { key: "soreness", label: "Muscle soreness" }, { key: "stress", label: "Stress" }, { key: "mood", label: "Mood" }]).map((i) => (
                  <span key={i.key} className="inline-flex items-center gap-1.5">{i.label} <ItemCell v={(latestW as any)[i.key]} /></span>
                ))}
                <span>Sleep <span className="font-medium">{latestW.sleepHours != null ? `${latestW.sleepHours} h` : "—"}</span></span>
              </div>
              {latestW.soreAreas.length > 0 && <div className="text-sm mt-2">Sore: {latestW.soreAreas.join(", ")}</div>}
              {d.medical && latestW.note && <div className="text-sm mt-2 rounded-md bg-muted p-2">Private note: {latestW.note}</div>}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Effort (session RPE)">
        {d.rpe.length === 0 ? <Empty>No effort ratings yet.</Empty> : (
          <TableWrap>
            <table className="w-full"><thead><tr>{["Date", "Session", "Effort", "Minutes", "Load", "By"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{d.rpe.slice(0, 20).map((r) => (
                <tr key={r.id}><td className={td}>{niceDay(r.date)}</td><td className={`${td} capitalize`}>{r.kind}</td><td className={td}>{r.rpe}/10</td>
                  <td className={td}>{r.minutes ?? "—"}</td><td className={`${td} tabular-nums`}>{r.load ?? "—"}</td><td className={`${td} text-xs text-muted-foreground`}>{r.byAthlete ? "Player" : "Staff"}</td></tr>
              ))}</tbody></table>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Measurements" note="Every number any source has sent for this player, latest first.">
        {grouped.size === 0 ? <Empty>No readings from GPS, wearables or imports yet. Use Import data to bring a file in.</Empty> : (
          <div className="space-y-4">
            {Array.from(grouped.entries()).map(([c, keys]) => (
              <div key={c}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{CATEGORY_LABEL[c] ?? c}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {keys.map((k) => {
                    const m = cat.data?.metrics.find((x) => x.key === k) ?? metricByKey(k);
                    const rows = d.metrics[k]; const last = rows[rows.length - 1];
                    return (
                      <div key={k} className="rounded-md border border-border p-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground truncate">{m?.label ?? k}</div>
                          <div className="font-medium tabular-nums">{formatMetric(last.value, m as any)}</div>
                          <div className="text-[11px] text-muted-foreground">{niceDay(last.date)} · <Pill>{sourceWord(last.source)}</Pill></div>
                        </div>
                        <Spark values={rows.slice(-12).map((r) => r.value)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Availability" note={`${days} day${days === 1 ? "" : "s"} out of full training in total.`}>
        {d.availability.spells.length === 0 ? <Empty>No injuries or illness recorded.</Empty> : (
          <TableWrap>
            <table className="w-full"><thead><tr>{["Status", "From", "To", "Expected back", "Area", "Reason", ...(d.medical ? ["Clinical notes"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{d.availability.spells.map((s) => (
                <tr key={s.id}><td className={td}><AvailBadge state={s.status} /></td><td className={td}>{niceDay(s.startedOn, true)}</td><td className={td}>{s.endedOn ? niceDay(s.endedOn, true) : "Ongoing"}</td>
                  <td className={td}>{niceDay(s.expectedReturn)}</td><td className={td}>{s.bodyArea ?? "—"}</td><td className={td}>{s.reason ?? "—"}</td>
                  {d.medical && <td className={`${td} max-w-xs`}>{s.notes ?? "—"}</td>}</tr>
              ))}</tbody></table>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Tests">
        {d.tests.length === 0 ? <Empty>No test results yet.</Empty> : (
          <TableWrap>
            <table className="w-full"><thead><tr>{["Test", "Result", "Date"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{d.tests.map((t, i) => (
                <tr key={i}><td className={td}>{t.name}</td><td className={`${td} tabular-nums`}>{t.value}{t.unit ? ` ${t.unit}` : ""}</td><td className={td}>{niceDay(t.date, true)}</td></tr>
              ))}</tbody></table>
          </TableWrap>
        )}
      </Panel>

      <Panel title="Video clips">
        {d.media.length === 0 ? <Empty>No clips tagged to this player. Add one on the Video page.</Empty> : (
          <ul className="divide-y divide-border">
            {d.media.map((m) => (
              <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="font-medium truncate">{m.title}</div>
                  <div className="text-xs text-muted-foreground">{niceDay(m.clip_date)} · {m.source}{m.tags.length ? ` · ${m.tags.join(", ")}` : ""}</div></div>
                <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0">Open <ExternalLink className="w-3.5 h-3.5" aria-hidden /></a>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Check-in app account" note="Players answer their daily check-in on their own phone.">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Pill tone={ACCOUNT_TONE[d.account?.state ?? "none"]}>{ACCOUNT_WORD[d.account?.state ?? "none"]}</Pill>
          {d.account && <span className="text-sm text-muted-foreground">{d.account.email}{d.account.lastSignIn ? ` · last sign-in ${niceDay(String(d.account.lastSignIn).slice(0, 10), true)}` : ""}</span>}
        </div>
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <Input className={`${control} md:w-72`} type="email" placeholder={d.player.email ?? "Player's email"} value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button className={control} disabled={acct.busy}
            onClick={() => acct.run(async () => { const r = await send("POST", `/players/${contactId}/invite`, email.trim() ? { email: email.trim() } : {}); return r.emailed ? "Invite emailed." : "Account made. The email could not be sent."; })}>
            {d.account ? "Send invite again" : "Invite to check-in app"}
          </Button>
          {d.account && d.account.state !== "disabled" && (
            <Button variant="outline" className={control} disabled={acct.busy} onClick={() => acct.run(async () => { await send("POST", `/players/${contactId}/disable`); return "Account disabled."; })}>Disable</Button>
          )}
        </div>
        {acct.done && <p className="text-sm text-emerald-700 mt-2">{acct.done}</p>}
        <FormError error={acct.error} />
      </Panel>
    </div>
  );
}
