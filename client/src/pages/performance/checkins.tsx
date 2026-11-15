// Check-ins — Rowan's Smartabase report, rebuilt. Daniel, 14 Nov: "study this
// loom … it shows Rowan going through Smartabase".
//
// What the Loom does, and where it lives here:
//   date interval (Today / range) + "include the most recent result"  → Range, Most recent
//   view fields (tick the columns you want)                          → Columns
//   click a column header to sort by severity/score                  → every header sorts
//   "include missing users" (who hasn't entered)                     → Show who hasn't checked in
//   add a filter (Session RPE not equal to 0 …)                      → Filters
//   save as a report to ourselves, relative to "today"               → Saved reports
//   "enter data for athlete" (sit with the player)                   → Enter for a player
//   the collective soreness picture                                  → Areas today
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, Plus, Smartphone, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { answerSortKey, answerText, liveQuestions, regionLabel, type Answers, type FormDef, type Question } from "@shared/perf-forms";
import { AnswerList, CheckInForm, SIU } from "@/components/performance/checkin-form";
import {
  DateField, Empty, Field, FormError, LoadError, Loading, PageHead, Panel, Pick, Pill, TableWrap,
  control, niceDay, send, refresh, td, th, usePerfQuery, useOverview, getJson, errText,
} from "./ui";

type Range = "today" | "yesterday" | "7d" | "28d" | "custom";
type Op = "eq" | "ne" | "gte" | "lte" | "has" | "blank" | "notblank";
interface Filter { field: string; op: Op; value: string }
interface Config {
  range: Range; from?: string; to?: string; mostRecent: boolean; includeMissing: boolean; tests: boolean;
  fields: string[] | null; filters: Filter[]; sort: { field: string; dir: "asc" | "desc" } | null;
}
const DEFAULT: Config = { range: "today", mostRecent: true, includeMissing: false, tests: false, fields: null, filters: [], sort: null };

interface Row {
  id: number; contactId: number | null; name: string; position: string | null; squadNumber: number | null; date: string;
  answers: Answers; flag: "red" | "amber" | null; reasons: string[]; isTest: boolean; enteredBy: string;
  entriesThisWeek: number | null; loadThisWeek: number | null;
}
interface Report {
  today: string; from: string; to: string;
  form: null | { id: number; title: string; version: number; definition: FormDef };
  rows: Row[]; missing: { contactId: number; name: string; position: string | null; squadNumber: number | null }[];
}

const EXTRA = [
  { id: "_flag", label: "Flag" },
  { id: "_entries", label: "Entries this week" },
  { id: "_load", label: "Load this week" },
  { id: "_by", label: "Entered by" },
];
const RANGES = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" }, { value: "28d", label: "Last 28 days" }, { value: "custom", label: "Pick dates" },
];
const OPS: { value: Op; label: string }[] = [
  { value: "eq", label: "is" }, { value: "ne", label: "is not" }, { value: "gte", label: "at least" }, { value: "lte", label: "at most" },
  { value: "has", label: "includes" }, { value: "blank", label: "is blank" }, { value: "notblank", label: "is not blank" },
];
const FLAG_RANK = { red: 2, amber: 1 } as const;

function extraValue(r: Row, id: string): number | string | null {
  if (id === "_flag") return r.flag ? FLAG_RANK[r.flag] : 0;
  if (id === "_entries") return r.entriesThisWeek;
  if (id === "_load") return r.loadThisWeek;
  if (id === "_by") return r.enteredBy;
  return null;
}

function passes(r: Row, f: Filter, qs: Map<string, Question>): boolean {
  const q = qs.get(f.field);
  const raw = q ? r.answers[f.field] : extraValue(r, f.field);
  const blank = raw == null || (Array.isArray(raw) && raw.length === 0) || raw === "";
  if (f.op === "blank") return blank;
  if (f.op === "notblank") return !blank;
  if (blank) return f.op === "ne";
  const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
  const n = Number(raw), v = Number(f.value);
  switch (f.op) {
    case "eq": return typeof raw === "number" ? n === v : list.length === 1 && list[0] === f.value;
    case "ne": return typeof raw === "number" ? n !== v : !list.includes(f.value);
    case "gte": return typeof raw === "number" && n >= v;
    case "lte": return typeof raw === "number" && n <= v;
    case "has": return list.some((x) => x.toLowerCase().includes(f.value.toLowerCase()));
  }
  return true;
}

export default function CheckIns() {
  const [cfg, setCfg] = useState<Config>(DEFAULT);
  const [savedName, setSavedName] = useState<string | null>(null);
  const qs = new URLSearchParams();
  if (cfg.range === "custom") { if (cfg.from) qs.set("from", cfg.from); if (cfg.to) qs.set("to", cfg.to); } else qs.set("range", cfg.range);
  qs.set("mostRecent", cfg.mostRecent ? "1" : "0");
  if (cfg.tests) qs.set("tests", "1");
  const q = usePerfQuery<Report>("checkins", `/checkins?${qs}`);
  const saved = usePerfQuery<{ reports: { id: number; name: string; config: Config }[] }>("reports", "/reports");
  const [open, setOpen] = useState<number | null>(null);
  const [enter, setEnter] = useState<{ contactId?: number } | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const d = q.data;
  const def = d?.form?.definition;
  const questions = useMemo(() => (def ? liveQuestions(def) : []), [def]);
  const qMap = useMemo(() => new Map(questions.map((x) => [x.id, x])), [questions]);
  const allCols = useMemo(() => [...questions.map((x) => ({ id: x.id, label: x.short ?? x.label })), ...EXTRA], [questions]);
  const cols = cfg.fields ? allCols.filter((c) => cfg.fields!.includes(c.id)) : allCols.filter((c) => c.id !== "_by");

  const rows = useMemo(() => {
    if (!d) return [];
    let out = d.rows.filter((r) => cfg.filters.every((f) => passes(r, f, qMap)));
    if (cfg.sort) {
      const { field, dir } = cfg.sort;
      const key = (r: Row) => field === "_name" ? r.name.toLowerCase() : field === "_date" ? r.date : qMap.has(field) ? answerSortKey(qMap.get(field)!, r.answers[field]) : extraValue(r, field);
      out = [...out].sort((a, b) => {
        const x = key(a), y = key(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;                 // 🔴 blanks last, both directions
        if (y == null) return -1;
        const c = x < y ? -1 : x > y ? 1 : 0;
        return dir === "asc" ? c : -c;
      });
    }
    return out;
  }, [d, cfg.filters, cfg.sort, qMap]);

  const areaTally = useMemo(() => {
    const bodyQ = questions.find((x) => x.type === "body");
    if (!bodyQ || !d) return null;
    const m = new Map<string, number>();
    for (const r of d.rows) if (!r.isTest) for (const k of (r.answers[bodyQ.id] as string[] | undefined) ?? []) m.set(k, (m.get(k) ?? 0) + 1);
    return { q: bodyQ, list: Array.from(m.entries()).sort((a, b) => b[1] - a[1]) };
  }, [questions, d]);

  const sortBy = (field: string) => setCfg((c) => ({ ...c, sort: c.sort?.field === field ? { field, dir: c.sort.dir === "asc" ? "desc" : "asc" } : { field, dir: field === "_name" ? "asc" : "desc" } }));
  const Head = ({ id, label }: { id: string; label: string }) => (
    <th className={th}>
      <button type="button" onClick={() => sortBy(id)} className="inline-flex items-center gap-1 hover:text-foreground" title="Sort">
        {label}{cfg.sort?.field === id && (cfg.sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );

  const [naming, setNaming] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const saveReport = async () => {
    const name = (naming ?? "").trim();
    if (!name) { setSaveErr("Give the report a name."); return; }
    try { await send("POST", "/reports", { name, config: cfg }); setSavedName(name); setNaming(null); setSaveErr(null); await refresh(); }
    catch (e) { setSaveErr(errText(e)); }
  };
  const deleteSaved = async () => {
    const r = saved.data?.reports.find((x) => x.name === savedName);
    if (!r) return;
    try { await send("DELETE", `/reports/${r.id}`); setSavedName(null); setCfg(DEFAULT); await refresh(); } catch (e) { setSaveErr(errText(e)); }
  };

  return (
    <div className="space-y-4 min-w-0">
      <PageHead
        title="Check-ins"
        blurb={d?.form ? `${d.form.title}: every answer, sortable, with who hasn't checked in.` : "The players' daily check-in answers."}
        right={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/performance/try"><Button variant="outline" className={control}><Smartphone className="w-4 h-4 mr-1.5" />Try the player app</Button></Link>
            <Button className={control} onClick={() => setEnter({})} disabled={!d?.form}><Plus className="w-4 h-4 mr-1.5" />Enter for a player</Button>
          </div>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Saved reports" className="w-56">
            <Pick value={savedName ?? ""} placeholder={saved.data?.reports.length ? "Open a saved report" : "None saved yet"}
              options={(saved.data?.reports ?? []).map((r) => ({ value: r.name, label: r.name }))}
              onChange={(n) => { const r = saved.data?.reports.find((x) => x.name === n); if (r) { setCfg({ ...DEFAULT, ...r.config }); setSavedName(r.name); } }} testId="saved-report" />
          </Field>
          <Field label="Dates" className="w-44">
            <Pick value={cfg.range} options={RANGES} onChange={(v) => setCfg((c) => ({ ...c, range: v as Range }))} testId="range" />
          </Field>
          {cfg.range === "custom" && (
            <>
              <Field label="From" className="w-44"><DateField value={cfg.from ?? d?.today ?? ""} onChange={(v) => setCfg((c) => ({ ...c, from: v }))} /></Field>
              <Field label="To" className="w-44"><DateField value={cfg.to ?? d?.today ?? ""} onChange={(v) => setCfg((c) => ({ ...c, to: v }))} /></Field>
            </>
          )}
          <label className="flex items-center gap-2 text-sm h-11 md:h-9"><Checkbox checked={cfg.mostRecent} onCheckedChange={(v) => setCfg((c) => ({ ...c, mostRecent: !!v }))} />Most recent per player</label>
          <label className="flex items-center gap-2 text-sm h-11 md:h-9"><Checkbox checked={cfg.includeMissing} onCheckedChange={(v) => setCfg((c) => ({ ...c, includeMissing: !!v }))} data-testid="include-missing" />Show who hasn't checked in</label>
          <label className="flex items-center gap-2 text-sm h-11 md:h-9"><Checkbox checked={cfg.tests} onCheckedChange={(v) => setCfg((c) => ({ ...c, tests: !!v }))} />Show test entries</label>
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" className={control} onClick={() => setShowSetup((s) => !s)}>{showSetup ? "Hide columns & filters" : "Columns & filters"}</Button>
            <Button variant="outline" className={control} onClick={() => setNaming(savedName ?? "Today's check-ins")} data-testid="save-report">Save report</Button>
            {savedName && <Button variant="ghost" className={control} onClick={deleteSaved}>Delete saved</Button>}
            {savedName && <Button variant="ghost" className={control} onClick={() => { setCfg(DEFAULT); setSavedName(null); }}>Clear</Button>}
          </div>
        </div>
        {naming != null && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input className={`${control} w-64`} value={naming} onChange={(e) => setNaming(e.target.value)} maxLength={80} aria-label="Report name" autoFocus data-testid="report-name" />
            <Button className={control} onClick={saveReport}>Save</Button>
            <Button variant="ghost" className={control} onClick={() => { setNaming(null); setSaveErr(null); }}>Cancel</Button>
            <span className="text-xs text-muted-foreground">Dates are kept as "{RANGES.find((r) => r.value === cfg.range)?.label}", so tomorrow it shows tomorrow.</span>
          </div>
        )}
        <FormError error={saveErr} />

        {showSetup && def && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Columns</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {allCols.map((c) => {
                  const on = cols.some((x) => x.id === c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 text-sm min-h-[36px]">
                      <Checkbox checked={on} onCheckedChange={() => setCfg((x) => {
                        const cur = x.fields ?? cols.map((k) => k.id);
                        return { ...x, fields: on ? cur.filter((k) => k !== c.id) : [...cur, c.id] };
                      })} />{c.label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Filters</p>
              <div className="space-y-2">
                {cfg.filters.map((f, i) => {
                  const fq = qMap.get(f.field);
                  const upd = (p: Partial<Filter>) => setCfg((c) => ({ ...c, filters: c.filters.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
                  return (
                    <div key={i} className="flex flex-wrap gap-2 items-center">
                      <Pick className="w-48" value={f.field} options={allCols.map((c) => ({ value: c.id, label: c.label }))} onChange={(v) => upd({ field: v, value: "" })} />
                      <Pick className="w-32" value={f.op} options={OPS} onChange={(v) => upd({ op: v as Op })} />
                      {f.op !== "blank" && f.op !== "notblank" && (fq?.options
                        ? <Pick className="w-44" value={f.value} options={fq.options.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => upd({ value: v })} />
                        : <Input className={`${control} w-28`} value={f.value} onChange={(e) => upd({ value: e.target.value })} />)}
                      <Button variant="ghost" size="icon" aria-label="Remove filter" onClick={() => setCfg((c) => ({ ...c, filters: c.filters.filter((_, j) => j !== i) }))}><X className="w-4 h-4" /></Button>
                    </div>
                  );
                })}
                <Button variant="outline" className={control} onClick={() => setCfg((c) => ({ ...c, filters: [...c.filters, { field: questions[0]?.id ?? "_flag", op: "ne", value: "" }] }))}>
                  <Plus className="w-4 h-4 mr-1.5" />Add a filter</Button>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {q.isLoading && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={() => q.refetch()} />}
      {d && !d.form && <Empty>No check-in form is set up. Open Forms to start from the SI United Check In template.</Empty>}
      {d?.form && def && (
        <>
          <Panel title={`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`} note={d.from === d.to ? niceDay(d.from, true) : `${niceDay(d.from)} to ${niceDay(d.to, true)}`}>
            {rows.length === 0 && !cfg.includeMissing ? <Empty>No check-ins for these dates yet.</Empty> : (
              <TableWrap>
                <table className="w-full" data-testid="checkins-table">
                  <thead><tr><Head id="_date" label="Date" /><Head id="_name" label="Player" />{cols.map((c) => <Head key={c.id} id={c.id} label={c.label} />)}</tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(r.id)}>
                        <td className={`${td} whitespace-nowrap`}>{niceDay(r.date)}</td>
                        <td className={`${td} whitespace-nowrap font-medium`}>{r.name}{r.isTest && <span className="ml-2"><Pill tone="blue">Test</Pill></span>}</td>
                        {cols.map((c) => <td key={c.id} className={`${td} max-w-[16rem]`}>{cell(r, c.id, qMap)}</td>)}
                      </tr>
                    ))}
                    {cfg.includeMissing && d.missing.map((m) => (
                      <tr key={`m${m.contactId}`} className="bg-muted/30">
                        <td className={td}>—</td>
                        <td className={`${td} whitespace-nowrap font-medium`}>{m.name}</td>
                        <td className={td} colSpan={cols.length}>
                          <span className="text-muted-foreground mr-3">Hasn't checked in</span>
                          <Button variant="outline" size="sm" onClick={() => setEnter({ contactId: m.contactId })}>Enter for {m.name.split(" ")[0]}</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {!cfg.includeMissing && d.missing.length > 0 && (
              <p className="text-xs text-muted-foreground mt-3">{d.missing.length} {d.missing.length === 1 ? "player hasn't" : "players haven't"} checked in for these dates. Tick "Show who hasn't checked in".</p>
            )}
          </Panel>

          {areaTally && areaTally.list.length > 0 && (
            <Panel title="Areas players are managing" note="Every body area ticked in these entries, most common first.">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
                {areaTally.list.map(([k, n]) => (
                  <div key={k} className="flex items-center gap-2 text-sm">
                    <span className="w-44 shrink-0 truncate">{regionLabel(k)}</span>
                    <span className="h-2 flex-1 rounded-full bg-muted overflow-hidden"><span className="block h-full bg-amber-500" style={{ width: `${(n / areaTally.list[0][1]) * 100}%` }} /></span>
                    <span className="w-6 text-right tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}

      {open != null && <ResponseDialog id={open} onClose={() => setOpen(null)} onEdit={(contactId) => { setOpen(null); setEnter({ contactId }); }} />}
      {enter && def && <EnterDialog def={def} preset={enter.contactId} today={d!.today} onClose={() => setEnter(null)} />}
    </div>
  );
}

function cell(r: Row, id: string, qMap: Map<string, Question>) {
  if (id === "_flag") return r.flag ? <span title={r.reasons.join(", ")}><Pill tone={r.flag}>{r.flag === "red" ? "Concern" : "Take care"}</Pill></span> : <span className="text-muted-foreground">—</span>;
  if (id === "_entries") return r.entriesThisWeek ?? "—";
  if (id === "_load") return r.loadThisWeek ?? "—";
  if (id === "_by") return r.enteredBy;
  const q = qMap.get(id);
  const t = q ? answerText(q, r.answers[id]) : "";
  return t ? <span className="whitespace-normal">{t}</span> : <span className="text-muted-foreground">—</span>;
}

function ResponseDialog({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (contactId: number) => void }) {
  const q = usePerfQuery<{ id: number; contactId: number | null; date: string; answers: Answers; reasons: string[]; isTest: boolean; definition: FormDef }>(`checkin-${id}`, `/checkins/${id}`);
  const [err, setErr] = useState<string | null>(null);
  const del = async () => { try { await send("DELETE", `/checkins/${id}`); await refresh(); onClose(); } catch (e) { setErr(errText(e)); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{q.data ? `Check-in, ${niceDay(q.data.date, true)}` : "Check-in"}</DialogTitle></DialogHeader>
        {q.isLoading && <Loading rows={3} />}
        {q.isError && <LoadError error={q.error} />}
        {q.data && (
          <div className="space-y-4 min-w-0">
            {q.data.reasons?.length > 0 && <div className="flex flex-wrap gap-1.5">{q.data.reasons.map((r) => <Pill key={r} tone="amber">{r}</Pill>)}</div>}
            <AnswerList def={q.data.definition} answers={q.data.answers} dark={false} />
            <div className="flex gap-2">
              {q.data.contactId && <Button variant="outline" onClick={() => onEdit(q.data!.contactId!)}>Change this player's answers</Button>}
              {q.data.isTest && <Button variant="outline" onClick={del}><Trash2 className="w-4 h-4 mr-1.5" />Delete test entry</Button>}
            </div>
            <FormError error={err} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EnterDialog({ def, preset, today, onClose }: { def: FormDef; preset?: number; today: string; onClose: () => void }) {
  const ov = useOverview();
  const [contactId, setContactId] = useState<number | undefined>(preset);
  const [date, setDate] = useState(today);
  const [initial, setInitial] = useState<Answers | null | undefined>(preset ? undefined : null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Load what the player already said that day, so staff edit rather than overwrite blind.
  const pick = async (id: number, day: string) => {
    setContactId(id); setInitial(undefined); setError(null);
    try {
      const r = await getJson<Report>(`/checkins?from=${day}&to=${day}`);
      setInitial(r.rows.find((x) => x.contactId === id)?.answers ?? null);
    } catch (e) { setError(errText(e)); setInitial(null); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (preset) void pick(preset, today); }, []);
  const name = ov.data?.players.find((p) => p.contactId === contactId)?.name;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto p-0" style={{ background: SIU.bg, color: SIU.ink }}>
        <div className="p-4">
          <DialogHeader><DialogTitle style={{ color: SIU.ink }}>Enter a check-in for a player</DialogTitle></DialogHeader>
          <p className="text-xs mt-1" style={{ color: SIU.mute }}>Saved under your name. The player still sees it on their phone.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 text-foreground">
            <Pick value={contactId ? String(contactId) : ""} placeholder="Choose a player"
              options={(ov.data?.players ?? []).map((p) => ({ value: String(p.contactId), label: p.name }))}
              onChange={(v) => pick(Number(v), date)} testId="enter-player" />
            <DateField value={date} onChange={(v) => { setDate(v); if (contactId) pick(contactId, v); }} />
          </div>
          <FormError error={error} />
          {done && <p className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: SIU.pine }}>{done}</p>}
          {contactId && initial !== undefined && !done && (
            <CheckInForm key={`${contactId}-${date}`} def={def} initial={initial} submitLabel={`Save for ${name ?? "this player"}`}
              onSubmit={async (answers) => {
                try { await send("POST", "/checkins", { contactId, date, answers }); await refresh(); setDone(`Saved ${name ?? "the player"}'s check-in for ${niceDay(date, true)}.`); return { ok: true }; }
                catch (e) { return { ok: false, message: errText(e) }; }
              }} />
          )}
          {done && <Button className="mt-3 w-full" onClick={onClose}>Close</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
