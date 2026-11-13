import { useState } from "react";
import { useLocation } from "wouter";
import { formatMetric, metricByKey } from "@shared/performance";
import {
  AvailBadge, BandPill, DateField, Empty, LevelDot, Loading, LoadError, PageHead, Panel, Pick, ScoreFlag, Stat,
  TableWrap, td, th, niceDay, send, refresh, useOverview, useSaver, FormError, type BoardPlayer,
} from "./ui";

export function gpsText(p: BoardPlayer): string {
  const d = p.gps.total_distance_m, s = p.gps.top_speed_kmh;
  const bits = [d && formatMetric(d.value, metricByKey("total_distance_m")), s && formatMetric(s.value, metricByKey("top_speed_kmh"))].filter(Boolean);
  return bits.length ? bits.join(" · ") : "—";
}

export default function Board() {
  const [date, setDate] = useState("");
  const q = useOverview(date || undefined);
  const [, navigate] = useLocation();
  const link = useSaver();
  const [picks, setPicks] = useState<Record<number, string>>({});

  const d = q.data;
  return (
    <div className="space-y-5 min-w-0">
      <PageHead
        title="Performance"
        blurb="Who is ready to train today: availability, check-in, effort and load in one place."
        right={<div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Looking at</span><DateField value={date || d?.today || ""} onChange={setDate} className="w-48" testId="perf-date" /></div>}
      />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Stat label="Squad" value={String(d.counts.squad)} />
            <Stat label="Available" value={String(d.counts.available)} />
            <Stat label="Modified" value={String(d.counts.modified)} />
            <Stat label="Out" value={String(d.counts.out)} />
            <Stat label="Checked in" value={`${d.counts.checkedIn} of ${d.counts.squad}`} note={niceDay(d.today)} />
            <Stat label="Flagged" value={String(d.counts.flagged)} />
            <Stat label="Check-in accounts" value={String(d.counts.accounts)} note="active players" />
          </div>

          {d.players.length === 0 ? (
            <Empty>No players on the squad yet. Add players to a South Island United squad in the Squads tab and they appear here.</Empty>
          ) : (
            <Panel title="Squad board" note="Tap a player for their full page.">
              <TableWrap>
                <table className="w-full" data-testid="perf-board">
                  <thead><tr>
                    {["Player", "Ready?", "Availability", "Check-in", "Effort (RPE)", "Load (7 days)", "ACWR", "GPS"].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {d.players.map((p) => (
                      <tr key={p.contactId} className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/admin/performance/players/${p.contactId}?from=/admin/performance`)}>
                        <td className={td}>
                          <div className="font-medium text-foreground">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{[p.position, p.squadNumber != null ? `#${p.squadNumber}` : null].filter(Boolean).join(" · ") || "—"}</div>
                        </td>
                        <td className={td}>
                          <LevelDot level={p.readiness.level} />
                          {p.readiness.reasons.length > 0 && <div className="text-xs text-muted-foreground max-w-[14rem]">{p.readiness.reasons.join(", ")}</div>}
                          {p.readiness.missing.length > 0 && <div className="text-[11px] text-muted-foreground">No data: {p.readiness.missing.join(", ")}</div>}
                        </td>
                        <td className={td}>
                          <AvailBadge state={p.availability.state} />
                          {p.availability.expectedReturn && <div className="text-xs text-muted-foreground">Back {niceDay(p.availability.expectedReturn)}</div>}
                          {p.availability.bodyArea && <div className="text-xs text-muted-foreground">{p.availability.bodyArea}</div>}
                        </td>
                        <td className={td}>
                          {p.wellness ? (
                            <>
                              <ScoreFlag score={p.wellness.score} flag={p.wellness.flag} />
                              {p.wellness.reasons.length > 0 && <div className="text-xs text-muted-foreground max-w-[14rem]">{p.wellness.reasons.join(", ")}</div>}
                            </>
                          ) : <span className="text-xs text-muted-foreground">No check-in</span>}
                        </td>
                        <td className={td}>
                          {p.rpe.length ? p.rpe.map((r, i) => <div key={i} className="text-xs">{niceDay(r.date)} · {r.kind} · <span className="font-medium">{r.rpe}</span>/10{r.minutes ? ` · ${r.minutes} min` : ""}</div>) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={`${td} tabular-nums`}>{p.load.acute7 != null ? p.load.acute7 : "—"}</td>
                        <td className={td}>
                          {p.load.acwr != null ? <div className="space-y-0.5"><span className="font-medium tabular-nums">{p.load.acwr}</span><div><BandPill band={p.load.band} /></div></div>
                            : <span className="text-xs text-muted-foreground">{p.load.acwrNote ?? "—"}</span>}
                        </td>
                        <td className={`${td} text-xs`}>{gpsText(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Panel>
          )}

          <Panel title="Data to fix" note="GPS and other files name players their own way (for example initials). Link each name to a squad player so their history lands on the right page.">
            {d.unlinked.length === 0 ? <Empty>Nothing to fix. Every name in the imported files is linked to a player.</Empty> : (
              <div className="space-y-2">
                {d.unlinked.map((u) => (
                  <div key={u.id} className="flex flex-col md:flex-row md:items-center gap-2 rounded-md border border-border p-2">
                    <div className="min-w-0 md:w-72">
                      <span className="font-medium">{u.source_name || u.source_athlete_key}</span>
                      <span className="text-xs text-muted-foreground"> from {u.source} · {u.readings} reading{u.readings === 1 ? "" : "s"}</span>
                    </div>
                    <Pick className="md:w-64" placeholder="Which player is this?" value={picks[u.id]} onChange={(v) => setPicks({ ...picks, [u.id]: v })}
                      options={d.players.map((p) => ({ value: String(p.contactId), label: p.name }))} />
                    <button type="button" disabled={!picks[u.id] || link.busy}
                      className="h-11 md:h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                      onClick={() => link.run(async () => { await send("POST", `/athletes/${u.id}/link`, { contactId: Number(picks[u.id]) }); await refresh(); })}>
                      Link
                    </button>
                  </div>
                ))}
                <FormError error={link.error} />
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
