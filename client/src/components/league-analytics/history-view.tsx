// MFL Analytics → History. Isaac (28 Oct 2026): "the total income from term 1
// … the accurate numbers for our income this year". Daniel: "the histogram …
// the trends … holiday camps history and under-4s/under-8s history … have it
// all in there for him."
//
// Mini Football Leagues only: income by term from the team records, by year
// from Xero, by month this year. Holiday camps and U4–U8 were removed on
// 30 Oct 2026 (Daniel) — CUFC programmes don't belong in the MFL workspace;
// they live on their own programme pages in CUFC.
import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { RefreshCw, Info, ChevronDown, ChevronRight } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";
import { TermBreakdown } from "./term-breakdown";

type IncomeTerm = {
  term: string; label: string; year: number; teams: number; entries: number; newTeams: number; returningTeams: number;
  incomeCents: number; teamsWithFee: number; unattributedCents: number; unmatchedPayments: number; byFormat: Record<string, number>; sources: string[]; avgFeeCents: number | null;
};
type History = {
  builtAt: string;
  terms: IncomeTerm[];
  years: { year: number; recordsCents: number; xeroExGstCents: number | null; xeroPartial: boolean }[];
  xeroAsOf: string;
  months: { month: string; cents: number }[] | null;
  monthsThrough: string | null;
  monthsExcluded: { cents: number; lines: string[] };
};

const DASH = "—";
const money = (c: number | null | undefined) => (c == null ? DASH : `$${Math.round(c / 100).toLocaleString("en-NZ")}`);
const k = (c: number) => (Math.abs(c) >= 100000 ? `$${(c / 100000).toFixed(c >= 1000000 ? 0 : 1)}k` : `$${Math.round(c / 100)}`);
const shortTerm = (label: string) => label.replace(/^Term (\d) (\d{2})(\d{2})$/, "T$1 '$3");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const niceDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
};

const Loading = () => <div className="flex items-center justify-center py-16"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="flex gap-2 text-xs text-muted-foreground"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{children}</span></p>
);

export function HistoryView() {
  return (
    <div className="space-y-5" data-testid="history-view">
      <LeagueIncome />
    </div>
  );
}

// The open term lives in the URL (?term=2025-T4) so Back and a shared link land on it.
function useOpenTerm(): [string | null, (t: string | null) => void] {
  const [term, setTerm] = useState<string | null>(() => new URLSearchParams(window.location.search).get("term"));
  const set = (t: string | null) => {
    const u = new URL(window.location.href);
    if (t) u.searchParams.set("term", t); else u.searchParams.delete("term");
    window.history.replaceState(window.history.state, "", u.toString());
    setTerm(t);
  };
  return [term, set];
}

function LeagueIncome() {
  const [openTerm, setOpenTerm] = useOpenTerm();
  const { data, isLoading, error } = useQuery<History>({
    queryKey: ["/api/admin/league/analytics/history"],
    queryFn: async () => {
      const r = await workspaceFetch("/api/admin/league/analytics/history");
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <p className="text-sm text-red-500 py-6" data-testid="history-error">{(error as Error)?.message ?? "Couldn't load the history."}</p>;

  const terms = data.terms;
  const termChart = terms.map((t) => ({
    name: shortTerm(t.label),
    income: Math.round(t.incomeCents / 100),
    newTeams: t.newTeams,
    returning: t.returningTeams,
    avgFee: t.avgFeeCents != null ? Math.round(t.avgFeeCents / 100) : null,
  }));
  const yearChart = data.years.filter((y) => y.xeroExGstCents != null || y.recordsCents > 0).map((y) => ({
    name: y.xeroPartial ? `${y.year} so far` : String(y.year),
    xero: y.xeroExGstCents != null ? Math.round(y.xeroExGstCents / 100) : null,
    records: Math.round(y.recordsCents / 100),
  }));
  const thisYear = new Date().getFullYear();
  const thisYearTerms = terms.filter((t) => t.year === thisYear);
  const thisYearTotal = thisYearTerms.reduce((a, t) => a + t.incomeCents, 0);
  const xeroThisYear = data.years.find((y) => y.year === thisYear);
  const latest = terms[terms.length - 1];

  return (
    <div className="space-y-6">
      {/* This year, in one line each */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{thisYear} income, by term</p>
          <p className="text-2xl font-bold mt-1" data-testid="history-year-records">{money(thisYearTotal)}</p>
          <p className="text-xs text-muted-foreground mt-1">{thisYearTerms.map((t) => `${shortTerm(t.label)} ${money(t.incomeCents)}`).join(" · ")}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{thisYear} in Xero so far</p>
          <p className="text-2xl font-bold mt-1" data-testid="history-year-xero">{money(xeroThisYear?.xeroExGstCents)}</p>
          <p className="text-xs text-muted-foreground mt-1">League income accounts, excl GST, as at {niceDate(data.xeroAsOf)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{latest ? latest.label : "Latest term"}</p>
          <p className="text-2xl font-bold mt-1">{latest ? `${latest.teams} teams` : DASH}</p>
          <p className="text-xs text-muted-foreground mt-1">{latest ? `${latest.newTeams} new · ${latest.returningTeams} returning · ${money(latest.incomeCents)}` : ""}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Income by term</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="h-64" data-testid="history-term-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={termChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => k(v * 100)} width={48} />
                <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString("en-NZ")}`, "Income (incl GST)"]} />
                <Bar dataKey="income" fill="#d1b96e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Note>Money paid by teams, incl GST, from Friendly Manager (2021–25), Shopify, SportNinja and ClubOS (from Term 3 2026). Isaac's team sheet is loaded for Term 4 2025. Older terms are incomplete where a team's fee was never recorded. Tap any term in the table below to see every team, where each one came from, and what doesn't add up.</Note>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Teams per term</CardTitle></CardHeader>
          <CardContent>
            <div className="h-56" data-testid="history-teams-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={termChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} width={32} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="returning" name="Returning" stackId="t" fill="#1f2937" />
                  <Bar dataKey="newTeams" name="New" stackId="t" fill="#d1b96e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Average fee per team</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="h-56" data-testid="history-fee-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={termChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} width={48} />
                  <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString("en-NZ")}`, "Average fee"]} />
                  <Line type="monotone" dataKey="avgFee" stroke="#d1b96e" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Note>Average of the teams whose fee is known, incl GST, after early-bird and multi-team discounts.</Note>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Income by year</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="h-56" data-testid="history-year-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => k(v * 100)} width={48} />
                <Tooltip formatter={(v: any, n: any) => [v == null ? DASH : `$${Number(v).toLocaleString("en-NZ")}`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="xero" name="Xero (excl GST)" fill="#1f2937" radius={[4, 4, 0, 0]} />
                <Bar dataKey="records" name="Team records (incl GST)" fill="#d1b96e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Note>Xero is the accounting figure: the league income accounts on the P&L, excl GST, as at {niceDate(data.xeroAsOf)}. The team records are what each team paid, incl GST, and miss teams whose fee was never recorded. Where the two differ, Xero is the one the accounts use.</Note>
        </CardContent>
      </Card>

      {data.months && data.months.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Money banked by month</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="h-52" data-testid="history-month-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.months.map((m) => ({ name: monthLabel(m.month), v: Math.round(m.cents / 100) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => k(v * 100)} width={48} />
                  <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString("en-NZ")}`, "Banked (excl GST)"]} />
                  <Bar dataKey="v" fill="#d1b96e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Note>
              Xero bank lines at the date the money landed, excl GST{data.monthsThrough ? `, up to ${monthLabel(data.monthsThrough)}` : ""}. Early-bird money lands the month before a term starts.
              {data.monthsExcluded.cents ? ` Academy, U17/U20 and staff payments coded to the Leagues account (${money(data.monthsExcluded.cents)}) are left out.` : ""}
            </Note>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Every term</CardTitle><p className="text-xs text-muted-foreground">Tap a term to see every team by league, the records behind each one, and payments not tied to a team.</p></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="history-term-table">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Term</th>
                <th className="py-2 pr-3 font-medium text-right">Teams</th>
                <th className="py-2 pr-3 font-medium text-right">New</th>
                <th className="py-2 pr-3 font-medium text-right">Returning</th>
                <th className="py-2 pr-3 font-medium text-right">Income</th>
                <th className="py-2 pr-3 font-medium text-right">Payment matched</th>
                <th className="py-2 pr-3 font-medium text-right">Not tied to a team</th>
                <th className="py-2 pr-3 font-medium text-right">Avg fee</th>
                <th className="py-2 font-medium">Where from</th>
              </tr>
            </thead>
            <tbody>
              {terms.slice().reverse().map((t) => {
                const complete = t.teamsWithFee >= t.teams;
                const isOpen = openTerm === t.term;
                return (
                  <Fragment key={t.term}>
                    <tr
                      className={`border-b cursor-pointer hover:bg-muted/50 ${isOpen ? "bg-muted/40" : ""}`}
                      onClick={() => setOpenTerm(isOpen ? null : t.term)}
                      data-testid={`history-term-${t.term}`}
                    >
                      <td className="py-2 pr-3 whitespace-nowrap font-medium">
                        <button type="button" aria-expanded={isOpen} className="inline-flex items-center gap-1 min-h-9" onClick={(e) => { e.stopPropagation(); setOpenTerm(isOpen ? null : t.term); }}>
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{t.label}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.teams}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.newTeams}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.returningTeams}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">{money(t.incomeCents)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${complete ? "text-muted-foreground" : "text-amber-600"}`}>{t.teamsWithFee} of {t.teams}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${t.unattributedCents ? "text-red-600" : "text-muted-foreground"}`}>{t.unattributedCents ? `${money(t.unattributedCents)} (${t.unmatchedPayments})` : DASH}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(t.avgFeeCents)}</td>
                      <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">{t.sources.join(", ")}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b">
                        <td colSpan={9} className="px-1 sm:px-3 whitespace-normal">
                          <div className="max-w-[calc(100vw-4rem)] sm:max-w-none"><TermBreakdown term={t.term} /></div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
