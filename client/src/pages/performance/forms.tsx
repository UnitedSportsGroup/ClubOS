// Forms — customise the players' daily check-in. Daniel, 14 Nov: "copy all of
// those [Rowan's Smartabase questions] to start off with as the base template,
// and then we can customise from there."
//
// 🔴 What you change here changes the player's phone, "Enter for a player",
//    the report columns and the board's flag at once — they all read this form.
// 🔴 A question players have answered can be HIDDEN, never deleted (the server
//    refuses), so no past answer is ever orphaned.
// 🔴 Saving bumps the version; every past answer keeps the version it was
//    answered on. Two people editing at once: the second save is refused.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  allQuestions, formProblem, newQuestionId,
  type FlagRule, type FormDef, type Option, type Question, type QuestionType,
} from "@shared/perf-forms";
import { CheckInForm, SIU } from "@/components/performance/checkin-form";
import { Empty, Field, FormError, LoadError, Loading, PageHead, Panel, Pick, Pill, control, errText, refresh, send, usePerfQuery } from "./ui";

const TYPE_WORD: Record<QuestionType, string> = {
  choice: "One choice", multi: "Several choices", scale: "Number scale", body: "Body map", text: "Written answer", calc: "Worked out",
};
const ADDABLE: QuestionType[] = ["choice", "multi", "scale", "body", "text"];
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const optValue = (label: string, used: string[]) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "option";
  if (!used.includes(base)) return base;
  for (let i = 2; ; i++) if (!used.includes(`${base}_${i}`)) return `${base}_${i}`;
};

interface FormPayload { id: number; key: string; title: string; version: number; isDaily: boolean; templateKey: string | null; definition: FormDef; answered: string[] }

export default function Forms() {
  const list = usePerfQuery<{ forms: { id: number; title: string; version: number; isDaily: boolean; updatedAt: string; updatedBy: string | null; responses: number }[] }>("forms", "/forms");
  const daily = list.data?.forms.find((f) => f.isDaily) ?? list.data?.forms[0];
  return (
    <div className="space-y-4 min-w-0">
      <PageHead title="Forms" blurb="The questions players answer every morning. Start from Rowan's SI United Check In and change anything: wording, options, what's required, what gets flagged." />
      {list.isLoading && <Loading />}
      {list.isError && <LoadError error={list.error} onRetry={() => list.refetch()} />}
      {list.data && !daily && <Empty>No form yet. Run script/apply-performance-forms.ts to seed the SI United Check In template.</Empty>}
      {daily && <Editor key={daily.id} id={daily.id} meta={daily} />}
    </div>
  );
}

function Editor({ id, meta }: { id: number; meta: { updatedAt: string; updatedBy: string | null; responses: number } }) {
  const q = usePerfQuery<FormPayload>(`form-${id}`, `/forms/${id}`);
  const [draft, setDraft] = useState<FormDef | null>(null);
  const [editing, setEditing] = useState<{ s: number; i: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (q.data) setDraft(clone(q.data.definition)); }, [q.data]);

  const answered = useMemo(() => new Set(q.data?.answered ?? []), [q.data]);
  const dirty = !!(draft && q.data && JSON.stringify(draft) !== JSON.stringify(q.data.definition));
  const problem = draft ? formProblem(draft) : null;

  const mut = (fn: (d: FormDef) => void) => setDraft((d) => { if (!d) return d; const n = clone(d); fn(n); return n; });
  const save = async () => {
    if (!draft || !q.data) return;
    setBusy(true); setError(null); setDone(null);
    try { await send("PATCH", `/forms/${id}`, { definition: draft, version: q.data.version }); await refresh(); await q.refetch(); setDone("Saved. Players see the new form the next time they open it."); }
    catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  const reset = async () => {
    setBusy(true); setError(null); setDone(null);
    try { await send("POST", `/forms/${id}/reset`); await refresh(); await q.refetch(); setConfirmReset(false); setDone("Back to the SI United Check In template. Anything you added is kept at the end, hidden."); }
    catch (e) { setError(errText(e)); }
    setBusy(false);
  };

  if (q.isLoading || !draft) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const editQ = editing ? draft.sections[editing.s]?.questions[editing.i] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px] items-start">
      <div className="space-y-4 min-w-0">
        <Panel
          title="The form"
          note={`Version ${q.data!.version}${meta.updatedBy ? `, last saved by ${meta.updatedBy}` : ""} · ${meta.responses} answers so far`}
          right={
            <div className="flex flex-wrap gap-2">
              {confirmReset
                ? <><Button variant="destructive" className={control} onClick={reset} disabled={busy}>Yes, back to the template</Button><Button variant="ghost" className={control} onClick={() => setConfirmReset(false)}>Cancel</Button></>
                : <Button variant="outline" className={control} onClick={() => setConfirmReset(true)} disabled={busy}><RotateCcw className="w-4 h-4 mr-1.5" />Back to template</Button>}
              <Button className={control} onClick={save} disabled={busy || !dirty || !!problem} data-testid="form-save">{busy ? "Saving…" : dirty ? "Save changes" : "Saved"}</Button>
            </div>
          }
        >
          <div className="grid gap-3">
            <Field label="Title"><Input className={control} value={draft.title} onChange={(e) => mut((d) => { d.title = e.target.value; })} /></Field>
            <Field label="Line under the title (players see it)"><Input className={control} value={draft.intro ?? ""} onChange={(e) => mut((d) => { d.intro = e.target.value || undefined; })} /></Field>
          </div>
          {problem && <p className="mt-3 text-sm text-amber-700">{problem}</p>}
          <FormError error={error} />
          {done && <p className="mt-3 text-sm text-emerald-700">{done}</p>}
        </Panel>

        {draft.sections.map((sec, si) => (
          <Panel key={sec.id}
            right={
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label="Move section up" disabled={si === 0} onClick={() => mut((d) => { [d.sections[si - 1], d.sections[si]] = [d.sections[si], d.sections[si - 1]]; })}><ArrowUp className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" aria-label="Move section down" disabled={si === draft.sections.length - 1} onClick={() => mut((d) => { [d.sections[si + 1], d.sections[si]] = [d.sections[si], d.sections[si + 1]]; })}><ArrowDown className="w-4 h-4" /></Button>
                {sec.questions.length === 0 && <Button variant="ghost" size="icon" aria-label="Delete section" onClick={() => mut((d) => { d.sections.splice(si, 1); })}><Trash2 className="w-4 h-4" /></Button>}
              </div>
            }>
            <Input className={`${control} font-semibold mb-3`} value={sec.title} aria-label="Section title" onChange={(e) => mut((d) => { d.sections[si].title = e.target.value; })} />
            <ul className="divide-y divide-border">
              {sec.questions.map((qq, qi) => {
                const locked = answered.has(qq.id);
                const dep = qq.showIf ? allQuestions(draft).find((x) => x.id === qq.showIf!.q) : null;
                return (
                  <li key={qq.id} className={`py-2.5 flex flex-wrap items-start gap-2 ${qq.hidden ? "opacity-50" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">{qq.label}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        <Pill>{TYPE_WORD[qq.type]}</Pill>
                        {qq.required && <Pill tone="blue">Required</Pill>}
                        {qq.hidden && <Pill tone="amber">Hidden</Pill>}
                        {qq.flags?.length ? <Pill tone="amber">Flags</Pill> : null}
                        {dep && <span className="text-muted-foreground">Only when "{dep.short ?? dep.label}" is {qq.showIf!.in.map((v) => dep.options?.find((o) => o.value === v)?.label ?? v).join(" or ")}</span>}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" aria-label="Move up" disabled={qi === 0} onClick={() => mut((d) => { const a = d.sections[si].questions; [a[qi - 1], a[qi]] = [a[qi], a[qi - 1]]; })}><ArrowUp className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Move down" disabled={qi === sec.questions.length - 1} onClick={() => mut((d) => { const a = d.sections[si].questions; [a[qi + 1], a[qi]] = [a[qi], a[qi + 1]]; })}><ArrowDown className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={qq.hidden ? "Show" : "Hide"} onClick={() => mut((d) => { const x = d.sections[si].questions[qi]; x.hidden = x.hidden ? undefined : true; })}>{qq.hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</Button>
                      <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing({ s: si, i: qi })}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label="Delete" disabled={locked} title={locked ? "Players have answered this. Hide it instead, so their answers stay." : "Delete"}
                        onClick={() => mut((d) => { d.sections[si].questions.splice(qi, 1); })}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {ADDABLE.map((t) => (
                <Button key={t} variant="outline" size="sm" onClick={() => {
                  const label = "New question";
                  mut((d) => {
                    const nq: Question = { id: newQuestionId(d, `${label} ${TYPE_WORD[t]}`), label, type: t };
                    if (t === "choice" || t === "multi") nq.options = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
                    if (t === "scale") { nq.min = 0; nq.max = 10; nq.step = 1; }
                    d.sections[si].questions.push(nq);
                  });
                  setEditing({ s: si, i: sec.questions.length });
                }}><Plus className="w-3.5 h-3.5 mr-1" />{TYPE_WORD[t]}</Button>
              ))}
            </div>
          </Panel>
        ))}
        <Button variant="outline" className={control} onClick={() => mut((d) => { d.sections.push({ id: `s${Date.now().toString(36)}`, title: "New section", questions: [] }); })}>
          <Plus className="w-4 h-4 mr-1.5" />Add a section</Button>
      </div>

      <div className="lg:sticky lg:top-4 min-w-0">
        <p className="text-xs font-medium text-muted-foreground mb-2">Preview — what a player sees{dirty ? " (unsaved)" : ""}</p>
        <div className="rounded-[2rem] border-[8px] border-neutral-900 overflow-hidden">
          <div className="max-h-[75vh] overflow-y-auto px-3 pt-4 pb-6" style={{ background: SIU.bg, color: SIU.ink }}>
            <h2 className="text-lg font-semibold">{draft.title}</h2>
            {draft.intro && <p className="mt-1 text-sm" style={{ color: SIU.mute }}>{draft.intro}</p>}
            {!problem && <CheckInForm key={JSON.stringify(draft)} def={draft} submitLabel="Preview only, nothing is saved" onSubmit={async () => ({ ok: false, message: "This is a preview. Use Try the player app to save a test entry." })} />}
          </div>
        </div>
      </div>

      {editQ && editing && (
        <QuestionDialog q={editQ} form={draft} locked={answered.has(editQ.id)}
          onClose={() => setEditing(null)}
          onSave={(nq) => { mut((d) => { d.sections[editing.s].questions[editing.i] = nq; }); setEditing(null); }} />
      )}
    </div>
  );
}

// ── one question ─────────────────────────────────────────────────────────────
function QuestionDialog({ q, form, locked, onClose, onSave }: { q: Question; form: FormDef; locked: boolean; onClose: () => void; onSave: (q: Question) => void }) {
  const [x, setX] = useState<Question>(() => clone(q));
  const set = (p: Partial<Question>) => setX((c) => ({ ...c, ...p }));
  const deps = allQuestions(form).filter((o) => o.id !== q.id && (o.type === "choice" || o.type === "multi"));
  const depQ = deps.find((o) => o.id === x.showIf?.q);
  const [marksText, setMarksText] = useState(() => Object.entries(q.marks ?? {}).map(([k, v]) => `${k}=${v}`).join(", "));

  // Flags, as plain controls. Rules are rebuilt only for the kind of question it is.
  const optionLevel = (v: string) => x.flags?.find((f) => f.in?.includes(v))?.level ?? "";
  const setOptionLevel = (o: Option, level: string) => {
    const others = (x.flags ?? []).filter((f) => !f.in?.includes(o.value));
    set({ flags: level ? [...others, { in: [o.value], level: level as "red" | "amber", reason: `${x.short ?? x.label}: ${o.label}` }] : others });
  };
  const scaleAt = (level: "red" | "amber") => x.flags?.find((f) => f.level === level && f.lte != null)?.lte;
  const setScaleAt = (level: "red" | "amber", n: string) => {
    const others = (x.flags ?? []).filter((f) => !(f.level === level && f.lte != null));
    const rule: FlagRule[] = n === "" ? [] : [{ lte: Number(n), level, reason: `${x.short ?? x.label} {value}` }];
    const all = [...others, ...rule].sort((a, b) => (a.level === "red" ? -1 : 1) - (b.level === "red" ? -1 : 1));
    set({ flags: all.length ? all : undefined });
  };
  const bodyAt = x.flags?.find((f) => f.minCount != null)?.minCount;

  const done = () => {
    const out = { ...x };
    if (out.type === "scale") {
      const marks: Record<string, string> = {};
      for (const part of marksText.split(",")) { const [k, ...v] = part.split("="); if (k?.trim() && v.join("=").trim()) marks[k.trim()] = v.join("=").trim(); }
      out.marks = Object.keys(marks).length ? marks : undefined;
    }
    if (!out.short?.trim()) delete out.short;
    if (!out.help?.trim()) delete out.help;
    onSave(out);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit question</DialogTitle></DialogHeader>
        <div className="space-y-3 min-w-0">
          <Field label="Question"><Input className={control} value={x.label} onChange={(e) => set({ label: e.target.value })} data-testid="q-label" /></Field>
          <Field label="Short name for the report column (optional)"><Input className={control} value={x.short ?? ""} onChange={(e) => set({ short: e.target.value })} /></Field>
          <Field label="Help line under the question (optional)"><Textarea rows={2} value={x.help ?? ""} onChange={(e) => set({ help: e.target.value })} /></Field>
          {x.type !== "calc" && <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!x.required} onCheckedChange={(v) => set({ required: v ? true : undefined })} />Players must answer this</label>}
          <p className="text-xs text-muted-foreground">{TYPE_WORD[x.type]}{locked ? " · players have answered this, so its options keep their meaning: you can reword them and add new ones." : ""}</p>

          {(x.type === "choice" || x.type === "multi") && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Options, and whether picking one flags the player</p>
              {x.options!.map((o, i) => (
                <div key={o.value} className="flex gap-2 items-center">
                  <Input className={`${control} flex-1`} value={o.label} onChange={(e) => set({ options: x.options!.map((p, j) => (j === i ? { ...p, label: e.target.value } : p)) })} />
                  <Pick className="w-36" value={optionLevel(o.value)} allowNone="No flag" options={[{ value: "amber", label: "Take care" }, { value: "red", label: "Concern" }]} onChange={(v) => setOptionLevel(o, v)} />
                  <Button variant="ghost" size="icon" aria-label="Remove option" disabled={locked || x.options!.length <= 2}
                    onClick={() => set({ options: x.options!.filter((_, j) => j !== i), flags: x.flags?.filter((f) => !f.in?.includes(o.value)) })}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => set({ options: [...x.options!, { value: optValue("New option", x.options!.map((o) => o.value)), label: "New option" }] })}><Plus className="w-3.5 h-3.5 mr-1" />Add option</Button>
            </div>
          )}

          {x.type === "scale" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Lowest"><Input className={control} inputMode="numeric" value={String(x.min ?? 0)} onChange={(e) => set({ min: Number(e.target.value) || 0 })} /></Field>
                <Field label="Highest"><Input className={control} inputMode="numeric" value={String(x.max ?? 10)} onChange={(e) => set({ max: Number(e.target.value) || 0 })} /></Field>
                <Field label="Step"><Input className={control} inputMode="numeric" value={String(x.step ?? 1)} onChange={(e) => set({ step: Math.max(1, Number(e.target.value) || 1) })} /></Field>
              </div>
              <Field label="Words under numbers, e.g. 1=Very Light, 5=Hard"><Input className={control} value={marksText} onChange={(e) => setMarksText(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Take care at or below"><Input className={control} inputMode="numeric" value={scaleAt("amber") != null ? String(scaleAt("amber")) : ""} onChange={(e) => setScaleAt("amber", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="No flag" /></Field>
                <Field label="Concern at or below"><Input className={control} inputMode="numeric" value={scaleAt("red") != null ? String(scaleAt("red")) : ""} onChange={(e) => setScaleAt("red", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="No flag" /></Field>
              </div>
            </>
          )}

          {x.type === "body" && (
            <Field label="Take care when a player ticks this many areas or more">
              <Input className={control} inputMode="numeric" value={bodyAt != null ? String(bodyAt) : ""} placeholder="No flag"
                onChange={(e) => { const n = e.target.value.replace(/[^0-9]/g, ""); set({ flags: n ? [{ minCount: Number(n), level: "amber", reason: "Managing {value} areas" }] : undefined }); }} />
            </Field>
          )}

          {deps.length > 0 && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!x.showIf} onCheckedChange={(v) => set({ showIf: v ? { q: deps[0].id, in: [] } : undefined })} />Only ask this after a particular answer</label>
              {x.showIf && (
                <>
                  <Pick value={x.showIf.q} options={deps.map((d) => ({ value: d.id, label: d.short ?? d.label }))} onChange={(v) => set({ showIf: { q: v, in: [] } })} />
                  <div className="flex flex-wrap gap-3">
                    {depQ?.options?.map((o) => (
                      <label key={o.value} className="flex items-center gap-2 text-sm"><Checkbox checked={x.showIf!.in.includes(o.value)}
                        onCheckedChange={(v) => set({ showIf: { q: x.showIf!.q, in: v ? [...x.showIf!.in, o.value] : x.showIf!.in.filter((k) => k !== o.value) } })} />{o.label}</label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button onClick={done} disabled={!x.label.trim() || (!!x.showIf && !x.showIf.in.length)}>Done</Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
          <p className="text-xs text-muted-foreground">Remember to press Save changes on the form.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
