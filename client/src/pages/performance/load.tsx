import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { formatMetric, metricByKey } from "@shared/performance";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  BandPill, DateField, Empty, Field, FormError, Loading, LoadError, PageHead, Panel, Pick, SaveButton, TableWrap, td, th, send, useOverview, useSaver, control, niceDay,
} from "./ui";

export default function Load() {
  const q = useOverview();
  const [, navigate] = useLocation();
  const d = q.data;
  const [date, setDate] = useState("");
  const [kind, setKind] = useState("training");
  const [minutes, setMinutes] = useState("");
  const [rpe, setRpe] = useState("");
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const save = useSaver();

  const availableIds = d ? d.players.filter((p) => p.availability.state === "available").map((p) => p.contactId) : [];
  useEffect(() => { if (d && picked == null) setPicked(new Set(availableIds)); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = picked ?? new Set<number>();
  const gpsCols = ["total_distance_m", "hsr_distance_m", "sprint_distance_m", "top_speed_kmh", "player_load"];

  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Load & GPS" blurb="How much each player has done this week against their own normal. Load = effort (0–10) × minutes." />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Panel title="Squad load">
            {d.players.length === 0 ? <Empty>No players on the squad yet.</Empty> : (
              <TableWrap>
                <table className="w-full" data-testid="perf-load">
                  <thead><tr>
                    {["Player", "This week", "Normal week", "ACWR", "Monotony", "Strain", ...gpsCols.map((k) => metricByKey(k)?.label ?? k)].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {d.players.map((p) => (
                      <tr key={p.contactId} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/performance/players/${p.contactId}?from=/admin/performance/load`)}>
                        <td className={`${td} font-medium`}>{p.name}</td>
                        <td className={`${td} tabular-nums`}>{p.load.acute7 ?? "—"}</td>
                        <td className={`${td} tabular-nums`}>{p.load.chronic28 ?? "—"}</td>
                        <td className={td}>
                          {p.load.acwr != null ? <div><span className="font-medium tabular-nums">{p.load.acwr}</span><div><BandPill band={p.load.band} /></div></div>
                            : <span className="text-xs text-muted-foreground">{p.load.acwrNote ?? "—"}</span>}
                        </td>
                        <td className={`${td} tabular-nums`}>{p.load.monotony ?? "—"}</td>
                        <td className={`${td} tabular-nums`}>{p.load.strain ?? "—"}</td>
                        {gpsCols.map((k) => (
                          <td key={k} className={`${td} text-xs`}>
                            {p.gps[k] ? <>{formatMetric(p.gps[k].value, metricByKey(k))}<div className="text-[11px] text-muted-foreground">{niceDay(p.gps[k].date)}</div></> : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>

          <Panel title="Log session effort for the squad" note="Everyone ticked gets the same effort and minutes. Players can also do their own on the check-in app.">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Day"><DateField value={date || d.today} onChange={setDate} className="w-full" /></Field>
              <Field label="Session"><Pick value={kind} onChange={setKind} options={[{ value: "training", label: "Training" }, { value: "match", label: "Match" }, { value: "gym", label: "Gym" }, { value: "other", label: "Other" }]} /></Field>
              <Field label="Minutes"><Input className={control} inputMode="numeric" placeholder="e.g. 75" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
              <Field label="Effort 0–10"><Input className={control} inputMode="numeric" placeholder="0 rest, 10 maximal" value={rpe} onChange={(e) => setRpe(e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set(d.players.map((p) => p.contactId)))}>Everyone</button>
              <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set(availableIds))}>Only available players</button>
              <button type="button" className="text-primary hover:underline" onClick={() => setPicked(new Set())}>None</button>
              <span className="text-muted-foreground">{chosen.size} ticked</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 mt-2">
              {d.players.map((p) => (
                <label key={p.contactId} className="flex items-center gap-2 text-sm h-9">
                  <Checkbox checked={chosen.has(p.contactId)} onCheckedChange={(v) => { const n = new Set(chosen); v === true ? n.add(p.contactId) : n.delete(p.contactId); setPicked(n); }} />
                  {p.name}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <SaveButton busy={save.busy} disabled={chosen.size === 0 || rpe.trim() === ""} onClick={() => save.run(async () => {
                const r = await send("POST", "/rpe", { contactIds: Array.from(chosen), date: date || d.today, kind, minutes: minutes.trim() === "" ? null : Number(minutes), rpe: Number(rpe) });
                return `Saved for ${r.written} player${r.written === 1 ? "" : "s"}.`;
              })}>Save for {chosen.size}</SaveButton>
              {save.done && <span className="text-sm text-emerald-700">{save.done}</span>}
            </div>
            <FormError error={save.error} />
          </Panel>
        </>
      )}
    </div>
  );
}
