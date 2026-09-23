/**
 * Xero Invoices — every sales invoice raised in Xero, filterable, so staff can chase money without a Xero login.
 * Daniel, 23 Sep 2026: "a link between invoices issued in xero that automatically come up in clubos … see and filter
 * with different settings, sponsorship, academy, pre-academy by player etc… what's paid what's part paid, what's not
 * paid what's overdue."
 *
 * 🔴 Never a bare fetch() to an admin endpoint — workspaceFetch attaches X-Workspace-Slug (the rule that cost us a
 * Registrations page listing the wrong club's rows).
 * 🔴 Money arrives in CENTS and is formatted once, here.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { workspaceFetch } from "@/lib/queryClient";
import { Loader2, Search, ExternalLink, Mail, Phone, AlertTriangle } from "lucide-react";

const fmt = (c: number) => `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (c: number) => `$${Math.round(c / 100).toLocaleString("en-NZ")}`;
const dayLabel = (d?: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "2-digit" }) : "—";

interface Row {
  invoice_id: string; number: string; contact: string; code: string; person: string; category: string;
  programme: string; status: string; issued: string; due: string | null;
  total_cents: number; paid_cents: number; due_cents: number; credited_cents: number;
  sent: boolean; reference: string; description: string; accounts: string[];
  payments: { date: string; amount: number; id?: string }[]; last_paid: string | null;
  email: string; phone: string; contact_source: string; overdue: boolean; days_overdue: number | null;
}

const STATES = [
  { k: "", label: "All" },
  { k: "owing", label: "Anything owing" },
  { k: "overdue", label: "Overdue" },
  { k: "unpaid", label: "Not paid" },
  { k: "part", label: "Part paid" },
  { k: "paid", label: "Paid" },
];

const TONE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "part paid": "bg-amber-50 text-amber-800 border-amber-200",
  unpaid: "bg-rose-50 text-rose-700 border-rose-200",
};

export default function XeroInvoicesPage() {
  const [state, setState] = useState("owing");
  const [category, setCategory] = useState("");
  const [programme, setProgramme] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const qs = new URLSearchParams(
    Object.entries({ state, category, programme, search }).filter(([, v]) => v) as [string, string][],
  ).toString();

  const { data, isLoading, error } = useQuery({
    queryKey: ["xero-invoices", qs],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/xero-invoices?${qs}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`);
      return r.json();
    },
  });

  if (isLoading)
    return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…</div>;
  // 🔴 loading / error / empty are three different things — never one silent empty state (the dashboard-zeros rule)
  if (error)
    return <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Couldn't load invoices: {String((error as Error).message)}</div>;

  const rows: Row[] = data?.rows ?? [];
  const t = data?.totals ?? { n: 0, total: 0, paid: 0, owing: 0, overdue: 0, unsent: 0 };
  const sync = data?.lastSync;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Xero Invoices</h1>
          <p className="text-[13px] text-muted-foreground">
            Every sales invoice raised in Xero — what's paid, part paid, unpaid and overdue.{" "}
            {sync ? <>Last refreshed {new Date(sync.ran_at).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })} · {sync.rows} invoices.</>
                  : <>Waiting for the first nightly refresh.</>}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name, invoice number, reference…"
                 className="min-h-[40px] w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm sm:w-80" />
        </div>
      </div>

      {/* the tiles describe the FILTERED set, so they always agree with the list beneath */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[["Invoices", String(t.n), ""], ["Invoiced", short(t.total), ""], ["Paid", short(t.paid), "text-emerald-700"],
          ["Still owing", short(t.owing), "text-rose-700"], ["Of that, overdue", short(t.overdue), "text-rose-700"]].map(([k, v, c]) => (
          <div key={k} className="rounded-xl border bg-card p-3 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className={`mt-0.5 text-xl font-semibold tabular-nums ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      {t.unsent > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{t.unsent}</strong>{" "}
            {t.unsent === 1
              ? "invoice is still owing and was never marked as sent in Xero — it may never have reached the customer."
              : "invoices are still owing and were never marked as sent in Xero — they may never have reached the customer."}{" "}
            Check before chasing.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {STATES.map((s) => (
          <button key={s.k} onClick={() => setState(s.k)} data-state={s.k}
                  className={`min-h-[36px] rounded-md border px-3 text-sm ${state === s.k ? "border-slate-800 bg-slate-800 text-white" : "hover:bg-muted"}`}>
            {s.label}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        <select value={category} onChange={(e) => { setCategory(e.target.value); setProgramme(""); }}
                className="min-h-[36px] rounded-md border bg-background px-2 text-sm">
          <option value="">Every category</option>
          {(data?.categories ?? []).map((c: any) => (
            <option key={c.k} value={c.k}>{c.k} — {c.n}{c.owing ? ` · ${short(c.owing)} owing` : ""}</option>
          ))}
        </select>
        {(data?.programmes ?? []).length > 0 && (
          <select value={programme} onChange={(e) => setProgramme(e.target.value)}
                  className="min-h-[36px] rounded-md border bg-background px-2 text-sm">
            <option value="">Every age group</option>
            {(data?.programmes ?? []).map((p: any) => (
              <option key={p.k} value={p.k}>{p.k} — {p.n}{p.owing ? ` · ${short(p.owing)} owing` : ""}</option>
            ))}
          </select>
        )}
        {(state !== "owing" || category || programme || search) && (
          <button onClick={() => { setState("owing"); setCategory(""); setProgramme(""); setSearch(""); }}
                  className="min-h-[36px] rounded-md border px-3 text-sm hover:bg-muted">Reset</button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          No invoice matches those filters.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="xi-list">
          {rows.map((r) => {
            const isOpen = open === r.invoice_id;
            return (
              <div key={r.invoice_id}>
                <button onClick={() => setOpen(isOpen ? null : r.invoice_id)}
                        className="block w-full px-3 py-2.5 text-left hover:bg-muted/40">
                  {/* 🔴 The NAME is what a person reads, so it keeps the whole first line to itself and the badges drop
                      beneath it. Sharing that line with two badges and an amount clipped "(S) Pak'nSave Tamatea" to
                      "(S)…" at 390px — caught by a screenshot, by nothing else. */}
                  <span className="flex items-baseline gap-2">
                    <span className="w-3 shrink-0 text-muted-foreground">{isOpen ? "−" : "+"}</span>
                    <span className="min-w-0 flex-1 break-words text-[13.5px] font-medium">{r.contact}</span>
                    <span className={`shrink-0 text-[13.5px] font-semibold tabular-nums ${r.due_cents ? "text-rose-700" : "text-muted-foreground"}`}>
                      {r.due_cents ? fmt(r.due_cents) : "—"}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[11.5px] text-muted-foreground">
                    <span className={`rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${TONE[r.status] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}>
                      {r.status}
                    </span>
                    {r.overdue && (
                      <span className="rounded border border-rose-300 bg-rose-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                        {r.days_overdue}d overdue
                      </span>
                    )}
                    <span>{r.number}</span>
                    <span>{r.category}{r.programme ? ` · ${r.programme}` : ""}</span>
                    <span>issued {dayLabel(r.issued)}{r.due ? ` · due ${dayLabel(r.due)}` : ""}</span>
                    <span className="tabular-nums">{fmt(r.total_cents)} invoiced{r.paid_cents ? ` · ${fmt(r.paid_cents)} paid` : ""}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="grid gap-4 border-t bg-muted/20 p-3 md:grid-cols-2">
                    <div className="space-y-1.5 text-[12.5px]">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">What it is for</div>
                      <p className="break-words">{r.description || r.reference || "— nothing written on the invoice —"}</p>
                      {r.reference && r.description && <p className="text-muted-foreground">their reference: {r.reference}</p>}
                      <p className="text-muted-foreground">accounts {r.accounts?.join(", ") || "—"}</p>
                      {!r.sent && r.due_cents > 0 && (
                        <p className="font-semibold text-rose-700">Never marked as sent in Xero — check before chasing.</p>
                      )}
                      <a href={`https://go.xero.com/app/invoicing/view/${r.invoice_id}`} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 pt-1 text-sky-700 hover:underline">
                        Open it in Xero <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="space-y-1.5 text-[12.5px]">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Payments {r.payments?.length ? `· ${r.payments.length}` : ""}
                      </div>
                      {r.payments?.length ? (
                        <ul className="divide-y rounded-lg border bg-card">
                          {r.payments.map((p, i) => (
                            <li key={i} className="flex items-center justify-between px-2.5 py-1">
                              <span>{dayLabel(p.date)}</span>
                              <span className="tabular-nums text-emerald-700">{fmt(Math.round(p.amount * 100))}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-muted-foreground">Nothing paid against it.</p>}
                      {r.credited_cents > 0 && <p className="text-amber-800">Credit-noted {fmt(r.credited_cents)}</p>}
                      <div className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Who to chase</div>
                      {r.email || r.phone ? (
                        <p className="flex flex-wrap items-center gap-3">
                          {r.email && <a href={`mailto:${r.email}`} className="inline-flex items-center gap-1 text-sky-700 hover:underline"><Mail className="h-3 w-3" />{r.email}</a>}
                          {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-sky-700 hover:underline"><Phone className="h-3 w-3" />{r.phone}</a>}
                        </p>
                      ) : <p className="text-rose-700">Nobody on file — a human has to find them.</p>}
                      {r.contact_source && <p className="text-muted-foreground">from {r.contact_source}</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {rows.length >= 2000 && (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">Showing the first 2,000 — narrow the filters to see the rest.</div>
          )}
        </div>
      )}

      <p className="text-[12px] text-muted-foreground">
        Xero is the source of truth; this is a mirror refreshed nightly, so an invoice raised today appears tomorrow.
        Overdue is worked out from each invoice's own due date against today in NZ, never stored. For a child's invoice
        the email and phone are the <strong>guardian's</strong>, because they are who pays.
      </p>
    </div>
  );
}
