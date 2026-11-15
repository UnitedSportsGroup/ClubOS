// Shared bits for the Performance area: fetching, dates, small components.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

export const BASE = "/api/admin/performance";

/** Turn "409: {"message":"..."}" into the server's own sentence. */
export function errText(e: unknown): string {
  const raw = (e as Error)?.message ?? "Something went wrong.";
  const body = raw.replace(/^\d+:\s*/, "");
  try {
    const j = JSON.parse(body);
    if (j && typeof j.message === "string") return j.message;
  } catch { /* not json */ }
  return body || "Something went wrong.";
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await workspaceFetch(`${BASE}${path}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(errText(new Error(`${res.status}: ${t}`)));
  }
  return res.json();
}

export async function send<T = any>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  try {
    const res = await apiRequest(method, `${BASE}${path}`, body ?? (method === "DELETE" ? undefined : {}));
    return await res.json();
  } catch (e) {
    throw new Error(errText(e));
  }
}

export const refresh = () => queryClient.invalidateQueries({ queryKey: ["perf"] });

export function usePerfQuery<T>(key: string, path: string) {
  return useQuery<T>({ queryKey: ["perf", key, path], queryFn: () => getJson<T>(path), staleTime: 30_000 });
}

// ── dates on their parts, never through a Date ──
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function niceDay(iso: string | null | undefined, withYear = false): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export const control = "h-11 md:h-9";

// ── types (the shapes server/performance-routes.ts returns) ──
export type Level = "green" | "amber" | "red" | null;
export interface Readiness { level: Level; used: string[]; missing: string[]; reasons: string[] }
export interface LoadSummary { acute7: number | null; chronic28: number | null; acwr: number | null; acwrNote: string | null; monotony: number | null; strain: number | null; band: "low" | "sweet" | "high" | "danger" | null }
export interface GpsValue { value: number; date: string; source: string }
export interface BoardPlayer {
  contactId: number; name: string; position: string | null; squadNumber: number | null; squad: string; email: string | null;
  availability: { state: string; since: string | null; expectedReturn: string | null; bodyArea: string | null };
  wellness: null | { score: number | null; flag: "red" | "amber" | null; reasons: string[]; items: Record<string, number | null>; sleepHours: number | null; soreAreas: string[]; byAthlete: boolean; medicalFlag?: boolean | null; note?: string | null };
  checkIn: null | { id: number; flag: "red" | "amber" | null; reasons: string[]; byAthlete: boolean; summary: { label: string; text: string }[] };
  rpe: { date: string; kind: string; rpe: number; minutes: number | null }[];
  load: LoadSummary; readiness: Readiness; gps: Record<string, GpsValue>;
  account: "none" | "invited" | "active" | "disabled"; lastSignIn: string | null;
}
export interface Overview {
  today: string; medical: boolean; players: BoardPlayer[];
  counts: { squad: number; available: number; modified: number; out: number; checkedIn: number; flagged: number; accounts: number };
  unlinked: { id: number; source: string; source_athlete_key: string; source_name: string; readings: number }[];
}
export interface SourceRow {
  key: string; name: string; category: string; state: "built" | "import" | "planned"; priority: "now" | "next" | "later";
  what: string; how: string; advice: string; last: string | null; readings: number;
}
export interface Catalogue {
  today: string; medical: boolean; sources: SourceRow[];
  metrics: { key: string; label: string; unit: string | null; category: string; higherIsBetter: boolean | null; decimals?: number }[];
  formulas: { name: string; formula: string; reads: string }[];
  wellnessItems: { key: string; label: string; low: string; high: string }[];
  soreAreas: string[];
}
export const useOverview = (date?: string) => usePerfQuery<Overview>("overview", `/overview${date ? `?date=${date}` : ""}`);
export const useCatalogue = () => usePerfQuery<Catalogue>("catalogue", "/catalogue");

// ── components ──
export function PageHead({ title, blurb, right }: { title: string; blurb?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {blurb && <p className="text-sm text-muted-foreground mt-0.5 max-w-3xl">{blurb}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ title, note, right, children, className }: { title?: string; note?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-4 min-w-0", className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
            {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-foreground mt-0.5">{value}</div>
      {note && <div className="text-xs text-muted-foreground mt-0.5">{note}</div>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="performance-loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" data-testid="performance-error">
      <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Couldn't load this</p>
        <p className="text-xs text-muted-foreground mt-1 break-words">{errText(error)}</p>
        {onRetry && <button type="button" onClick={onRetry} className="text-xs font-medium text-primary hover:underline mt-2">Try again</button>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground rounded-lg border border-dashed border-border p-4">{children}</p>;
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="text-sm text-destructive break-words" data-testid="performance-form-error">{error}</p>;
}

const LEVEL_CLASS: Record<string, string> = {
  green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500",
};
const LEVEL_WORD: Record<string, string> = { green: "Ready", amber: "Take care", red: "Concern" };
export function LevelDot({ level, label = true }: { level: Level; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <span className={cn("inline-block w-2.5 h-2.5 rounded-full", level ? LEVEL_CLASS[level] : "bg-muted-foreground/30")} aria-hidden />
      {label && <span>{level ? LEVEL_WORD[level] : "No reading"}</span>}
    </span>
  );
}

const PILL: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 border-emerald-200",
  amber: "bg-amber-100 text-amber-900 border-amber-200",
  red: "bg-red-100 text-red-800 border-red-200",
  grey: "bg-muted text-muted-foreground border-border",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
};
export function Pill({ tone = "grey", children }: { tone?: keyof typeof PILL; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", PILL[tone])}>{children}</span>;
}

export const AVAIL_TONE: Record<string, keyof typeof PILL> = { available: "green", modified: "amber", injured: "red", ill: "red", unavailable: "red" };
export const AVAIL_WORD: Record<string, string> = { available: "Available", modified: "Modified training", injured: "Injured", ill: "Ill", unavailable: "Unavailable" };
export function AvailBadge({ state }: { state: string }) {
  return <Pill tone={AVAIL_TONE[state] ?? "grey"}>{AVAIL_WORD[state] ?? state}</Pill>;
}

export const BAND_WORD: Record<string, string> = { low: "Under-loaded (below 0.8)", sweet: "Sweet spot 0.8–1.3", high: "Rising 1.3–1.5", danger: "Spike (above 1.5)" };
export const BAND_TONE: Record<string, keyof typeof PILL> = { low: "blue", sweet: "green", high: "amber", danger: "red" };
export function BandPill({ band }: { band: string | null }) {
  if (!band) return null;
  return <Pill tone={BAND_TONE[band]}>{BAND_WORD[band]}</Pill>;
}

export function ScoreFlag({ score, flag }: { score: number | null; flag: "red" | "amber" | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium tabular-nums">{score}/25</span>
      {flag && <Pill tone={flag}>{flag === "red" ? "Flag" : "Watch"}</Pill>}
    </span>
  );
}

/** Coloured 1–5 cell (5 = good). */
export function ItemCell({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const tone = v <= 2 ? "red" : v === 3 ? "amber" : "green";
  return <Pill tone={tone}>{v}</Pill>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto -mx-1"><div className="min-w-max px-1">{children}</div></div>;
}
export const th = "text-left text-xs font-medium text-muted-foreground px-2 py-2 whitespace-nowrap border-b border-border";
export const td = "px-2 py-2 text-sm align-middle border-b border-border/60";

// ── controls ──
const NONE = "__none__";
export function Pick({ value, onChange, options, placeholder = "Choose…", className, testId, allowNone }: {
  value: string | null | undefined; onChange: (v: string) => void; options: { value: string; label: string }[];
  placeholder?: string; className?: string; testId?: string; allowNone?: string;
}) {
  return (
    <Select value={value ? value : allowNone ? NONE : undefined} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className={cn(control, className)} data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function DateField({ value, onChange, className, testId }: { value: string; onChange: (v: string) => void; className?: string; testId?: string }) {
  return <DatePickerInput value={value} onChange={(e) => onChange(e.target.value)} className={cn(control, className)} data-testid={testId} />;
}

/** 1–5 buttons, 5 = good. Tap the active one again to clear. */
export function ScoreButtons({ value, onChange, low, high }: { value: number | null; onChange: (v: number | null) => void; low: string; high: string }) {
  return (
    <div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)}
            className={cn("h-11 md:h-9 flex-1 min-w-[2.5rem] rounded-md border text-sm font-medium transition-colors",
              value === n ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background text-foreground hover:bg-muted")}
          >{n}</button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground mt-0.5"><span>1 {low}</span><span>5 {high}</span></div>
    </div>
  );
}

export function ToggleChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("h-9 px-3 rounded-full border text-[13px] transition-colors",
        on ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background text-foreground hover:bg-muted")}>
      {children}
    </button>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1 min-w-0", className)}>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Run a save, show the server's words if it refuses. */
export function useSaver() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(null); setDone(null);
    try { const m = await fn(); if (m) setDone(m); await refresh(); return true; }
    catch (e) { setError(errText(e)); return false; }
    finally { setBusy(false); }
  };
  return { error, busy, done, run, setError, setDone };
}

export function SaveButton({ busy, children, onClick, disabled }: { busy: boolean; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <Button className={control} onClick={onClick} disabled={busy || disabled}>{busy ? "Saving…" : children}</Button>;
}

export function Spark({ values, w = 80, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <span className="text-muted-foreground text-xs">—</span>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  return <svg width={w} height={h} aria-hidden className="text-primary"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>;
}
