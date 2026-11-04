// Payments due — every fee a CUFC family still owes, as of now (Daniel, 2026-11-04).
// Read straight from Xero (the office's invoices are the ledger for what is owed),
// joined to ClubOS for the child and parent. Group it by programme, age group,
// family, term or how late it is; filter by status, year, term and programme.
// 🔴 Every filter and the grouping live in the URL, so Back and a shared link land
// on the same view (the 2026-09-10 tab-state rule).
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { workspaceFetch } from "@/lib/queryClient";
import { withFrom } from "@/lib/back-to";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Search, Download, FileText, Phone, Mail, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

type Row = {
  invoiceId: string; invoiceNumber: string | null; reference: string | null; xeroContactName: string; childName: string;
  kind: "term_fee" | "uniform" | "levies" | "other"; programme: string; programmeLabel: string;
  ageGroup: string | null; ageSort: number; year: number | null; term: number | null;
  issued: string | null; due: string | null; status: "overdue" | "due_soon" | "not_yet_due"; daysOverdue: number;
  ageing: "not_due" | "1-30" | "31-60" | "61-90" | "90+";
  totalCents: number; paidCents: number; owedCents: number; lastPaymentOn: string | null; onPlan: boolean; partPaid: boolean; sent: boolean;
  childId: number | null; childDob: string | null; parentName: string | null; parentEmail: string | null; parentPhone: string | null;
  contactSource: "clubos" | "xero" | null; familyKey: string; familyLabel: string; registeredInClubOS: boolean; paidInClubOSCents: number;
};
type Snap = {
  asOf: string; today: string; rows: Row[];
  outOfScope: { label: string; invoices: number; owedCents: number }[];
  coverage: Array<{ programme: string; programmeLabel: string; year: number; term: number; registered: number; invoiced: number; invoicedOpen: number; owedCents: number }>;
};

const money = (c: number) => `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (c: number) => `$${Math.round(c / 100).toLocaleString("en-NZ")}`;
const dmy = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const time = (iso: string) => new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const STATUS = [
  { key: "all", label: "Everything owed" },
  { key: "overdue", label: "Overdue" },
  { key: "due_soon", label: "Due in the next 14 days" },
  { key: "not_yet_due", label: "Not due yet" },
  { key: "plan", label: "Paying it off" },
  { key: "check", label: "Check first" },
] as const;
const GROUPS = [
  { key: "programme", label: "Programme" },
  { key: "age", label: "Age group" },
  { key: "family", label: "Family" },
  { key: "term", label: "Term" },
  { key: "ageing", label: "How late" },
  { key: "none", label: "No grouping" },
] as const;
const KINDS: Record<Row["kind"], string> = { term_fee: "Term fees", uniform: "Uniforms & kit", levies: "Levies & match fees", other: "Other" };
const AGEING_LABEL: Record<Row["ageing"], string> = { "90+": "More than 90 days late", "61-90": "61–90 days late", "31-60": "31–60 days late", "1-30": "1–30 days late", not_due: "Not overdue yet" };
const AGEING_ORDER: Row["ageing"][] = ["90+", "61-90", "31-60", "1-30", "not_due"];

/** Something to check before chasing: paid in ClubOS already, or never sent from Xero. */
const needsCheck = (r: Row) => r.paidInClubOSCents > 0 || !r.sent;

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return {
    status: p.get("status") ?? "all", group: p.get("group") ?? "programme",
    year: p.get("year") ?? "all", term: p.get("term") ?? "all", prog: p.get("prog") ?? "all", kind: p.get("kind") ?? "all", q: p.get("q") ?? "",
  };
}

export default function AdminPaymentsDue() {
  const [f, setF] = useState(readUrl);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const qc = useQueryClient();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  // Filters → URL (replace, so nine clicks don't bury the page you came from).
  useEffect(() => {
    const p = new URLSearchParams();
    const def = { status: "all", group: "programme", year: "all", term: "all", prog: "all", kind: "all", q: "" } as Record<string, string>;
    for (const [k, v] of Object.entries(f)) if (v !== def[k]) p.set(k, v);
    const s = p.toString();
    const next = `${window.location.pathname}${s ? `?${s}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [f]);
  useEffect(() => {
    const onPop = () => setF(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const { data, isLoading, error } = useQuery<Snap>({
    queryKey: ["/api/admin/payments-due"],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/payments-due`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5 * 60_000,
  });

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await workspaceFetch(`/api/admin/payments-due?refresh=1`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      qc.setQueryData(["/api/admin/payments-due"], await r.json());
      toast({ title: "Read Xero again" });
    } catch (e: any) {
      toast({ title: "Couldn't read Xero", description: String(e?.message ?? ""), variant: "destructive" });
    } finally { setRefreshing(false); }
  };

  const rows = data?.rows ?? [];
  const years = useMemo(() => Array.from(new Set(rows.map((r) => r.year).filter((y): y is number => !!y))).sort((a, b) => b - a), [rows]);
  const progs = useMemo(() => Array.from(new Map(rows.map((r) => [r.programme, r.programmeLabel])).entries()), [rows]);

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (f.status === "overdue" && r.status !== "overdue") return false;
      if (f.status === "due_soon" && r.status !== "due_soon") return false;
      if (f.status === "not_yet_due" && r.status !== "not_yet_due") return false;
      if (f.status === "plan" && !r.onPlan) return false;
      if (f.status === "check" && !needsCheck(r)) return false;
      if (f.year !== "all" && String(r.year) !== f.year) return false;
      if (f.term !== "all" && String(r.term ?? "none") !== f.term) return false;
      if (f.prog !== "all" && r.programme !== f.prog) return false;
      if (f.kind !== "all" && r.kind !== f.kind) return false;
      if (q && ![r.childName, r.familyLabel, r.parentEmail, r.parentPhone, r.invoiceNumber, r.reference, r.xeroContactName].some((s) => (s ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, f]);

  const groups = useMemo(() => {
    const keyOf = (r: Row): [string, string, number | string] => {
      switch (f.group) {
        case "programme": return [r.programme, r.programmeLabel, r.programme];
        case "age": return [r.ageGroup ?? "none", r.ageGroup ?? "Age group not stated", r.ageSort];
        case "family": return [r.familyKey, r.familyLabel, r.familyLabel.toLowerCase()];
        case "term": return r.term && r.year ? [`${r.year}-${r.term}`, `Term ${r.term} ${r.year}`, -(r.year * 10 + r.term)] : [`y${r.year ?? 0}`, r.year ? `${r.year} — no term (uniforms, levies…)` : "No year", -((r.year ?? 0) * 10)];
        case "ageing": return [r.ageing, AGEING_LABEL[r.ageing], AGEING_ORDER.indexOf(r.ageing)];
        default: return ["all", "All invoices", 0];
      }
    };
    const m = new Map<string, { key: string; label: string; sort: number | string; rows: Row[] }>();
    for (const r of shown) {
      const [k, label, sort] = keyOf(r);
      const g = m.get(k) ?? { key: k, label, sort, rows: [] };
      g.rows.push(r); m.set(k, g);
    }
    const out = Array.from(m.values());
    if (f.group === "family") out.sort((a, b) => sum(b.rows, "overdue") - sum(a.rows, "overdue") || sum(b.rows) - sum(a.rows));
    else out.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
    return out;
  }, [shown, f.group]);

  const tile = (label: string, value: string, sub?: string, tone = "text-white") => (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 min-w-0">
      <div className="text-[11.5px] text-white/45">{label}</div>
      <div className={`text-xl font-semibold tabular-nums whitespace-nowrap ${tone}`}>{value}</div>
      {sub && <div className="text-[11.5px] text-white/40">{sub}</div>}
    </div>
  );

  const csv = () => {
    const head = ["Child", "Family", "Phone", "Email", "Programme", "Age group", "Year", "Term", "What for", "Invoice", "Reference", "Issued", "Due", "Days overdue", "Total", "Paid", "Owed", "Paying it off", "Sent", "Already paid in ClubOS"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = shown.map((r) => [r.childName, r.familyLabel, r.parentPhone, r.parentEmail, r.programmeLabel, r.ageGroup, r.year, r.term, KINDS[r.kind], r.invoiceNumber, r.reference, r.issued, r.due, r.daysOverdue,
      (r.totalCents / 100).toFixed(2), (r.paidCents / 100).toFixed(2), (r.owedCents / 100).toFixed(2), r.onPlan ? "yes" : "", r.sent ? "yes" : "no", r.paidInClubOSCents ? (r.paidInClubOSCents / 100).toFixed(2) : ""].map(esc).join(","));
    const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `payments-due-${data?.today ?? "today"}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-[12px] font-medium border cursor-pointer whitespace-nowrap ${active ? "bg-blue-500/15 text-blue-400 border-blue-500/25" : "text-white/45 border-white/[0.08] hover:text-white/70"}`;
  const families = new Set(shown.map((r) => r.familyKey)).size;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5 min-w-0" data-testid="page-payments-due">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Payments due</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every fee a CUFC family still owes, read from the office's invoices in Xero and matched to the child and parent in ClubOS.
            {data && <> As of {time(data.asOf)}.</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={csv} disabled={!shown.length} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-[12.5px] text-white/70 hover:text-white cursor-pointer disabled:opacity-50" data-testid="button-export">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-[12.5px] text-white/70 hover:text-white cursor-pointer disabled:opacity-50" data-testid="button-refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Read Xero again
          </button>
        </div>
      </div>

      {isLoading ? <div className="py-16 text-center text-sm text-white/40">Reading Xero… this takes a few seconds.</div>
        : error ? <div className="rounded-xl border border-red-500/25 bg-red-500/[0.05] p-6 text-sm text-red-400">{(error as Error).message}</div>
        : data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5" data-testid="payments-due-tiles">
            {tile("Owed (shown)", money0(sum(shown)), `${shown.length} invoices`)}
            {tile("Overdue", money0(sum(shown, "overdue")), `${shown.filter((r) => r.status === "overdue").length} invoices`, "text-red-400")}
            {tile("Due in 14 days", money0(sum(shown, "due_soon")), `${shown.filter((r) => r.status === "due_soon").length} invoices`, "text-amber-400")}
            {tile("90+ days late", money0(shown.filter((r) => r.ageing === "90+").reduce((s, r) => s + r.owedCents, 0)), `${shown.filter((r) => r.ageing === "90+").length} invoices`, "text-red-400")}
            {tile("Families", String(families), `${shown.filter((r) => r.onPlan).length} paying it off`)}
          </div>

          <div className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5" data-testid="filter-status">
              {STATUS.map((s) => {
                const n = s.key === "all" ? rows.length : s.key === "plan" ? rows.filter((r) => r.onPlan).length : s.key === "check" ? rows.filter(needsCheck).length : rows.filter((r) => r.status === s.key).length;
                return <button key={s.key} onClick={() => set("status", s.key)} className={chip(f.status === s.key)} data-testid={`status-${s.key}`}>{s.label} <span className="ml-1 text-white/30">{n}</span></button>;
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-programme">
              <span className="text-[11.5px] text-white/40 w-16 shrink-0">Programme</span>
              <button onClick={() => set("prog", "all")} className={chip(f.prog === "all")}>All</button>
              {progs.map(([k, label]) => <button key={k} onClick={() => set("prog", k)} className={chip(f.prog === k)}>{label}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-term">
              <span className="text-[11.5px] text-white/40 w-16 shrink-0">Year</span>
              <button onClick={() => set("year", "all")} className={chip(f.year === "all")}>All</button>
              {years.map((y) => <button key={y} onClick={() => set("year", String(y))} className={chip(f.year === String(y))}>{y}</button>)}
              <span className="text-[11.5px] text-white/40 ml-3 shrink-0">Term</span>
              <button onClick={() => set("term", "all")} className={chip(f.term === "all")}>All</button>
              {[1, 2, 3, 4].map((t) => <button key={t} onClick={() => set("term", String(t))} className={chip(f.term === String(t))}>Term {t}</button>)}
              <button onClick={() => set("term", "none")} className={chip(f.term === "none")}>No term</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="filter-kind">
              <span className="text-[11.5px] text-white/40 w-16 shrink-0">What for</span>
              <button onClick={() => set("kind", "all")} className={chip(f.kind === "all")}>All</button>
              {(Object.keys(KINDS) as Row["kind"][]).map((k) => <button key={k} onClick={() => set("kind", k)} className={chip(f.kind === k)}>{KINDS[k]}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-80">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Child, parent, email, phone, invoice…" className="premium-input w-full pl-8 pr-3 py-2 text-[12.5px]" data-testid="input-search" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="group-by">
                <span className="text-[11.5px] text-white/40">Group by</span>
                {GROUPS.map((g) => <button key={g.key} onClick={() => set("group", g.key)} className={chip(f.group === g.key)} data-testid={`group-${g.key}`}>{g.label}</button>)}
              </div>
            </div>
          </div>

          {!shown.length ? <div className="rounded-xl border border-white/[0.08] p-8 text-center text-sm text-white/40">Nothing owed matches these filters.</div> : (
            <div className="space-y-2.5" data-testid="payments-due-groups">
              {groups.map((g) => {
                const isOpen = open[g.key] ?? (f.group === "none" || groups.length <= 6);
                const fams = new Set(g.rows.map((r) => r.familyKey)).size;
                const fam = f.group === "family" ? g.rows[0] : null;
                return (
                  <div key={g.key} className="rounded-xl border border-white/[0.08] bg-white/[0.02] min-w-0" data-testid="due-group">
                    <button onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-white/40 shrink-0" /> : <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />}
                      <span className="flex-1 min-w-[180px]">
                        <span className="font-medium text-white">{g.label}</span>
                        <span className="block text-[11.5px] text-white/40">
                          {g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}{f.group !== "family" ? ` · ${fams} famil${fams === 1 ? "y" : "ies"}` : ""}
                          {fam && (fam.parentPhone || fam.parentEmail) ? ` · ${[fam.parentPhone, fam.parentEmail].filter(Boolean).join(" · ")}` : ""}
                        </span>
                      </span>
                      {sum(g.rows, "overdue") > 0 && <span className="text-[12.5px] text-red-400 tabular-nums whitespace-nowrap">{money(sum(g.rows, "overdue"))} overdue</span>}
                      <span className="text-[13px] font-semibold text-white tabular-nums whitespace-nowrap w-[110px] text-right">{money(sum(g.rows))}</span>
                    </button>
                    {isOpen && <div className="border-t border-white/[0.06] divide-y divide-white/[0.06]">{g.rows.map((r) => <DueRowView key={r.invoiceId} r={r} />)}</div>}
                  </div>
                );
              })}
            </div>
          )}

          <Coverage snap={data} />

          {data.outOfScope.length > 0 && (
            <div className="rounded-xl border border-white/[0.08] px-4 py-3 text-[12px] text-white/45" data-testid="out-of-scope">
              <span className="text-white/60 font-medium">Not on this page</span> (not academy families):{" "}
              {data.outOfScope.map((o) => `${o.label} ${money0(o.owedCents)} (${o.invoices})`).join(" · ")}.
            </div>
          )}
          <p className="text-[11.5px] text-white/35">
            Card payments on the website are paid in full before a registration exists, so everything owed is an office invoice in Xero.
            "Paying it off" = part-paid with a payment in the last 45 days. "Check first" = ClubOS already shows the child paid for that term, or Xero says the invoice was never sent.
          </p>
        </>
      )}
    </div>
  );
}

function sum(rows: Row[], status?: Row["status"]) {
  return rows.reduce((s, r) => s + (!status || r.status === status ? r.owedCents : 0), 0);
}

function DueRowView({ r }: { r: Row }) {
  const { toast } = useToast();
  const here = `${window.location.pathname}${window.location.search}`;
  const pdf = async () => {
    const w = window.open("", "_blank");
    try {
      const res = await workspaceFetch(`/api/admin/payments-due/${r.invoiceId}/pdf`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location.href = url; else window.open(url, "_blank");
    } catch (e: any) {
      w?.close();
      toast({ title: "Couldn't open the invoice", description: String(e?.message ?? ""), variant: "destructive" });
    }
  };
  return (
    <div className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1.5 text-[12.5px] min-w-0" data-testid="due-row">
      <div className="flex-1 min-w-[200px]">
        {r.childId
          ? <Link href={withFrom(`/admin/people/contact-${r.childId}`, here)} className="font-medium text-white hover:text-blue-400">{r.childName}</Link>
          : <span className="font-medium text-white">{r.childName}</span>}
        <span className="text-white/40"> · {r.programmeLabel}{r.ageGroup ? ` · ${r.ageGroup}` : ""}{r.term ? ` · Term ${r.term} ${r.year}` : r.year ? ` · ${r.year}` : ""}</span>
        <div className="text-[11.5px] text-white/40 break-words">
          {r.parentName ? `${r.parentName} · ` : ""}
          {r.parentPhone && <a href={`tel:${r.parentPhone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-0.5 hover:text-white/70"><Phone className="w-3 h-3" />{r.parentPhone}</a>}
          {r.parentPhone && r.parentEmail ? " · " : ""}
          {r.parentEmail && <a href={`mailto:${r.parentEmail}`} className="inline-flex items-center gap-0.5 hover:text-white/70 break-all"><Mail className="w-3 h-3" />{r.parentEmail}</a>}
          {!r.parentPhone && !r.parentEmail && "No contact details on file"}
          {!r.childId && " · not matched to a ClubOS player yet"}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {r.onPlan && <Badge tone="blue">Paying it off · last paid {dmy(r.lastPaymentOn)}</Badge>}
          {r.partPaid && !r.onPlan && <Badge tone="amber">Part-paid, stopped {r.lastPaymentOn ? dmy(r.lastPaymentOn) : ""}</Badge>}
          {!r.sent && <Badge tone="amber">Never sent from Xero</Badge>}
          {r.paidInClubOSCents > 0 && <Badge tone="red"><AlertTriangle className="w-3 h-3" /> ClubOS shows {money(r.paidInClubOSCents)} paid for this term — possible duplicate</Badge>}
          {r.kind !== "term_fee" && <Badge tone="grey">{KINDS[r.kind]}</Badge>}
        </div>
      </div>
      <div className="w-[150px] text-white/55">
        <button onClick={pdf} className="inline-flex items-center gap-1 text-blue-400 hover:underline cursor-pointer" data-testid="button-pdf"><FileText className="w-3.5 h-3.5" />{r.invoiceNumber ?? "Invoice"}</button>
        <div className="text-[11.5px] text-white/40 break-words">“{r.reference ?? "no reference"}”</div>
      </div>
      <div className="w-[130px]">
        <div className="text-white/55">Due {dmy(r.due)}</div>
        <div className={`text-[11.5px] ${r.status === "overdue" ? "text-red-400" : r.status === "due_soon" ? "text-amber-400" : "text-white/40"}`}>
          {r.status === "overdue" ? `${r.daysOverdue} day${r.daysOverdue === 1 ? "" : "s"} overdue` : r.status === "due_soon" ? "Due soon" : "Not due yet"}
        </div>
      </div>
      <div className="w-[110px] text-right">
        <div className="font-semibold text-white tabular-nums whitespace-nowrap">{money(r.owedCents)}</div>
        {r.paidCents > 0 && <div className="text-[11.5px] text-white/40 whitespace-nowrap">of {money(r.totalCents)}</div>}
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "blue" | "amber" | "red" | "grey"; children: React.ReactNode }) {
  const c = { blue: "bg-blue-500/10 text-blue-400 border-blue-500/20", amber: "bg-amber-500/10 text-amber-400 border-amber-500/20", red: "bg-red-500/10 text-red-400 border-red-500/20", grey: "bg-white/[0.04] text-white/50 border-white/[0.08]" }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${c}`}>{children}</span>;
}

function Coverage({ snap }: { snap: Snap }) {
  if (!snap.coverage.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2 min-w-0" data-testid="coverage">
      <div>
        <div className="font-medium text-white text-[13.5px]">Has every term been billed?</div>
        <div className="text-[11.5px] text-white/40">Paid registrations in ClubOS beside the office's invoices in Xero, per programme and term. A term with players but no invoices can't show as owed above — it was never billed.</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[520px]">
          <thead><tr className="text-left text-[11px] text-white/40">
            <th className="py-1.5 pr-3 font-medium">Term</th><th className="py-1.5 pr-3 font-medium">Programme</th>
            <th className="py-1.5 pr-3 font-medium text-right">Paid in ClubOS</th><th className="py-1.5 pr-3 font-medium text-right">Invoiced in Xero</th>
            <th className="py-1.5 pr-3 font-medium text-right">Still open</th><th className="py-1.5 font-medium text-right">Owed</th>
          </tr></thead>
          <tbody className="divide-y divide-white/[0.06]">
            {snap.coverage.map((c) => (
              <tr key={`${c.year}-${c.term}-${c.programme}`} className="text-white/70">
                <td className="py-1.5 pr-3 whitespace-nowrap">Term {c.term} {c.year}</td>
                <td className="py-1.5 pr-3">{c.programmeLabel}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{c.registered}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{c.invoiced}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{c.invoicedOpen}</td>
                <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{c.owedCents ? money(c.owedCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
