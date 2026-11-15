// The SIU check-in form, drawn from its definition (shared/perf-forms.ts).
// ONE renderer for every door: the player's phone, staff "Enter for athlete",
// "Try the player app" and the no-login demo. Change the form, all four change.
//
// 🔴 Every control is drawn here, never by the browser (ClubOS standing rule).
// 🔴 The answers are checked with the SAME validateAnswers the server runs, so
//    the phone names the missing question before it ever sends.
import { useMemo, useState, type ReactNode } from "react";
import { Loader2, Minus, Plus, X } from "lucide-react";
import {
  AnswerError, BODY_REGIONS, answerText, calcValue, isShown, regionLabel, validateAnswers,
  type AnswerValue, type Answers, type BodyRegion, type FormDef, type Question,
} from "@shared/perf-forms";

export const SIU = { bg: "#0B0B0B", card: "#141414", line: "rgba(255,255,255,0.08)", ink: "#F5F1E8", mute: "rgba(245,241,232,0.6)", gold: "#C59949", pine: "#1F3D2B", red: "#F2B8B5" };

const tile = (on: boolean) => on
  ? { background: SIU.gold, color: "#0B0B0B", border: `1px solid ${SIU.gold}` }
  : { background: "#0B0B0B", color: SIU.ink, border: `1px solid ${SIU.line}` };

// ── body map ─────────────────────────────────────────────────────────────────
// Front: the player's RIGHT is on the viewer's left. Back: their left is on the left.
type Box = [x: number, y: number, w: number, h: number];
const PART_BOX: Record<string, { front: Box; back?: Box }> = {
  "Head": { front: [47, 4, 26, 28] },
  "Neck": { front: [53, 32, 14, 10] },
  "Shoulder": { front: [26, 42, 20, 13] },
  "Chest": { front: [46, 44, 14, 24] },
  "Upper Back": { front: [46, 44, 14, 24] },
  "Abdomen": { front: [47, 68, 13, 22] },
  "Lower Back": { front: [47, 68, 13, 22] },
  "Pelvis": { front: [46, 90, 14, 17] },
  "Upper Arm": { front: [22, 56, 13, 32] },
  "Lower Arm / Hand": { front: [17, 89, 13, 44] },
  "Upper Leg": { front: [45, 108, 15, 44] },
  "Knee": { front: [46, 153, 13, 13] },
  "Lower Leg / Foot": { front: [46, 167, 13, 60] },
};
function boxFor(r: BodyRegion): Box | null {
  const b = PART_BOX[r.part]?.front;
  if (!b) return null;
  const [x, y, w, h] = b;
  if (r.side === "centre") return b;
  // The box above is drawn on the viewer's LEFT. Front view: that is the player's right.
  const viewerLeft = r.view === "front" ? r.side === "right" : r.side === "left";
  return viewerLeft ? b : [120 - x - w, y, w, h];
}

function BodyMap({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);
  const figure = (view: "front" | "back") => (
    <div className="flex-1 min-w-0">
      <svg viewBox="0 0 120 232" className="mx-auto block h-auto w-full max-w-[150px]" role="group" aria-label={view === "front" ? "Front of body" : "Back of body"}>
        {BODY_REGIONS.filter((r) => r.view === view).map((r) => {
          const b = boxFor(r); if (!b) return null;
          const on = value.includes(r.key);
          return (
            <rect key={r.key} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx={r.part === "Head" ? 12 : 5}
              role="button" tabIndex={0} aria-pressed={on} aria-label={r.label}
              onClick={() => toggle(r.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r.key); } }}
              style={{ cursor: "pointer", outline: "none" }}
              fill={on ? SIU.gold : "rgba(245,241,232,0.10)"} stroke={on ? SIU.ink : "rgba(245,241,232,0.35)"} strokeWidth={on ? 1.4 : 0.8}>
              <title>{r.label}</title>
            </rect>
          );
        })}
      </svg>
      <p className="mt-1 text-center text-xs" style={{ color: SIU.mute }}>{view === "front" ? "Front" : "Back"}</p>
    </div>
  );
  return (
    <div>
      <div className="flex gap-3">{figure("front")}{figure("back")}</div>
      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.map((k) => (
            <button key={k} type="button" onClick={() => toggle(k)} aria-label={`Remove ${regionLabel(k)}`}
              className="flex min-h-[36px] items-center gap-1 rounded-full px-3 text-xs font-medium" style={tile(true)}>
              {regionLabel(k)} <X size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── one question ─────────────────────────────────────────────────────────────
function ScaleInput({ q, value, onChange }: { q: Question; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const min = q.min ?? 0, max = q.max ?? 10, step = q.step ?? 1;
  const count = Math.floor((max - min) / step) + 1;
  if (count <= 11) {
    const nums = Array.from({ length: count }, (_, i) => min + i * step);
    return (
      <div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(count, 6)}, minmax(0, 1fr))` }}>
          {nums.map((n) => (
            <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(value === n ? undefined : n)}
              className="min-h-[52px] rounded-xl px-0.5 py-1" style={tile(value === n)}>
              <span className="block text-lg font-semibold leading-tight tabular-nums">{n}</span>
              {q.marks?.[String(n)] && <span className="block text-[10px] leading-tight" style={{ opacity: 0.85 }}>{q.marks[String(n)]}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }
  // Long ranges (minutes): − / + and quick picks.
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
  const quick = [30, 45, 60, 75, 90, 120].filter((n) => n >= min && n <= max);
  const b = "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl";
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button type="button" aria-label={`Less ${q.label}`} className={b} style={tile(false)} onClick={() => set((value ?? min) - step)}><Minus size={20} /></button>
        <div className="text-center text-2xl font-semibold tabular-nums">{value ?? <span className="text-base font-normal" style={{ color: SIU.mute }}>Not set</span>}</div>
        <button type="button" aria-label={`More ${q.label}`} className={b} style={tile(false)} onClick={() => set((value ?? min) + step)}><Plus size={20} /></button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {quick.map((n) => <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)} className="min-h-[40px] rounded-full px-3 text-sm" style={tile(value === n)}>{n}</button>)}
        {value != null && <button type="button" onClick={() => onChange(undefined)} className="min-h-[40px] rounded-full px-3 text-sm underline" style={{ color: SIU.mute }}>Clear</button>}
      </div>
    </div>
  );
}

function QuestionBlock({ q, answers, set, error }: { q: Question; answers: Answers; set: (id: string, v: AnswerValue | undefined) => void; error?: string }) {
  const v = answers[q.id];
  let body: ReactNode = null;
  switch (q.type) {
    case "choice":
      body = (
        <div className="flex flex-col gap-2">
          {q.options!.map((o) => (
            <button key={o.value} type="button" aria-pressed={v === o.value} onClick={() => set(q.id, v === o.value ? undefined : o.value)}
              className="min-h-[48px] rounded-xl px-4 text-left text-base" style={tile(v === o.value)}>{o.label}</button>
          ))}
        </div>
      );
      break;
    case "multi": {
      const list = Array.isArray(v) ? v : [];
      body = (
        <div className="flex flex-wrap gap-2">
          {q.options!.map((o) => {
            const on = list.includes(o.value);
            return <button key={o.value} type="button" aria-pressed={on} onClick={() => set(q.id, on ? list.filter((x) => x !== o.value) : [...list, o.value])}
              className="min-h-[48px] rounded-full px-4 text-base" style={tile(on)}>{o.label}</button>;
          })}
        </div>
      );
      break;
    }
    case "scale": body = <ScaleInput q={q} value={typeof v === "number" ? v : undefined} onChange={(n) => set(q.id, n)} />; break;
    case "body": body = <BodyMap value={Array.isArray(v) ? v : []} onChange={(l) => set(q.id, l)} />; break;
    case "text":
      body = <textarea value={typeof v === "string" ? v : ""} onChange={(e) => set(q.id, e.target.value)} maxLength={1000} rows={3}
        className="w-full rounded-xl px-3 py-2 text-base outline-none focus:ring-2 focus:ring-[#C59949]"
        style={{ background: "#0B0B0B", border: `1px solid ${SIU.line}`, color: SIU.ink }} />;
      break;
    case "calc": {
      const c = calcValue(q, answers);
      body = <p className="text-2xl font-semibold tabular-nums">{c ?? <span className="text-sm font-normal" style={{ color: SIU.mute }}>Worked out from your answers above</span>}</p>;
      break;
    }
  }
  return (
    <div className="mb-5" data-question={q.id}>
      <p className="mb-1 text-base font-medium">{q.label}{q.required && <span style={{ color: SIU.gold }}> *</span>}</p>
      {q.help && <p className="mb-2 text-xs" style={{ color: SIU.mute }}>{q.help}</p>}
      {body}
      {error && <p role="alert" className="mt-2 text-sm" style={{ color: SIU.red }}>{error}</p>}
    </div>
  );
}

// ── the form ─────────────────────────────────────────────────────────────────
export interface SubmitResult { ok: boolean; message?: string; questionId?: string }

export function CheckInForm({ def, initial, onSubmit, submitLabel = "Submit check-in", onCancel }: {
  def: FormDef; initial?: Answers | null; onSubmit: (answers: Answers) => Promise<SubmitResult>; submitLabel?: string; onCancel?: () => void;
}) {
  const [answers, setAnswers] = useState<Answers>(() => ({ ...(initial ?? {}) }));
  const [errs, setErrs] = useState<{ id?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, v: AnswerValue | undefined) => {
    setErrs(null);
    setAnswers((a) => { const n = { ...a }; if (v == null || (Array.isArray(v) && !v.length) || v === "") delete n[id]; else n[id] = v; return n; });
  };
  const sections = useMemo(() => def.sections.map((s) => ({ ...s, questions: s.questions.filter((q) => !q.hidden) })).filter((s) => s.questions.length), [def]);

  const submit = async () => {
    try { validateAnswers(def, answers); }
    catch (e) {
      if (e instanceof AnswerError) {
        setErrs({ id: e.questionId, msg: e.message });
        document.querySelector(`[data-question="${e.questionId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      throw e;
    }
    setBusy(true); setErrs(null);
    try {
      const r = await onSubmit(answers);
      if (!r.ok) setErrs({ id: r.questionId, msg: r.message ?? "Could not save. Try again." });
    } catch { setErrs({ msg: "No connection. Try again." }); }
    setBusy(false);
  };

  return (
    <div>
      {sections.map((s) => (
        <section key={s.id} className="mt-4 rounded-2xl p-4" style={{ background: SIU.card, border: `1px solid ${SIU.line}` }}>
          <h2 className="mb-4 text-lg font-semibold" style={{ color: SIU.gold }}>{s.title}</h2>
          {s.questions.filter((q) => isShown(q, answers)).map((q) => (
            <QuestionBlock key={q.id} q={q} answers={answers} set={set} error={errs?.id === q.id ? errs.msg : undefined} />
          ))}
        </section>
      ))}
      {errs && <p role={errs.id ? undefined : "alert"} className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: "rgba(192,80,77,0.18)", color: SIU.red }}>{errs.msg}</p>}
      <div className="mt-4 space-y-2">
        <button type="button" onClick={submit} disabled={busy} data-testid="checkin-submit"
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold disabled:opacity-50"
          style={{ background: SIU.gold, color: "#0B0B0B" }}>{busy && <Loader2 className="animate-spin" size={18} />}{submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="flex min-h-[48px] w-full items-center justify-center rounded-xl text-base" style={{ border: `1px solid ${SIU.line}`, color: SIU.ink }}>Cancel</button>}
      </div>
    </div>
  );
}

/** Read-only answers, for "Done" cards and the report's detail view. */
export function AnswerList({ def, answers, dark = true }: { def: FormDef; answers: Answers; dark?: boolean }) {
  return (
    <dl className="space-y-3">
      {def.sections.map((s) => {
        const qs = s.questions.filter((q) => isShown(q, answers) && answers[q.id] != null);
        if (!qs.length) return null;
        return (
          <div key={s.id}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide" style={dark ? { color: SIU.gold } : undefined}>{s.title}</p>
            {qs.map((q) => (
              <div key={q.id} className="flex justify-between gap-4 py-1 text-sm">
                <dt style={dark ? { color: SIU.mute } : undefined} className={dark ? "" : "text-muted-foreground"}>{q.short ?? q.label}</dt>
                <dd className="text-right font-medium">{answerText(q, answers[q.id])}</dd>
              </div>
            ))}
          </div>
        );
      })}
    </dl>
  );
}
