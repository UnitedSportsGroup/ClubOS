// ─────────────────────────────────────────────────────────────────────────────
// ENERGY — power, gas and water across every site we pay for.
//
// Daniel, 2026-09-23: "a really good system for tracking our energy consumption
// and expenses … really detailed attribution … see where that's currently being
// paid from." Every figure on this page is DERIVED from the bills (imported from
// the suppliers' own tax invoices, each one reconciled to the cent) — nothing is
// a stored total. Money shown incl. GST unless it says otherwise.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DatePickerInput } from "@/components/ui/date-picker-input";
import { MoneyInput } from "@/components/ui/money-input";
import { SelectInput } from "@/components/ui/select-input";
import { dollarInputToCents, formatCurrency } from "@/lib/format";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Zap, Flame, Droplets, Plus, Pencil, AlertTriangle, TrendingUp, TrendingDown, Wallet, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { LPG_KWH_PER_KG, billDays, billMonth, exGst, type EnergyUtility } from "@shared/energy";

interface Site {
  id: number; name: string; address: string | null; utility: EnergyUtility; area: string | null; supplier: string | null;
  accountNumber: string | null; icp: string | null; meter: string | null; paidBy: string | null; notes: string | null; archivedAt: string | null;
}
interface Line { kind: string; meter?: string; register?: string; rateCPerKwh?: number; kwh?: number; cents: number; cPerDay?: number; days?: number; label?: string; desc?: string; qty?: number; kg?: number }
interface Bill {
  id: number; siteId: number; source: string; invoiceNumber: string | null; kind: string; periodStart: string | null; periodEnd: string | null;
  billDate: string | null; units: number | null; unit: string | null; cents: number; fixedCents: number; lines: Line[]; readings: Array<{ prev: number; curr: number; kwh: number; basis?: string }>;
}
interface Payment { id: number; supplier: string; accountNumber: string | null; paidOn: string; cents: number; method: string | null; kind: "payment" | "dishonour" | "fee" }
interface EnergyResponse {
  sites: Site[]; bills: Bill[]; payments: Payment[]; today: string;
  xero: { asOf: string; residency: { account: string; years: Record<string, number> }; general: { account: string; years: Record<string, number> } };
}
const KEY = ["/api/admin/energy"];

const money = (c: number) => formatCurrency(c, { fromCents: true, decimals: 0 });
const money2 = (c: number) => formatCurrency(c, { fromCents: true });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ym = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(2, 4)}`;
const dmy = (s: string | null) => (s ? `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : "—");
const SITE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16", "#ec4899"];
const UTIL_ICON: Record<EnergyUtility, typeof Zap> = { electricity: Zap, gas: Flame, water: Droplets };
const unitLabel = (u: string | null) => (u === "m3" ? "m³" : u ?? "");

/** Shift a y-m string by n months, on the parts. */
function addMonths(ymStr: string, n: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export default function EnergyPage() {
  const { data, isLoading, error } = useQuery<EnergyResponse>({ queryKey: KEY });
  const [metric, setMetric] = useState<"cost" | "use">("cost");
  const [range, setRange] = useState<24 | 60>(24);
  const [siteFilter, setSiteFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<Site | null>(null);
  const [addBill, setAddBill] = useState(false);
  const [addSite, setAddSite] = useState(false);

  const d = useMemo(() => {
    if (!data) return null;
    const sites = data.sites.filter((s) => !s.archivedAt);
    const color = new Map(sites.map((s, i) => [s.id, SITE_COLORS[i % SITE_COLORS.length]]));
    const thisMonth = data.today.slice(0, 7);
    const from12 = addMonths(thisMonth, -11), from24 = addMonths(thisMonth, -23);
    const inWin = (b: Bill, a: string, z: string) => { const m = billMonth(b); return !!m && m >= a && m <= z; };
    const last12 = data.bills.filter((b) => inWin(b, from12, thisMonth));
    const prev12 = data.bills.filter((b) => inWin(b, from24, addMonths(from12, -1)));
    const siteOf = new Map(data.sites.map((s) => [s.id, s]));
    const elec = (bs: Bill[]) => bs.filter((b) => siteOf.get(b.siteId)?.utility === "electricity");
    const sum = (bs: Bill[], f: (b: Bill) => number) => bs.reduce((s, b) => s + f(b), 0);
    const kwh12 = sum(elec(last12), (b) => b.units ?? 0);
    const cost12 = sum(last12, (b) => b.cents), costPrev = sum(prev12, (b) => b.cents);
    const elecCost12 = sum(elec(last12), (b) => b.cents), fixed12 = sum(elec(last12), (b) => b.fixedCents);

    // Account balance, the way the supplier keeps it: bills + fees − payments + bounced payments.
    const acct = "40593350";
    const acctBills = data.bills.filter((b) => b.source === "meridian" && b.invoiceNumber !== "21467536");
    const balance = sum(acctBills, (b) => b.cents)
      + data.payments.filter((p) => p.accountNumber === acct).reduce((s, p) => s + (p.kind === "payment" ? -p.cents : p.cents), 0);

    // Chart: one bar per month, stacked by site.
    const months: string[] = [];
    for (let m = addMonths(thisMonth, -(range - 1)); m <= thisMonth; m = addMonths(m, 1)) months.push(m);
    const chart = months.map((m) => {
      const row: Record<string, number | string> = { month: ym(m) };
      for (const s of sites) row[`s${s.id}`] = 0;
      for (const b of data.bills) {
        if (billMonth(b) !== m || !color.has(b.siteId)) continue;
        const s = siteOf.get(b.siteId)!;
        const v = metric === "cost" ? b.cents / 100 : s.utility === "gas" ? (b.units ?? 0) * LPG_KWH_PER_KG : s.utility === "electricity" ? b.units ?? 0 : 0;
        row[`s${b.siteId}`] = Math.round(((row[`s${b.siteId}`] as number) + v) * 100) / 100;
      }
      return row;
    });

    // Per site: last 12 months, latest bill, same period a year earlier, rate history.
    const perSite = sites.map((s) => {
      const bs = data.bills.filter((b) => b.siteId === s.id).sort((a, b) => (a.periodEnd ?? "").localeCompare(b.periodEnd ?? ""));
      const real = bs.filter((b) => b.kind === "bill");
      const latest = real[real.length - 1];
      const yearAgo = latest ? real.find((b) => billMonth(b) === addMonths(billMonth(latest)!, -12)) : undefined;
      const perDay = (b?: Bill) => { const n = b ? billDays(b.periodStart, b.periodEnd) : null; return b && n && b.units != null ? b.units / n : null; };
      const rates = real.flatMap((b) => b.lines.filter((l) => l.kind === "energy" && l.rateCPerKwh).map((l) => ({ at: b.periodEnd ?? "", rate: l.rateCPerKwh! })));
      const daily = real.flatMap((b) => b.lines.filter((l) => l.kind === "daily" && l.cPerDay).map((l) => ({ at: b.periodEnd ?? "", c: l.cPerDay! })));
      const s12 = last12.filter((b) => b.siteId === s.id);
      return {
        site: s, color: color.get(s.id)!, bills: bs.length, first: bs[0]?.periodStart ?? bs[0]?.billDate ?? null,
        units12: sum(s12, (b) => b.units ?? 0), cost12: sum(s12, (b) => b.cents), fixed12: sum(s12, (b) => b.fixedCents), deliveries12: s12.length,
        latest, perDay: perDay(latest), perDayYearAgo: perDay(yearAgo),
        rateNow: rates[rates.length - 1]?.rate ?? null, rateFirst: rates[0]?.rate ?? null, rateFirstAt: rates[0]?.at ?? null,
        dailyNow: daily[daily.length - 1]?.c ?? null, dailyFirst: daily[0]?.c ?? null,
      };
    });

    // The check: our bills (excl GST, by the year of the bill) against Xero's lines.
    const byYear = (area: "residency" | "general") => {
      const out: Record<number, number> = {};
      for (const b of data.bills) {
        const s = siteOf.get(b.siteId); if (!s || b.source === "manual") continue;
        if ((area === "residency") !== (s.area === "Residency")) continue;
        const y = Number((b.billDate ?? b.periodEnd ?? "0").slice(0, 4));
        out[y] = (out[y] ?? 0) + exGst(b.cents);
      }
      return out;
    };
    return { sites, color, siteOf, kwh12, cost12, costPrev, elecCost12, fixed12, balance, chart, perSite, resYears: byYear("residency"), genYears: byYear("general"), from12 };
  }, [data, metric, range]);

  if (isLoading) return <div className="p-8 text-sm text-white/45">Loading every bill…</div>;
  if (error || !data || !d) return <div className="p-8 text-sm text-red-400">{(error as Error)?.message ?? "Couldn't load energy."}</div>;

  const change = d.costPrev > 0 ? Math.round(((d.cost12 - d.costPrev) / d.costPrev) * 100) : null;
  const bounced = data.payments.filter((p) => p.kind === "dishonour");
  const methods = data.payments.filter((p) => p.kind === "payment");
  const lastDD = methods.filter((p) => /direct debit/i.test(p.method ?? "")).map((p) => p.paidOn).sort().pop();
  const firstOnline = methods.filter((p) => /online/i.test(p.method ?? "")).map((p) => p.paidOn).sort()[0];
  const shownBills = data.bills.filter((b) => siteFilter === null || b.siteId === siteFilter);

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto" data-testid="energy-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Zap className="w-5 h-5 text-amber-400" /> Energy</h1>
          <p className="text-xs text-white/45 mt-1 max-w-2xl">
            Power, gas and water for every site we pay for, from each supplier's own tax invoices. Every invoice here adds up to the cent. Amounts include GST unless marked.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAddSite(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-white/10 text-white/70 hover:text-white" data-testid="energy-add-site"><Building2 className="w-3.5 h-3.5" /> Add site</button>
          <button onClick={() => setAddBill(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25" data-testid="energy-add-bill"><Plus className="w-3.5 h-3.5" /> Add a bill</button>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="energy-stats">
        <Stat label="Last 12 months" value={money(d.cost12)} sub={change === null ? "all sites" : undefined}
          change={change === null ? undefined : { pct: change, vs: "the 12 months before" }} />
        <Stat label="Electricity used · 12 months" value={`${Math.round(d.kwh12).toLocaleString("en-NZ")} kWh`} sub={`${Math.round(d.kwh12 / 365).toLocaleString("en-NZ")} kWh a day`} />
        <Stat label="All-in price of power" value={d.kwh12 ? `${(d.elecCost12 / d.kwh12).toFixed(1)}c/kWh` : "—"}
          sub={d.elecCost12 ? `${Math.round((d.fixed12 / d.elecCost12) * 100)}% of it is daily charges, used or not` : undefined} />
        <Stat label="Owing to Meridian" value={money2(d.balance)} sub="bills + fees − payments, as Meridian keeps it" tone={d.balance > 0 ? "warn" : undefined} />
      </div>

      {/* Who pays */}
      <div className="rounded-xl border border-white/[0.08] p-4 space-y-2" data-testid="energy-who-pays">
        <h2 className="text-sm font-semibold text-white/85 flex items-center gap-2"><Wallet className="w-4 h-4" /> Who pays</h2>
        <ul className="text-xs text-white/65 space-y-1.5 list-disc pl-5">
          <li><b className="text-white/85">Meridian account 40593350</b>, in the name “Ch Ch United Football Club”, is paid from <b className="text-white/85">the club's own bank account</b>. It's in the club's Xero: residency power is coded to {data.xero.residency.account} and the rest to {data.xero.general.account}.</li>
          {lastDD && firstOnline && (
            <li>It was paid by <b className="text-white/85">direct debit</b> until {dmy(lastDD)}. After {bounced.length} direct debit{bounced.length === 1 ? "" : "s"} bounced ({bounced.map((b) => `${money2(b.cents)} on ${dmy(b.paidOn)}`).join(", ")}), it has been paid by <b className="text-white/85">online banking</b> since {dmy(firstOnline)}. Nothing pays it automatically now; someone has to pay each bill.</li>
          )}
          <li><b className="text-white/85">KiwiGas account 31151</b> (LPG for the residency) is also the club's.</li>
          <li className="text-amber-300/90"><b>The United Sports Centre's own power and water are not here.</b> They aren't on this Meridian account, and no power or water for the centre appears in the club's Xero in any year from 2015 to 2026. Another entity pays them, so confirm who, then add the centre as a site and its bills here.</li>
        </ul>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-white/[0.08] p-3" data-testid="energy-chart">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div className="flex gap-1 text-xs">
            {([["cost", "Cost"], ["use", "Energy used (kWh)"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMetric(k)} className={`px-2.5 py-1 rounded-md ${metric === k ? "bg-white/10 text-white font-semibold" : "text-white/45"}`}>{l}</button>
            ))}
          </div>
          <div className="flex gap-1 text-xs">
            {([[24, "2 years"], [60, "5 years"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-2.5 py-1 rounded-md ${range === k ? "bg-white/10 text-white font-semibold" : "text-white/45"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.chart} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={48} tickLine={false} axisLine={false}
                tickFormatter={(v) => (metric === "cost" ? `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v))} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v: number, k: string) => [metric === "cost" ? `$${Number(v).toLocaleString("en-NZ", { minimumFractionDigits: 2 })}` : `${Math.round(Number(v)).toLocaleString("en-NZ")} kWh`, d.siteOf.get(Number(k.slice(1)))?.name ?? k]} />
              {d.sites.map((s) => <Bar key={s.id} dataKey={`s${s.id}`} stackId="a" fill={d.color.get(s.id)} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-3 flex-wrap mt-2 text-[11px] text-white/55">
          {d.sites.map((s) => <span key={s.id} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color.get(s.id) }} />{s.name}</span>)}
        </div>
        {metric === "use" && <p className="text-[10px] text-white/35 mt-1">Gas is shown as its energy content: {LPG_KWH_PER_KG} kWh per kg of LPG, an estimate.</p>}
      </div>

      {/* Sites */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="energy-sites">
        {d.perSite.map((p) => {
          const Icon = UTIL_ICON[p.site.utility];
          const pd = p.perDay !== null && p.perDayYearAgo ? Math.round(((p.perDay - p.perDayYearAgo) / p.perDayYearAgo) * 100) : null;
          return (
            <div key={p.site.id} className="rounded-xl border border-white/[0.08] p-4 space-y-2" data-testid={`energy-site-${p.site.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-white/90 flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} /><Icon className="w-4 h-4 text-white/50 shrink-0" /> <span className="truncate">{p.site.name}</span></div>
                  <div className="text-[11px] text-white/45 mt-0.5">
                    {[p.site.area, p.site.supplier, p.site.accountNumber && `acct ${p.site.accountNumber}`, p.site.icp && `ICP ${p.site.icp}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button onClick={() => setEditing(p.site)} className="text-white/40 hover:text-white/80 p-1" aria-label={`Edit ${p.site.name}`}><Pencil className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Mini label="12 months" value={money(p.cost12)} />
                <Mini label={p.site.utility === "gas" ? "Gas · 12 months" : "Used · 12 months"} value={p.site.utility === "gas" ? `${Math.round(p.units12)} kg` : `${Math.round(p.units12).toLocaleString("en-NZ")} ${unitLabel(p.site.utility === "water" ? "m3" : "kWh")}`} />
                {p.site.utility === "electricity" ? (
                  <Mini label="Latest, per day" value={p.perDay !== null ? `${p.perDay.toFixed(1)} kWh` : "—"}
                    sub={pd === null ? undefined : `${pd >= 0 ? "+" : ""}${pd}% vs a year ago`} tone={pd === null ? undefined : pd > 0 ? "bad" : "good"} />
                ) : (
                  <Mini label="Deliveries · 12 months" value={String(p.deliveries12)} />
                )}
              </div>
              {p.site.utility === "electricity" && p.rateNow !== null && (
                <div className="text-[11px] text-white/55 space-y-0.5">
                  <div>Price now <b className="text-white/80">{p.rateNow.toFixed(2)}c/kWh</b>{p.rateFirst && p.rateFirst !== p.rateNow ? ` · was ${p.rateFirst.toFixed(2)}c in ${p.rateFirstAt?.slice(0, 4)} (${Math.round(((p.rateNow - p.rateFirst) / p.rateFirst) * 100) >= 0 ? "+" : ""}${Math.round(((p.rateNow - p.rateFirst) / p.rateFirst) * 100)}%)` : ""}</div>
                  {p.dailyNow !== null && <div>Daily charge <b className="text-white/80">${(p.dailyNow / 100).toFixed(2)}/day</b> (${Math.round((p.dailyNow * 365) / 100).toLocaleString("en-NZ")} a year before a single kWh){p.dailyFirst && p.dailyFirst !== p.dailyNow ? ` · was $${(p.dailyFirst / 100).toFixed(2)}` : ""}</div>}
                  {p.cost12 > 0 && <div>{Math.round((p.fixed12 / p.cost12) * 100)}% of this site's cost is the daily charge</div>}
                </div>
              )}
              <div className="text-[11px] text-white/45"><span className="text-white/60">Paid by:</span> {p.site.paidBy ?? <span className="text-amber-300">not recorded</span>}</div>
              {p.site.notes && <div className="text-[11px] text-white/40">{p.site.notes}</div>}
              <div className="text-[10px] text-white/30">{p.bills} bills since {dmy(p.first)}</div>
            </div>
          );
        })}
      </div>

      {/* The check against Xero */}
      <div className="space-y-2" data-testid="energy-xero-check">
        <h2 className="text-sm font-semibold text-white/85">The check: these bills against the club's Xero</h2>
        <p className="text-[11px] text-white/45 max-w-3xl">Excluding GST, by the year each bill was issued. A bill paid through the club should appear in Xero's line for the same year. Xero figures pulled {dmy(data.xero.asOf)}; this year is to date.</p>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-xs min-w-[560px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.08]">
              <th className="text-left font-medium px-3 py-2">Year</th>
              <th className="text-right font-medium px-2 py-2">Residency bills</th><th className="text-right font-medium px-2 py-2">Xero · Residency</th>
              <th className="text-right font-medium px-2 py-2">Other sites' bills</th><th className="text-right font-medium px-3 py-2">Xero · Light, Power, Heating</th>
            </tr></thead>
            <tbody>
              {Array.from(new Set([...Object.keys(d.resYears), ...Object.keys(d.genYears), ...Object.keys(data.xero.residency.years)])).map(Number).filter((y) => y >= 2021).sort((a, b) => b - a).map((y) => (
                <tr key={y} className="border-b border-white/[0.05]">
                  <td className="px-3 py-2 text-white/85 font-medium">{y}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/75">{d.resYears[y] ? money(d.resYears[y]) : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/60">{data.xero.residency.years[y] ? money(data.xero.residency.years[y]) : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-white/75">{d.genYears[y] ? money(d.genYears[y]) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/60">{data.xero.general.years[y] ? money(data.xero.general.years[y]) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payments */}
      <details className="rounded-xl border border-white/[0.08] p-3" data-testid="energy-payments">
        <summary className="cursor-pointer text-sm font-semibold text-white/85">Payments to Meridian · {methods.length} paid, {bounced.length} bounced</summary>
        <div className="mt-2 max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-b border-white/[0.05]">
                  <td className="py-1.5 pr-3 text-white/55 whitespace-nowrap tabular-nums">{dmy(p.paidOn)}</td>
                  <td className={`py-1.5 pr-3 ${p.kind === "dishonour" ? "text-red-400 font-semibold" : p.kind === "fee" ? "text-amber-300" : "text-white/70"}`}>
                    {p.kind === "dishonour" ? "Direct debit bounced, added back to the balance" : p.kind === "fee" ? p.method : `Paid · ${p.method ?? "method not stated"}`}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-white/80">{p.kind === "payment" ? "−" : "+"}{money2(p.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {/* Bills */}
      <div className="space-y-2" data-testid="energy-bills">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-white/85">Every bill</h2>
          <SelectInput value={siteFilter === null ? "" : String(siteFilter)} onChange={(e) => setSiteFilter(e.target.value ? Number(e.target.value) : null)}
            className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs">
            <option value="">All sites</option>
            {data.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        </div>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-xs min-w-[720px]">
            <thead><tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.08]">
              <th className="w-6" /><th className="text-left font-medium px-2 py-2">Period</th><th className="text-left font-medium px-2 py-2">Site</th>
              <th className="text-right font-medium px-2 py-2">Used</th><th className="text-right font-medium px-2 py-2">Per day</th>
              <th className="text-right font-medium px-2 py-2">Daily charges</th><th className="text-right font-medium px-3 py-2">Amount</th>
            </tr></thead>
            <tbody>{shownBills.slice(0, 400).map((b) => <BillRow key={b.id} b={b} site={d.siteOf.get(b.siteId)} color={d.color.get(b.siteId)} />)}</tbody>
          </table>
        </div>
      </div>

      {editing && <EditSite site={editing} onClose={() => setEditing(null)} />}
      {addBill && <AddBill sites={d.sites} onClose={() => setAddBill(false)} />}
      {addSite && <AddSite onClose={() => setAddSite(false)} />}
    </div>
  );
}

function BillRow({ b, site, color }: { b: Bill; site?: Site; color?: string }) {
  const [open, setOpen] = useState(false);
  const days = billDays(b.periodStart, b.periodEnd);
  const per = days && b.units != null && site?.utility === "electricity" ? b.units / days : null;
  return (
    <>
      <tr className={`border-b border-white/[0.05] cursor-pointer hover:bg-white/[0.02] ${b.kind === "credit" ? "text-emerald-400" : ""}`} onClick={() => setOpen(!open)}>
        <td className="pl-2 text-white/35">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="px-2 py-2 whitespace-nowrap text-white/75">{b.periodStart && b.periodEnd && b.periodStart !== b.periodEnd ? `${dmy(b.periodStart)} – ${dmy(b.periodEnd)}` : dmy(b.periodEnd ?? b.billDate)}{b.kind === "credit" && " · credit"}</td>
        <td className="px-2 py-2 text-white/70 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: color ?? "#64748b" }} />{site?.name ?? "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums text-white/75">{b.units != null ? `${Math.round(b.units).toLocaleString("en-NZ")} ${unitLabel(b.unit)}` : "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums text-white/55">{per !== null ? `${per.toFixed(1)} kWh` : "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums text-white/55">{b.fixedCents ? money2(b.fixedCents) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums text-white/85 font-semibold">{money2(b.cents)}</td>
      </tr>
      {open && (
        <tr className="border-b border-white/[0.05] bg-white/[0.02]">
          <td /><td colSpan={6} className="px-2 py-2 text-[11px] text-white/60 space-y-1">
            {b.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3">
                <span>{l.kind === "daily" ? `Daily charge · ${l.cPerDay}c × ${l.days} days` : l.kind === "energy" ? `${l.register} · ${l.kwh} kWh at ${l.rateCPerKwh}c` : l.kind === "unmetered" ? `Unmetered load · ${l.kwh} kWh at ${l.rateCPerKwh}c` : l.desc ?? l.label ?? l.kind}</span>
                <span className="tabular-nums">{money2(l.cents)}</span>
              </div>
            ))}
            {b.readings.map((r, i) => <div key={`r${i}`} className="text-white/40">Meter {r.prev} → {r.curr} ({r.basis ?? "reading"})</div>)}
            <div className="text-white/35">{b.source === "manual" ? "Typed in by hand" : `${b.source === "meridian" ? "Meridian" : "KiwiGas"} invoice ${b.invoiceNumber ?? ""}`} · issued {dmy(b.billDate)}</div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, sub, change, tone }: { label: string; value: string; sub?: string; change?: { pct: number; vs: string }; tone?: "warn" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "warn" ? "border-amber-500/30" : "border-white/[0.08]"}`}>
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-lg sm:text-xl font-semibold text-white/90 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/45 mt-0.5">{sub}</div>}
      {change && (
        <div className={`text-[11px] mt-0.5 inline-flex items-center gap-1 ${change.pct > 0 ? "text-red-400" : "text-emerald-400"}`}>
          {change.pct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{change.pct > 0 ? "+" : ""}{change.pct}% vs {change.vs}
        </div>
      )}
    </div>
  );
}
function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-[10px] text-white/40">{label}</div>
      <div className="font-semibold text-white/85 tabular-nums">{value}</div>
      {sub && <div className={`text-[10px] ${tone === "bad" ? "text-red-400" : tone === "good" ? "text-emerald-400" : "text-white/40"}`}>{sub}</div>}
    </div>
  );
}

const field = "w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25";
function useSave(onClose: () => void, title: string) {
  const { toast } = useToast();
  return (fn: () => Promise<Response>) => useMutation({
    mutationFn: async () => (await fn()).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: KEY }); toast({ title }); onClose(); },
    onError: (e: Error) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });
}

function EditSite({ site, onClose }: { site: Site; onClose: () => void }) {
  const [f, setF] = useState({ name: site.name, area: site.area ?? "", paidBy: site.paidBy ?? "", notes: site.notes ?? "" });
  const save = useSave(onClose, "Site saved")(() => apiRequest("PATCH", `/api/admin/energy/sites/${site.id}`, f));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-neutral-950 border-white/10 text-white">
        <div className="space-y-3">
          <h2 className="font-semibold">{site.name}</h2>
          <L label="Name"><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></L>
          <L label="Area (e.g. Residency, Clubrooms, Sports centre)"><input className={field} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></L>
          <L label="Who pays it"><input className={field} value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} /></L>
          <L label="Notes"><textarea className={field} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></L>
          <div className="flex justify-end gap-2"><button onClick={onClose} className="text-xs px-3 py-2 text-white/55">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending} className="text-sm font-semibold px-4 py-2 rounded-lg bg-amber-500 text-white">Save</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddSite({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", utility: "electricity", address: "", area: "", supplier: "", accountNumber: "", icp: "", paidBy: "", notes: "" });
  const save = useSave(onClose, "Site added")(() => apiRequest("POST", "/api/admin/energy/sites", f));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-neutral-950 border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <div className="space-y-3">
          <h2 className="font-semibold">Add a site</h2>
          <p className="text-[11px] text-white/45">For a supply we don't have bills for yet, like the sports centre's power or water.</p>
          <L label="Name"><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="United Sports Centre — main building" /></L>
          <L label="What it supplies">
            <SelectInput value={f.utility} onChange={(e) => setF({ ...f, utility: e.target.value })} className={field}>
              <option value="electricity">Electricity</option><option value="gas">Gas</option><option value="water">Water</option>
            </SelectInput>
          </L>
          <div className="grid grid-cols-2 gap-2">
            <L label="Supplier"><input className={field} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></L>
            <L label="Account number"><input className={field} value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></L>
          </div>
          <L label="Address"><input className={field} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></L>
          <div className="grid grid-cols-2 gap-2">
            <L label="Area"><input className={field} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></L>
            <L label="ICP (electricity)"><input className={field} value={f.icp} onChange={(e) => setF({ ...f, icp: e.target.value })} /></L>
          </div>
          <L label="Who pays it"><input className={field} value={f.paidBy} onChange={(e) => setF({ ...f, paidBy: e.target.value })} /></L>
          <div className="flex justify-end gap-2"><button onClick={onClose} className="text-xs px-3 py-2 text-white/55">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !f.name.trim()} className="text-sm font-semibold px-4 py-2 rounded-lg bg-amber-500 text-white disabled:opacity-40">Add site</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddBill({ sites, onClose }: { sites: Site[]; onClose: () => void }) {
  const [f, setF] = useState({ siteId: sites[0]?.id ?? 0, periodStart: "", periodEnd: "", units: "", amount: "", fixed: "", invoiceNumber: "" });
  const site = sites.find((s) => s.id === Number(f.siteId));
  const save = useSave(onClose, "Bill added")(() => apiRequest("POST", "/api/admin/energy/bills", {
    siteId: Number(f.siteId), periodStart: f.periodStart || null, periodEnd: f.periodEnd, units: f.units === "" ? null : Number(f.units),
    cents: dollarInputToCents(f.amount), fixedCents: f.fixed ? dollarInputToCents(f.fixed) : 0, invoiceNumber: f.invoiceNumber || null,
  }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-neutral-950 border-white/10 text-white max-h-[90vh] overflow-y-auto">
        <div className="space-y-3">
          <h2 className="font-semibold">Add a bill</h2>
          <p className="text-[11px] text-white/45">Meridian and KiwiGas bills load themselves from the accounts inbox. Use this for anything else, like water or the sports centre.</p>
          <L label="Site">
            <SelectInput value={String(f.siteId)} onChange={(e) => setF({ ...f, siteId: Number(e.target.value) })} className={field}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectInput>
          </L>
          <div className="grid grid-cols-2 gap-2">
            <L label="Period from"><DatePickerInput value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} className={field} /></L>
            <L label="Period to"><DatePickerInput value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} className={field} /></L>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <L label={`Used (${unitLabel(site?.utility === "water" ? "m3" : site?.utility === "gas" ? "kg" : "kWh")})`}><input className={field} inputMode="decimal" value={f.units} onChange={(e) => setF({ ...f, units: e.target.value })} /></L>
            <L label="Amount incl GST"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} className={field} /></L>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <L label="Of which daily / supply charges"><MoneyInput value={f.fixed} onChange={(v) => setF({ ...f, fixed: v })} className={field} /></L>
            <L label="Invoice number"><input className={field} value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} /></L>
          </div>
          <div className="flex justify-end gap-2"><button onClick={onClose} className="text-xs px-3 py-2 text-white/55">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending || !f.periodEnd || !f.amount} className="text-sm font-semibold px-4 py-2 rounded-lg bg-amber-500 text-white disabled:opacity-40">Add bill</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function L({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>{children}</div>;
}
