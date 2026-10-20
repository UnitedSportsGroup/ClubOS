/**
 * MFL Analytics — the Lifetime and Acquisition sub-tabs.
 *
 * The customer is a TEAM. Every money figure says whether it is incl or excl
 * GST; a blank is "—", never $0 or 0.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, BarChart, Bar } from "recharts";
import { RefreshCw, Users, Repeat, TrendingUp, DollarSign, Trophy, Target, Megaphone, Info } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";
import { LTGP_CAC_FLOOR, type AcquisitionResponse, type LifetimeResponse, type LtvScenario } from "@shared/league-economics";

// ── formatting: money and counts never share a formatter ─────────────────────
const DASH = "—";
export const money = (cents: number | null | undefined, decimals = 0) =>
  cents == null ? DASH : `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
const count = (n: number | null | undefined) => (n == null ? DASH : n.toLocaleString("en-NZ"));
const num = (n: number | null | undefined, d = 2) => (n == null ? DASH : n.toLocaleString("en-NZ", { maximumFractionDigits: d }));
const pct = (r: number | null | undefined) => (r == null ? DASH : `${Math.round(r * 100)}%`);
const ratio = (r: number | null | undefined) => (r == null ? DASH : `${r.toLocaleString("en-NZ", { maximumFractionDigits: 1 })} : 1`);

async function getJson<T>(url: string): Promise<T> {
  const r = await workspaceFetch(url);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.message || `HTTP ${r.status}`);
  }
  return r.json();
}

const GstTag = ({ kind }: { kind: "incl" | "excl" }) => (
  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{kind} GST</span>
);

function Stat({ title, value, sub, icon: Icon, gst, testId, badge }: { title: string; value: string; sub?: string; icon: any; gst?: "incl" | "excl"; testId: string; badge?: string }) {
  return (
    <Card data-testid={testId} className="min-w-0">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><Icon className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{title}{gst && <GstTag kind={gst} />}</p>
            <p className="text-xl font-bold tabular-nums" data-testid={`${testId}-value`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
            {badge && <Badge variant="outline" className="mt-1 border-amber-300 bg-amber-50 text-[10px] text-amber-800">{badge}</Badge>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const Loading = ({ what }: { what: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
    <RefreshCw className="h-5 w-5 animate-spin" />
    <span>Building the {what} view from every league record since 2021. The first open can take up to 20 seconds.</span>
  </div>
);
const Failed = ({ error }: { error: unknown }) => (
  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="lifetime-error">
    Could not load this view: {error instanceof Error ? error.message : String(error)}
  </div>
);

/** A table that scrolls inside its card on a phone instead of widening the page. */
const Scroll = ({ children }: { children: React.ReactNode }) => <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0">{children}</div>;
const th = "px-2 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "px-2 py-2 text-sm whitespace-nowrap tabular-nums";

// ── Lifetime ────────────────────────────────────────────────────────────────

export function LifetimeView({ term }: { term: string }) {
  const [scenario, setScenario] = useState<LtvScenario>("all");
  const params = new URLSearchParams({ scenario, term });
  const { data, isLoading, error } = useQuery<LifetimeResponse>({
    queryKey: ["/api/admin/league/analytics/lifetime", scenario, term],
    queryFn: () => getJson(`/api/admin/league/analytics/lifetime?${params}`),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <Loading what="lifetime" />;
  if (error || !data) return <Failed error={error} />;

  const best = new Set(data.retentionBest), worst = new Set(data.retentionWorst);
  const chart = data.retention.filter((r) => r.rate != null).map((r) => ({ term: r.term.replace("-", " "), rate: Math.round((r.rate as number) * 100) }));
  const fiveSeven = data.formats.filter((f) => f.format === "5s" || f.format === "7s");
  const others = data.formats.filter((f) => f.format !== "5s" && f.format !== "7s");

  return (
    <div className="space-y-6" data-testid="view-lifetime">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {count(data.totals.identities)} teams · {count(data.totals.teamTerms)} team-terms · {count(data.totals.dataTerms)} terms with data. {data.stay.scope}.
        </p>
        <div className="inline-flex rounded-lg border p-1" role="group" aria-label="Matching scenario">
          {(["all", "backbone"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScenario(s)} data-testid={`scenario-${s}`}
              className={`min-h-11 rounded-md px-3 text-sm font-medium ${scenario === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {s === "all" ? "All records" : "Backbone"}
            </button>
          ))}
        </div>
      </div>

      {/* 1 · Stay */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">How long a team stays</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat testId="ltv-mean-terms" title="Mean terms per team" value={num(data.stay.all.mean)} sub={`median ${num(data.stay.all.median)} · ${count(data.stay.all.n)} teams`} icon={Users} />
          <Stat testId="ltv-mature-terms" title="Mean terms, mature teams" value={num(data.stay.mature.mean)} sub={`median ${num(data.stay.mature.median)} · ${count(data.stay.mature.n)} teams`} icon={Users} />
          <Stat testId="ltv-ever-return" title="Mature teams that ever came back" value={pct(data.stay.everReturnMaturePct)} sub="played a second term, any time" icon={Repeat} />
          <Stat testId="ltv-longest" title="Longest unbroken run" value={data.stay.longestRun ? `${count(data.stay.longestRun.terms)} terms` : DASH} sub={data.stay.longestRun?.team} icon={Trophy} />
        </div>
        <p className="text-xs text-muted-foreground">Mature = {data.matureRule}. Most terms in total: {data.stay.longestTotal ? `${data.stay.longestTotal.team}, ${data.stay.longestTotal.terms}` : DASH}.</p>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Terms played</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.stay.histogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: "terms", position: "insideBottomRight", offset: -2, fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => [`${v} teams`, "Teams"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="teams" fill="#d1b96e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </section>

      {/* 2 · Retention */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Retention by term</h2>
        <Card>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="term" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => [`${v}%`, "Came back from previous term"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="rate" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <Scroll>
              <table className="mt-3 w-full min-w-[560px]" data-testid="table-retention">
                <thead><tr className="border-b"><th className={th}>Term</th><th className={th}>Teams</th><th className={th}>New</th><th className={th}>Returning</th><th className={th}>Came back from previous term</th><th className={th}>Note</th></tr></thead>
                <tbody>
                  {data.retention.map((r) => {
                    const tone = best.has(r.term) ? "bg-green-50" : worst.has(r.term) ? "bg-red-50" : data.term === r.term ? "bg-blue-50" : "";
                    return (
                      <tr key={r.term} className={`border-b last:border-0 ${tone}`} data-testid={`retention-row-${r.term}`}>
                        <td className={`${td} font-medium`}>{r.label}</td>
                        <td className={td}>{r.hasData ? count(r.teams) : DASH}</td>
                        <td className={td}>{r.hasData ? count(r.newTeams) : DASH}</td>
                        <td className={td}>{r.hasData ? count(r.returning) : DASH}</td>
                        <td className={td}>{r.rate == null ? DASH : `${pct(r.rate)} (${r.cameBack} of ${r.prevTeams})`}{best.has(r.term) && <span className="ml-2 text-xs text-green-700">best</span>}{worst.has(r.term) && <span className="ml-2 text-xs text-red-700">worst</span>}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{r.note ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Scroll>
            <p className="mt-2 text-xs text-muted-foreground">Best and worst are picked from Term 2 2023 on, leaving out the two terms marked as under- or over-stated.</p>
          </CardContent>
        </Card>
      </section>

      {/* 3 · Formats */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">5-a-side vs 7-a-side</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {fiveSeven.map((f) => (
            <Card key={f.format} data-testid={`format-card-${f.format}`} className="min-w-0">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{f.label}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row k="List price" v={money(f.avgListCents)} gst="incl" />
                <Row k="Avg contracted (after discounts)" v={money(f.avgContractedCents)} gst="incl" />
                <Row k="Avg actually paid so far" v={money(f.avgPaidClubosCents)} gst="incl" testId={`format-paid-${f.format}`} />
                <Row k="Discount off list" v={pct(f.discountPct)} />
                <p className="text-xs text-muted-foreground">Prices from {count(f.clubosEntries)} ClubOS entries (Term 3 2026 on); paid excludes instalments still to come.</p>
                <div className="border-t pt-2" />
                <Row k="Entries (in view)" v={count(f.entries)} />
                <Row k="Avg paid, every term with a fee" v={money(f.avgPaidCents)} gst="incl" />
                <Row k="Teams whose first term was this" v={count(f.firstFormatTeams)} />
                <Row k="Mean / median terms (mature)" v={`${num(f.meanTerms)} / ${num(f.medianTerms)}`} />
                <Row k="Ever came back (mature)" v={pct(f.everReturnPct)} />
                <Row k="Mean lifetime revenue (mature)" v={money(f.meanLifetimeRevenueCents)} gst="incl" />
              </CardContent>
            </Card>
          ))}
        </div>
        {others.length > 0 && (
          <Card>
            <CardContent className="pt-4">
              <Scroll>
                <table className="w-full min-w-[520px]" data-testid="table-other-formats">
                  <thead><tr className="border-b"><th className={th}>Format</th><th className={th}>Entries</th><th className={th}>Avg paid (incl GST)</th><th className={th}>First-format teams</th><th className={th}>Mean / median terms</th><th className={th}>Ever came back</th></tr></thead>
                  <tbody>{others.map((f) => (
                    <tr key={f.format} className="border-b last:border-0"><td className={`${td} font-medium`}>{f.label}</td><td className={td}>{count(f.entries)}</td><td className={td}>{money(f.avgPaidCents)}</td><td className={td}>{count(f.firstFormatTeams)}</td><td className={td}>{num(f.meanTerms)} / {num(f.medianTerms)}</td><td className={td}>{pct(f.everReturnPct)}</td></tr>
                  ))}</tbody>
                </table>
              </Scroll>
              <p className="mt-2 text-xs text-muted-foreground">6-a-side was the small-sided format before 2025. List and contracted prices exist only from Term 3 2026, when leagues moved into ClubOS.</p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 4 · LTV / LTGP */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">What a team is worth</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat testId="ltv-revenue" title="Lifetime revenue per team" gst="incl" value={money(data.ltv.meanRevenueCents)} sub={`median ${money(data.ltv.medianRevenueCents)} · ${count(data.ltv.teams)} teams`} icon={DollarSign} />
          <Stat testId="ltv-ltgp" title="Lifetime gross profit (LTGP)" gst="excl" value={money(data.ltv.meanLtgpCents)} sub={`median ${money(data.ltv.medianLtgpCents)}`} icon={TrendingUp}
            badge={data.ltv.refereeAssumedTerms > 0 ? `referees assumed $105 a team-term` : undefined} />
          <Stat testId="ltv-contribution" title="Gross profit per team-term now" gst="excl" value={money(data.ltv.contributionPerTeamTermCents)} sub="last 4 terms: paid ÷ 1.15 − referees" icon={DollarSign} />
          <Stat testId="ltv-forward" title="Forward LTGP (projection)" gst="excl" value={money(data.ltv.forwardLtgpCents)} sub={`${num(data.ltv.forwardTerms)} terms at ${pct(data.ltv.recentRetention)} retention`} icon={Target} />
        </div>
        <p className="text-xs text-muted-foreground">
          {data.ltv.rule}. LTGP = Σ(paid ÷ 1.15 − referee cost per team-term). Forward LTGP = gross profit per team-term × 1 ÷ (1 − retention), using the mean of the last four steps ({data.ltv.recentSteps.map((s) => `${s.term.replace("-", " ")} ${pct(s.rate)}`).join(" · ")}). It is a projection, not money banked.
          {data.ltv.refereeClubosTerms === 0 && " ClubOS holds no referee-assigned games yet, so every term uses the assumed $105 (from Xero: $111 in 2025, $101 in 2026)."}
        </p>
      </section>

      {/* 5 · Survivors */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Still playing since 2023</h2>
        <Card data-testid="card-survivors">
          <CardContent className="pt-4 text-sm">
            <p className="font-medium"><span className="text-xl font-bold tabular-nums">{count(data.survivors.playing)}</span> of {count(data.survivors.cohort)} teams that played in 2023 are playing {data.survivors.latestTerm.replace("-", " ")}.</p>
            <p className="mt-2 text-muted-foreground">{data.survivors.names.join(" · ") || DASH}</p>
          </CardContent>
        </Card>
      </section>

      <Notes notes={data.notes} />
    </div>
  );
}

function Row({ k, v, gst, testId }: { k: string; v: string; gst?: "incl" | "excl"; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{k}{gst && <GstTag kind={gst} />}</span>
      <span className="font-semibold tabular-nums" data-testid={testId}>{v}</span>
    </div>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-4">
        <p className="flex items-center gap-2 text-xs font-medium"><Info className="h-3.5 w-3.5" /> How to read this</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </CardContent>
    </Card>
  );
}

// ── Acquisition ─────────────────────────────────────────────────────────────

const CHANNEL_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", google: "Google", direct: "Direct", email: "Email", organic: "Organic search",
  meta_unattributed: "Meta (no ad id)", other: "Other", qr: "QR code", "(unclassified)": "Not classified", "(not answered)": "Not answered",
  friend_teammate: "Friend / teammate",
};
const chLabel = (c: string) => CHANNEL_LABEL[c] ?? c;

function Mix({ rows, total, testId }: { rows: { label: string; count: number }[]; total: number; testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2" data-testid={testId}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between gap-2 text-sm"><span className="truncate">{r.label}</span><span className="tabular-nums">{count(r.count)} · {total ? `${Math.round((r.count / total) * 100)}%` : DASH}</span></div>
          <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${(r.count / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function AcquisitionView({ term }: { term: string }) {
  const { data, isLoading, error } = useQuery<AcquisitionResponse>({
    queryKey: ["/api/admin/league/analytics/acquisition", term],
    queryFn: () => getJson(`/api/admin/league/analytics/acquisition?${new URLSearchParams({ term })}`),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <Loading what="acquisition" />;
  if (error || !data) return <Failed error={error} />;

  const t = data.trend;
  const withSpend = data.rows.filter((r) => r.spendCents != null);
  const chart = withSpend.map((r) => ({ term: r.term.replace("-", " "), ratio: r.ltgpCacRatio, cac: r.cacCents != null ? r.cacCents / 100 : null }));
  const hubMonth = data.hubFrom ? new Date(data.hubFrom + "T00:00:00Z").toLocaleDateString("en-NZ", { month: "short", year: "numeric", timeZone: "UTC" }) : DASH;
  const ft = data.firstTouch;

  return (
    <div className="space-y-6" data-testid="view-acquisition">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat testId="acq-cac" title={`Blended CAC, ${t.term.replace("-", " ")}`} gst="excl" value={money(t.cacCents, 2)} sub="Meta spend ÷ new teams" icon={Megaphone} />
        <Stat testId="acq-cac-prev" title={`Last term${t.prevTerm ? ` (${t.prevTerm.replace("-", " ")})` : ""}`} gst="excl" value={money(t.prevCacCents, 2)} icon={Megaphone} />
        <Stat testId="acq-cac-ly" title={`Same term last year${t.lastYearTerm ? ` (${t.lastYearTerm.replace("-", " ")})` : ""}`} gst="excl" value={money(t.lastYearCacCents, 2)} sub={t.lastYearCacCents == null ? `no spend data before ${hubMonth}` : undefined} icon={Megaphone} />
        <Stat testId="acq-ratio" title="LTGP : CAC" value={ratio(t.ltgpCacRatio)} sub={`floor ${LTGP_CAC_FLOOR} : 1 · LTGP ${money(data.ltgpCents)} excl GST`} icon={Target} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">LTGP : CAC by term</CardTitle></CardHeader>
        <CardContent>
          {chart.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No spend data yet.</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="term" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => [`${v} : 1`, "LTGP : CAC"]} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <ReferenceLine y={LTGP_CAC_FLOOR} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `${LTGP_CAC_FLOOR}:1 floor`, position: "insideTopLeft", fontSize: 11, fill: "#dc2626" }} />
                <Line type="monotone" dataKey="ratio" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Per term</CardTitle></CardHeader>
        <CardContent>
          <Scroll>
            <table className="w-full min-w-[760px]" data-testid="table-acquisition">
              <thead><tr className="border-b">
                <th className={th}>Term</th><th className={th}>New teams</th><th className={th}>Ad spend (excl GST)</th><th className={th}>Blended CAC</th><th className={th}>Meta purchases</th><th className={th}>LTGP : CAC</th><th className={th}>1st-term GP (excl GST)</th><th className={th}>30-day test</th>
              </tr></thead>
              <tbody>
                {[...data.rows].reverse().map((r) => (
                  <tr key={r.term} className={`border-b align-top last:border-0 ${t.term === r.term ? "bg-blue-50" : ""}`} data-testid={`acq-row-${r.term}`}>
                    <td className={`${td} font-medium`}>{r.label}</td>
                    <td className={td}>{count(r.newTeams)}</td>
                    <td className="px-2 py-2 text-sm">
                      <span className="tabular-nums">{money(r.spendCents, 2)}</span>
                      <span className="block max-w-[220px] whitespace-normal text-xs text-muted-foreground">{r.spendBasis}</span>
                      {r.campaigns.length > 0 && <span className="block max-w-[220px] whitespace-normal text-xs text-muted-foreground">{r.campaigns.map((c) => `${c.name} ${money(c.spendCents)}${c.basis === "date" ? " (by date)" : ""}`).join(" · ")}</span>}
                    </td>
                    <td className={td}>{money(r.cacCents, 2)}</td>
                    <td className={td}>{count(r.metaPurchases)}</td>
                    <td className={td}>{ratio(r.ltgpCacRatio)}</td>
                    <td className={td}>{money(r.firstTermContributionCents)}</td>
                    <td className={td}>{r.thirtyDayPass == null ? DASH : r.thirtyDayPass ? <span className="text-green-700">✔ pass</span> : <span className="text-red-700">✘ fail</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          {data.ballersNote.spendCents > 0 && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="ballers-note">
              Ballers is an individual-player product, so its spend ({money(data.ballersNote.spendCents, 2)}: {data.ballersNote.campaigns.join(", ")}) is left out of team CAC.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Where teams come from</h2>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="blended-explainer">
          CAC above is <strong>blended</strong>: every MFL ad dollar for a term divided by every new team, because the ad click is rarely still attached when a captain registers. Below is what we do know. {ft.stampedDirectBeforeFix > 0 && <>The registration's own channel tag read "direct" on {count(ft.stampedDirectBeforeFix)} sign-ups made before the 14 Oct 2026 fix; the first-touch figures below are read from the visitor's history instead.</>}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">First touch of registered teams</CardTitle></CardHeader>
            <CardContent>
              <Mix testId="mix-first-touch" rows={ft.registrations.map((r) => ({ label: chLabel(r.channel), count: r.count }))} total={ft.registrationsWithHistory} />
              <p className="mt-3 text-xs text-muted-foreground">{count(ft.registrationsWithHistory)} of {count(ft.registrationsTotal)} ClubOS team registrations have a recorded visit in the 30 days before registering. First visit by that visitor or the same person.</p>
            </CardContent></Card>
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">First visits to MFL sites, last 12 months</CardTitle></CardHeader>
            <CardContent>
              <Mix testId="mix-site" rows={ft.siteFirstVisits.slice(0, 8).map((r) => ({ label: chLabel(r.channel), count: r.count }))} total={ft.siteFirstVisitsTotal} />
              <p className="mt-3 text-xs text-muted-foreground">{count(ft.siteFirstVisitsTotal)} visitors to minifootball.co.nz and join.minifootball.co.nz, by the channel of their first visit.</p>
            </CardContent></Card>
          <Card className="min-w-0"><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">"How did you hear about us?"</CardTitle></CardHeader>
            <CardContent>
              <Mix testId="mix-heard" rows={data.howHeard.filter((h) => h.source !== "(not answered)").map((h) => ({ label: chLabel(h.source), count: h.count }))} total={data.howHeardAnswered} />
              <p className="mt-3 text-xs text-muted-foreground">Answered by {count(data.howHeardAnswered)} of {count(data.howHeardTotal)} captains. The question is optional.</p>
            </CardContent></Card>
        </div>
      </section>

      <Notes notes={data.notes} />
    </div>
  );
}
