import { useState } from "react";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DateField, Empty, Field, FormError, ItemCell, Loading, LoadError, PageHead, Panel, Pick, Pill, SaveButton, ScoreButtons, ScoreFlag, TableWrap,
  ToggleChip, td, th, niceDay, send, useCatalogue, useOverview, useSaver, control,
} from "./ui";

const ITEMS = [
  { key: "sleep", label: "Sleep quality", low: "Terrible", high: "Great" },
  { key: "fatigue", label: "Energy", low: "Exhausted", high: "Fresh" },
  { key: "soreness", label: "Muscle soreness", low: "Very sore", high: "Not sore" },
  { key: "stress", label: "Stress", low: "Very stressed", high: "Relaxed" },
  { key: "mood", label: "Mood", low: "Low", high: "Great" },
];

export default function Wellness() {
  const q = useOverview();
  const cat = useCatalogue();
  const [, navigate] = useLocation();
  const d = q.data;
  const items = cat.data?.wellnessItems ?? ITEMS;
  const areas = cat.data?.soreAreas ?? [];

  const [player, setPlayer] = useState("");
  const [date, setDate] = useState("");
  const [vals, setVals] = useState<Record<string, number | null>>({});
  const [sleepHours, setSleepHours] = useState("");
  const [sore, setSore] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [medFlag, setMedFlag] = useState(false);
  const save = useSaver();

  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Wellness" blurb={`Today's check-ins${d ? ` (${niceDay(d.today)})` : ""}. 1 is worst, 5 is best on every question.`} />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Panel title="Today's grid" note={`${d.counts.checkedIn} of ${d.counts.squad} have checked in.`}>
            {d.players.length === 0 ? <Empty>No players on the squad yet.</Empty> : d.counts.checkedIn === 0 ? (
              <Empty>No check-ins yet today. Invite players on their player page, or enter one below for a player without a phone.</Empty>
            ) : (
              <TableWrap>
                <table className="w-full" data-testid="perf-wellness-grid">
                  <thead><tr>
                    <th className={th}>Player</th>{items.map((i) => <th key={i.key} className={th}>{i.label}</th>)}
                    <th className={th}>Sleep</th><th className={th}>Sore areas</th><th className={th}>Score</th>
                    {d.medical && <><th className={th}>Tell the physio</th><th className={th}>Private note</th></>}
                  </tr></thead>
                  <tbody>
                    {d.players.map((p) => (
                      <tr key={p.contactId} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/performance/players/${p.contactId}?from=/admin/performance/wellness`)}>
                        <td className={`${td} font-medium`}>{p.name}</td>
                        {p.wellness ? (
                          <>
                            {items.map((i) => <td key={i.key} className={td}><ItemCell v={p.wellness!.items[i.key]} /></td>)}
                            <td className={td}>{p.wellness.sleepHours != null ? `${p.wellness.sleepHours} h` : "—"}</td>
                            <td className={`${td} text-xs max-w-[12rem]`}>{p.wellness.soreAreas.length ? p.wellness.soreAreas.join(", ") : "—"}</td>
                            <td className={td}><ScoreFlag score={p.wellness.score} flag={p.wellness.flag} /></td>
                            {d.medical && <><td className={td}>{p.wellness.medicalFlag ? <Pill tone="red">Yes</Pill> : "—"}</td><td className={`${td} text-xs max-w-xs`}>{p.wellness.note || "—"}</td></>}
                          </>
                        ) : <td className={`${td} text-xs text-muted-foreground`} colSpan={items.length + 3 + (d.medical ? 2 : 0)}>No check-in</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>

          <Panel title="Enter a check-in for a player" note="For a player without the app. Answering again for the same day replaces it.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Player"><Pick value={player} onChange={setPlayer} options={d.players.map((p) => ({ value: String(p.contactId), label: p.name }))} testId="perf-wellness-player" /></Field>
              <Field label="Day"><DateField value={date || d.today} onChange={setDate} className="w-full" /></Field>
              {items.map((i) => (
                <Field key={i.key} label={i.label}><ScoreButtons value={vals[i.key] ?? null} onChange={(v) => setVals({ ...vals, [i.key]: v })} low={i.low} high={i.high} /></Field>
              ))}
              <Field label="Hours slept"><Input className={control} inputMode="decimal" placeholder="e.g. 7.5" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} /></Field>
              <Field label="Anywhere sore?" className="md:col-span-2">
                <div className="flex flex-wrap gap-1.5">{areas.map((a) => <ToggleChip key={a} on={sore.includes(a)} onClick={() => setSore(sore.includes(a) ? sore.filter((x) => x !== a) : [...sore, a])}>{a}</ToggleChip>)}</div>
              </Field>
              <Field label="Note" className="md:col-span-2"><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional" /></Field>
              {d.medical && (
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <Checkbox checked={medFlag} onCheckedChange={(v) => setMedFlag(v === true)} /> Player wants to speak to the physio
                </label>
              )}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <SaveButton busy={save.busy} disabled={!player} onClick={() => save.run(async () => {
                await send("POST", "/wellness", {
                  contactId: Number(player), date: date || d.today, ...vals,
                  sleepHours: sleepHours.trim() === "" ? null : Number(sleepHours), soreAreas: sore, note,
                  ...(d.medical ? { medicalFlag: medFlag } : {}),
                });
                setVals({}); setSleepHours(""); setSore([]); setNote(""); setMedFlag(false);
                return "Saved.";
              })}>Save check-in</SaveButton>
              {save.done && <span className="text-sm text-emerald-700">{save.done}</span>}
            </div>
            <FormError error={save.error} />
          </Panel>
        </>
      )}
    </div>
  );
}
