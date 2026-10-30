// MFL Analytics → History → Every term → one term, team by team.
//
// Daniel + Isaac, 30 Oct 2026: "why 85 teams term 4 2025 but then money looks
// like 52 … give breakdown of where each team came from … dropdown of each
// transaction, team details by league … so we can find the discrepancies of
// double ups or mistakes based on our old spreadsheets."
//
// Every team is stitched from up to six systems (Isaac's sheet, SportNinja,
// Friendly Manager, Shopify, FM payments, ClubOS). This shows the records behind
// each one and what the server flagged for a human to check.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";

type Flag = { code: string; label: string };
type Rec = {
  source: string; sourceName: string; name: string | null; division: string | null; captain: string | null;
  email: string | null; phone: string | null; amountCents: number | null; date: string | null; ref: string; note: string;
  extraPayments: { ref: string; amountCents: number; date: string | null; payer: string }[];
};
type Team = {
  key: string; name: string; otherNames: string[]; league: string; leagues: string[]; captain: string | null;
  email: string | null; phone: string | null; amountCents: number | null; sources: string[]; flags: Flag[]; records: Rec[];
};
type Payment = {
  source: string; sourceName: string; amountCents: number; date: string | null; payer: string | null; email: string | null;
  detail: string | null; ref: string; suggestions: { key: string; name: string; why: string }[];
};
type Breakdown = {
  term: string; label: string; hasSheet: boolean;
  summary: { teams: number; paid: number; noPayment: number; needsALook: number; matchedCents: number; unmatchedCents: number; unmatchedCount: number };
  leagues: { league: string; teams: Team[]; paidCents: number }[];
  unmatched: Payment[];
};

const money = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : null);

// Red = something is missing or wrong; amber = check it; grey = worth knowing.
const FLAG_TONE: Record<string, string> = {
  no_payment: "bg-red-50 text-red-700 border-red-200",
  paid_twice: "bg-red-50 text-red-700 border-red-200",
  not_on_sheet: "bg-amber-50 text-amber-800 border-amber-200",
  not_in_draw: "bg-amber-50 text-amber-800 border-amber-200",
  odd_amount: "bg-amber-50 text-amber-800 border-amber-200",
  similar_name: "bg-amber-50 text-amber-800 border-amber-200",
  grading_only: "bg-slate-100 text-slate-700 border-slate-200",
  weekly: "bg-slate-100 text-slate-700 border-slate-200",
};
const SOURCE_TONE: Record<string, string> = {
  sheet: "bg-emerald-50 text-emerald-800 border-emerald-200",
  sportninja: "bg-blue-50 text-blue-800 border-blue-200",
  fm: "bg-violet-50 text-violet-800 border-violet-200",
  fm_payment: "bg-violet-50 text-violet-800 border-violet-200",
  shopify: "bg-lime-50 text-lime-800 border-lime-200",
  clubos: "bg-sky-50 text-sky-800 border-sky-200",
};

type Filter = "all" | "look" | "no_payment" | "weekly";

export function TermBreakdown({ term }: { term: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<Breakdown>({
    queryKey: ["/api/admin/league/analytics/history/term", term],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/league/analytics/history/term/${term}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><RefreshCw className="w-4 h-4 animate-spin" /> Loading every team…</div>;
  if (error || !data) return <p className="py-4 text-sm text-red-600">{(error as Error)?.message ?? "Couldn't load this term."}</p>;

  const s = data.summary;
  const all = data.leagues.flatMap((l) => l.teams);
  const counts = {
    all: all.length,
    look: all.filter((t) => t.flags.some((f) => f.code !== "weekly")).length,
    no_payment: all.filter((t) => t.amountCents == null).length,
    weekly: all.filter((t) => t.flags.some((f) => f.code === "weekly")).length,
  };
  const keep = (t: Team) =>
    filter === "all" ? true
    : filter === "look" ? t.flags.some((f) => f.code !== "weekly")
    : filter === "no_payment" ? t.amountCents == null
    : t.flags.some((f) => f.code === "weekly");
  const FILTERS: [Filter, string][] = [["all", "All teams"], ["look", "Needs a look"], ["no_payment", "No payment found"], ["weekly", "Weekly payers"]];

  return (
    <div className="space-y-4 py-3" data-testid={`term-breakdown-${term}`}>
      <p className="text-sm">
        <strong>{s.teams} teams</strong> · {s.paid} with a payment matched ({money(s.matchedCents)}) · {s.noPayment} with none found
        {s.unmatchedCount > 0 && <> · <strong>{money(s.unmatchedCents)}</strong> in {s.unmatchedCount} payment{s.unmatchedCount === 1 ? "" : "s"} not tied to a team</>}
        {!data.hasSheet && <span className="text-muted-foreground"> · no team spreadsheet loaded for this term yet</span>}
      </p>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which teams">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 min-h-9 text-xs font-medium ${filter === k ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}
            data-testid={`breakdown-filter-${k}`}
          >
            {label} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>

      {data.unmatched.length > 0 && (filter === "all" || filter === "look") && (
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 space-y-2" data-testid="breakdown-unmatched">
          <p className="text-sm font-semibold text-red-800">Payments not tied to a team</p>
          {data.unmatched.map((p) => (
            <div key={p.ref} className="rounded-md bg-white border p-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-semibold tabular-nums">{money(p.amountCents)}</span>
                <span>{p.payer ?? "Unknown payer"}</span>
                {p.email && <span className="text-muted-foreground break-all">{p.email}</span>}
                {day(p.date) && <span className="text-muted-foreground">{day(p.date)}</span>}
                <span className={`rounded border px-1.5 text-[11px] ${SOURCE_TONE[p.source] ?? "bg-muted"}`}>{p.sourceName}</span>
              </div>
              {p.detail && <p className="text-xs text-muted-foreground mt-1">{p.detail}</p>}
              <p className="text-xs mt-1">
                {p.suggestions.length
                  ? <>Probably one of: {p.suggestions.map((g) => <span key={g.key} className="font-medium">{g.name} <span className="text-muted-foreground font-normal">({g.why})</span></span>).reduce<React.ReactNode[]>((a, n, i) => (i ? [...a, ", ", n] : [n]), [])}</>
                  : <span className="text-muted-foreground">No unpaid team in the same league to suggest.</span>}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">{p.ref}</p>
            </div>
          ))}
        </div>
      )}

      {data.leagues.map((l) => {
        const teams = l.teams.filter(keep);
        if (!teams.length) return null;
        return (
          <div key={l.league} className="rounded-lg border" data-testid={`breakdown-league-${l.league}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 border-b bg-muted/40">
              <p className="text-sm font-semibold">{l.league}</p>
              <p className="text-xs text-muted-foreground">{l.teams.length} team{l.teams.length === 1 ? "" : "s"} · {money(l.paidCents)} matched</p>
            </div>
            <ul className="divide-y">
              {teams.map((t) => {
                const isOpen = open === t.key;
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : t.key)}
                      aria-expanded={isOpen}
                      className="w-full text-left px-3 py-2 min-h-11 hover:bg-muted/50 flex items-start gap-2"
                      data-testid={`breakdown-team-${t.key}`}
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" />}
                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">{t.name}</span>
                          {t.otherNames.length > 0 && <span className="text-xs text-muted-foreground">also "{t.otherNames.join('", "')}"</span>}
                          {t.captain && <span className="text-xs text-muted-foreground">{t.captain}</span>}
                        </span>
                        {t.flags.length > 0 && (
                          <span className="flex flex-wrap gap-1 mt-1">
                            {t.flags.map((f, i) => <span key={i} className={`rounded border px-1.5 text-[11px] ${FLAG_TONE[f.code] ?? "bg-muted"}`}>{f.label}</span>)}
                          </span>
                        )}
                      </span>
                      <span className={`tabular-nums text-sm font-medium shrink-0 ${t.amountCents == null ? "text-red-600" : ""}`}>{t.amountCents == null ? "Not found" : money(t.amountCents)}</span>
                    </button>
                    {isOpen && <TeamRecords team={t} />}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Amounts are what each system recorded as paid, incl GST. Weekly payers show only the deposit — the instalments were tracked on the sheet's Weekly Payers tab, not in these systems.
      </p>
    </div>
  );
}

function TeamRecords({ team }: { team: Team }) {
  return (
    <div className="px-3 pb-3 pl-9 space-y-2" data-testid={`breakdown-records-${team.key}`}>
      {(team.email || team.phone || team.leagues.length > 1) && (
        <p className="text-xs text-muted-foreground break-all">
          {[team.email, team.phone, team.leagues.length > 1 ? `Plays in: ${team.leagues.join(", ")}` : null].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="text-xs font-medium">Where this team came from — {team.records.length} record{team.records.length === 1 ? "" : "s"}</p>
      {team.records.map((r, i) => (
        <div key={i} className="rounded-md border bg-background p-2 text-xs space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className={`rounded border px-1.5 ${SOURCE_TONE[r.source] ?? "bg-muted"}`}>{r.sourceName}</span>
            <span className="font-medium">{r.name ?? "(no team name)"}</span>
            {r.division && <span className="text-muted-foreground">{r.division}</span>}
            <span className="ml-auto tabular-nums font-medium">{r.amountCents == null ? (r.source === "sheet" ? "" : "no payment") : money(r.amountCents)}</span>
          </div>
          {(r.captain || r.email || r.phone || r.date) && (
            <p className="text-muted-foreground break-all">{[r.captain, r.email, r.phone, day(r.date)].filter(Boolean).join(" · ")}</p>
          )}
          {r.note && <p>{r.note}</p>}
          {r.extraPayments.map((p) => (
            <p key={p.ref} className="text-muted-foreground">+ {money(p.amountCents)} from {p.payer}{day(p.date) ? ` on ${day(p.date)}` : ""} ({p.ref})</p>
          ))}
          <p className="text-[11px] text-muted-foreground">{r.ref}</p>
        </div>
      ))}
    </div>
  );
}
