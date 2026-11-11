/**
 * Canterbury Sport — United Sports Group Limited (formerly Canterbury Sport Ltd), the company that owns the land, the
 * fields and the buildings at United Sports Centre.
 *
 * Seven views over ONE snapshot built from the company's own Xero (outputs/usg-ltd-finance/build_model.py): what it
 * costs to run, what it pays every week and month, its loans, what it needs to break even, its cash in the weeks ahead,
 * and whether the club pays it on time. P&L views are EXCL GST; cash views are what moves through the bank (INCL GST) —
 * each view says which. Nothing here is computed from a guess except where the page says "estimate".
 * The view lives in the URL hash (the ClubOS tab-state rule).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";

type View = "overview" | "costs" | "ongoing" | "loans" | "breakeven" | "cash" | "club";
const VIEWS: View[] = ["overview", "costs", "ongoing", "loans", "breakeven", "cash", "club"];
const LABEL: Record<View, string> = { overview: "Overview", costs: "Costs by year", ongoing: "Ongoing costs", loans: "Loans", breakeven: "Break-even", cash: "Cash ahead", club: "Club payments" };
const API = "/api/admin/canterbury-sport";
const viewFromHash = (): View => { const h = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""); return (VIEWS as string[]).includes(h) ? (h as View) : "overview"; };

const nz = (n: number, cents = false) => {
  const v = Number(n || 0); const s = Math.abs(v).toLocaleString("en-NZ", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  return (v < 0 ? "−$" : "$") + s;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; };
/** ISO yyyy-mm-dd → "21 Nov 2026" from the parts, never through a Date (NZ/UTC day shift). */
const day = (iso?: string | null) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`; };
const tone = (v: number) => (v < 0 ? "text-red-600" : "text-emerald-700");

export default function CanterburySport() {
  const q = useQuery({ queryKey: [API], queryFn: async () => { const r = await workspaceFetch(API); if (r.status === 404) return { denied: true }; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); } });
  const [view, setView] = useState<View>(viewFromHash);
  useEffect(() => { const on = () => setView(viewFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  const go = (v: View) => { history.replaceState(null, "", `#${v}`); setView(v); };
  const m = q.data?.snapshot?.model;

  return (
    <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Canterbury Sport</h1>
          <p className="text-sm text-muted-foreground">United Sports Group Limited (formerly Canterbury Sport Ltd): the land, the fields and the buildings</p>
        </div>
        {m && <p className="text-xs text-muted-foreground">From the company's Xero · updated {day(m.asOf)} · financial year ends {m.fyEnds}</p>}
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.isError && <p className="text-sm text-red-600">Could not load ({String((q.error as any)?.message)}).</p>}
      {q.data?.denied && <p className="text-sm text-muted-foreground">This page is not available on your account.</p>}
      {q.data && !q.data.denied && !m && <p className="text-sm text-muted-foreground">No figures have been sent yet. Run <code>python3 outputs/usg-ltd-finance/build_model.py --push</code>.</p>}
      {m && (
        <>
          <div className="mb-5 flex gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1" role="tablist">
            {VIEWS.map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => go(v)}
                className={`min-h-[40px] shrink-0 rounded-md px-3 text-sm font-medium transition ${view === v ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`cs-tab-${v}`}>{LABEL[v]}</button>
            ))}
          </div>
          {view === "overview" && <Overview m={m} go={go} />}
          {view === "costs" && <Costs m={m} />}
          {view === "ongoing" && <Ongoing m={m} />}
          {view === "loans" && <Loans m={m} />}
          {view === "breakeven" && <BreakEven m={m} />}
          {view === "cash" && <Cash m={m} />}
          {view === "club" && <Club m={m} />}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
function Section({ title, note, children }: { title: string; note?: string; children: any }) {
  return (
    <section className="mb-6 rounded-xl border bg-white p-4 sm:p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Note({ children, kind = "info" }: { children: any; kind?: "info" | "warn" }) {
  return <div className={`mb-4 rounded-lg border p-3 text-sm ${kind === "warn" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>{children}</div>;
}

function useCore(m: any) {
  return useMemo(() => {
    const be = m.breakeven;
    const result = be.income - be.runningCosts - be.loanPaymentsNowPerYear;
    const debt = m.loans.reduce((s: number, l: any) => s + l.balance, 0);
    const owed = m.debtors.reduce((s: number, d: any) => s + d.owing, 0);
    return { be, result, debt, owed };
  }, [m]);
}

/* ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────── */
function Overview({ m, go }: { m: any; go: (v: View) => void }) {
  const { be, result, debt, owed } = useCore(m);
  const cufc = m.clubStats?.CUFC?.all;
  const minWeek = m.forecast.weeks.reduce((a: any, w: any) => (w.closing < a.closing ? w : a), m.forecast.weeks[0]);
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Income, last 12 months" value={nz(be.income)} sub={`${monthLabel(be.period[0])} – ${monthLabel(be.period[1])}, excl GST`} />
        <Tile label="Running costs" value={nz(be.runningCosts)} sub="Last 12 months, excl GST, before loan payments" />
        <Tile label="ANZ loan payments" value={nz(be.loanPaymentsNowPerYear)} sub={`${nz(be.loanPaymentsNowPerYear / 12)} a month at today's three payments`} />
        <Tile label="Result a year" value={nz(result)} cls={tone(result)} sub={`${nz(result / 12)} a month: income less running costs and ANZ payments`} />
        <Tile label="In the bank today" value={nz(m.bank.total)} sub="All the company's accounts" />
        <Tile label="Owed to the company" value={nz(owed)} sub={`${m.debtors.length} customers`} />
        <Tile label="Loans" value={nz(debt)} sub="ANZ, SIU Lifestyle, Loan -3" />
        <Tile label="Club pays on time" value={cufc?.onTimePct != null ? `${cufc.onTimePct}%` : "—"} sub={cufc ? `CUFC, ${cufc.paidCount} paid invoices; late ones average ${cufc.avgDaysLateWhenLate} days` : undefined} />
      </div>
      <Section title="Month by month" note="Income against running costs and loan payments, from the company's P&L (excl GST). Depreciation is left out: it is not cash.">
        <MonthChart months={m.months.slice(-24)} />
      </Section>
      <Section title="What stands out">
        <ul className="space-y-2 text-sm">
          <li>• <b>The grounds cover their own running costs; the loans do not fit on top.</b> Over the last 12 months income was {nz(be.income)} and running costs {nz(be.runningCosts)}, leaving {nz(be.income - be.runningCosts)}. The three ANZ payments now come to {nz(be.loanPaymentsNowPerYear)} a year. <button className="underline" onClick={() => go("breakeven")}>Break-even →</button></li>
          <li>• <b>Every ANZ payment is recorded as "Loan Fees", and the loan balance in Xero has never gone down.</b> Each payment is about 10% a year of what was borrowed, which suggests it includes repaying the loan, not just interest. Ask ANZ for a loan statement. <button className="underline" onClick={() => go("loans")}>Loans →</button></li>
          <li>• <b>{nz(be.otherLoansBalance)} of loans have no repayments and no terms in Xero</b> (SIU Lifestyle and "Loan -3"). If either starts charging interest, the gap grows.</li>
          <li>• <b>Cash is thin.</b> The company holds {nz(m.bank.total)} today. Over the next 26 weeks the lowest point we expect is {nz(minWeek.closing)} (week of {day(minWeek.start)}), before any repairs or one-off bills. <button className="underline" onClick={() => go("cash")}>Cash ahead →</button></li>
          <li>• <b>The club is {Math.round(100 * be.cufcIncomeLast12m / Math.max(1, be.income))}% of the company's income.</b> When it pays late, the company has to find the ANZ money somewhere else. <button className="underline" onClick={() => go("club")}>Club payments →</button></li>
        </ul>
      </Section>
    </>
  );
}

function MonthChart({ months }: { months: any[] }) {
  const W = 960, H = 240, P = 28;
  const max = Math.max(1, ...months.map((x) => Math.max(x.income, x.runningCosts + x.loanPayments)));
  const bw = (W - P * 2) / months.length;
  const y = (v: number) => H - P - (Math.max(0, v) / max) * (H - P * 2);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Monthly income and costs">
        {months.map((x, i) => {
          const x0 = P + i * bw;
          return (
            <g key={x.month}>
              <rect x={x0 + 2} y={y(x.income)} width={bw / 2 - 3} height={H - P - y(x.income)} fill="#16a34a" opacity={x.partial ? 0.4 : 0.85}><title>{`${monthLabel(x.month)} income ${nz(x.income)}`}</title></rect>
              <rect x={x0 + bw / 2} y={y(x.runningCosts)} width={bw / 2 - 3} height={H - P - y(x.runningCosts)} fill="#94a3b8" opacity={x.partial ? 0.4 : 1}><title>{`running costs ${nz(x.runningCosts)}`}</title></rect>
              <rect x={x0 + bw / 2} y={y(x.runningCosts + x.loanPayments)} width={bw / 2 - 3} height={y(x.runningCosts) - y(x.runningCosts + x.loanPayments)} fill="#dc2626" opacity={x.partial ? 0.4 : 0.8}><title>{`loan payments ${nz(x.loanPayments)}`}</title></rect>
              {i % 2 === 0 && <text x={x0 + bw / 2} y={H - 8} fontSize="11" textAnchor="middle" fill="#64748b">{monthLabel(x.month)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-green-600" />Income</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" />Running costs</span>
        <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-red-600" />Loan payments</span>
        <span>Faded = this month so far</span>
      </div>
    </div>
  );
}

/* ── Costs by year ────────────────────────────────────────────────────────────────────────────────────────────── */
function Costs({ m }: { m: any }) {
  const periods = m.periods as any[];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const total = (rows: any[], k: string) => rows.reduce((s, r) => s + (r.values[k] || 0), 0);
  const Table = ({ rows, title }: { rows: any[]; title: string }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">{title}</th>{periods.map((p) => <th key={p.key} className="py-2 pl-3 text-right font-medium">{p.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <FragmentRows key={r.category} r={r} periods={periods} open={!!open[title + r.category]} toggle={() => setOpen({ ...open, [title + r.category]: !open[title + r.category] })} />
          ))}
          <tr className="border-t font-semibold"><td className="py-2 pr-3">Total</td>{periods.map((p) => <td key={p.key} className="py-2 pl-3 text-right tabular-nums">{nz(total(rows, p.key))}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <Note>From the company's P&L, <b>excl GST</b>. The financial year runs April to March. "Last 12 months" is the honest yearly figure: {m.periods.find((p: any) => p.key === "L12M")?.range?.map(monthLabel).join(" – ")}. Tap a row to see the Xero accounts inside it.</Note>
      <Section title="What it costs to run"><Table rows={m.costs} title="Cost" /></Section>
      <Section title="What it earns"><Table rows={m.income} title="Income" /></Section>
      <Section title="Depreciation" note="Not cash. Posted at year end, so this year's is not in yet.">
        <Table rows={m.depreciation} title="Depreciation" />
      </Section>
      <Section title="Who pays it" note="Invoiced, excl GST">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Customer</th>{periods.map((p) => <th key={p.key} className="py-2 pl-3 text-right font-medium">{p.label}</th>)}</tr></thead>
            <tbody>{m.incomeByWho.map((w: any) => <tr key={w.who} className="border-b last:border-0"><td className="py-2 pr-3">{w.who}</td>{periods.map((p) => <td key={p.key} className="py-2 pl-3 text-right tabular-nums">{w.values[p.key] != null ? nz(w.values[p.key]) : "—"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
function FragmentRows({ r, periods, open, toggle }: { r: any; periods: any[]; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={toggle}>
        <td className="py-2 pr-3"><span className="mr-1 inline-block w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>{r.category}</td>
        {periods.map((p) => <td key={p.key} className="py-2 pl-3 text-right tabular-nums">{nz(r.values[p.key] || 0)}</td>)}
      </tr>
      {open && r.lines.map((l: any) => (
        <tr key={l.name} className="border-b bg-muted/20 text-xs text-muted-foreground">
          <td className="py-1.5 pl-7 pr-3">{l.name}</td>
          {periods.map((p) => <td key={p.key} className="py-1.5 pl-3 text-right tabular-nums">{nz(l.values[p.key] || 0)}</td>)}
        </tr>
      ))}
    </>
  );
}

/* ── Ongoing costs ────────────────────────────────────────────────────────────────────────────────────────────── */
function Ongoing({ m }: { m: any }) {
  const rows = m.recurring as any[];
  const loan = rows.filter((r) => r.group === "Loan"), run = rows.filter((r) => r.group !== "Loan");
  const sum = (a: any[]) => a.reduce((s, r) => s + r.perYear, 0);
  const [showOne, setShowOne] = useState(false);
  const T = ({ list }: { list: any[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Paid to</th><th className="py-2 px-3 font-medium">How often</th><th className="py-2 px-3 text-right font-medium">Usual amount</th><th className="py-2 px-3 text-right font-medium">A year</th><th className="py-2 px-3 font-medium">Last paid</th><th className="py-2 pl-3 font-medium">Next due</th></tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.name} className="border-b last:border-0">
            <td className="py-2 pr-3">{r.name}</td><td className="py-2 px-3">{r.frequency}{r.dayOfMonth ? ` · around the ${r.dayOfMonth}${["th", "st", "nd", "rd"][(r.dayOfMonth % 10 > 3 || [11, 12, 13].includes(r.dayOfMonth)) ? 0 : r.dayOfMonth % 10]}` : ""}</td>
            <td className="py-2 px-3 text-right tabular-nums">{nz(r.typical, true)}</td><td className="py-2 px-3 text-right font-medium tabular-nums">{nz(r.perYear)}</td>
            <td className="py-2 px-3 text-muted-foreground">{day(r.lastPaid)}</td><td className="py-2 pl-3">{day(r.next)}</td>
          </tr>))}
          <tr className="border-t font-semibold"><td className="py-2 pr-3" colSpan={3}>Total a year</td><td className="py-2 px-3 text-right tabular-nums">{nz(sum(list))}</td><td colSpan={2} /></tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <>
      <Note>Every payment the company has made <b>regularly</b> from the bank in the last 12 months, worked out from Xero. Amounts are what left the bank, so they <b>include GST</b>. "A year" is the usual amount × how often. "Next due" follows the pattern and is an estimate.</Note>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label="Loan payments a year" value={nz(sum(loan))} sub={`${nz(sum(loan) / 12)} a month`} />
        <Tile label="Other ongoing costs a year" value={nz(sum(run))} sub={`${nz(sum(run) / 12)} a month`} />
        <Tile label="Committed every month" value={nz((sum(loan) + sum(run)) / 12)} sub="Before repairs and one-off bills" />
      </div>
      <Section title="Loan payments"><T list={loan} /></Section>
      <Section title="Running the grounds"><T list={run} /></Section>
      <Section title="Paid in the last 12 months but not regular" note="One-off or irregular payments, mostly repairs and trades. Not counted above.">
        <button className="text-sm underline" onClick={() => setShowOne(!showOne)}>{showOne ? "Hide" : `Show ${m.oneOffs.length}`}</button>
        {showOne && <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{m.oneOffs.map((o: any) => <li key={o.name} className="flex justify-between gap-3 border-b py-1"><span>{o.name}</span><span className="tabular-nums">{nz(o.paidLast12m)}</span></li>)}</ul>}
      </Section>
    </>
  );
}

/* ── Loans ────────────────────────────────────────────────────────────────────────────────────────────────────── */
function Loans({ m }: { m: any }) {
  const total = m.loans.reduce((s: number, l: any) => s + l.balance, 0);
  const monthly = m.loans.reduce((s: number, l: any) => s + l.monthlyPayment, 0);
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total borrowed" value={nz(total)} />
        <Tile label="Paid to lenders each month" value={nz(monthly, true)} sub={`${nz(monthly * 12)} a year`} />
        <Tile label="Assets" value={nz(m.balanceSheet.totalAssets)} sub="Land, fields, buildings, at cost less depreciation" />
        <Tile label="Owners' money in (net)" value={nz(m.balanceSheet.netAssets)} sub="Assets less everything owed" />
      </div>
      <Note kind="warn">Xero does not hold any loan's interest rate, term or end date. The figures below are what the bank lines show. To plan properly we need: the ANZ loan statement (rate, term, how much of each payment is principal), and the written terms of the SIU Lifestyle and "Loan -3" money.</Note>
      {m.loans.map((l: any) => (
        <Section key={l.key} title={`${l.name}: ${nz(l.balance)}`} note={`Lender: ${l.lender}`}>
          <p className="mb-3 text-sm text-slate-700">{l.note}</p>
          {l.facilities.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Drawn</th><th className="py-2 px-3 text-right font-medium">Amount</th><th className="py-2 px-3 font-medium">Paid from</th><th className="py-2 px-3 text-right font-medium">Each month</th><th className="py-2 px-3 font-medium">Day</th><th className="py-2 pl-3 text-right font-medium">As a yearly %</th></tr></thead>
                <tbody>{l.facilities.map((f: any) => (
                  <tr key={f.payee} className="border-b last:border-0">
                    <td className="py-2 pr-3">{day(f.drawdown?.date)}</td><td className="py-2 px-3 text-right tabular-nums">{f.drawdown ? nz(f.drawdown.amount) : "—"}</td>
                    <td className="py-2 px-3">{f.payee}</td><td className="py-2 px-3 text-right tabular-nums">{nz(f.monthlyPayment, true)}</td><td className="py-2 px-3">~{f.dayOfMonth}th</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{f.impliedInterestOnlyRate != null ? `${f.impliedInterestOnlyRate}%` : "—"}</td>
                  </tr>))}</tbody>
              </table>
              <p className="mt-1 text-xs text-muted-foreground">"As a yearly %" = 12 payments ÷ amount drawn. If a loan were interest only, this would be its interest rate.</p>
            </div>
          )}
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Money received ({l.drawdowns.length})</summary>
            <ul className="mt-2 space-y-1">{l.drawdowns.map((d: any, i: number) => <li key={i} className="flex justify-between gap-3 border-b py-1"><span>{d.date ? day(d.date) : "Earlier"} · {d.from}</span><span className="tabular-nums">{nz(d.amount)}</span></li>)}</ul>
          </details>
        </Section>
      ))}
    </>
  );
}

/* ── Break-even ───────────────────────────────────────────────────────────────────────────────────────────────── */
function Num({ label, value, set, step = 100, suffix }: { label: string; value: number; set: (n: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        {!suffix && <span className="text-muted-foreground">$</span>}
        <input type="number" inputMode="decimal" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => set(Number(e.target.value || 0))}
          className="h-11 w-full rounded-md border px-3 tabular-nums" />
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}
function BreakEven({ m }: { m: any }) {
  const be = m.breakeven;
  const [cufcExtra, setCufcExtra] = useState(0);
  const [otherExtra, setOtherExtra] = useState(0);
  const [savings, setSavings] = useState(0);
  const [rate, setRate] = useState(0);
  const [years, setYears] = useState(0);
  const other = be.otherLoansBalance;
  const otherInterest = other * (rate / 100);
  const otherPrincipal = years > 0 ? other / years : 0;
  const income = be.income + cufcExtra * 12 + otherExtra;
  const costs = be.runningCosts - savings;
  const anz = be.loanPaymentsNowPerYear;
  const result = income - costs - anz - otherInterest - otherPrincipal;
  const needCufc = result < 0 ? -result / 12 : 0;
  const Row = ({ k, v, b }: { k: string; v: number; b?: boolean }) => <div className={`flex justify-between border-b py-2 text-sm ${b ? "font-semibold" : ""}`}><span>{k}</span><span className={`tabular-nums ${b ? tone(v) : ""}`}>{nz(v)}</span></div>;
  return (
    <>
      <Note>Starts from the last 12 months ({monthLabel(be.period[0])} – {monthLabel(be.period[1])}), <b>excl GST</b>, with the three ANZ payments at today's amounts. Change the boxes to test a plan. Nothing is saved.</Note>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Change the plan">
          <div className="grid gap-4 sm:grid-cols-2">
            <Num label="CUFC pays more each month (excl GST)" value={cufcExtra} set={setCufcExtra} />
            <Num label="More from other hirers a year" value={otherExtra} set={setOtherExtra} step={1000} />
            <Num label="Running costs saved a year" value={savings} set={setSavings} step={1000} />
            <Num label="Interest on the SIU + Loan -3 money" value={rate} set={setRate} step={0.25} suffix="% a year" />
            <Num label="Repay SIU + Loan -3 over" value={years} set={setYears} step={1} suffix="years (0 = not repaying)" />
          </div>
        </Section>
        <Section title="A year">
          <Row k="Income" v={income} />
          <Row k="Running costs" v={-costs} />
          <Row k="ANZ loan payments" v={-anz} />
          {otherInterest > 0 && <Row k="Interest on SIU + Loan -3" v={-otherInterest} />}
          {otherPrincipal > 0 && <Row k="Repaying SIU + Loan -3" v={-otherPrincipal} />}
          <Row k="Result" v={result} b />
          <p className="mt-3 text-sm">{result >= 0
            ? <>The company <b className="text-emerald-700">breaks even</b>, with {nz(result)} a year ({nz(result / 12)} a month) to spare.</>
            : <>To break even the company needs <b className="text-red-600">{nz(needCufc)} more a month</b>. If it all came from the club, that is {nz(needCufc * 1.15)} a month incl GST on top of what CUFC pays now.</>}</p>
          <p className="mt-2 text-xs text-muted-foreground">Running costs exclude depreciation (not cash). Repairs come from the last 12 months; a big turf or lights bill would sit on top. If the ANZ payments include principal, part of that line is paying the loan down rather than a cost.</p>
        </Section>
      </div>
    </>
  );
}

/* ── Cash ahead ───────────────────────────────────────────────────────────────────────────────────────────────── */
function Cash({ m }: { m: any }) {
  const f = m.forecast; const weeks = f.weeks as any[];
  const [openW, setOpenW] = useState<string | null>(null);
  const min = weeks.reduce((a, w) => (w.closing < a.closing ? w : a), weeks[0]);
  const W = 960, H = 200, P = 26;
  const vals = [f.startBalance, ...weeks.map((w) => w.closing)];
  const hi = Math.max(...vals, 1), lo = Math.min(0, ...vals);
  const y = (v: number) => P + (hi - v) / (hi - lo) * (H - P * 2);
  const x = (i: number) => P + i * (W - P * 2) / weeks.length;
  return (
    <>
      <Note>Cash through the bank, <b>incl GST</b>, for the next 26 weeks. It counts the payments the company makes every week and month (<i>Ongoing costs</i>), invoices already sent that are still owed (on their due date), and, for months not yet invoiced, the average the club and other hirers paid over {f.averageMonths.map(monthLabel).join(", ")} (<b>an estimate</b>: club {nz(f.clubMonthlyAverage)} and others {nz(f.otherMonthlyAverage)} a month). <b>Not included:</b> repairs, one-off bills, building work, GST refunds or payments, and owner money.</Note>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile label="In the bank today" value={nz(f.startBalance)} />
        <Tile label="Lowest point" value={nz(min.closing)} cls={tone(min.closing)} sub={`Week of ${day(min.start)}`} />
        <Tile label="In 26 weeks" value={nz(weeks[weeks.length - 1].closing)} cls={tone(weeks[weeks.length - 1].closing)} />
      </div>
      <Section title="Bank balance, week by week">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[620px]" role="img" aria-label="Expected bank balance">
            {lo < 0 && <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#dc2626" strokeDasharray="4 4" />}
            <polyline fill="none" stroke="#1d4ed8" strokeWidth="2.5" points={vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {weeks.map((w, i) => i % 4 === 0 && <text key={w.start} x={x(i + 1)} y={H - 6} fontSize="11" textAnchor="middle" fill="#64748b">{day(w.start).replace(/ \d{4}$/, "")}</text>)}
          </svg>
        </div>
      </Section>
      <Section title="Each week" note="Tap a week to see what goes in and out.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Week of</th><th className="py-2 px-3 text-right font-medium">In</th><th className="py-2 px-3 text-right font-medium">Out</th><th className="py-2 pl-3 text-right font-medium">Bank at the end</th></tr></thead>
            <tbody>{weeks.map((w) => (
              <WeekRows key={w.start} w={w} open={openW === w.start} toggle={() => setOpenW(openW === w.start ? null : w.start)} />
            ))}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Where the money came from, last 12 months" note="Every bank line by kind, incl GST. 'Operating' = trading receipts less running costs and loan payments; when it is negative, the owner, the lenders or GST refunds covered it.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2 pr-2 font-medium">Month</th>{m.cashBuckets.map((b: string) => <th key={b} className="py-2 px-2 text-right font-medium">{b}</th>)}<th className="py-2 pl-2 text-right font-medium">Operating</th></tr></thead>
            <tbody>{m.cashByMonth.map((r: any) => (
              <tr key={r.month} className="border-b last:border-0"><td className="py-1.5 pr-2">{monthLabel(r.month)}</td>{m.cashBuckets.map((b: string) => <td key={b} className="py-1.5 px-2 text-right tabular-nums">{r[b] ? nz(r[b]) : "—"}</td>)}<td className={`py-1.5 pl-2 text-right font-medium tabular-nums ${tone(r.operating)}`}>{nz(r.operating)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
function WeekRows({ w, open, toggle }: { w: any; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={toggle}>
        <td className="py-2 pr-3"><span className="mr-1 inline-block w-3 text-muted-foreground">{open ? "▾" : "▸"}</span>{day(w.start)}</td>
        <td className="py-2 px-3 text-right tabular-nums text-emerald-700">{w.totalIn ? nz(w.totalIn) : "—"}</td>
        <td className="py-2 px-3 text-right tabular-nums">{w.totalOut ? nz(-w.totalOut) : "—"}</td>
        <td className={`py-2 pl-3 text-right font-medium tabular-nums ${tone(w.closing)}`}>{nz(w.closing)}</td>
      </tr>
      {open && [...w.in.map((x: any) => ({ ...x, s: 1 })), ...w.out.map((x: any) => ({ ...x, s: -1 }))].sort((a, b) => a.date.localeCompare(b.date)).map((x: any, i: number) => (
        <tr key={i} className="border-b bg-muted/20 text-xs">
          <td className="py-1.5 pl-7 pr-3" colSpan={2}>{day(x.date)} · {x.name}{x.kind === "estimate" ? " (estimate)" : ""}{x.overdue ? " (overdue)" : ""}</td>
          <td className={`py-1.5 px-3 text-right tabular-nums ${x.s > 0 ? "text-emerald-700" : ""}`} colSpan={2}>{nz(x.s * x.amount, true)}</td>
        </tr>
      ))}
    </>
  );
}

/* ── Club payments ────────────────────────────────────────────────────────────────────────────────────────────── */
function Club({ m }: { m: any }) {
  const [who, setWho] = useState<"CUFC" | "CUGC (gymnastics)">("CUFC");
  const stats = m.clubStats[who] || {};
  const fys = Object.keys(stats).filter((k) => k !== "all").sort();
  const rows = (m.clubInvoices as any[]).filter((r) => r.who === who).slice().reverse();
  const badge = (r: any) => {
    if (!r.paid && r.owing > 0) return r.daysLate > 0 ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">{r.daysLate} days overdue</span> : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Not yet due</span>;
    if (r.daysLate == null) return null;
    return r.daysLate <= 0 ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">On time</span> : <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{r.daysLate} days late</span>;
  };
  return (
    <>
      <Note>Every invoice the company has sent the club since April 2024, with when it was due and when it was paid in full (amounts <b>incl GST</b>). The company pays ANZ around the 21st, 25th and 30th of every month, so a club payment that lands after those dates leaves the company short.</Note>
      <div className="mb-4 flex gap-2">
        {(["CUFC", "CUGC (gymnastics)"] as const).map((w) => <button key={w} onClick={() => setWho(w)} className={`min-h-[40px] rounded-md border px-3 text-sm ${who === w ? "bg-slate-900 text-white" : "bg-white"}`}>{w}</button>)}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Paid on time" value={stats.all?.onTimePct != null ? `${stats.all.onTimePct}%` : "—"} sub={`${stats.all?.onTime ?? 0} of ${stats.all?.paidCount ?? 0} paid invoices`} />
        <Tile label="When late, by" value={`${stats.all?.avgDaysLateWhenLate ?? 0} days`} sub="Average" />
        <Tile label="Owing now" value={nz(stats.all?.owing ?? 0)} />
        <Tile label="Overdue now" value={nz(stats.all?.overdue ?? 0)} cls={(stats.all?.overdue ?? 0) > 0 ? "text-red-600" : ""} />
      </div>
      <Section title="By financial year">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Year</th><th className="py-2 px-3 text-right font-medium">Invoiced</th><th className="py-2 px-3 text-right font-medium">Invoices</th><th className="py-2 px-3 text-right font-medium">On time</th><th className="py-2 pl-3 text-right font-medium">Late by (avg)</th></tr></thead>
            <tbody>{fys.map((k) => <tr key={k} className="border-b last:border-0"><td className="py-2 pr-3">{k}</td><td className="py-2 px-3 text-right tabular-nums">{nz(stats[k].invoiced)}</td><td className="py-2 px-3 text-right">{stats[k].invoices}</td><td className="py-2 px-3 text-right">{stats[k].onTimePct != null ? `${stats[k].onTimePct}%` : "—"}</td><td className="py-2 pl-3 text-right">{stats[k].avgDaysLateWhenLate} days</td></tr>)}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Every invoice">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-3 font-medium">Invoice</th><th className="py-2 px-3 font-medium">For</th><th className="py-2 px-3 font-medium">Sent</th><th className="py-2 px-3 font-medium">Due</th><th className="py-2 px-3 font-medium">Paid</th><th className="py-2 px-3 text-right font-medium">Amount</th><th className="py-2 pl-3 font-medium">Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.number} className="border-b last:border-0">
                <td className="py-2 pr-3">{r.number}</td><td className="py-2 px-3">{r.for || "—"}</td><td className="py-2 px-3 text-muted-foreground">{day(r.date)}</td><td className="py-2 px-3">{day(r.due)}</td><td className="py-2 px-3">{day(r.paid)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{nz(r.total, true)}{r.owing > 0 && r.owing < r.total ? <span className="block text-xs text-red-600">{nz(r.owing, true)} owing</span> : null}</td><td className="py-2 pl-3">{badge(r)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Section>
      <Section title="Everyone who owes the company now">
        <ul className="text-sm">{m.debtors.map((d: any) => <li key={d.name} className="flex justify-between gap-3 border-b py-1.5 last:border-0"><span>{d.name}</span><span className="tabular-nums">{nz(d.owing, true)}</span></li>)}</ul>
      </Section>
    </>
  );
}
