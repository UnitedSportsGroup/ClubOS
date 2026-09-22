/**
 * Financial Insight — the forward-looking views (Daniel, 23 Sep 2026: "this is the kind of additional views and tabs we need in
 * clubos finance tab"). Three views over ONE object the nightly refresh builds on Daniel's Mac (outputs/club-finance-2026/
 * cash_forecast.py → model.cashForecast), the same numbers as the "CUFC Cash Forecast" sheet tab:
 *
 *   Cash to 31 Dec — Christchurch United on its own (no SIU, no donations): money in, money out, week by week, three cases,
 *                    and the one input that turns it into a YES or a NO — the bank balance.
 *   Money owed     — every unpaid sales invoice in Xero, aged, by who owes it.
 *   Term fees      — the academy fee book, BOTH ways a family pays: card in ClubOS and an invoice from the office in Xero.
 *
 * 🔴 Nothing here computes a forecast. The browser only chooses a case, adds a typed bank balance, and draws. The bank balance a
 * person types stays in THIS browser (localStorage, keyed by the forecast's start date) — it is never sent anywhere.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/finance-insight-engine";

export type Case = "base" | "worse" | "better";
export interface CfNode { label: string; basis: string; note: string; vals: Record<Case, number[]>; kids: CfNode[] }
export interface CfLine { label: string; who?: string; side: "in" | "out"; amount: number; basis: string; day: string }
/** A leaf on its own says "take-home pay" and never whose — `who` is its path down the tree. Show the named parent as the
 *  headline when there is one (a person, a programme), otherwise the leaf's own label. */
export const lineName = (l: CfLine) => {
  const parts = (l.who ?? "").split(" · ").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return parts.length > 1 ? { top: last, sub: l.label } : { top: l.label, sub: last };
};
export interface CfWeekCase { in: number; out: number; cum: number; lines?: CfLine[] }
export interface CfWeek { from: string; to: string; base: CfWeekCase; worse: CfWeekCase; better: CfWeekCase }
export interface CfActualLine { who: string; account: string; amount: number; n: number; side: "in" | "out"; brand?: string; rollup?: boolean }
export interface CfActualWeek { from: string; to: string; in: number; out: number; detail: boolean; lines: CfActualLine[] }
export interface CfReceivable { invoice: string; invoiceId: string; contact: string; group: string; date: string; due: string; daysOverdue: number; amount: number; reference: string; accounts: string[] }
export interface CfProgramme {
  name: string; t3Invoiced: number; t3Card: number; t3Book: number; t3Unpaid: number; ratio: number; cardShare: number;
  t4Expected: number; t4Worse: number; t4Better: number; t4CardSold: number; t4CardN: number; t4Invoiced: number; t4InvoicedN: number; t4InvoicedPaid: number;
  t4PrePaid: number; t4CardStillToSell: number; t4StillToInvoice: number; note: string;
}
export interface CfOwed { who: string; amount: number | null; monthly?: number; asAt: string; state: string; inForecast: boolean; evidence: string; note: string }
export interface CashForecast {
  version: number; generatedAt: string; asOf: string; through: string; bankFeedTo: string; plannedOn: string;
  months: { key: string; label: string }[];
  stripePending: { amount: number; read_at: string };
  bankPosition: { as_at: string; fetched_at: string; accounts: Record<string, number> } | null;
  results: Record<Case, { in: number; out: number; net: number; low: number; lowWeek: number }>;
  weeks: CfWeek[]; tree: CfNode;
  levers: { title: string; amount: string; who: string; what: string }[];
  blocks: { title: string; lines: string[] }[];
  receivables: CfReceivable[]; receivablesTotal: number;
  withSiu?: { tree: CfNode; results: Record<Case, { in: number; out: number; net: number; low: number; lowWeek: number }>; weeks: CfWeek[]; preSeasonStart: string; paydays: string[]; basis: string[] };
  owed?: CfOwed[]; owedTotal?: number; owedNotInForecast?: number;
  actualWeeks?: CfActualWeek[]; actualFrom?: string; actualTo?: string; accounts?: Record<string, string>;
  termFees: { programmes: CfProgramme[]; t3Book: number; t3Xero: number; t3CardOnly: number; t3ClubOSAlone: number; invoiceAssumption: string };
  bounced: { date: string; payee: string; amount: number }[];
}

const CASES: { k: Case; label: string; hint: string }[] = [
  { k: "base", label: "Base", hint: "what the history says is most likely" },
  { k: "worse", label: "Worse", hint: "fewer sign-ups, slower payers, no grants" },
  { k: "better", label: "Better", hint: "strong sign-ups, a grant, debts collected" },
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "2026-09-23" → "Wed 23 Sep" — from the y-m-d parts, never through local time. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[wd]} ${d} ${MONTH_SHORT[m - 1]}`;
}
const short = (iso: string) => { const [, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${MONTH_SHORT[m - 1]}`; };
const tone = (v: number) => (v < 0 ? "text-red-700" : v > 0 ? "text-emerald-700" : "");

function Missing() {
  return <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground shadow-sm">The forecast has not been pushed yet — it arrives with the nightly refresh (cash_forecast.py → push_snapshot.py).</div>;
}

// =====================================================================================================================
// CASH TO 31 DEC
// =====================================================================================================================
export function CashForecastView({ cf, onOwe }: { cf?: CashForecast; onOwe?: () => void }) {
  const [kase, setKase] = useState<Case>("base");
  const [siu, setSiu] = useState(false);
  const [openWeek, setOpenWeek] = useState<number | null>(null);
  const lsKey = cf ? `fi-bank-balance-${cf.asOf}` : "";
  const xeroBal = cf?.bankPosition ? Object.values(cf.bankPosition.accounts).reduce((a, b) => a + b, 0) : null;
  const [typed, setTyped] = useState<string>(() => { try { return lsKey ? localStorage.getItem(lsKey) ?? "" : ""; } catch { return ""; } });
  if (!cf) return <Missing />;
  const withSiu = siu && !!cf.withSiu;                       // the same forecast with the 2027 OFC squad and staff switched on
  const R = withSiu ? cf.withSiu!.results : cf.results;
  const WEEKS = withSiu ? cf.withSiu!.weeks : cf.weeks;
  const TREE = withSiu ? cf.withSiu!.tree : cf.tree;
  const parsed = typed.trim() === "" ? null : Number(typed.replace(/[$,\s]/g, ""));
  const balance = parsed !== null && Number.isFinite(parsed) ? parsed : xeroBal;
  const setBal = (v: string) => { setTyped(v); try { v.trim() ? localStorage.setItem(lsKey, v) : localStorage.removeItem(lsKey); } catch { /* private window */ } };
  const r = R[kase]; const need = Math.max(0, -r.low);
  const running = WEEKS.map((w) => w[kase].cum);
  const lowIdx = running.reduce((best, v, i) => (v < running[best] ? i : best), 0);
  const lowest = balance !== null ? balance + Math.min(0, ...running) : null;
  const yes = lowest !== null ? lowest >= 0 : null;
  const lowWeek = WEEKS[lowIdx]; const siuAdds = cf.withSiu ? Math.max(0, -cf.withSiu.results[kase].low) - Math.max(0, -cf.results[kase].low) : 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{withSiu ? "Christchurch United and South Island United — cash to 31 December" : "Christchurch United on its own — cash to 31 December"}</h2>
          <p className="text-[13px] text-muted-foreground">{withSiu ? `With the 2027 OFC squad and staff from pre-season, Mon ${dayLabel(cf.withSiu!.preSeasonStart).slice(4)}.` : "No South Island United,"} no donations. Starts {dayLabel(cf.asOf)} and rolls forward every night — what is past is already in the bank balance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cf.withSiu && (
            <button onClick={() => setSiu((v) => !v)} data-testid="cf-siu" className={`min-h-[36px] rounded-md border px-3 text-sm ${siu ? "border-slate-800 bg-slate-800 text-white" : "hover:bg-muted"}`}>
              {siu ? "✓ South Island United is in" : "Add South Island United"}
            </button>
          )}
          <div className="flex rounded-md border p-1 text-sm" role="group" aria-label="case">
            {CASES.map((c) => <button key={c.k} onClick={() => setKase(c.k)} title={c.hint} className={`min-h-[36px] rounded px-3 ${kase === c.k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{c.label}</button>)}
          </div>
        </div>
      </div>

      <div className={`rounded-xl border-2 p-4 ${yes === null ? "border-amber-300 bg-amber-50" : yes ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`} data-testid="cf-answer">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">The answer · {CASES.find((c) => c.k === kase)!.label.toLowerCase()} case</div>
        {yes !== null && lowest !== null ? (
          <p className="mt-1 text-[16px] leading-relaxed"><b className={yes ? "text-emerald-700" : "text-red-700"}>{yes ? "YES" : "NO"}</b> — with <b className="tabular-nums">{fmt(balance!)}</b> in the bank at the start of {dayLabel(cf.asOf)}, the lowest point is <b className={`tabular-nums ${tone(lowest)}`}>{fmt(lowest)}</b> in the week of {dayLabel(lowWeek.from)}.{!yes && <> The club would need another <b className="tabular-nums">{fmt(-lowest)}</b> by then — from the levers below, or from a donation.</>}</p>
        ) : null}
        <p className={`${yes !== null ? "mt-1 text-[14px] text-muted-foreground" : "mt-1 text-[16px]"} leading-relaxed`}>{withSiu ? "Both clubs together need" : "Christchurch United alone needs"} <b className="tabular-nums text-foreground">{fmt(need)}</b> in the bank today to reach 31 December without a donation <span className="text-muted-foreground">(worse case {fmt(Math.max(0, -R.worse.low))}, better {fmt(Math.max(0, -R.better.low))})</span>.{withSiu && siuAdds > 0 && <span className="text-muted-foreground"> South Island United's pre-season adds <b className="tabular-nums">{fmt(siuAdds)}</b> of that.</span>}</p>
        {cf.owedNotInForecast ? <p className="mt-1 text-[13px] text-muted-foreground">Not counted above: <b className="tabular-nums text-foreground">{fmt(cf.owedNotInForecast)}</b> of old bills nobody has scheduled — mostly the Belgravia kit account. {onOwe && <button onClick={onOwe} className="underline">See what we owe →</button>}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="cf-bank" className="text-[13px] font-medium">Bank balance at the start of {dayLabel(cf.asOf)}</label>
          <input id="cf-bank" value={typed} onChange={(e) => setBal(e.target.value)} inputMode="decimal" placeholder={xeroBal !== null ? `Xero: ${fmt(xeroBal)}` : "type the ANZ figure"} className="premium-input h-10 w-44 rounded-md border bg-white px-3 text-sm tabular-nums" />
          {typed && <button onClick={() => setBal("")} className="min-h-[36px] rounded-md border bg-white px-3 text-xs">{xeroBal !== null ? "use Xero's figure" : "clear"}</button>}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          {cf.bankPosition ? <>Xero's own balance as at {short(cf.bankPosition.as_at)}: {Object.entries(cf.bankPosition.accounts).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ")}. It counts only what has been reconciled — check it against ANZ.</> : <>Xero's balance could not be read yet (the finance app's daily calls). Type the ANZ figure — it stays in this browser only.</>}
          {" "}All club accounts together, less anything already promised to SIU.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Money in" v={r.in} />
        <Stat label="Money out" v={r.out} />
        <Stat label="Net, to 31 Dec" v={r.net} colour />
        <Stat label={balance !== null ? "Lowest bank balance" : "Lowest point vs today"} v={balance !== null ? lowest! : Math.min(0, ...running)} colour sub={`week of ${short(lowWeek.from)}`} />
      </div>

      <WeekChart weeks={WEEKS} kase={kase} balance={balance} onPick={(i) => setOpenWeek(i === openWeek ? null : i)} picked={openWeek} />
      {openWeek !== null && WEEKS[openWeek] && (
        <WeekBreakdown week={WEEKS[openWeek]} lines={(cf.weeks[openWeek]?.[kase].lines ?? []).concat(withSiu ? cf.withSiu!.weeks[openWeek]?.[kase].lines ?? [] : [])}
                       kase={kase} onClose={() => setOpenWeek(null)} />
      )}

      {cf.bounced.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[13px]">
          <div className="font-semibold text-red-800">Warning sign — direct debits are bouncing on the ANZ OFC League account</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-red-900">{cf.bounced.map((b) => <span key={b.date + b.payee}>{short(b.date)} · {b.payee} <span className="tabular-nums">{fmt(b.amount, 2)}</span></span>)}</div>
        </div>
      )}

      <Tree cf={cf} kase={kase} tree={TREE} />
      {withSiu && (
        <div className="rounded-xl border bg-card p-4 text-[13px] shadow-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How South Island United is worked out</div>
          <ul className="list-disc space-y-1 pl-5 leading-snug">{cf.withSiu!.basis.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Where to put the time — ranked by cash before 31 Dec</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {cf.levers.map((l, i) => (
            <div key={l.title} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div className="font-medium leading-snug"><span className="mr-1.5 text-muted-foreground">{i + 1}.</span>{l.title}</div><span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">{l.amount}</span></div>
              <div className="mt-1 text-[12px] font-medium text-muted-foreground">{l.who}</div>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{l.what}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-2">
        {cf.blocks.map((b) => (
          <details key={b.title} className="rounded-xl border bg-card p-4 shadow-sm" open={/QUESTIONS/.test(b.title)}>
            <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{b.title}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-snug">{b.lines.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">Built {cf.generatedAt.slice(0, 16).replace("T", " ")} · bank feed to {short(cf.bankFeedTo)} · Stripe read {cf.stripePending.read_at.slice(0, 16).replace("T", " ")} · every amount is cash as it moves through the bank, GST included (the GST owed to IRD is its own line). Same numbers as the "CUFC Cash Forecast" tab in the Financial Master Document.</p>
    </div>
  );
}

function Stat({ label, v, colour, sub }: { label: string; v: number; colour?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${colour ? tone(v) : ""}`}>{fmt(v)}</div>
      {sub && <div className="text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function WeekChart({ weeks, kase, balance, onPick, picked }: { weeks: CfWeek[]; kase: Case; balance: number | null; onPick?: (i: number) => void; picked?: number | null }) {
  const [hov, setHov] = useState<number | null>(null);
  // drawn at the box's REAL width so the labels are true-size on a phone (a 960-wide viewBox shrunk to 350px made them 4px)
  const box = useRef<HTMLDivElement>(null); const [Wd, setWd] = useState(960);
  useEffect(() => { const el = box.current; if (!el || typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver(() => setWd(Math.max(300, Math.round(el.clientWidth - 24)))); ro.observe(el); return () => ro.disconnect(); }, []);
  const W = weeks; const n = W.length;
  const ins = W.map((w) => w[kase].in), outs = W.map((w) => -w[kase].out);
  const line = W.map((w) => (balance ?? 0) + w[kase].cum);
  const narrowChart = Wd < 600; const H = narrowChart ? 260 : 300, P = { l: narrowChart ? 46 : 64, r: 10, t: 14, b: 30 }; const iw = Wd - P.l - P.r, ih = H - P.t - P.b;
  const max = Math.max(...ins, ...outs, ...line, balance ?? 0, 1); const min = Math.min(...line, 0);
  const y = (v: number) => P.t + ih * (1 - (v - min) / (max - min)); const cw = iw / n; const x = (i: number) => P.l + cw * i; const cx = (i: number) => x(i) + cw / 2;
  const bw = Math.max(3, cw * 0.3); const y0 = y(0); const step = Math.max(1, Math.ceil(48 / cw));
  const tv = Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);
  const lab = balance !== null ? "bank balance" : "running total from today";
  return (
    <div ref={box} className="relative rounded-xl border bg-card p-3 shadow-sm" data-testid="cf-chart">
      <div className="mb-1 flex flex-wrap items-center gap-4 px-1 text-[11px] text-muted-foreground"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />money in</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" />money out</span><span><i className="mr-1 inline-block h-0.5 w-4 bg-sky-700 align-middle" />{lab}</span><span className="ml-auto">{onPick ? "week by week · tap a week to open it" : "week by week"}</span></div>
      <svg viewBox={`0 0 ${Wd} ${H}`} className="w-full" onMouseLeave={() => setHov(null)}>
        {tv.map((v, i) => <g key={i}><line x1={P.l} x2={Wd - P.r} y1={y(v)} y2={y(v)} stroke="#e5e7eb" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{fmt(v / 1000)}k</text></g>)}
        {picked !== null && picked !== undefined && <rect x={x(picked)} y={P.t} width={cw} height={ih} fill="#0369a1" opacity="0.10" />}
        {hov !== null && <rect x={x(hov)} y={P.t} width={cw} height={ih} fill="#0ea5e9" opacity="0.08" />}
        <line x1={P.l} x2={Wd - P.r} y1={y0} y2={y0} stroke="#9ca3af" />
        {W.map((w, i) => <g key={w.from}>
          <rect x={cx(i) - bw - 1} y={y(Math.max(ins[i], 0))} width={bw} height={Math.abs(y0 - y(ins[i]))} fill="#10b981" />
          <rect x={cx(i) + 1} y={y(Math.max(outs[i], 0))} width={bw} height={Math.abs(y0 - y(outs[i]))} fill="#f43f5e" opacity="0.85" />
          {i % step === 0 && <text x={cx(i)} y={H - 10} textAnchor="middle" fontSize="11" fill="#374151">{short(w.from)}</text>}
        </g>)}
        <path d={line.map((v, i) => `${i ? "L" : "M"}${cx(i)},${y(v)}`).join(" ")} fill="none" stroke="#0369a1" strokeWidth="2.5" />
        {line.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={hov === i ? 5 : 3} fill={v < 0 ? "#b91c1c" : "#0369a1"} />)}
        {W.map((w, i) => <rect key={`h${w.from}`} x={x(i)} y={P.t} width={cw} height={ih + P.b} fill="transparent" onMouseEnter={() => setHov(i)} onTouchStart={() => setHov(hov === i ? null : i)} onClick={() => onPick?.(i)} style={{ cursor: onPick ? "pointer" : "crosshair" }}><title>{`open ${short(w.from)}`}</title></rect>)}
      </svg>
      {hov !== null && (
        <div className="pointer-events-none absolute z-10 w-60 rounded-lg border bg-white p-3 text-[12px] shadow-lg" style={{ left: `min(max(${(cx(hov) / Wd) * 100}% - 7.5rem, 0.5rem), calc(100% - 15.5rem))`, top: "2.5rem" }}>
          <div className="mb-1 font-semibold">{dayLabel(W[hov].from)} – {dayLabel(W[hov].to)}</div>
          {([["Money in", W[hov][kase].in], ["Money out", W[hov][kase].out], ["Net", W[hov][kase].in + W[hov][kase].out], [balance !== null ? "Bank after this week" : "Running total", line[hov]]] as [string, number][]).map(([l, v], j) => <div key={l} className={`flex justify-between gap-3 ${j === 3 ? "font-semibold" : "text-muted-foreground"}`}><span>{l}</span><span className={`tabular-nums ${j >= 2 ? tone(v) : ""}`}>{fmt(v)}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** One week opened up: every line of money in and money out, forecast or actual. */
function LineList({ title, rows, total, tone: t }: { title: string; rows: { key: string; left: string; right?: string; amount: number; badge?: string }[]; total: number; tone: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span><span className={`text-sm font-semibold tabular-nums ${t}`}>{fmt(total)}</span></div>
      {rows.length === 0 ? <p className="text-[12px] text-muted-foreground">nothing</p> : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3 px-3 py-1.5 text-[12.5px]">
              <span className="min-w-0"><span className="break-words">{r.left}</span>{r.badge && <span className={`ml-1.5 inline-block rounded border px-1 py-px align-middle text-[9px] font-semibold tracking-wide ${BASIS_STYLE[r.badge] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}>{r.badge}</span>}{r.right && <span className="block text-[11px] text-muted-foreground">{r.right}</span>}</span>
              <span className="shrink-0 tabular-nums">{fmt(Math.abs(r.amount), 2)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function WeekBreakdown({ week, lines, kase, onClose }: { week: CfWeek; lines: CfLine[]; kase: Case; onClose: () => void }) {
  const ins = lines.filter((l) => l.amount > 0), outs = lines.filter((l) => l.amount < 0);
  const row = (l: CfLine, i: number) => { const n = lineName(l); return { key: `${l.label}-${l.day}-${i}`, left: n.top, right: [dayLabel(l.day), n.sub].filter(Boolean).join(" · "), amount: l.amount, badge: l.basis }; };
  return (
    <div className="rounded-xl border-2 border-sky-200 bg-sky-50/40 p-4" data-testid="cf-week">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div><span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Forecast week · {CASES.find((c) => c.k === kase)!.label.toLowerCase()} case</span>
          <h3 className="text-base font-semibold">{dayLabel(week.from)} – {dayLabel(week.to)}</h3></div>
        <div className="flex items-center gap-3 text-sm"><span className="tabular-nums text-emerald-700">in {fmt(week[kase].in)}</span><span className="tabular-nums text-rose-700">out {fmt(week[kase].out)}</span><span className={`font-semibold tabular-nums ${tone(week[kase].in + week[kase].out)}`}>net {fmt(week[kase].in + week[kase].out)}</span>
          <button onClick={onClose} className="min-h-[32px] rounded-md border bg-white px-2.5 text-xs">close</button></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <LineList title={`Money in · ${ins.length} line${ins.length === 1 ? "" : "s"}`} rows={ins.map(row)} total={week[kase].in} tone="text-emerald-700" />
        <LineList title={`Money out · ${outs.length} line${outs.length === 1 ? "" : "s"}`} rows={outs.map(row)} total={week[kase].out} tone="text-rose-700" />
      </div>
    </div>
  );
}

// =====================================================================================================================
// WEEK BY WEEK — the weeks already gone (what actually moved) and the weeks ahead (what is forecast), each one opens up
// =====================================================================================================================
const span = (a: string, b: string) => (a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`);
/** The head of one week row. Date and net on top, in/out beneath — three figures and a date do not fit 390px on one line. */
function WeekRowHead({ from, to, mIn, mOut, note, open, canOpen }: { from: string; to: string; mIn: number; mOut: number; note: string; open: boolean; canOpen: boolean }) {
  return (
    <>
      <span className="flex items-center gap-2">
        <span className="w-3 shrink-0 text-muted-foreground">{canOpen ? (open ? "−" : "+") : ""}</span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{span(from, to)}</span>
        <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${tone(mIn + mOut)}`}>{fmt(mIn + mOut)}</span>
      </span>
      <span className="mt-0.5 flex items-center gap-3 pl-5 text-[11.5px] tabular-nums text-muted-foreground">
        <span className="text-emerald-700">in {fmt(mIn)}</span>
        <span className="text-rose-700">out {fmt(mOut)}</span>
        <span>{note}</span>
      </span>
    </>
  );
}
export function WeekByWeekView({ cf }: { cf?: CashForecast }) {
  const [kase, setKase] = useState<Case>("base");
  const [cufcOnly, setCufcOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  if (!cf) return <Missing />;
  const actual = (cf.actualWeeks ?? []).slice().reverse();                 // newest first — last week is what a person looks at
  const keep = (l: CfActualLine) => !cufcOnly || !l.brand;                 // brand is only set when it is NOT plain CUFC (SIU, donations)
  const money2 = (w: CfActualWeek, side: "in" | "out") => money2sum(w.lines.filter((l) => l.side === side && keep(l)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Week by week — what moved, and what is coming</h2>
          <p className="text-[13px] text-muted-foreground">Open any week to see every line in it. The weeks up to {cf.actualTo ? short(cf.actualTo) : "today"} are what ACTUALLY moved through the bank (Xero); the weeks after are the forecast.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setCufcOnly((v) => !v)} className={`min-h-[36px] rounded-md border px-3 text-sm ${cufcOnly ? "border-slate-800 bg-slate-800 text-white" : "hover:bg-muted"}`}>{cufcOnly ? "✓ CUFC only" : "Everything (incl. SIU + donations)"}</button>
          <div className="flex rounded-md border p-1 text-sm">{CASES.map((c) => <button key={c.k} onClick={() => setKase(c.k)} title={c.hint} className={`min-h-[36px] rounded px-3 ${kase === c.k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{c.label}</button>)}</div>
        </div>
      </div>

      <section data-testid="wk-forecast">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ahead — forecast</h3>
        <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {cf.weeks.map((w, i) => {
            const id = `f${w.from}`; const isOpen = open === id; const c = w[kase];
            const lines = c.lines ?? [];
            return (
              <div key={id}>
                <button onClick={() => setOpen(isOpen ? null : id)} className="block w-full px-3 py-2 text-left hover:bg-muted/40">
                  <WeekRowHead from={w.from} to={w.to} mIn={c.in} mOut={c.out} note={`${lines.length} lines`} open={isOpen} canOpen />
                </button>
                {isOpen && <div className="grid gap-4 border-t bg-muted/20 p-3 md:grid-cols-2">
                  <LineList title="Money in" rows={lines.filter((l) => l.amount > 0).map((l, j) => fcRow(l, j))} total={c.in} tone="text-emerald-700" />
                  <LineList title="Money out" rows={lines.filter((l) => l.amount < 0).map((l, j) => fcRow(l, j))} total={c.out} tone="text-rose-700" />
                </div>}
              </div>
            );
          })}
        </div>
      </section>

      <section data-testid="wk-actual">
        <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gone — what actually moved{cufcOnly ? ", CUFC only" : ""}</h3>
        <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {actual.map((w) => {
            const id = `a${w.from}`; const isOpen = open === id;
            const ins = money2(w, "in"), outs = money2(w, "out");
            const rows = w.lines.filter(keep);
            return (
              <div key={id}>
                <button onClick={() => w.detail && setOpen(isOpen ? null : id)} className={`block w-full px-3 py-2 text-left ${w.detail ? "hover:bg-muted/40" : "cursor-default opacity-70"}`}>
                  <WeekRowHead from={w.from} to={w.to} mIn={cufcOnly && w.detail ? ins : w.in} mOut={cufcOnly && w.detail ? outs : w.out}
                               note={w.detail ? `${rows.length} lines` : "totals only"} open={isOpen} canOpen={w.detail} />
                </button>
                {isOpen && <div className="grid gap-4 border-t bg-muted/20 p-3 md:grid-cols-2">
                  <LineList title="Money in" rows={rows.filter((l) => l.side === "in").map((l, j) => ({ key: `${l.who}${l.account}${j}`, left: l.who + (l.n > 1 ? ` · ${l.n} payments` : ""), right: [cf.accounts?.[l.account] ?? l.account, l.brand].filter(Boolean).join(" · "), amount: l.amount }))} total={ins} tone="text-emerald-700" />
                  <LineList title="Money out" rows={rows.filter((l) => l.side === "out").map((l, j) => ({ key: `${l.who}${l.account}${j}`, left: l.who + (l.n > 1 ? ` · ${l.n} payments` : ""), right: [cf.accounts?.[l.account] ?? l.account, l.brand].filter(Boolean).join(" · "), amount: l.amount }))} total={outs} tone="text-rose-700" />
                </div>}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Actuals come from the Xero bank feed and the sales invoices, grouped by payer and account inside each week — a week of card purchases from one shop is one line with a count. Weeks older than six months keep their totals only. Anything under $50 is rolled into "smaller items".</p>
      </section>
    </div>
  );
}
const fcRow = (l: CfLine, j: number) => { const n = lineName(l); return { key: `${l.label}${j}`, left: n.top, right: [dayLabel(l.day), n.sub].filter(Boolean).join(" · "), amount: l.amount, badge: l.basis }; };
const money2sum = (rows: CfActualLine[]) => Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;

const BASIS_STYLE: Record<string, string> = { COMMITTED: "border-sky-300 bg-sky-50 text-sky-800", REPEATING: "border-slate-300 bg-slate-50 text-slate-700", ESTIMATE: "border-amber-300 bg-amber-50 text-amber-800", ASSUMPTION: "border-rose-300 bg-rose-50 text-rose-800" };
function Tree({ cf, kase, tree }: { cf: CashForecast; kase: Case; tree: CfNode }) {
  // open by default: the grand total and money in / money out; every category starts closed
  const [open, setOpen] = useState<Record<string, boolean>>({ "0": true, "0.0": true, "0.1": true });
  const [notes, setNotes] = useState(false);
  const rows: { node: CfNode; path: string; depth: number }[] = [];
  const walk = (n: CfNode, path: string, depth: number) => { rows.push({ node: n, path, depth }); if (open[path]) n.kids.forEach((k, i) => walk(k, `${path}.${i}`, depth + 1)); };
  walk(tree, "0", 0);
  const openAll = (v: boolean) => { const o: Record<string, boolean> = {}; const w = (n: CfNode, p: string) => { if (n.kids.length) { o[p] = v || p === "0"; n.kids.forEach((k, i) => w(k, `${p}.${i}`)); } }; w(tree, "0"); if (!v) { o["0.0"] = true; o["0.1"] = true; } setOpen(o); };
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Every line — tap a row to open it<span className="font-normal normal-case tracking-normal sm:hidden"> · months on a wider screen</span></h3>
        <div className="flex gap-2 text-xs"><button onClick={() => openAll(true)} className="min-h-[32px] rounded-md border px-2.5 hover:bg-muted">Open all</button><button onClick={() => openAll(false)} className="min-h-[32px] rounded-md border px-2.5 hover:bg-muted">Close all</button><button onClick={() => setNotes((v) => !v)} className={`min-h-[32px] rounded-md border px-2.5 ${notes ? "bg-muted" : "hover:bg-muted"}`}>{notes ? "Hide notes" : "Show notes"}</button></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm" data-testid="cf-tree">
        <table className="w-full text-[12.5px] sm:min-w-[760px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="sticky left-0 z-[1] bg-card px-3 py-2 text-left">line</th>{cf.months.map((m) => <th key={m.key} className="hidden px-2 py-2 text-right sm:table-cell">{m.label}</th>)}<th className="px-3 py-2 text-right">total</th></tr></thead>
          <tbody>
            {rows.map(({ node, path, depth }) => {
              const v = node.vals[kase]; const tot = v.reduce((a, b) => a + b, 0); const has = node.kids.length > 0; const isOpen = !!open[path];
              const strong = depth <= 1;
              return (
                <tr key={path} onClick={() => has && setOpen({ ...open, [path]: !isOpen })} className={`border-t ${has ? "cursor-pointer hover:bg-muted/40" : ""} ${depth === 0 ? "bg-slate-100 text-[13.5px] font-bold" : depth === 1 ? "bg-slate-50 font-semibold" : ""}`}>
                  <td className={`sticky left-0 z-[1] px-3 py-1.5 ${depth === 0 ? "bg-slate-100" : depth === 1 ? "bg-slate-50" : "bg-card"}`} style={{ paddingLeft: `${8 + depth * 12}px` }}>
                    <div className="flex items-start gap-1.5">
                      <span className="w-3 shrink-0 text-center text-muted-foreground">{has ? (isOpen ? "−" : "+") : ""}</span>
                      <div className="min-w-0 max-w-[520px]">
                        <span className={strong ? "font-semibold" : ""}>{node.label}</span>
                        {node.basis && depth > 0 && <span className={`ml-2 inline-block rounded border px-1 py-px align-middle text-[9px] font-semibold tracking-wide ${BASIS_STYLE[node.basis] ?? "border-slate-200"}`}>{node.basis}</span>}
                        {notes && node.note && <div className="mt-0.5 text-[11px] font-normal leading-snug text-muted-foreground">{node.note}</div>}
                      </div>
                    </div>
                  </td>
                  {v.map((x, i) => <td key={i} className={`hidden whitespace-nowrap px-2 py-1.5 text-right tabular-nums sm:table-cell ${x < 0 ? "text-red-700" : ""}`}>{x ? fmt(x) : "–"}</td>)}
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums ${tot < 0 ? "text-red-700" : ""}`}>{fmt(tot)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground"><b>COMMITTED</b> a salary, fee or plan already agreed · <b>REPEATING</b> a steady pattern · <b>ESTIMATE</b> worked out from history · <b>ASSUMPTION</b> a judgement to replace with a real figure</p>
    </section>
  );
}

// =====================================================================================================================
// MONEY OWED
// =====================================================================================================================
const AGE = [{ k: "current", l: "Not yet due", test: (d: number) => d <= 0 }, { k: "30", l: "1–30 days late", test: (d: number) => d > 0 && d <= 30 },
  { k: "60", l: "31–60 days late", test: (d: number) => d > 30 && d <= 60 }, { k: "90", l: "61–90 days late", test: (d: number) => d > 60 && d <= 90 },
  { k: "90+", l: "More than 90 days late", test: (d: number) => d > 90 }];
export function MoneyOwedView({ cf, initialGroup }: { cf?: CashForecast; initialGroup?: string }) {
  const [group, setGroup] = useState<string>(initialGroup ?? "all"); const [q, setQ] = useState(""); const [sort, setSort] = useState<"amount" | "late">("amount");
  const recs = cf?.receivables ?? [];
  const groups = useMemo(() => { const m = new Map<string, { n: number; amt: number; old: number }>(); for (const r of recs) { const g = m.get(r.group) ?? { n: 0, amt: 0, old: 0 }; g.n++; g.amt += r.amount; if (r.daysOverdue > 60) g.old += r.amount; m.set(r.group, g); } return Array.from(m.entries()).sort((a, b) => b[1].amt - a[1].amt); }, [recs]);
  if (!cf) return <Missing />;
  const rows = recs.filter((r) => (group === "all" || r.group === group) && (!q || `${r.contact} ${r.invoice} ${r.reference}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (sort === "amount" ? b.amount - a.amount : b.daysOverdue - a.daysOverdue));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Money owed to the club — {fmt(cf.receivablesTotal)} on unpaid invoices</h2>
        <p className="text-[13px] text-muted-foreground">Every sales invoice Xero still shows as unpaid, SIU invoices left out. Days late are counted from the due date to today. Collecting it costs nothing — it is the first lever on the cash forecast.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {AGE.map((a) => { const s = recs.filter((r) => a.test(r.daysOverdue)); const amt = s.reduce((x, r) => x + r.amount, 0); return (
          <div key={a.k} className={`rounded-xl border p-3 shadow-sm ${a.k === "90+" ? "border-red-200 bg-red-50" : "bg-card"}`}><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{a.l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{fmt(amt)}</div><div className="text-[12px] text-muted-foreground">{s.length} invoice{s.length === 1 ? "" : "s"}</div></div>); })}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="who owes it">
        <Chip on={group === "all"} onClick={() => setGroup("all")}>Everyone · {fmt(cf.receivablesTotal)}</Chip>
        {groups.map(([g, v]) => <Chip key={g} on={group === g} onClick={() => setGroup(g)}>{g} · {fmt(v.amt)}</Chip>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">{rows.length} invoice{rows.length === 1 ? "" : "s"} · <b className="tabular-nums">{fmt(total, 2)}</b></div>
        <div className="flex flex-wrap items-center gap-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a name or invoice" className="premium-input h-9 w-56 rounded-md border px-3 text-[13px]" /><div className="flex rounded-md border p-0.5 text-xs"><button onClick={() => setSort("amount")} className={`min-h-[32px] rounded px-2.5 ${sort === "amount" ? "bg-primary text-primary-foreground" : ""}`}>Biggest first</button><button onClick={() => setSort("late")} className={`min-h-[32px] rounded px-2.5 ${sort === "late" ? "bg-primary text-primary-foreground" : ""}`}>Oldest first</button></div></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm" data-testid="owed-table">
        <table className="w-full min-w-[680px] text-[12.5px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2 text-left">who</th><th className="px-2 py-2 text-left">invoice</th><th className="px-2 py-2 text-left">group</th><th className="px-2 py-2 text-right">invoiced</th><th className="px-2 py-2 text-right">due</th><th className="px-2 py-2 text-right">days late</th><th className="px-3 py-2 text-right">owed</th></tr></thead>
          <tbody>{rows.slice(0, 400).map((r) => (
            <tr key={r.invoiceId + r.invoice} className="border-t">
              <td className="px-3 py-1.5"><div className="font-medium">{r.contact}</div>{r.reference && <div className="text-[11px] text-muted-foreground">{r.reference}</div>}</td>
              <td className="whitespace-nowrap px-2 py-1.5"><a href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${r.invoiceId}`} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{r.invoice}</a></td>
              <td className="px-2 py-1.5 text-muted-foreground">{r.group}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right text-muted-foreground">{short(r.date)}</td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right text-muted-foreground">{r.due ? short(r.due) : "—"}</td>
              <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${r.daysOverdue > 90 ? "font-semibold text-red-700" : r.daysOverdue > 30 ? "text-amber-700" : "text-muted-foreground"}`}>{r.daysOverdue > 0 ? r.daysOverdue : "—"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(r.amount, 2)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">The invoice number opens it in Xero (you need a Xero login). Read from Xero on {short(cf.bankFeedTo)}; a payment Olga has not yet matched in Xero still shows here as owed.</p>
    </div>
  );
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: any }) {
  return <button onClick={onClick} className={`min-h-[36px] rounded-full border px-3 text-[13px] ${on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{children}</button>;
}

// =====================================================================================================================
// WHAT WE OWE
// =====================================================================================================================
export function WeOweView({ cf, onForecast }: { cf?: CashForecast; onForecast?: () => void }) {
  if (!cf || !cf.owed) return <Missing />;
  const rows = cf.owed; const total = cf.owedTotal ?? 0; const extra = cf.owedNotInForecast ?? 0;
  const unknown = rows.filter((o) => o.amount === null).length;
  const need = Math.max(0, -cf.results.base.low);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">What the club owes — {fmt(total)} found so far</h2>
        <p className="text-[13px] text-muted-foreground">Xero holds almost no supplier bills (the office pays direct and reconciles after), so this is built from the suppliers' own statements and chasing emails in the club's mailboxes, plus what Xero Payroll and the GST lines say is owed to IRD. {unknown > 0 && <>There {unknown === 1 ? "is" : "are"} {unknown} more where the amount has not been confirmed.</>}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-3 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Owed, all of it</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(total)}</div><div className="text-[12px] text-muted-foreground">{rows.length} accounts</div></div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wider text-red-900">Not in the cash forecast</div><div className="mt-1 text-2xl font-semibold tabular-nums text-red-800">{fmt(extra)}</div><div className="text-[12px] text-red-900">nobody has scheduled paying it</div></div>
        <button onClick={onForecast} className="rounded-xl border bg-card p-3 text-left shadow-sm hover:bg-muted"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cash needed today, if it were all paid</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(need + extra)}</div><div className="text-[12px] text-muted-foreground">against {fmt(need)} in the forecast →</div></button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm" data-testid="owe-table">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead><tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2 text-left">who</th><th className="px-2 py-2 text-right">amount</th><th className="px-2 py-2 text-left">where it stands</th><th className="px-3 py-2 text-left">evidence · what to do</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={o.who} className="border-t align-top">
              <td className="px-3 py-2"><div className="font-medium">{o.who}</div><div className="text-[11px] text-muted-foreground">as at {short(o.asAt)}</div></td>
              <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{o.amount !== null ? fmt(o.amount, 2) : o.monthly ? <span className="font-normal">{fmt(o.monthly, 2)}<div className="text-[11px] text-muted-foreground">a month</div></span> : <span className="font-normal text-muted-foreground">not confirmed</span>}</td>
              <td className="px-2 py-2"><span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${/overdue|bounced|failed|disputed|chasing/.test(o.state) ? "border-red-300 bg-red-50 text-red-800" : "border-slate-300 bg-slate-50 text-slate-700"}`}>{o.state}</span><div className={`mt-1 text-[11px] ${o.inForecast ? "text-muted-foreground" : "font-medium text-red-700"}`}>{o.inForecast ? "in the forecast" : "not in the forecast"}</div></td>
              <td className="px-3 py-2 text-[12px] leading-snug text-muted-foreground"><div>{o.evidence}</div><div className="mt-0.5 text-foreground/80">{o.note}</div></td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">Read from the club's own mailboxes (accounts, info, cufc, siu) and Xero. An amount marked "not confirmed" means a statement arrived and nobody has opened it yet — those are the next ones to chase.</p>
    </div>
  );
}

// =====================================================================================================================
// TERM FEES
// =====================================================================================================================
export function TermFeesView({ cf, onOwed }: { cf?: CashForecast; onOwed?: () => void }) {
  if (!cf) return <Missing />;
  const tf = cf.termFees; const P = tf.programmes;
  const S = (k: keyof CfProgramme) => P.reduce((a, p) => a + (p[k] as number), 0);
  const cell = "whitespace-nowrap px-2 py-2 text-right tabular-nums";
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Term fees — both ways a family pays</h2>
        <p className="text-[13px] text-muted-foreground">A family pays either by card in ClubOS, or on an invoice the office raises in Xero. The Academy (U13 and up) is only ever invoiced. ClubOS on its own shows only the invoices that were imported into it.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-3 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Term 3 fee book</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(tf.t3Book)}</div><div className="text-[12px] text-muted-foreground">{fmt(tf.t3Xero)} invoiced in Xero + {fmt(tf.t3CardOnly)} by card</div></div>
        <div className="rounded-xl border bg-card p-3 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What ClubOS alone showed</div><div className="mt-1 text-2xl font-semibold tabular-nums text-muted-foreground">{fmt(tf.t3ClubOSAlone)}</div><div className="text-[12px] text-muted-foreground">{fmt(tf.t3Book - tf.t3ClubOSAlone)} never reached ClubOS</div></div>
        <div className="rounded-xl border bg-card p-3 shadow-sm"><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Term 4 expected</div><div className="mt-1 text-2xl font-semibold tabular-nums">{fmt(S("t4Expected"))}</div><div className="text-[12px] text-muted-foreground">worse {fmt(S("t4Worse"))} · better {fmt(S("t4Better"))}</div></div>
        <button onClick={onOwed} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-left shadow-sm hover:bg-amber-100"><div className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">Term 3 invoices still unpaid</div><div className="mt-1 text-2xl font-semibold tabular-nums text-amber-900">{fmt(S("t3Unpaid"))}</div><div className="text-[12px] text-amber-900">see who owes it →</div></button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm" data-testid="fees-table">
        <table className="w-full min-w-[980px] text-[12.5px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 pt-2 text-left" /><th colSpan={4} className="border-l px-2 pt-2 text-center">Term 3 2026</th><th colSpan={5} className="border-l px-2 pt-2 text-center">Term 4 2026 · starts Mon 12 Oct</th></tr>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground"><th className="px-3 py-2 text-left">programme</th><th className="border-l px-2 py-2 text-right">invoiced in Xero</th><th className="px-2 py-2 text-right">card, no invoice</th><th className="px-2 py-2 text-right">fee book</th><th className="px-2 py-2 text-right">still unpaid</th><th className="border-l px-2 py-2 text-right">expected</th><th className="px-2 py-2 text-right">sold by card</th><th className="px-2 py-2 text-right">invoiced so far</th><th className="px-2 py-2 text-right">card still to sell</th><th className="px-2 py-2 text-right">still to invoice</th></tr>
          </thead>
          <tbody>
            {P.map((p) => (
              <tr key={p.name} className="border-t align-top">
                <td className="px-3 py-2"><div className="font-medium">{p.name}</div><div className="max-w-[340px] text-[11px] leading-snug text-muted-foreground">{p.note}</div></td>
                <td className={`${cell} border-l`}>{fmt(p.t3Invoiced)}</td><td className={cell}>{fmt(p.t3Card)}</td><td className={`${cell} font-semibold`}>{fmt(p.t3Book)}</td><td className={`${cell} ${p.t3Unpaid > 0 ? "text-amber-700" : ""}`}>{fmt(p.t3Unpaid)}</td>
                <td className={`${cell} border-l font-semibold`}>{fmt(p.t4Expected)}</td>
                <td className={cell}>{p.t4CardN ? <>{fmt(p.t4CardSold)}<div className="text-[11px] text-muted-foreground">{p.t4CardN} sign-ups</div></> : p.cardShare ? "–" : <span className="text-[11px] text-muted-foreground">not on sale</span>}</td>
                <td className={cell}>{p.t4InvoicedN ? <>{fmt(p.t4Invoiced)}<div className="text-[11px] text-muted-foreground">{p.t4InvoicedN} invoice{p.t4InvoicedN === 1 ? "" : "s"}, {fmt(p.t4InvoicedPaid)} paid</div></> : p.t4PrePaid ? <>{fmt(p.t4PrePaid)}<div className="text-[11px] text-muted-foreground">paid ahead</div></> : "–"}</td>
                <td className={cell}>{p.cardShare ? fmt(p.t4CardStillToSell) : "–"}</td>
                <td className={`${cell} font-medium text-sky-800`}>{fmt(p.t4StillToInvoice)}</td>
              </tr>
            ))}
            <tr className="border-t bg-slate-50 font-semibold"><td className="px-3 py-2">All programmes</td><td className={`${cell} border-l`}>{fmt(S("t3Invoiced"))}</td><td className={cell}>{fmt(S("t3Card"))}</td><td className={cell}>{fmt(S("t3Book"))}</td><td className={cell}>{fmt(S("t3Unpaid"))}</td><td className={`${cell} border-l`}>{fmt(S("t4Expected"))}</td><td className={cell}>{fmt(S("t4CardSold"))}</td><td className={cell}>{fmt(S("t4Invoiced") + S("t4PrePaid"))}</td><td className={cell}>{fmt(S("t4CardStillToSell"))}</td><td className={cell}>{fmt(S("t4StillToInvoice"))}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border bg-card p-4 text-[13px] leading-relaxed shadow-sm">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How Term 4 is worked out</div>
        Term 3's fee book per programme × last year's Term 4 ÷ Term 3, less what Term 4 has already sold by card (ClubOS, live) and invoiced (Xero, live). Invoices: {tf.invoiceAssumption}. The earlier the Term 4 invoices go out, the more of that money lands before Christmas.
      </div>
    </div>
  );
}
