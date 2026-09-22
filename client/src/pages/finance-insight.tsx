/**
 * Financial Insight — the club's cash P&L (Dec 2025 → now) with what-if levers, for the United Sports Group workspace.
 *
 * Whoever holds the tab sees the PASSWORD screen; the model is only fetched once the server says the session is unlocked
 * (POST unlock → eight hours). Every figure is computed in the browser from the snapshot the nightly refresh pushed —
 * the same events as the "CUFC 2026 — P&L (monthly)" sheet, so the two never disagree. Light theme only (admin rule).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { EMPTY, MON, PERIODS, byKey, describe, factor, fmt, monthsFor, narrow, nodeTotal, sum, summaryForAI, totals, type Model, type FiNode, type Period, type Scenario } from "@/lib/finance-insight-engine";
import { CashForecastView, MoneyOwedView, TermFeesView, WeOweView, WeekByWeekView, type CashForecast } from "@/components/finance-insight/forecast-views";

type View = "overview" | "forecast" | "weeks" | "owe" | "owed" | "fees" | "income" | "expenses" | "streams" | "ask";
// The views that look FORWARD (or at what is owed) read model.cashForecast and ignore the P&L levers and the period picker.
const FORWARD: View[] = ["forecast", "weeks", "owe", "owed", "fees"];
const VIEW_LABEL: Record<View, string> = { overview: "The gap", forecast: "Cash to 31 Dec", weeks: "Week by week", owe: "What we owe", owed: "Money owed", fees: "Term fees", income: "Income", expenses: "Expenses", streams: "By stream", ask: "Ask the analyst" };
const VIEWS: View[] = ["overview", "forecast", "weeks", "owe", "owed", "fees", "income", "expenses", "streams", "ask"];
/** The view lives in the URL hash so Back, a refresh and a shared link all land on it (the ClubOS tab-state rule). */
const viewFromHash = (): View => { const h = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""); return (VIEWS as string[]).includes(h) ? (h as View) : "overview"; };
const LS = "finance-insight-scenarios";
const API = "/api/admin/finance-insight";

export default function FinanceInsight() {
  const status = useQuery({ queryKey: [API, "status"], queryFn: async () => { const r = await workspaceFetch(`${API}/status`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); } });
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => { if (status.data?.unlocked) setUnlocked(true); }, [status.data]);
  if (status.isLoading) return <Frame><p className="text-sm text-muted-foreground">Checking…</p></Frame>;
  if (status.isError) return <Frame><p className="text-sm text-destructive">Financial Insight could not be reached ({String((status.error as any)?.message)}). Open it from the United Sports Group workspace.</p></Frame>;
  if (!unlocked) return <Frame><PasswordScreen configured={!!status.data?.configured} snapshot={status.data?.snapshot} onUnlocked={() => setUnlocked(true)} /></Frame>;
  return <App onLock={() => setUnlocked(false)} />;
}

function Frame({ children }: { children: any }) {
  return <div className="mx-auto max-w-[1500px] p-4 sm:p-6"><h1 className="mb-1 text-2xl font-semibold tracking-tight">Financial Insight</h1><p className="mb-6 text-sm text-muted-foreground">The gap, the levers, and who covers it — Christchurch United FC Inc</p>{children}</div>;
}

function PasswordScreen({ configured, snapshot, onUnlocked }: { configured: boolean; snapshot: { generatedAt: string; nodes: number } | null; onUnlocked: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [show, setShow] = useState(false);
  const go = async (e: any) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await workspaceFetch(`${API}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (!r.ok) { setErr(j.message || "That password is not right."); return; }
    setPw(""); onUnlocked();
  };
  return (
    <div className="max-w-md rounded-xl border bg-card p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password protected</div>
      <p className="mt-2 text-sm text-muted-foreground">This report carries salaries, donations and every payer by name. It opens only with the Financial Insight password, for eight hours in this session.</p>
      {!configured && <p className="mt-3 text-sm text-destructive">No password is configured on the server yet.</p>}
      <form onSubmit={go} className="mt-4 space-y-3">
        <div className="flex gap-2">
          <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="off" placeholder="password" className="premium-input w-full rounded-md border px-3 py-2 text-sm" />
          <button type="button" onClick={() => setShow((v) => !v)} className="rounded-md border px-3 text-xs text-muted-foreground">{show ? "hide" : "show"}</button>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button type="submit" disabled={busy || !pw} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Checking…" : "Open the report"}</button>
      </form>
      {snapshot ? <p className="mt-4 text-xs text-muted-foreground">Latest snapshot {snapshot.generatedAt.slice(0, 10)} · {snapshot.nodes} lines</p> : <p className="mt-4 text-xs text-muted-foreground">No snapshot has been pushed yet.</p>}
    </div>
  );
}

function App({ onLock }: { onLock: () => void }) {
  const q = useQuery({ queryKey: [API, "model"], queryFn: async () => { const r = await workspaceFetch(`${API}/model`); if (!r.ok) throw new Error(r.status === 403 ? "locked" : `HTTP ${r.status}`); return r.json(); } });
  const [s, setS] = useState<Scenario>(EMPTY); const [view, setViewState] = useState<View>(viewFromHash);
  useEffect(() => { const on = () => setViewState(viewFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  const setView = (v: View) => { setViewState(v); try { window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${v}`); } catch { /* ignore */ } };
  const [owedGroup, setOwedGroup] = useState<string | undefined>(undefined);
  const [levers, setLevers] = useState(() => typeof window === "undefined" || window.innerWidth >= 1024);
  const [period, setPeriod] = useState<Period>("ytd"); const [from, setFrom] = useState("2026-01"); const [to, setTo] = useState("2026-09");
  if (q.isLoading) return <Frame><p className="text-sm text-muted-foreground">Loading the model…</p></Frame>;
  if (q.isError) { if (String((q.error as any)?.message) === "locked") onLock(); return <Frame><p className="text-sm text-destructive">{String((q.error as any)?.message)}</p></Frame>; }
  const full: Model = q.data.model;
  const model = narrow(full, monthsFor(full, period, from, to));            // every view below sees only the months in the window
  const cf: CashForecast | undefined = (full as any).cashForecast;
  const forward = FORWARD.includes(view);
  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Financial Insight</h1><p className="text-sm text-muted-foreground">Cash P&amp;L Dec 2025 – Sep 2026 · refreshed {String(q.data.generatedAt).slice(0, 10)} · every figure from Xero, Xero Payroll and ClubOS — the same events as the P&amp;L sheet</p></div>
        <div className="flex flex-wrap items-center gap-2 text-xs print:hidden">
          {!forward && <PeriodPicker full={full} period={period} setPeriod={setPeriod} from={from} to={to} setFrom={setFrom} setTo={setTo} />}
          {!forward && <button onClick={() => setLevers((v) => !v)} className="rounded-md border px-3 py-1.5 hover:bg-muted">{levers ? "Hide levers" : "Levers"}</button>}
          <button onClick={() => window.print()} className="rounded-md border px-3 py-1.5 hover:bg-muted">Print / PDF</button>
          <button onClick={async () => { await workspaceFetch(`${API}/lock`, { method: "POST" }); onLock(); }} className="rounded-md border px-3 py-1.5 hover:bg-muted">Lock</button>
        </div>
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {levers && !forward && <Levers model={model} s={s} setS={setS} />}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap gap-2 print:hidden" data-testid="fi-views">{VIEWS.map((v) => <button key={v} data-view={v} onClick={() => setView(v)} className={`min-h-[36px] rounded-md px-3 py-1.5 text-sm ${view === v ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}>{VIEW_LABEL[v]}</button>)}</div>
          {view === "overview" && <Overview model={model} s={s} />}
          {view === "forecast" && <CashForecastView cf={cf} onOwe={() => setView("owe")} />}
          {view === "weeks" && <WeekByWeekView cf={cf} />}
          {view === "owe" && <WeOweView cf={cf} onForecast={() => setView("forecast")} />}
          {view === "owed" && <MoneyOwedView key={owedGroup ?? "all"} cf={cf} initialGroup={owedGroup} />}
          {view === "fees" && <TermFeesView cf={cf} onOwed={() => { setOwedGroup("Academy families"); setView("owed"); }} />}
          {view === "income" && <Breakdown model={model} s={s} setS={setS} side="income" />}
          {view === "expenses" && <Breakdown model={model} s={s} setS={setS} side="expense" />}
          {view === "streams" && <Streams model={model} s={s} setS={setS} />}
          {view === "ask" && <Ask model={model} s={s} />}
        </div>
      </div>
    </div>
  );
}

function PeriodPicker({ full, period, setPeriod, from, to, setFrom, setTo }: { full: Model; period: Period; setPeriod: (p: Period) => void; from: string; to: string; setFrom: (m: string) => void; setTo: (m: string) => void }) {
  const lab = (m: string) => `${MON[m] ?? m} ${m.slice(2, 4)}`;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border p-1">
      {PERIODS.map(([p, l]) => <button key={p} onClick={() => setPeriod(p)} className={`rounded px-2 py-1 ${period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>)}
      {period === "custom" && <span className="flex items-center gap-1 pl-1">
        <select value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} className="rounded border bg-background px-1 py-1">{full.months.map((m) => <option key={m} value={m}>{lab(m)}</option>)}</select>
        <span>to</span>
        <select value={to} onChange={(e) => { setTo(e.target.value); if (e.target.value < from) setFrom(e.target.value); }} className="rounded border bg-background px-1 py-1">{full.months.map((m) => <option key={m} value={m}>{lab(m)}</option>)}</select>
      </span>}
    </div>
  );
}
function Levers({ model, s, setS }: { model: Model; s: Scenario; setS: (s: Scenario) => void }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState<Record<string, boolean>>({ streams: true, programmes: true });
  const [saved, setSaved] = useState<Record<string, Scenario>>(() => { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch { return {}; } });
  const [name, setName] = useState("");
  const tog = (k: "offBrands" | "offPeople" | "offProgrammes" | "offGroups", v: string) => { const arr = s[k]; setS({ ...s, [k]: arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }); };
  const pct = (k: "pctGroup" | "pctProgramme" | "pctPerson", key: string, v: number) => setS({ ...s, [k]: { ...s[k], [key]: v } });
  const brands = byKey(model, EMPTY, (n) => n.brand, (n) => !n.funding);
  const progs = byKey(model, EMPTY, (n) => n.programme!, (n) => !!n.programme).sort((a, b) => (model.ageOrder.indexOf(a.key) < 0 ? 99 : model.ageOrder.indexOf(a.key)) - (model.ageOrder.indexOf(b.key) < 0 ? 99 : model.ageOrder.indexOf(b.key)));
  const people = byKey(model, EMPTY, (n) => n.person!, (n) => !!n.person).filter((p) => !q || p.key.toLowerCase().includes(q.toLowerCase()));
  const groups = [...byKey(model, EMPTY, (n) => n.group, (n) => n.side === "income" && !n.funding), ...byKey(model, EMPTY, (n) => n.group, (n) => n.side === "expense")];
  const applied = describe(model, s);
  const Sec = ({ id, title, children }: { id: string; title: string; children: any }) => (
    <div className="border-t pt-3"><button onClick={() => setOpen({ ...open, [id]: !open[id] })} className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}<span>{open[id] ? "−" : "+"}</span></button>{open[id] && <div className="mt-2 space-y-1.5">{children}</div>}</div>
  );
  const Row = ({ on, label, amt, onTog, pctVal, onPct }: { on: boolean; label: string; amt: number; onTog: () => void; pctVal?: number; onPct?: (v: number) => void }) => (
    <div className={`flex items-center gap-2 text-[13px] ${on ? "" : "opacity-40 line-through"}`}><input type="checkbox" checked={on} onChange={onTog} className="h-3.5 w-3.5" /><span className="min-w-0 flex-1 truncate" title={label}>{label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{fmt(amt)}</span>{onPct && <input type="number" value={pctVal ?? 0} onChange={(e) => onPct(Number(e.target.value) || 0)} className="w-14 shrink-0 rounded border px-1 py-0.5 text-right text-[12px] tabular-nums" title="% change" />}</div>
  );
  return (
    <aside className="w-full shrink-0 space-y-3 rounded-xl border bg-card p-4 shadow-sm lg:sticky lg:top-4 lg:w-[360px] print:hidden">
      <div className="flex items-center justify-between"><h2 className="font-semibold">What if…</h2><button onClick={() => setS(EMPTY)} className="text-xs text-muted-foreground hover:underline">Reset to actuals</button></div>
      <p className="text-[12px] leading-snug text-muted-foreground">Untick a stream, a programme or a person to take it out — its income <em>and</em> its costs. Type a % to re-price a programme or scale a group. Every figure recomputes from the real ledger.</p>
      {applied.length > 0 && <div className="flex flex-wrap gap-1.5">{applied.map((a) => <span key={a} className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">{a}</span>)}</div>}
      <Sec id="streams" title="Streams — remove a whole brand"><>{brands.map((b) => <Row key={b.key} on={!s.offBrands.includes(b.key)} label={b.key} amt={b.nodes.filter((n) => n.side === "income").reduce((x, n) => x + nodeTotal(n, model.months), 0) - b.nodes.filter((n) => n.side === "expense").reduce((x, n) => x + nodeTotal(n, model.months), 0)} onTog={() => tog("offBrands", b.key)} />)}<p className="text-[11px] text-muted-foreground">amount = that stream's net (income − costs) at actuals</p></></Sec>
      <Sec id="programmes" title="Programmes & age groups — fee income, re-price with %"><>{progs.map((p) => <Row key={p.key} on={!s.offProgrammes.includes(p.key)} label={p.key} amt={p.base} onTog={() => tog("offProgrammes", p.key)} pctVal={s.pctProgramme[p.key]} onPct={(v) => pct("pctProgramme", p.key, v)} />)}</></Sec>
      <Sec id="people" title="People — payroll, players, contractors, referees"><><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a person" className="w-full rounded border px-2 py-1 text-[13px]" /><div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">{people.map((p) => <Row key={p.key} on={!s.offPeople.includes(p.key)} label={p.key} amt={p.base} onTog={() => tog("offPeople", p.key)} pctVal={s.pctPerson[p.key]} onPct={(v) => pct("pctPerson", p.key, v)} />)}</div></></Sec>
      <Sec id="groups" title="Groups — scale a whole line of the P&L by %"><>{groups.map((g) => <Row key={g.key} on={!s.offGroups.includes(g.key)} label={g.key} amt={g.base} onTog={() => tog("offGroups", g.key)} pctVal={s.pctGroup[g.key]} onPct={(v) => pct("pctGroup", g.key, v)} />)}<label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={s.includeOutside} onChange={() => setS({ ...s, includeOutside: !s.includeOutside })} className="h-3.5 w-3.5" />count the costs Slava paid outside the club</label></></Sec>
      <Sec id="saved" title="Saved scenarios"><><div className="flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="name this scenario" className="min-w-0 flex-1 rounded border px-2 py-1 text-[13px]" /><button onClick={() => { if (!name.trim()) return; const n = { ...saved, [name.trim()]: s }; setSaved(n); localStorage.setItem(LS, JSON.stringify(n)); setName(""); }} className="rounded border px-2 py-1 text-[12px]">Save</button></div>{Object.keys(saved).map((k) => <div key={k} className="flex items-center gap-2 text-[13px]"><button onClick={() => setS(saved[k])} className="min-w-0 flex-1 truncate text-left hover:underline">{k}</button><button onClick={() => { const n = { ...saved }; delete n[k]; setSaved(n); localStorage.setItem(LS, JSON.stringify(n)); }} className="text-muted-foreground hover:text-destructive">×</button></div>)}<p className="text-[11px] text-muted-foreground">saved in this browser only</p></></Sec>
    </aside>
  );
}

function Card({ label, base, scen, note, big, good }: { label: string; base: number; scen: number; note?: string; big?: boolean; good?: "pos" }) {
  const d = scen - base; const changed = Math.abs(d) >= 0.5;
  const col = good ? (scen >= 0 ? "text-emerald-700" : "text-red-700") : "";
  return (
    <div className={`rounded-xl border bg-card p-4 shadow-sm ${big ? "sm:col-span-2" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 ${big ? "text-3xl" : "text-2xl"} font-semibold tabular-nums ${col}`}>{fmt(scen)}</div>
      {changed ? <div className="mt-1 text-[12px] tabular-nums text-muted-foreground">actuals {fmt(base)} · <span className={d >= 0 ? "text-emerald-700" : "text-red-700"}>{d >= 0 ? "+" : ""}{fmt(d)}</span></div> : note ? <div className="mt-1 text-[12px] text-muted-foreground">{note}</div> : null}
    </div>
  );
}
function Verdict({ model, s, t, b }: { model: Model; s: Scenario; t: ReturnType<typeof totals>; b: ReturnType<typeof totals> }) {
  const M = model.months; const span = `${MON[M[0]] ?? M[0]} ${M[0].slice(2, 4)} – ${MON[M[M.length - 1]] ?? M[M.length - 1]} ${M[M.length - 1].slice(2, 4)}`;
  const gap = sum(t.gap), net = sum(t.net), levers = describe(model, s);
  return (
    <div className={`rounded-xl border-2 p-4 ${gap >= 0 ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{levers.length ? "This scenario" : "At actuals"} · {span}</div>
      <p className="mt-1 text-[15px] leading-relaxed">
        On its own earnings — no donations, no owner funding — the club lands at <b className={`tabular-nums ${gap >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmt(gap)}</b>{gap >= 0 ? ", a surplus: nothing to subsidise." : ", a shortfall that donations had to cover."}
        {" "}With donations &amp; owner funding counted, the cash result is <b className={`tabular-nums ${net >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmt(net)}</b>.
        {levers.length > 0 && <span className="text-muted-foreground"> At actuals the gap was {fmt(sum(b.gap))}; the levers applied: {levers.join("; ")}.</span>}
      </p>
    </div>
  );
}
function Overview({ model, s }: { model: Model; s: Scenario }) {
  const t = totals(model, s); const b = totals(model, EMPTY); const M = model.months; const T = (a: number[]) => sum(a);
  const upto = model.dataThrough ?? M[M.length - 1]; const keep = M.map((m, i) => (m <= upto ? i : -1)).filter((i) => i >= 0); const pick = (a: number[]) => keep.map((i) => a[i]); const PM = keep.map((i) => M[i]);
  return (
    <div className="space-y-5">
      <Verdict model={model} s={s} t={t} b={b} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Income the club earns itself" base={T(b.own)} scen={T(t.own)} note="fees, competitions, sponsorship, grants, prize money, merchandise" />
        <Card label="Donations & owner funding" base={T(b.funding)} scen={T(t.funding)} note="money the club did not earn — Slava and other donors" />
        <Card label="Expenses through the club" base={T(b.expenses)} scen={T(t.expenses)} note="wages at cost to club, bills, bank — Xero" />
        <Card label="Paid outside the club" base={T(b.outside)} scen={T(t.outside)} note="OFC hotels Slava paid, never through the club" />
        <Card label="GAP — through the club's accounts" base={T(b.gapThrough)} scen={T(t.gapThrough)} good="pos" />
        <Card label="GAP — outside the club's accounts" base={T(b.gapOutside)} scen={T(t.gapOutside)} good="pos" />
        <Card label={T(t.gap) >= 0 ? "TOTAL GAP — a surplus, nothing to subsidise" : "TOTAL GAP — what has to be subsidised"} base={T(b.gap)} scen={T(t.gap)} good="pos" big note="own income − every cost, through the club and outside; donations never counted here" />
        <Card label="Net after donations & what Slava paid outside" base={T(b.net)} scen={T(t.net)} good="pos" note="the cash result once the subsidy is counted — the P&L's NET" big />
      </div>
      {PM.length > 0 && <Chart months={PM} own={pick(t.own)} through={pick(t.expenses)} outside={pick(t.outside)} gap={pick(t.gap)} baseGap={pick(b.gap)} funding={pick(t.funding)} />}
      <MonthTable months={M} t={t} upto={upto} />
      <div className="rounded-xl border bg-card p-4 text-[13px] shadow-sm"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Invoiced, not yet paid — {fmt(model.receivablesTotal)} owed to the club</div><div className="flex flex-wrap gap-x-5 gap-y-1">{Object.entries(model.receivables).slice(0, 8).map(([k, v]) => <span key={k}>{k} <span className="tabular-nums text-muted-foreground">{fmt(v)}</span></span>)}</div></div>
    </div>
  );
}
function Chart({ months, own, through, outside, gap, baseGap, funding }: { months: string[]; own: number[]; through: number[]; outside: number[]; gap: number[]; baseGap: number[]; funding: number[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const exp = through.map((v, i) => v + outside[i]);
  const W = 960, H = 300, P = { l: 64, r: 16, t: 16, b: 34 }; const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(...own, ...exp, 1); const min = Math.min(...gap, ...baseGap, 0);
  const y = (v: number) => P.t + ih * (1 - (v - min) / (max - min)); const x = (i: number) => P.l + (iw / months.length) * i;
  const cw = iw / months.length; const bw = cw * 0.32; const y0 = y(0); const cx = (i: number) => x(i) + cw / 2;
  const path = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${cx(i)},${y(v)}`).join(" ");
  const tv = Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);
  const rowsFor = (i: number): [string, number, string?][] => [["Income the club earns itself", own[i]], ["Expenses through the club", through[i]], ["Paid outside the club", outside[i]],
    ["Total gap (scenario)", gap[i], "bold"], ["Gap at actuals", baseGap[i]], ["Donations & owner funding", funding[i]]];
  return (
    <div className="relative rounded-xl border bg-card p-3 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-4 px-1 text-[11px] text-muted-foreground"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />own income</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />expenses (incl. outside)</span><span><i className="mr-1 inline-block h-0.5 w-4 bg-amber-600 align-middle" />total gap (scenario)</span><span><i className="mr-1 inline-block h-0.5 w-4 border-t border-dashed border-slate-400 align-middle" />gap at actuals</span><span className="ml-auto">hover a month for the figures</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHov(null)}>
        {tv.map((v, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#e5e7eb" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#6b7280">{fmt(v / 1000)}k</text></g>)}
        {hov !== null && <rect x={x(hov)} y={P.t} width={cw} height={ih} fill="#f59e0b" opacity="0.10" />}
        <line x1={P.l} x2={W - P.r} y1={y0} y2={y0} stroke="#9ca3af" />
        {months.map((m, i) => <g key={m}><rect x={cx(i) - bw - 2} y={y(Math.max(own[i], 0))} width={bw} height={Math.abs(y0 - y(own[i]))} fill="#10b981"><title>{`${MON[m] ?? m} · own income ${fmt(own[i])}`}</title></rect><rect x={cx(i) + 2} y={y(Math.max(exp[i], 0))} width={bw} height={Math.abs(y0 - y(exp[i]))} fill="#f43f5e" opacity="0.85"><title>{`${MON[m] ?? m} · expenses ${fmt(exp[i])}`}</title></rect><text x={cx(i)} y={H - 12} textAnchor="middle" fontSize="11" fill={hov === i ? "#111827" : "#374151"} fontWeight={hov === i ? 700 : 400}>{MON[m] ?? m}</text></g>)}
        <path d={path(baseGap)} fill="none" stroke="#9ca3af" strokeDasharray="4 4" strokeWidth="1.5" />
        <path d={path(gap)} fill="none" stroke="#d97706" strokeWidth="2.5" />
        {gap.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={hov === i ? 5 : 3.5} fill="#d97706" />)}
        {/* one invisible hit column per month — a bar of $0 has no height to hover */}
        {months.map((m, i) => <rect key={`h${m}`} x={x(i)} y={P.t} width={cw} height={ih + P.b} fill="transparent" onMouseEnter={() => setHov(i)} onTouchStart={() => setHov(hov === i ? null : i)} style={{ cursor: "crosshair" }} />)}
      </svg>
      {hov !== null && (
        <div className="pointer-events-none absolute z-10 w-64 rounded-lg border bg-white p-3 text-[12px] shadow-lg" style={{ left: `min(max(${(cx(hov) / W) * 100}% - 8rem, 0.5rem), calc(100% - 16.5rem))`, top: "2.5rem" }}>
          <div className="mb-1 font-semibold">{MON[months[hov]] ?? months[hov]} {months[hov].slice(0, 4)}</div>
          {rowsFor(hov).map(([lab, v, b]) => <div key={lab} className={`flex justify-between gap-3 ${b ? "font-semibold" : "text-muted-foreground"}`}><span>{lab}</span><span className={`tabular-nums ${b ? (v < 0 ? "text-red-700" : "text-emerald-700") : ""}`}>{fmt(v)}</span></div>)}
        </div>
      )}
    </div>
  );
}
function MonthTable({ months, t, upto }: { months: string[]; t: ReturnType<typeof totals>; upto: string }) {
  const rows: [string, number[], boolean?][] = [["Income the club earns itself", t.own], ["Expenses through the club", t.expenses], ["Paid outside the club", t.outside], ["GAP through the club", t.gapThrough, true], ["GAP outside", t.gapOutside, true], ["TOTAL GAP", t.gap, true], ["Donations & owner funding", t.funding], ["Net after donations & outside cover", t.net, true]];
  const c = (bold: boolean | undefined, v: number) => `whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${bold && v < 0 ? "text-red-700" : bold && v > 0 ? "text-emerald-700" : ""}`;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm"><table className="w-full min-w-[820px] text-[12.5px]">
      <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2 text-left">by month</th>{months.map((m) => <th key={m} className="px-2 py-2 text-right">{MON[m] ?? m}</th>)}<th className="px-3 py-2 text-right">total</th></tr></thead>
      <tbody>{rows.map(([lab, a, bold]) => <tr key={lab} className={`border-t ${bold ? "font-semibold" : ""}`}><td className="px-3 py-1.5">{lab}</td>{a.map((v, i) => <td key={i} className={months[i] > upto ? "px-2 py-1.5 text-right text-muted-foreground" : c(bold, v)}>{months[i] > upto ? "—" : fmt(v)}</td>)}<td className={c(bold, sum(a))}>{fmt(sum(a))}</td></tr>)}</tbody></table></div>
  );
}
function Breakdown({ model, s, setS, side }: { model: Model; s: Scenario; setS: (s: Scenario) => void; side: "income" | "expense" }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = byKey(model, s, (n) => n.group, (n) => n.side === side);
  const total = groups.reduce((x, g) => x + g.scen, 0); const btotal = groups.reduce((x, g) => x + g.base, 0);
  const togNode = (id: string) => setS({ ...s, offNodes: s.offNodes.includes(id) ? s.offNodes.filter((x) => x !== id) : [...s.offNodes, id] });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm">{side === "income" ? "Income" : "Expenses"} · scenario <b className="tabular-nums">{fmt(total)}</b>{Math.abs(total - btotal) >= 0.5 && <span className="text-muted-foreground"> (actuals {fmt(btotal)})</span>}</div><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a line, a person, a programme" className="w-64 rounded border px-2 py-1 text-[13px] print:hidden" /></div>
      {groups.map((g) => {
        const rows = g.nodes.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase())).map((n) => ({ n, base: nodeTotal(n, model.months), scen: nodeTotal(n, model.months) * factor(n, s) })).sort((a, b) => Math.abs(b.base) - Math.abs(a.base));
        if (q && !rows.length) return null; const isOpen = open[g.key] ?? !!q;
        return (
          <div key={g.key} className="rounded-xl border bg-card shadow-sm">
            <button onClick={() => setOpen({ ...open, [g.key]: !isOpen })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"><span className="font-semibold">{g.key}</span><span className="flex items-center gap-3 tabular-nums text-[13px]"><span className="text-muted-foreground">{g.nodes.length} lines</span>{Math.abs(g.scen - g.base) >= 0.5 && <span className="text-muted-foreground line-through">{fmt(g.base)}</span>}<span>{fmt(g.scen)}</span><span className="text-muted-foreground">{isOpen ? "−" : "+"}</span></span></button>
            {isOpen && <table className="w-full border-t text-[12.5px]"><thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="print:hidden" /><th className="px-2 py-1.5 text-left">line</th>{model.months.map((m) => <th key={m} className="hidden px-1.5 py-1.5 text-right xl:table-cell">{MON[m] ?? m}</th>)}<th className="px-3 py-1.5 text-right">total</th></tr></thead><tbody>{rows.map(({ n, base, scen }) => <tr key={n.id} className={`border-t ${factor(n, s) === 0 ? "opacity-40" : ""}`}><td className="w-8 px-3 py-1.5 print:hidden"><input type="checkbox" checked={factor(n, s) !== 0 && !s.offNodes.includes(n.id)} onChange={() => togNode(n.id)} className="h-3.5 w-3.5" title="take this line out" /></td><td className="px-2 py-1.5">{n.label}<span className="ml-2 text-[11px] text-muted-foreground">{n.brand}{n.kind ? ` · ${n.kind}` : ""}</span></td>{model.months.map((m) => <td key={m} className="hidden px-1.5 py-1.5 text-right tabular-nums text-muted-foreground xl:table-cell">{n.vals[m] ? fmt(n.vals[m] * factor(n, s)) : ""}</td>)}<td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{Math.abs(scen - base) >= 0.5 && <span className="mr-2 text-muted-foreground line-through">{fmt(base)}</span>}{fmt(scen)}</td></tr>)}</tbody></table>}
          </div>
        );
      })}
    </div>
  );
}
function Streams({ model, s, setS }: { model: Model; s: Scenario; setS: (s: Scenario) => void }) {
  const brands = byKey(model, s, (n) => n.brand, () => true);
  const rows = brands.map((b) => { const f = (side: "income" | "expense", scen: boolean) => b.nodes.filter((n: FiNode) => n.side === side && !n.funding).reduce((x, n) => x + nodeTotal(n, model.months) * (scen ? factor(n, s) : 1), 0); return { key: b.key, inc: f("income", true), exp: f("expense", true), binc: f("income", false), bexp: f("expense", false), off: s.offBrands.includes(b.key) }; }).filter((r) => r.binc || r.bexp).sort((a, b) => (a.binc - a.bexp) - (b.binc - b.bexp));
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">What each stream earns and costs. A negative net is what the rest of the club (and the donations) carry for it. Untick a stream to see the club without it.</p>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm"><table className="w-full min-w-[640px] text-[13px]"><thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2 text-left">stream</th><th className="px-3 py-2 text-right">income</th><th className="px-3 py-2 text-right">costs</th><th className="px-3 py-2 text-right">net</th><th className="px-3 py-2 text-right">at actuals</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key} className={`border-t ${r.off ? "opacity-40" : ""}`}><td className="px-3 py-2"><label className="flex items-center gap-2"><input type="checkbox" checked={!r.off} onChange={() => setS({ ...s, offBrands: r.off ? s.offBrands.filter((x) => x !== r.key) : [...s.offBrands, r.key] })} className="h-3.5 w-3.5 print:hidden" />{r.key}</label></td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">{fmt(r.inc)}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-rose-700">{fmt(r.exp)}</td><td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${r.inc - r.exp >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmt(r.inc - r.exp)}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r.binc - r.bexp)}</td></tr>)}</tbody></table></div>
      <p className="text-[12px] text-muted-foreground">Streams are tagged by Xero account. Club-wide overheads (rent, insurance, admin staff) are not allocated to a stream here — allocation is a decision, not data.</p>
    </div>
  );
}
function Ask({ model, s }: { model: Model; s: Scenario }) {
  const [q, setQ] = useState("Where does the club land without the OFC Pro League, and what is the single biggest lever to close the gap?");
  const [a, setA] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [e, setE] = useState<string | null>(null);
  const summary = useMemo(() => summaryForAI(model, s), [model, s]);
  const go = async () => { setBusy(true); setE(null); setA(null); const r = await workspaceFetch(`${API}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, summary }) }); const j = await r.json().catch(() => ({})); setBusy(false); if (!r.ok) { setE(j.message || "The analyst could not answer."); return; } setA(j.answer); };
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">The analyst sees the current scenario — the totals by month, group and stream, and the levers you applied — never a person's name. Ask it what a board member would ask.</p>
      <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={3} className="w-full rounded-md border p-3 text-sm" />
      <button onClick={go} disabled={busy} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Thinking…" : "Ask"}</button>
      {e && <p className="text-sm text-destructive">{e}</p>}
      {a && <div className="whitespace-pre-wrap rounded-xl border bg-card p-4 text-[14px] leading-relaxed shadow-sm">{a}</div>}
      <details className="text-[12px] text-muted-foreground"><summary className="cursor-pointer">what the analyst is shown</summary><pre className="mt-2 whitespace-pre-wrap">{summary}</pre></details>
    </div>
  );
}
