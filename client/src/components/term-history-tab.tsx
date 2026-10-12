// History — every academy term the club has run (FUNiño, Technification,
// Pre-Academy, Academy, Goalkeeper, Morning), from every system it was sold
// through (Friendly Manager, Xero invoices, ClubOS), on one timeline.
// GET /api/admin/camps/:id/term-history · rules in @shared/term-programme-history.
// Twin of camp-history-tab.tsx (holiday camps).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";
import { TERM_STREAMS, type TermStream } from "@shared/term-programme-history";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp, TrendingDown, Info } from "lucide-react";

type Source = "friendly_manager" | "shopify" | "xero" | "clubos";
interface Period {
  key: string;
  title: string;
  year: number;
  cents: number;
  children: number;
  estimatedCents: number;
  inProgress: boolean;
  lastYearKey: string | null;
  sources: Partial<Record<Source, number>>;
  streams: Partial<Record<TermStream, { cents: number; children: number }>>;
}
interface TermHistoryResponse {
  today: string;
  thisStream: TermStream | null;
  periods: Period[];
  excluded: Array<{ reason: string; rows: number; cents: number }>;
}

const SOURCE_LABEL: Record<Source, string> = {
  friendly_manager: "Friendly Manager",
  shopify: "Shopify",
  xero: "Xero invoice",
  clubos: "ClubOS",
};
const dollars = (c: number) => formatCurrency(Math.round(c / 100)).replace(/\.00$/, "");
const shortTitle = (k: string, t: string) => k.endsWith("-yr") ? `${k.slice(0, 4)} yr` : t.replace(/^Term (\d) (\d{4})$/, "T$1 $2");

type Filter = "all" | TermStream;
type Mode = "term" | "year";

/** The rows on screen: terms as they are, or calendar years summed — a year
 *  includes the whole-year invoices that belong to no single term. */
function rowsFor(periods: Period[], mode: Mode): Period[] {
  if (mode === "term") return periods.filter((p) => !p.key.endsWith("-yr"));
  const byYear = new Map<number, Period>();
  for (const p of periods) {
    let y = byYear.get(p.year);
    if (!y) byYear.set(p.year, (y = {
      key: String(p.year), title: String(p.year), year: p.year, cents: 0, children: 0, estimatedCents: 0,
      inProgress: false, lastYearKey: null, sources: {}, streams: {},
    }));
    y.cents += p.cents; y.estimatedCents += p.estimatedCents;
    y.children = Math.max(y.children, p.children); // a child in four terms is one child — the busiest term is the floor
    y.inProgress = y.inProgress || p.inProgress;
    for (const [s, v] of Object.entries(p.sources)) y.sources[s as Source] = (y.sources[s as Source] ?? 0) + (v ?? 0);
    for (const [s, v] of Object.entries(p.streams)) {
      const cell = (y.streams[s as TermStream] ??= { cents: 0, children: 0 });
      cell.cents += v!.cents; cell.children = Math.max(cell.children, v!.children);
    }
  }
  const out = Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  for (const y of out) y.lastYearKey = byYear.has(y.year - 1) ? String(y.year - 1) : null;
  return out;
}

export function TermHistoryTab({ campId }: { campId: number }) {
  const { data, isLoading, error } = useQuery<TermHistoryResponse>({
    queryKey: ["/api/admin/camps", campId, "term-history"],
    queryFn: async () => {
      const res = await workspaceFetch(`/api/admin/camps/${campId}/term-history`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Couldn't load the history");
      return res.json();
    },
  });
  const [filter, setFilter] = useState<Filter | null>(null);
  const [mode, setMode] = useState<Mode>("term");
  const active: Filter = filter ?? data?.thisStream ?? "all";

  const view = useMemo(() => {
    if (!data) return [];
    return rowsFor(data.periods, mode).map((e) => {
      const cell = active === "all" ? { cents: e.cents, children: e.children } : e.streams[active] ?? { cents: 0, children: 0 };
      return { ...e, shown: cell };
    }).filter((e) => e.shown.cents !== 0 || e.shown.children !== 0);
  }, [data, active, mode]);
  const byKey = useMemo(() => new Map(view.map((e) => [e.key, e])), [view]);

  if (isLoading) return <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (error || !data) return <p className="text-sm text-red-400 py-6" data-testid="history-error">{(error as Error)?.message ?? "Couldn't load the history."}</p>;

  const unit = mode === "term" ? "term" : "year";
  const finished = view.filter((e) => !e.inProgress);
  const lastFull = finished[finished.length - 1];
  const lastFullPrev = lastFull?.lastYearKey ? byKey.get(lastFull.lastYearKey) : undefined;
  const best = [...finished].sort((a, b) => b.shown.cents - a.shown.cents)[0];
  const allCents = view.reduce((s, e) => s + e.shown.cents, 0);
  const streamsWithData = TERM_STREAMS.filter((s) => data.periods.some((p) => (p.streams[s.key]?.cents ?? 0) > 0));

  const chart = view.map((e) => {
    const row: Record<string, number | string> = { name: shortTitle(e.key, e.title), title: e.title };
    if (active === "all") for (const s of streamsWithData) row[s.key] = Math.round((e.streams[s.key]?.cents ?? 0) / 100);
    else row[active] = Math.round(e.shown.cents / 100);
    return row;
  });
  const seriesShown = active === "all" ? streamsWithData : TERM_STREAMS.filter((s) => s.key === active);
  const btn = (on: boolean) => `text-xs px-3 py-1.5 rounded-lg border transition ${on ? "bg-blue-500/15 border-blue-500/40 text-blue-300 font-semibold" : "border-white/10 text-white/55 hover:text-white/80"}`;

  return (
    <div className="space-y-6" data-testid="term-history">
      <div>
        <h3 className="text-sm font-semibold text-white/85">Every academy term we have records for</h3>
        <p className="text-xs text-white/45 mt-0.5 max-w-2xl">
          Friendly Manager, Xero invoices and ClubOS on one timeline, grouped by school term. Money is what families paid,
          incl. GST. A payment ClubOS already holds is counted once. EFTPOS and cash taken at the counter without an invoice
          never reached a booking system, so treat these as a floor.
        </p>
      </div>

      {/* Programme + term/year */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap" data-testid="term-history-filter">
          {([["all", "All academy programmes"], ...streamsWithData.map((s) => [s.key, s.label])] as Array<[Filter, string]>).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} data-testid={`term-history-filter-${k}`} className={btn(active === k)}>{label}</button>
          ))}
        </div>
        <div className="flex gap-1.5" data-testid="term-history-mode">
          <button onClick={() => setMode("term")} data-testid="term-history-mode-term" className={btn(mode === "term")}>By term</button>
          <button onClick={() => setMode("year")} data-testid="term-history-mode-year" className={btn(mode === "year")}>By year</button>
        </div>
      </div>

      {view.length === 0 ? (
        <p className="text-sm text-white/45">No records for this programme before ClubOS.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Since records began" value={dollars(allCents)} sub={`${view.length} ${unit}s · from ${view[0].title}`} />
            {lastFull && (
              <Stat
                label={`Last finished ${unit} · ${lastFull.title}`}
                value={dollars(lastFull.shown.cents)}
                sub={`${lastFull.shown.children} children`}
                change={lastFullPrev ? { now: lastFull.shown.cents, before: lastFullPrev.shown.cents, vs: lastFullPrev.title } : undefined}
              />
            )}
            {best && <Stat label={`Best ${unit} on record`} value={dollars(best.shown.cents)} sub={`${best.title} · ${best.shown.children} children`} />}
          </div>

          <div className="rounded-xl border border-white/[0.08] p-3" data-testid="term-history-chart">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} width={44} tickLine={false} axisLine={false} />
                  <Tooltip
                    formatter={(v: number, k: string) => [`$${Number(v).toLocaleString("en-NZ")}`, TERM_STREAMS.find((s) => s.key === k)?.label ?? k]}
                    labelFormatter={(_l, p: any) => p?.[0]?.payload?.title ?? _l}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  {seriesShown.map((s) => <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} radius={0} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {active === "all" && (
              <div className="flex gap-3 flex-wrap mt-2 text-[11px] text-white/55">
                {streamsWithData.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full text-xs min-w-[640px]" data-testid="term-history-table">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.08]">
                  <th className="text-left font-medium px-3 py-2">{mode === "term" ? "Term" : "Year"}</th>
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
                  const pct = prev && prev.shown.cents > 0 && !(mode === "year" && e.inProgress) ? Math.round(((e.shown.cents - prev.shown.cents) / prev.shown.cents) * 100) : null;
                  return (
                    <tr key={e.key} className="border-b border-white/[0.05]" data-testid={`term-history-row-${e.key}`}>
                      <td className="px-3 py-2 text-white/85 font-medium whitespace-nowrap">
                        {e.title}
                        {e.inProgress && <span className="ml-2 text-[10px] font-semibold text-emerald-400">{mode === "term" ? "this term" : "so far"}</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/75">{e.shown.children}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/85 font-semibold">{dollars(e.shown.cents)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white/55">{e.shown.children ? dollars(Math.round(e.shown.cents / e.shown.children)) : "—"}</td>
                      <td className={`px-2 py-2 text-right tabular-nums whitespace-nowrap ${pct === null ? "text-white/30" : pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {pct === null ? "—" : `${pct >= 0 ? "+" : ""}${pct}%`}
                      </td>
                      <td className="px-3 py-2 text-white/50 whitespace-nowrap">
                        {(Object.keys(e.sources) as Source[]).map((s) => SOURCE_LABEL[s]).join(" · ")}
                        {e.estimatedCents > e.cents / 2 && <span className="ml-1.5 text-amber-400/90" title="Most of these records don't name the term, so they were placed by payment date">· placed by date</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <details className="rounded-xl border border-white/[0.08] p-3 text-[11px] text-white/55" data-testid="term-history-method">
        <summary className="cursor-pointer text-xs font-semibold text-white/70 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> How this was counted, and what was left out</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>A record goes to the term it names (“FS 2024 - Term 4”, “Term 1 2026 - U4-8 Players”). If it names none, it goes to the term running or about to start when it was paid — marked “placed by date”.</li>
          <li>The programme comes from the product name and the age group in it: U4–U8 is FUNiño, U9–U12 Pre-Academy, U13 and over Academy. Xero filed Academy and Pre-Academy together, so a line that states no age is “ages not stated”.</li>
          <li>Whole-year and winter-season invoices (2018–2019) belong to no single term. They show in “By year” and are never split across terms.</li>
          <li>Academy invoices that bundle Mainland Football levies are counted in full: it is what families paid.</li>
          <li>ClubOS registrations count at their total. One migrated from Xero or Friendly Manager is the same money as the old record and is counted once.</li>
          <li>Children = different names in a term. A Xero invoice is addressed to a parent, so siblings on one invoice count once. In “By year”, children is the busiest term — a floor, not a sum.</li>
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
