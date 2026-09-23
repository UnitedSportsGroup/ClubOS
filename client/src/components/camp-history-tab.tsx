// History — every holiday camp the club has run, from every system it was
// sold through (Friendly Manager, Shopify, Xero invoices, ClubOS), on one
// timeline, with Xero's own yearly income beside it as the check.
// GET /api/admin/camps/:id/history · rules in @shared/holiday-camp-history.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { CAMP_SERIES, type CampSeries } from "@shared/holiday-camp-history";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Info } from "lucide-react";

type Source = "friendly_manager" | "shopify" | "xero" | "clubos";
interface Edition {
  key: string;
  title: string;
  cents: number;
  children: number;
  estimatedCents: number;
  inProgress: boolean;
  lastYearKey: string | null;
  sources: Partial<Record<Source, number>>;
  series: Partial<Record<CampSeries, { cents: number; children: number }>>;
}
interface HistoryResponse {
  today: string;
  thisCampSeries: CampSeries;
  editions: Edition[];
  years: Array<{ year: number; xeroExGstCents: number; xeroIncGstCents: number; directCostCents: number; recordsCents: number }>;
  xero: { asOf: string; account: string };
  excluded: Array<{ reason: string; rows: number; cents: number }>;
}

const SOURCE_LABEL: Record<Source, string> = {
  friendly_manager: "Friendly Manager",
  shopify: "Shopify",
  xero: "Xero invoice",
  clubos: "ClubOS",
};
const dollars = (c: number) => formatCurrency(Math.round(c / 100)).replace(/\.00$/, "");
const short = (title: string) => title.replace("Sep–Oct ", "Sep ").replace(/^Dec (\d{4}) – Jan \d{4}$/, "Dec $1");

type Filter = "all" | CampSeries;

export function CampHistoryTab({ campId }: { campId: number }) {
  const { data, isLoading, error } = useQuery<HistoryResponse>({
    queryKey: ["/api/admin/camps", campId, "history"],
    queryFn: async () => {
      const res = await workspaceFetch(`/api/admin/camps/${campId}/history`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Couldn't load the history");
      return res.json();
    },
  });
  const [filter, setFilter] = useState<Filter | null>(null);
  const active: Filter = filter ?? (data?.thisCampSeries && data.thisCampSeries !== "general" ? data.thisCampSeries : "all");

  // One edition's numbers under the current filter.
  const view = useMemo(() => {
    if (!data) return [];
    return data.editions.map((e) => {
      const cell = active === "all" ? { cents: e.cents, children: e.children } : e.series[active] ?? { cents: 0, children: 0 };
      return { ...e, shown: cell };
    }).filter((e) => e.shown.cents !== 0 || e.shown.children !== 0);
  }, [data, active]);
  const byKey = useMemo(() => new Map(view.map((e) => [e.key, e])), [view]);

  if (isLoading) return <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (error || !data) return <p className="text-sm text-red-400 py-6" data-testid="history-error">{(error as Error)?.message ?? "Couldn't load the history."}</p>;

  const finished = view.filter((e) => !e.inProgress);
  const lastFull = finished[finished.length - 1];
  const lastFullPrev = lastFull?.lastYearKey ? byKey.get(lastFull.lastYearKey) : undefined;
  const best = [...finished].sort((a, b) => b.shown.cents - a.shown.cents)[0];
  const allCents = view.reduce((s, e) => s + e.shown.cents, 0);
  const allKids = view.reduce((s, e) => s + e.shown.children, 0);

  const chart = view.map((e) => {
    const row: Record<string, number | string> = { name: short(e.title), title: e.title };
    if (active === "all") for (const s of CAMP_SERIES) row[s.key] = Math.round((e.series[s.key]?.cents ?? 0) / 100);
    else row[active] = Math.round(e.shown.cents / 100);
    return row;
  });
  const seriesShown = active === "all" ? CAMP_SERIES : CAMP_SERIES.filter((s) => s.key === active);

  return (
    <div className="space-y-6" data-testid="camp-history">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white/85">Every holiday camp we have records for</h3>
          <p className="text-xs text-white/45 mt-0.5 max-w-2xl">
            Friendly Manager, Shopify, Xero invoices and ClubOS on one timeline, grouped by school holiday. Money is what
            families paid, incl. GST. Counter EFTPOS and cash never reached a booking system, so the yearly check against
            Xero sits below.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1.5 flex-wrap" data-testid="history-filter">
        {([["all", "All holiday camps"], ...CAMP_SERIES.map((s) => [s.key, s.label])] as Array<[Filter, string]>).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            data-testid={`history-filter-${k}`}
            className={`text-xs px-3 py-1.5 rounded-lg border transition ${active === k ? "bg-blue-500/15 border-blue-500/40 text-blue-300 font-semibold" : "border-white/10 text-white/55 hover:text-white/80"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view.length === 0 ? (
        <p className="text-sm text-white/45">No records for this camp before ClubOS.</p>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Since records began" value={dollars(allCents)} sub={`${allKids.toLocaleString("en-NZ")} children · ${view.length} holidays · from ${view[0].title}`} />
            {lastFull && (
              <Stat
                label={`Last finished holiday · ${lastFull.title}`}
                value={dollars(lastFull.shown.cents)}
                sub={`${lastFull.shown.children} children`}
                change={lastFullPrev ? { now: lastFull.shown.cents, before: lastFullPrev.shown.cents, vs: lastFullPrev.title } : undefined}
              />
            )}
            {best && <Stat label="Best holiday on record" value={dollars(best.shown.cents)} sub={`${best.title} · ${best.shown.children} children`} />}
          </div>

          {/* Chart */}
          <div className="rounded-xl border border-white/[0.08] p-3" data-testid="history-chart">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} width={44} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v: number, k: string) => [`$${Number(v).toLocaleString("en-NZ")}`, CAMP_SERIES.find((s) => s.key === k)?.label ?? k]}
                    labelFormatter={(_l, p: any) => p?.[0]?.payload?.title ?? _l}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  {seriesShown.map((s) => <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={0} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {active === "all" && (
              <div className="flex gap-3 flex-wrap mt-2 text-[11px] text-white/55">
                {CAMP_SERIES.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                ))}
              </div>
            )}
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full text-xs min-w-[640px]" data-testid="history-table">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.08]">
                  <th className="text-left font-medium px-3 py-2">School holiday</th>
                  <th className="text-right font-medium px-2 py-2">Children</th>
                  <th className="text-right font-medium px-2 py-2">Revenue</th>
                  <th className="text-right font-medium px-2 py-2">Per child</th>
                  <th className="text-right font-medium px-2 py-2">vs a year before</th>
                  <th className="text-left font-medium px-3 py-2">Sold through</th>
                </tr>
              </thead>
              <tbody>
                {[...view].reverse().map((e) => {
                  const prev = e.lastYearKey ? byKey.get(e.lastYearKey) : undefined;
                  const pct = prev && prev.shown.cents > 0 ? Math.round(((e.shown.cents - prev.shown.cents) / prev.shown.cents) * 100) : null;
                  return (
                    <tr key={e.key} className="border-b border-white/[0.05]" data-testid={`history-row-${e.key}`}>
                      <td className="px-3 py-2 text-white/85 font-medium whitespace-nowrap">
                        {e.title}
                        {e.inProgress && <span className="ml-2 text-[10px] font-semibold text-emerald-400">still selling</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/75">{e.shown.children}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/85 font-semibold">{dollars(e.shown.cents)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/55">{e.shown.children ? dollars(Math.round(e.shown.cents / e.shown.children)) : "—"}</td>
                      <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${pct === null ? "text-white/30" : pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct}%`}
                      </td>
                      <td className="px-3 py-2 text-white/50 whitespace-nowrap">
                        {(Object.keys(e.sources) as Source[]).map((s) => SOURCE_LABEL[s]).join(" · ")}
                        {e.estimatedCents > e.cents / 2 && <span className="ml-1.5 text-amber-400/90" title="Most of these records don't name the holiday, so they were placed by payment date">· placed by date</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* The yearly check against Xero */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-white/75">The check: booking records against Xero, by calendar year</h4>
        <p className="text-[11px] text-white/45 max-w-3xl">
          Xero's “{data.xero.account}” line is the only record that includes money taken at the counter (EFTPOS, cash, bank
          transfer). Where Xero is well above the records, bookings were taken off-system. Where it is below, holiday money was
          coded to another account that year. Xero excludes GST, so it is also shown with GST added to compare. Pulled{" "}
          {data.xero.asOf}. {data.years[data.years.length - 1]?.year} is the year to date. All holiday camps, whatever the filter above.
        </p>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full text-xs min-w-[640px]" data-testid="history-years">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.08]">
                <th className="text-left font-medium px-3 py-2">Year</th>
                <th className="text-right font-medium px-2 py-2">Booking records (incl. GST)</th>
                <th className="text-right font-medium px-2 py-2">Xero income (excl. GST)</th>
                <th className="text-right font-medium px-2 py-2">Xero + GST</th>
                <th className="text-right font-medium px-2 py-2">Records ÷ Xero</th>
                <th className="text-right font-medium px-3 py-2">Coaches &amp; hire (Xero)</th>
              </tr>
            </thead>
            <tbody>
              {[...data.years].reverse().filter((y) => y.recordsCents || y.xeroExGstCents).map((y) => {
                const cover = y.xeroIncGstCents > 0 ? Math.round((y.recordsCents / y.xeroIncGstCents) * 100) : null;
                return (
                  <tr key={y.year} className="border-b border-white/[0.05]">
                    <td className="px-3 py-2 text-white/85 font-medium">{y.year}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-white/75">{dollars(y.recordsCents)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-white/75">{y.xeroExGstCents ? dollars(y.xeroExGstCents) : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-white/55">{y.xeroIncGstCents ? dollars(y.xeroIncGstCents) : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-white/60">{cover === null ? "coded elsewhere" : `${cover}%`}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-white/55">{y.directCostCents ? dollars(y.directCostCents) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* How it was counted */}
      <details className="rounded-xl border border-white/[0.08] p-3 text-[11px] text-white/55" data-testid="history-method">
        <summary className="cursor-pointer text-xs font-semibold text-white/70 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> How this was counted, and what was left out</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>A record goes to the holiday it names (“January 2023”, “Term 3 Holidays”, “Easter”). If it names none, it goes to the next holiday after the payment date. Those rows are marked “placed by date”.</li>
          <li>The camp comes from the product name. Early camps that were sold for all ages at once are “ages not split”. HP, Elite, Individual Development, Goal Scorer and Netbusters camps are “specialist”.</li>
          <li>Children = different names on the bookings. A Xero invoice is addressed to a parent, so two siblings on one invoice count once. Treat children as a floor.</li>
          <li>ClubOS camps count the same way as the edition chips at the top of this page: paid, refunded or part-refunded registrations, at their total.</li>
        </ul>
        {data.excluded.length > 0 && (
          <div className="mt-3">
            <div className="font-semibold text-white/65 mb-1">Left out</div>
            <ul className="space-y-0.5">
              {data.excluded.map((x) => (
                <li key={x.reason} className="flex justify-between gap-3"><span>{x.reason}</span><span className="tabular-nums whitespace-nowrap">{x.rows} rows · {dollars(x.cents)}</span></li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  );
}

function Stat({ label, value, sub, change }: { label: string; value: string; sub?: string; change?: { now: number; before: number; vs: string } }) {
  const pct = change && change.before > 0 ? Math.round(((change.now - change.before) / change.before) * 100) : null;
  return (
    <div className="rounded-xl border border-white/[0.08] p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-xl font-semibold text-white/90 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-white/45 mt-0.5">{sub}</div>}
      {pct !== null && change && (
        <div className={`text-[11px] mt-1 inline-flex items-center gap-1 ${pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {pct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {pct >= 0 ? "+" : ""}{pct}% vs {change.vs}
        </div>
      )}
    </div>
  );
}
