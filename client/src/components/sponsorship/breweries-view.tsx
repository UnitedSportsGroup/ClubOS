/**
 * USG → Sponsorship → Breweries (2026-09-25).
 * Every brewery offer for the CUFC / SIU / Emerald Lounge beer partnership, with
 * the submissions word for word and several ways to compare them.
 * Data: GET /api/admin/sponsorship/breweries (server/brewery-offers.ts — server-only).
 * Maths: breweryValue() in shared/brewery-offers.ts — the ONE place an offer is priced.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutGrid, Table2, Calculator, BarChart3, Scale, FileText, History, AlertCircle, Mail, Phone, Lock,
  CheckCircle2, XCircle, HelpCircle,
} from "lucide-react";
import { breweryValue, rebateRateCents, type BreweryBoard, type BreweryOffer } from "@shared/brewery-offers";

type View = "overview" | "compare" | "value" | "volume" | "terms" | "submissions" | "timeline" | "issues";
const VIEWS: { key: View; label: string; icon: typeof LayoutGrid }[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "compare", label: "Compare", icon: Table2 },
  { key: "value", label: "Value calculator", icon: Calculator },
  { key: "volume", label: "Volume", icon: BarChart3 },
  { key: "terms", label: "Terms & ties", icon: Scale },
  { key: "submissions", label: "Submissions", icon: FileText },
  { key: "timeline", label: "Timeline", icon: History },
  { key: "issues", label: "Open issues", icon: AlertCircle },
];

const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-NZ")}`;
const range = (lo: number, hi: number) => (lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`);
const nzDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]} ${y}`;
};

export function BreweriesView() {
  const [view, setView] = useState<View>(() => {
    const h = typeof window !== "undefined" ? window.location.hash.replace("#breweries-", "") : "";
    return (VIEWS.some(v => v.key === h) ? h : "overview") as View;
  });
  const pick = (v: View) => {
    setView(v);
    try { window.history.replaceState(null, "", `#breweries-${v}`); } catch { /* ignore */ }
  };

  const { data, isLoading, error } = useQuery<BreweryBoard>({
    queryKey: ["/api/admin/sponsorship/breweries"],
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/sponsorship/breweries");
      if (!r.ok) throw new Error(r.status === 404 ? "Breweries lives in the United Sports Group workspace." : `Could not load (${r.status})`);
      return r.json();
    },
  });

  if (isLoading) return <div className="p-4 sm:p-6 space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !data) return <div className="p-6 text-sm text-red-400" data-testid="breweries-error">{(error as Error)?.message || "Could not load the brewery offers."}</div>;

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="breweries-view">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4">
        <div className="text-sm text-white/80">{data.summary}</div>
        <div className="text-[11px] text-white/40 mt-1">Read from the inboxes on {nzDate(data.updatedOn)} · money excludes GST · rebates in $ per hectolitre (100 litres)</div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
        {VIEWS.map(v => {
          const Icon = v.icon; const active = v.key === view;
          return (
            <button key={v.key} role="tab" aria-selected={active} onClick={() => pick(v.key)} data-testid={`breweries-view-${v.key}`}
              className={`flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold px-3 py-2 min-h-[36px] rounded-md border transition ${
                active ? "bg-blue-600 border-blue-600 text-white" : "border-white/10 text-white/60 hover:text-white bg-white/[0.02]"}`}>
              <Icon className="w-3.5 h-3.5" /> {v.label}
            </button>
          );
        })}
      </div>

      {view === "overview" && <Overview data={data} />}
      {view === "compare" && <Compare data={data} />}
      {view === "value" && <ValueCalc data={data} />}
      {view === "volume" && <Volume data={data} />}
      {view === "terms" && <Terms data={data} />}
      {view === "submissions" && <Submissions data={data} />}
      {view === "timeline" && <Timeline data={data} />}
      {view === "issues" && <Issues data={data} />}
    </div>
  );
}

function Dot({ colour }: { colour: string }) {
  return <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colour }} />;
}

function LoanBadge({ answer }: { answer: BreweryOffer["loan"]["answer"] }) {
  if (answer === "no") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400"><XCircle className="w-3.5 h-3.5" /> No</span>;
  if (answer === "discuss") return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-400"><CheckCircle2 className="w-3.5 h-3.5" /> Will discuss</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/40"><HelpCircle className="w-3.5 h-3.5" /> Not seen</span>;
}

// ── Overview ────────────────────────────────────────────────────────────────
function Overview({ data }: { data: BreweryBoard }) {
  const inWriting = data.offers.filter(o => o.hasWrittenOffer).length;
  const club = data.volumes.find(v => v.key === "club-y1")?.hlPerYear ?? 200;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Offers in writing" value={`${inWriting} of ${data.offers.length}`} />
        <Stat label="Largest cash ask" value="$30–50k" sub="Renaissance band — period not stated" />
        <Stat label="Loans offered" value={`${data.offers.filter(o => o.loan.answer === "discuss").length}`} sub="Only with exclusivity" />
        <Stat label="Volume gap" value={`${Math.min(...data.volumes.map(v => v.hlPerYear))}–${Math.max(...data.volumes.map(v => v.hlPerYear))} hl`} sub="Estimates of a year's pour" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {data.offers.map(o => {
          const v = breweryValue(o, club, 1, data.assumedPurchaseCentsPerHl, false);
          return (
            <div key={o.key} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3" style={{ borderLeft: `3px solid ${o.colour}` }} data-testid={`brewery-card-${o.key}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-semibold text-white"><Dot colour={o.colour} />{o.brewery}</div>
                  <div className="text-[11px] text-white/40 mt-0.5">{o.parent}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">{o.receivedOn ? "Received" : "Written offer"}</div>
                  <div className="text-xs font-semibold text-white">{o.receivedOn ? nzDate(o.receivedOn) : "Not seen"}</div>
                </div>
              </div>
              <div className="text-xs text-white/70">{o.status}</div>
              <div className="grid grid-cols-3 gap-2">
                <Mini label="Cash sponsorship" value={o.sponsorship.lowCents == null ? "—" : range(o.sponsorship.lowCents, o.sponsorship.highCents ?? o.sponsorship.lowCents)} />
                <Mini label="Rebate" value={o.rebate.tiers.length ? (o.rebate.tiers.length > 1 ? `$${o.rebate.tiers[0].perHlCents / 100}–${o.rebate.tiers[o.rebate.tiers.length - 1].perHlCents / 100}/hl` : `$${o.rebate.tiers[0].perHlCents / 100}/hl`) : "—"} />
                <Mini label="Term" value={o.termLabel} />
              </div>
              <div className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-white/70">
                {v.knowable
                  ? <>At our Year 1 model ({club} hl): <span className="font-semibold text-white">{range(v.cashPerYearLowCents, v.cashPerYearHighCents)}</span> cash a year{v.oneOffInKindCents > 0 ? <> + {money(v.oneOffInKindCents)} of fit-out/promo once</> : null}</>
                  : <>No written offer to price yet.</>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <List title="Going for it" items={o.strengths} tone="text-green-400" />
                <List title="Watch out" items={o.watchOuts} tone="text-orange-300" />
              </div>
              <div className="text-xs"><span className="font-semibold text-white">Next: </span><span className="text-white/70">{o.nextAction}</span></div>
              <Contact o={o} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">{label}</div>
      <div className="text-lg font-semibold text-white tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] px-2 py-1.5 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-white/40">{label}</div>
      <div className="text-xs font-semibold text-white truncate" title={value}>{value}</div>
    </div>
  );
}
function List({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${tone}`}>{title}</div>
      <ul className="space-y-1 text-white/70">{items.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-white/30">•</span><span>{s}</span></li>)}</ul>
    </div>
  );
}
function Contact({ o }: { o: BreweryOffer }) {
  return (
    <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-white/[0.06]">
      <span className="text-[11px] text-white/60 pt-2">{o.contact.name} · {o.contact.role}</span>
      <span className="flex gap-1.5 ml-auto pt-2">
        {o.contact.phone && <a href={`tel:${o.contact.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 min-h-[36px] rounded-md border border-white/10 text-white/70 hover:text-white"><Phone className="w-3.5 h-3.5" />{o.contact.phone}</a>}
        {o.contact.email && <a href={`mailto:${o.contact.email}`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 min-h-[36px] rounded-md border border-white/10 text-white/70 hover:text-white"><Mail className="w-3.5 h-3.5" />Email</a>}
      </span>
    </div>
  );
}

// ── Compare: every attribute side by side ──────────────────────────────────
function Compare({ data }: { data: BreweryBoard }) {
  const rows: { label: string; cell: (o: BreweryOffer) => React.ReactNode }[] = [
    { label: "Contact", cell: o => <>{o.contact.name}<div className="text-white/40">{o.contact.role}</div></> },
    { label: "How it arrived", cell: o => o.channel },
    { label: "Received", cell: o => o.receivedOn ? nzDate(o.receivedOn) : "No written offer seen" },
    { label: "Cash sponsorship", cell: o => <>{o.sponsorship.lowCents == null ? "—" : range(o.sponsorship.lowCents, o.sponsorship.highCents ?? o.sponsorship.lowCents)}<div className="text-white/40">{o.sponsorship.basis}</div></> },
    { label: "Volume rebate", cell: o => o.rebate.tiers.length ? <>{o.rebate.tiers.map((t, i) => <div key={i}>${t.perHlCents / 100}/hl{o.rebate.tiers.length > 1 ? ` · ${t.fromHl}${t.toHl ? `–${t.toHl}` : "+"} hl` : ""}</div>)}<div className="text-white/40 mt-1">{o.rebate.note}</div></> : "—" },
    { label: "% of all purchases", cell: o => o.pctOfPurchases ? `${o.pctOfPurchases}%, quarterly` : "—" },
    { label: "Stadium rebate", cell: o => o.stadiumRebatePerHlCents ? `$${o.stadiumRebatePerHlCents / 100}/hl (15c/L) on game volume` : "—" },
    { label: "Promo fund", cell: o => o.promoFundPerHlCents ? `$${o.promoFundPerHlCents / 100}/hl accrued — for promotions, not cash` : "—" },
    { label: "One-off contributions", cell: o => o.oneOffs.length ? o.oneOffs.map((x, i) => <div key={i}>{money(x.cents)} — {x.label}</div>) : "—" },
    { label: "Product in kind", cell: o => o.productInKind.length ? o.productInKind.map((x, i) => <div key={i}>{x}</div>) : "—" },
    { label: "Stock pricing", cell: o => o.stockPricing.length ? o.stockPricing.map((x, i) => <div key={i}>{x}</div>) : "—" },
    { label: "Build loan", cell: o => <><LoanBadge answer={o.loan.answer} /><div className="text-white/40 mt-1">{o.loan.detail}</div></> },
    { label: "Term", cell: o => o.termLabel },
    { label: "Exclusivity", cell: o => o.exclusivity },
    { label: "Range", cell: o => o.range },
    { label: "Delivery", cell: o => o.delivery },
    { label: "Payment terms", cell: o => o.paymentTerms },
    { label: "Service", cell: o => o.service },
    { label: "Questions to ask", cell: o => o.openQuestions.map((x, i) => <div key={i}>• {x}</div>) },
  ];
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-x-auto" data-testid="breweries-compare">
      <table className="w-full text-xs border-collapse min-w-[860px]">
        <thead>
          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
            <th className="text-left p-3 w-40 sticky left-0 bg-[#0a0e1a] text-white/40 text-[10px] uppercase tracking-wider"> </th>
            {data.offers.map(o => <th key={o.key} className="text-left p-3 text-white font-semibold"><span className="flex items-center gap-2"><Dot colour={o.colour} />{o.brewery}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-b border-white/[0.04] align-top">
              <td className="p-3 sticky left-0 bg-[#0a0e1a] text-white/50 font-semibold text-[11px]">{r.label}</td>
              {data.offers.map(o => <td key={o.key} className="p-3 text-white/80">{r.cell(o)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Value calculator ───────────────────────────────────────────────────────
function ValueCalc({ data }: { data: BreweryBoard }) {
  const [hl, setHl] = useState(data.volumes.find(v => v.key === "club-y1")?.hlPerYear ?? 200);
  const [years, setYears] = useState(5);
  const [inKind, setInKind] = useState(false);
  const [kegDollars, setKegDollars] = useState(data.assumedPurchaseCentsPerHl / 100);
  const priced = data.offers.filter(o => o.hasWrittenOffer);
  const rows = priced.map(o => ({ o, v: breweryValue(o, hl, years, kegDollars * 100, inKind) }));
  const max = Math.max(1, ...rows.map(r => r.v.overYearsHighCents));
  const presets = [...data.volumes].sort((a, b) => a.hlPerYear - b.hlPerYear);

  return (
    <div className="space-y-4" data-testid="breweries-value">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-semibold text-white">Volume: <span className="tabular-nums">{hl} hl</span> a year <span className="text-white/40 font-normal">({(hl * 100).toLocaleString("en-NZ")} litres)</span></div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-white/40">Over</span>
            {[1, 2, 3, 5].map(y => (
              <button key={y} onClick={() => setYears(y)} data-testid={`breweries-years-${y}`}
                className={`text-[11px] font-semibold px-2.5 min-h-[32px] rounded-md border ${years === y ? "bg-blue-600 border-blue-600 text-white" : "border-white/10 text-white/60"}`}>{y} yr</button>
            ))}
          </div>
        </div>
        <input type="range" min={20} max={800} step={5} value={hl} onChange={e => setHl(Number(e.target.value))} className="w-full accent-blue-600" aria-label="Hectolitres a year" data-testid="breweries-hl-slider" />
        <div className="flex gap-1.5 flex-wrap">
          {presets.map(p => (
            <button key={p.key} onClick={() => setHl(p.hlPerYear)}
              className={`text-[11px] px-2.5 min-h-[32px] rounded-md border ${hl === p.hlPerYear ? "border-blue-500 text-white bg-blue-500/15" : "border-white/10 text-white/60"}`}>
              {p.label} · {p.hlPerYear} hl{p.confidential ? " 🔒" : ""}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 flex-wrap text-[11px] text-white/60">
          <label className="flex items-center gap-2 min-h-[32px]"><input type="checkbox" checked={inKind} onChange={e => setInKind(e.target.checked)} className="accent-blue-600 w-4 h-4" /> Count fit-out and promo fund as value</label>
          <label className="flex items-center gap-2">Purchase price for the 4% rebate
            <span className="flex items-center rounded-md border border-white/10 px-2 min-h-[32px]">$<input type="number" min={0} value={kegDollars} onChange={e => setKegDollars(Math.max(0, Number(e.target.value) || 0))} className="w-16 bg-transparent outline-none text-white tabular-nums" />/hl</span>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-wider text-white/40">
              <th className="text-left p-3">Brewery</th><th className="text-right p-3">Sponsorship /yr</th><th className="text-right p-3">Rebate /yr</th>
              <th className="text-right p-3">4% of purchases</th><th className="text-right p-3">Cash /yr</th><th className="text-right p-3">Promo fund /yr</th>
              <th className="text-right p-3">One-offs</th><th className="text-right p-3">Over {years} yr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, v }) => (
              <tr key={o.key} className="border-b border-white/[0.04]">
                <td className="p-3 text-white font-semibold"><span className="flex items-center gap-2"><Dot colour={o.colour} />{o.brewery}</span></td>
                <td className="p-3 text-right tabular-nums text-white/80">{range(v.sponsorshipLowCents, v.sponsorshipHighCents)}</td>
                <td className="p-3 text-right tabular-nums text-white/80">{money(v.rebateCents)}<div className="text-white/40">${rebateRateCents(o, hl) / 100}/hl</div></td>
                <td className="p-3 text-right tabular-nums text-white/80">{v.purchasesPctCents ? money(v.purchasesPctCents) : "—"}</td>
                <td className="p-3 text-right tabular-nums text-white font-semibold">{range(v.cashPerYearLowCents, v.cashPerYearHighCents)}</td>
                <td className="p-3 text-right tabular-nums text-white/60">{v.promoPerYearCents ? money(v.promoPerYearCents) : "—"}</td>
                <td className="p-3 text-right tabular-nums text-white/60">{v.oneOffInKindCents + v.oneOffCashCents ? money(v.oneOffInKindCents + v.oneOffCashCents) : "—"}</td>
                <td className="p-3 text-right tabular-nums text-white font-semibold">{range(v.overYearsLowCents, v.overYearsHighCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-white/40">Over {years} year{years > 1 ? "s" : ""} at {hl} hl a year</div>
        {rows.map(({ o, v }) => (
          <div key={o.key}>
            <div className="flex justify-between text-xs mb-1"><span className="text-white/80">{o.brewery}</span><span className="text-white font-semibold tabular-nums">{range(v.overYearsLowCents, v.overYearsHighCents)}</span></div>
            <div className="h-3 rounded bg-white/[0.04] relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded opacity-40" style={{ width: `${(v.overYearsHighCents / max) * 100}%`, background: o.colour }} />
              <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(v.overYearsLowCents / max) * 100}%`, background: o.colour }} />
            </div>
          </div>
        ))}
        <div className="text-[11px] text-white/40">Solid bar = low end of a range, faded = high end. Cassels isn't priced — no written offer seen.</div>
      </div>

      <AcrossVolumes data={data} years={years} inKind={inKind} purchaseCents={kegDollars * 100} />

      <div className="text-[11px] text-white/40 space-y-1">
        <div>• Sponsorship is counted every year. Neither Moa nor Renaissance said whether theirs is per year — confirm before relying on it.</div>
        <div>• Terms differ: Moa 2 years, Renaissance rolling, DB 5 years. "Over N years" assumes the same terms carry on, so it compares like with like, not what's signed.</div>
        <div>• Renaissance's tiers are read as "the band the year reaches pays on all of it". The 4% uses the purchase price above (default: Moa's $375 keg = $750/hl).</div>
      </div>
    </div>
  );
}

function AcrossVolumes({ data, years, inKind, purchaseCents }: { data: BreweryBoard; years: number; inKind: boolean; purchaseCents: number }) {
  const vols = [...data.volumes].sort((a, b) => a.hlPerYear - b.hlPerYear);
  const priced = data.offers.filter(o => o.hasWrittenOffer);
  return (
    <div className="rounded-xl border border-white/[0.06] overflow-x-auto">
      <div className="p-3 text-[10px] uppercase tracking-wider text-white/40 border-b border-white/[0.06]">Cash a year at every volume estimate</div>
      <table className="w-full text-xs border-collapse min-w-[760px]">
        <thead>
          <tr className="border-b border-white/[0.06] text-white/40 text-[10px]">
            <th className="text-left p-3"> </th>
            {vols.map(v => <th key={v.key} className="text-right p-3 font-semibold">{v.label}<div className="font-normal">{v.hlPerYear} hl{v.confidential ? " 🔒" : ""}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {priced.map(o => (
            <tr key={o.key} className="border-b border-white/[0.04]">
              <td className="p-3 text-white font-semibold"><span className="flex items-center gap-2"><Dot colour={o.colour} />{o.brewery}</span></td>
              {vols.map(v => {
                const x = breweryValue(o, v.hlPerYear, years, purchaseCents, inKind);
                return <td key={v.key} className="p-3 text-right tabular-nums text-white/80">{range(x.cashPerYearLowCents, x.cashPerYearHighCents)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Volume estimates ───────────────────────────────────────────────────────
function Volume({ data }: { data: BreweryBoard }) {
  const vols = [...data.volumes].sort((a, b) => a.hlPerYear - b.hlPerYear);
  const max = Math.max(...vols.map(v => v.hlPerYear));
  return (
    <div className="space-y-3" data-testid="breweries-volume">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-4">
        {vols.map(v => (
          <div key={v.key}>
            <div className="flex justify-between gap-3 text-xs mb-1">
              <span className="text-white font-semibold">{v.label}{v.confidential && <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-orange-300"><Lock className="w-3 h-3" />Confidential — Marshall's own figure</span>}</span>
              <span className="text-white tabular-nums font-semibold">{v.hlPerYear} hl · {(v.hlPerYear * 100).toLocaleString("en-NZ")} L</span>
            </div>
            <div className="h-3 rounded bg-white/[0.04] overflow-hidden"><div className="h-full rounded bg-blue-600" style={{ width: `${(v.hlPerYear / max) * 100}%`, opacity: v.confidential ? 0.45 : 1 }} /></div>
            <div className="text-[11px] text-white/40 mt-1">{v.source} — {v.note}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-white/60 rounded-xl border border-white/[0.06] p-3">
        DB priced its offer at <span className="text-white font-semibold">60 hl</span>. Our own model says ~220 hl in Year 1. Agreeing the figure we'll defend is the first decision — every rebate above moves with it.
      </div>
    </div>
  );
}

// ── Terms & ties ────────────────────────────────────────────────────────────
function Terms({ data }: { data: BreweryBoard }) {
  const db = data.offers.find(o => o.key === "db");
  return (
    <div className="space-y-4" data-testid="breweries-terms">
      <div className="rounded-xl border border-white/[0.06] overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-wider text-white/40">
              <th className="text-left p-3">Brewery</th><th className="text-left p-3">Loan</th><th className="text-left p-3">Term</th><th className="text-left p-3">Ties / exclusivity</th><th className="text-left p-3">Payment</th>
            </tr>
          </thead>
          <tbody>
            {data.offers.map(o => (
              <tr key={o.key} className="border-b border-white/[0.04] align-top">
                <td className="p-3 text-white font-semibold"><span className="flex items-center gap-2"><Dot colour={o.colour} />{o.brewery}</span></td>
                <td className="p-3"><LoanBadge answer={o.loan.answer} /></td>
                <td className="p-3 text-white/80 whitespace-nowrap">{o.termLabel}</td>
                <td className="p-3 text-white/80">{o.exclusivity}</td>
                <td className="p-3 text-white/60">{o.paymentTerms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {db && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="text-sm font-semibold text-white mb-2">What DB asks of the outlet</div>
          <KV rows={data.dbObligations} />
        </div>
      )}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/70 space-y-1">
        <div className="text-sm font-semibold text-white mb-1">What a brewery loan involves (DB, 17 Aug)</div>
        <div>Directors' assets and liabilities · a copy of the lease · a 12–24 month business plan · credit checks on directors · a first-ranking GSA and personal guarantees. If a brewer can't take first GSA it needs to know who it ranks behind and by how much.</div>
      </div>
    </div>
  );
}
function KV({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="divide-y divide-white/[0.06]">
      {rows.map(r => (
        <div key={r.label} className="flex flex-col sm:flex-row sm:gap-4 py-2 text-xs">
          <div className="sm:w-56 flex-shrink-0 text-white/50 font-semibold">{r.label}</div>
          <div className="text-white/80">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Submissions, word for word ─────────────────────────────────────────────
function Submissions({ data }: { data: BreweryBoard }) {
  const [key, setKey] = useState(data.offers[0]?.key ?? "moa");
  const offer = data.offers.find(o => o.key === key)!;
  const sub = data.submissions[key];
  return (
    <div className="space-y-3" data-testid="breweries-submissions">
      <div className="flex gap-1.5 flex-wrap">
        {data.offers.map(o => (
          <button key={o.key} onClick={() => setKey(o.key)} data-testid={`breweries-sub-${o.key}`}
            className={`flex items-center gap-2 text-xs font-semibold px-3 min-h-[36px] rounded-md border ${key === o.key ? "border-blue-500 bg-blue-500/15 text-white" : "border-white/10 text-white/60"}`}>
            <Dot colour={o.colour} />{o.brewery}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="text-sm font-semibold text-white">{offer.brewery}</div>
        <div className="text-[11px] text-white/40">{offer.channel}{sub ? ` · ${sub.subject}` : ""}</div>
        {key === "db" && (
          <div className="rounded-lg border border-white/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">The offer page of the PDF</div>
            <KV rows={data.dbOfferPage} />
          </div>
        )}
        {sub
          ? <div className="text-xs text-white/80 whitespace-pre-wrap leading-relaxed break-words" data-testid="breweries-sub-text">{sub.text}</div>
          : <div className="text-xs text-white/50">No written offer from {offer.brewery} has reached any inbox ClubOS reads. {offer.nextAction}</div>}
      </div>
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────
function Timeline({ data }: { data: BreweryBoard }) {
  const [who, setWho] = useState<string | null>(null);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of data.offers) m.set(o.key, o.brewery);
    return m;
  }, [data]);
  const label = (b: string) => ({ Moa: "moa", Renaissance: "renaissance", DB: "db", Cassels: "cassels" } as Record<string, string>)[b];
  const colour = (b: string) => data.offers.find(o => o.key === label(b))?.colour ?? "#64748b";
  const events = [...data.timeline].filter(e => !who || e.brewery === who || e.brewery === "All").sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="space-y-3" data-testid="breweries-timeline">
      <div className="flex gap-1.5 flex-wrap">
        {[null, "Moa", "Renaissance", "DB", "Cassels"].map(b => (
          <button key={b ?? "all"} onClick={() => setWho(b)}
            className={`text-[11px] font-semibold px-2.5 min-h-[32px] rounded-md border ${who === b ? "border-blue-500 bg-blue-500/15 text-white" : "border-white/10 text-white/60"}`}>
            {b ? names.get(label(b)) ?? b : "Everything"}
          </button>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.06]">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3 p-3 text-xs">
            <div className="w-24 flex-shrink-0 text-white/40 tabular-nums">{nzDate(e.date)}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-semibold text-white"><Dot colour={e.brewery === "All" ? "#64748b" : colour(e.brewery)} />{e.brewery === "All" ? "All breweries" : e.brewery} · <span className="font-normal text-white/50">{e.who}</span></div>
              <div className="text-white/70 mt-0.5">{e.what}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Open issues ─────────────────────────────────────────────────────────────
function Issues({ data }: { data: BreweryBoard }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" data-testid="breweries-issues">
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
        <div className="text-sm font-semibold text-white">To decide</div>
        {data.issues.map((x, i) => (
          <div key={i} className="text-xs"><div className="font-semibold text-white">{i + 1}. {x.title}</div><div className="text-white/70 mt-0.5">{x.detail}</div></div>
        ))}
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
          <div className="text-sm font-semibold text-white">Waiting on us</div>
          {data.looseEnds.map((x, i) => (
            <div key={i} className="text-xs"><span className="font-semibold text-white">{x.brewery}: </span><span className="text-white/70">{x.detail}</span></div>
          ))}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
          <div className="text-sm font-semibold text-white">Questions to send each brewery</div>
          {data.offers.map(o => (
            <div key={o.key} className="text-xs">
              <div className="flex items-center gap-2 font-semibold text-white"><Dot colour={o.colour} />{o.brewery}</div>
              <ul className="mt-1 space-y-0.5 text-white/70">{o.openQuestions.map((q, i) => <li key={i}>• {q}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
