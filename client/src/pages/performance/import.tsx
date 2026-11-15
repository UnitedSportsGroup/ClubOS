import { useRef, useState } from "react";
import { METRICS, metricByKey } from "@shared/performance";
import { Button } from "@/components/ui/button";
import {
  DateField, Empty, Field, FormError, Loading, LoadError, PageHead, Panel, Pick, Pill, TableWrap, td, th, niceDay, send, refresh,
  usePerfQuery, useCatalogue, useSaver, control,
} from "./ui";

interface Plan {
  headers: string[]; playerColumn: number | null; dateColumn: number | null; sessionColumn: number | null;
  mapped: { column: number; header: string; metric: string }[]; ignored: string[];
  rows: { line: number; player: string; date: string | null; session: string | null; values: Record<string, number>; unreadable: string[] }[];
  problems: string[]; warnings: string[];
}
interface Preview {
  plan: Plan; totalRows: number;
  links: { player: string; contactId: number | null; how: string }[];
  squad: { contactId: number; name: string }[];
  duplicate: { at: string; by: string | null } | null;
}
interface ImportRow { id: number; source: string; filename: string | null; rows: number; values: number; at: string; by: string | null }

export default function ImportData() {
  const cat = useCatalogue();
  const history = usePerfQuery<{ imports: ImportRow[] }>("imports", "/imports");
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const prev = useSaver();
  const save = useSaver();

  const sources = (cat.data?.sources ?? []).filter((s) => (s.state === "import" || s.state === "planned") && !["monitoring", "medical", "video"].includes(s.category));

  const body = (m: Record<string, string>) => ({ source, csv: file?.csv, date: date || undefined, filename: file?.name, mapping: Object.keys(m).length ? m : undefined });
  const runPreview = (m: Record<string, string>) => prev.run(async () => {
    const p = await send<Preview>("POST", "/imports/preview", body(m));
    setPreview(p);
    setLinks((old) => {
      const next: Record<string, string> = {};
      for (const l of p.links) next[l.player] = old[l.player] ?? (l.contactId != null ? String(l.contactId) : "");
      return next;
    });
  });

  const onFile = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setFile({ name: f.name, csv: String(r.result ?? "") }); setPreview(null); setMapping({}); setResult(null); };
    r.readAsText(f);
  };
  const reset = () => { setFile(null); setPreview(null); setMapping({}); setLinks({}); if (fileRef.current) fileRef.current.value = ""; };

  const unresolved = preview ? preview.links.filter((l) => !links[l.player]).length : 0;

  return (
    <div className="space-y-5 min-w-0">
      <PageHead title="Import data" blurb="Bring in an export from GPS, a wearable, a force plate or a match-stats sheet. You see exactly what will be saved before anything is." />
      {cat.isLoading && <Loading />}
      {cat.isError && <LoadError error={cat.error} onRetry={() => cat.refetch()} />}
      {cat.data && (
        <Panel title="1. Choose the file">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Where did it come from?"><Pick value={source} onChange={(v) => { setSource(v); setPreview(null); }} options={sources.map((s) => ({ value: s.key, label: s.name }))} testId="perf-import-source" /></Field>
            <Field label="Session date (used if the file has no date)"><DateField value={date} onChange={(v) => { setDate(v); setPreview(null); }} className="w-full" /></Field>
            <Field label="CSV file">
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:h-11 md:file:h-9 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:text-sm" data-testid="perf-import-file" />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button className={control} disabled={!source || !file || prev.busy} onClick={() => runPreview(mapping)}>{prev.busy ? "Reading…" : "Preview"}</Button>
            {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
          </div>
          <FormError error={prev.error} />
        </Panel>
      )}

      {preview && (
        <Panel title="2. Check what it says" note={`${preview.totalRows} row${preview.totalRows === 1 ? "" : "s"} read.`}>
          {preview.plan.problems.length > 0 && (
            <ul className="mb-3 space-y-1">{preview.plan.problems.map((p, i) => <li key={i} className="text-sm text-destructive rounded-md bg-destructive/5 border border-destructive/30 p-2">{p}</li>)}</ul>
          )}
          {preview.plan.warnings.length > 0 && (
            <ul className="mb-3 space-y-1">{preview.plan.warnings.map((p, i) => <li key={i} className="text-sm text-amber-900 rounded-md bg-amber-50 border border-amber-200 p-2">{p}</li>)}</ul>
          )}
          {preview.duplicate && (
            <p className="mb-3 text-sm rounded-md bg-amber-50 border border-amber-200 p-2 text-amber-900">This exact file was already imported{preview.duplicate.by ? ` by ${preview.duplicate.by}` : ""} on {niceDay(String(preview.duplicate.at).slice(0, 10), true)}. Saving it again will do nothing.</p>
          )}

          <h3 className="text-sm font-semibold mb-1">Columns we understood</h3>
          {preview.plan.mapped.length === 0 ? <Empty>No columns were recognised as measurements.</Empty> : (
            <div className="flex flex-wrap gap-1.5 mb-4">{preview.plan.mapped.map((m) => <Pill key={m.column} tone="green">{m.header} → {metricByKey(m.metric)?.label ?? m.metric}</Pill>)}</div>
          )}

          {preview.plan.ignored.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold mb-1">Columns left out</h3>
              <p className="text-xs text-muted-foreground mb-2">Map one to a measurement if it is worth keeping, then preview again.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {preview.plan.ignored.map((h) => (
                  <div key={h} className="flex items-center gap-2">
                    <span className="text-sm flex-1 min-w-0 truncate" title={h}>{h}</span>
                    <Pick className="w-52" value={mapping[h] ?? ""} allowNone="Leave out" placeholder="Leave out"
                      onChange={(v) => setMapping({ ...mapping, [h]: v })} options={METRICS.map((m) => ({ value: m.key, label: m.label }))} />
                  </div>
                ))}
              </div>
              <Button variant="outline" className={`${control} mt-3`} disabled={prev.busy} onClick={() => runPreview(mapping)}>Preview again with these</Button>
            </div>
          )}

          <h3 className="text-sm font-semibold mb-1">Whose numbers are these?</h3>
          <p className="text-xs text-muted-foreground mb-2">Link each name in the file to a squad player. Names left blank are kept and can be linked later on the Dashboard.</p>
          <TableWrap>
            <table className="w-full" data-testid="perf-import-links">
              <thead><tr><th className={th}>Name in the file</th><th className={th}>Squad player</th><th className={th}>How we matched</th></tr></thead>
              <tbody>{preview.links.map((l) => (
                <tr key={l.player}>
                  <td className={`${td} font-medium`}>{l.player}</td>
                  <td className={td}><Pick className="w-60" value={links[l.player] ?? ""} allowNone="Not linked yet" placeholder="Not linked yet"
                    onChange={(v) => setLinks({ ...links, [l.player]: v })} options={preview.squad.map((s) => ({ value: String(s.contactId), label: s.name }))} /></td>
                  <td className={`${td} text-xs text-muted-foreground`}>{l.how}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableWrap>

          {preview.plan.rows.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mt-4 mb-1">First rows</h3>
              <TableWrap>
                <table className="w-full"><thead><tr><th className={th}>Player</th><th className={th}>Date</th><th className={th}>Session</th><th className={th}>Values</th></tr></thead>
                  <tbody>{preview.plan.rows.slice(0, 8).map((r) => (
                    <tr key={r.line}><td className={td}>{r.player}</td><td className={td}>{niceDay(r.date, true)}</td><td className={td}>{r.session ?? "—"}</td>
                      <td className={`${td} text-xs`}>{Object.entries(r.values).map(([k, v]) => `${metricByKey(k)?.label ?? k}: ${v}`).join(" · ") || "—"}{r.unreadable.length > 0 && <span className="text-amber-800"> · could not read: {r.unreadable.join(", ")}</span>}</td></tr>
                  ))}</tbody></table>
              </TableWrap>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button className={control} disabled={save.busy || preview.plan.problems.length > 0 || preview.plan.rows.length === 0}
              onClick={() => save.run(async () => {
                const l: Record<string, number | null> = {};
                for (const [name, v] of Object.entries(links)) l[name] = v ? Number(v) : null;
                const r = await send("POST", "/imports", { ...body(mapping), links: l });
                setResult(r.duplicate ? "That file was already imported. Nothing new was saved." : `Saved ${r.written} values across ${r.sessions} session${r.sessions === 1 ? "" : "s"}.`);
                reset();
                await refresh();
              })}>{save.busy ? "Saving…" : "Save these numbers"}</Button>
            {unresolved > 0 && <span className="text-xs text-muted-foreground">{unresolved} name{unresolved === 1 ? "" : "s"} not linked yet</span>}
          </div>
          <FormError error={save.error} />
        </Panel>
      )}
      {result && <p className="text-sm rounded-md bg-emerald-50 border border-emerald-200 p-3 text-emerald-900" data-testid="perf-import-result">{result}</p>}

      <Panel title="Recent imports">
        {history.isLoading ? <Loading rows={2} /> : history.isError ? <LoadError error={history.error} onRetry={() => history.refetch()} /> :
          (history.data?.imports.length ?? 0) === 0 ? <Empty>Nothing imported yet.</Empty> : (
            <TableWrap>
              <table className="w-full"><thead><tr>{["When", "Source", "File", "Rows", "Values", "By"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{history.data!.imports.map((i) => (
                  <tr key={i.id}><td className={td}>{niceDay(String(i.at).slice(0, 10), true)}</td><td className={td}>{i.source.replace(/_/g, " ")}</td><td className={`${td} text-xs`}>{i.filename ?? "—"}</td>
                    <td className={td}>{i.rows}</td><td className={td}>{i.values ?? "—"}</td><td className={td}>{i.by ?? "—"}</td></tr>
                ))}</tbody></table>
            </TableWrap>
          )}
      </Panel>
    </div>
  );
}
