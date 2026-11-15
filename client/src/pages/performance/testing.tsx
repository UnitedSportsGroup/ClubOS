import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  DateField, Empty, Field, FormError, Loading, LoadError, PageHead, Panel, Pick, Pill, SaveButton, TableWrap, td, th, niceDay, send,
  usePerfQuery, useOverview, useSaver, control,
} from "./ui";

interface Test { id: number; name: string; unit: string | null; higherIsBetter: boolean; bandRed: number | null; bandGreen: number | null }
interface Result { id: number; testId: number; contactId: number; name: string | null; value: number; date: string; notes: string | null }

/** Band tone only when the test has bands. Red/green thresholds follow "higher is better". */
function bandOf(t: Test, v: number): "red" | "amber" | "green" | null {
  if (t.bandRed == null && t.bandGreen == null) return null;
  const good = (x: number, th: number) => (t.higherIsBetter ? x >= th : x <= th);
  const bad = (x: number, th: number) => (t.higherIsBetter ? x <= th : x >= th);
  if (t.bandGreen != null && good(v, t.bandGreen)) return "green";
  if (t.bandRed != null && bad(v, t.bandRed)) return "red";
  return "amber";
}
const BAND_WORD = { red: "Below target", amber: "In between", green: "On target" } as const;

export default function Testing() {
  const q = usePerfQuery<{ tests: Test[]; results: Result[] }>("tests", "/tests");
  const ov = useOverview();
  const squad = ov.data?.players ?? [];
  const d = q.data;

  const [name, setName] = useState(""); const [unit, setUnit] = useState(""); const [hib, setHib] = useState("yes");
  const [red, setRed] = useState(""); const [green, setGreen] = useState("");
  const create = useSaver();

  const [testId, setTestId] = useState(""); const [date, setDate] = useState(""); const [vals, setVals] = useState<Record<number, string>>({});
  const enter = useSaver();

  // latest result per player per test
  const latest = new Map<string, Result>();
  for (const r of d?.results ?? []) {
    const k = `${r.testId}|${r.contactId}`;
    const cur = latest.get(k);
    if (!cur || r.date > cur.date) latest.set(k, r);
  }

  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Testing" blurb="Fitness and physio tests: sprints, jumps, range of motion. Name a test once, then enter results for the squad." />
      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Panel title="Latest results" note="Colours show only when a test has red and green targets set.">
            {d.tests.length === 0 ? <Empty>No tests yet. Create one below, for example "20 m sprint" in seconds, lower is better.</Empty> : d.results.length === 0 ? <Empty>No results entered yet.</Empty> : (
              <TableWrap>
                <table className="w-full" data-testid="perf-tests">
                  <thead><tr><th className={th}>Player</th>{d.tests.map((t) => <th key={t.id} className={th}>{t.name}{t.unit ? ` (${t.unit})` : ""}</th>)}</tr></thead>
                  <tbody>
                    {squad.map((p) => (
                      <tr key={p.contactId}>
                        <td className={`${td} font-medium`}>{p.name}</td>
                        {d.tests.map((t) => {
                          const r = latest.get(`${t.id}|${p.contactId}`);
                          if (!r) return <td key={t.id} className={`${td} text-muted-foreground`}>—</td>;
                          const b = bandOf(t, r.value);
                          return <td key={t.id} className={td}>{b ? <Pill tone={b}>{r.value} · {BAND_WORD[b]}</Pill> : <span className="tabular-nums">{r.value}</span>}<div className="text-[11px] text-muted-foreground">{niceDay(r.date)}</div></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>

          <Panel title="Enter results">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Test"><Pick value={testId} onChange={(v) => { setTestId(v); setVals({}); }} options={d.tests.map((t) => ({ value: String(t.id), label: t.name }))} placeholder="Which test?" /></Field>
              <Field label="Test date"><DateField value={date || ov.data?.today || ""} onChange={setDate} className="w-full" /></Field>
            </div>
            {testId && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {squad.map((p) => (
                  <div key={p.contactId} className="flex items-center gap-2">
                    <span className="text-sm flex-1 min-w-0 truncate">{p.name}</span>
                    <Input className={`${control} w-28`} inputMode="decimal" placeholder="not tested" value={vals[p.contactId] ?? ""} onChange={(e) => setVals({ ...vals, [p.contactId]: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 mt-4">
              <SaveButton busy={enter.busy} disabled={!testId} onClick={() => enter.run(async () => {
                const results = Object.entries(vals).filter(([, v]) => v.trim() !== "").map(([id, v]) => ({ contactId: Number(id), value: Number(v) }));
                const r = await send("POST", `/tests/${testId}/results`, { date: date || ov.data?.today, results });
                setVals({});
                return `Saved ${r.written} result${r.written === 1 ? "" : "s"}. Blank means not tested.`;
              })}>Save results</SaveButton>
              {enter.done && <span className="text-sm text-emerald-700">{enter.done}</span>}
            </div>
            <FormError error={enter.error} />
          </Panel>

          <Panel title="New test">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Field label="Name" className="col-span-2"><Input className={control} placeholder="e.g. 20 m sprint" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Unit"><Input className={control} placeholder="e.g. s, cm, kg" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
              <Field label="Higher is better?"><Pick value={hib} onChange={setHib} options={[{ value: "yes", label: "Yes (jump, strength)" }, { value: "no", label: "No (sprint time)" }]} /></Field>
              <div />
              <Field label="Red below/above (optional)"><Input className={control} inputMode="decimal" value={red} onChange={(e) => setRed(e.target.value)} /></Field>
              <Field label="Green at/beyond (optional)"><Input className={control} inputMode="decimal" value={green} onChange={(e) => setGreen(e.target.value)} /></Field>
            </div>
            <p className="text-xs text-muted-foreground mt-2">For "higher is better" tests red is the lower line and green the upper. For "lower is better" tests (like a sprint) red is the slow line and green the fast line.</p>
            <div className="mt-3 flex items-center gap-3">
              <SaveButton busy={create.busy} disabled={!name.trim()} onClick={() => create.run(async () => {
                await send("POST", "/tests", { name, unit, higherIsBetter: hib === "yes", bandRed: red, bandGreen: green });
                setName(""); setUnit(""); setRed(""); setGreen("");
                return "Test created.";
              })}>Create test</SaveButton>
              {create.done && <span className="text-sm text-emerald-700">{create.done}</span>}
            </div>
            <FormError error={create.error} />
          </Panel>
        </>
      )}
    </div>
  );
}
