// Xero payments — families who pay by invoice and bank transfer, and what the
// Xero sync did with each invoice (Daniel, 2026-10-14). Built for Olga: the
// "needs a person" queue first, where she picks the right child once and every
// later invoice to that Xero contact follows.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { workspaceFetch, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, AlertTriangle, Search, Check, X } from "lucide-react";

type Row = {
  invoice_id: string; invoice_number: string | null; xero_contact_name: string; parent_email: string | null; reference: string | null;
  payment_state: string; total_cents: number; amount_paid_cents: number; amount_due_cents: number; paid_on: string | null; invoice_date: string | null;
  decision: string; reason: string | null; candidates: number[] | null; registration_id: number | null; registered_by_sync: boolean;
  programme: string | null; term_number: number | null; year: number | null;
  child_id: number | null; child_name: string | null; child_dob: string | null; decided_by: string | null;
};
type Cand = { id: number; name: string; dob: string | null; parents: string | null; programmes?: string | null };
type Resp = {
  mode: "off" | "shadow" | "live";
  state: { last_ok_at: string | null; last_run_at: string | null; last_error: string | null; last_counts: any } | null;
  counts: Array<{ decision: string; n: number; due: number; paid: number }>;
  rows: Row[]; candidates: Record<string, Cand>;
};

const VIEWS: Array<{ key: string; label: string; hint: string }> = [
  { key: "needs_review", label: "Needs a person", hint: "The sync couldn't be certain which child an invoice is for. Pick the child once — every later invoice to that Xero contact follows." },
  { key: "registered", label: "Added to ClubOS", hint: "Paid in Xero and made a normal registration by the sync." },
  { key: "would_register", label: "Would add", hint: "Watching only: these are paid and matched, and will be added when the sync is switched to live." },
  { key: "awaiting_payment", label: "Awaiting payment", hint: "Invoiced, not paid yet — not registered until they are." },
  { key: "part_paid", label: "Part-paid", hint: "Some money received; registered once paid in full." },
  { key: "already_registered", label: "Already registered", hint: "Paid, and ClubOS already had them (website, office or earlier)." },
  { key: "past_term", label: "Past terms", hint: "Paid for a term that has finished — not added automatically. Pick the child to add one by hand." },
  { key: "dismissed", label: "Dismissed", hint: "Taken off the queue by a person." },
  { key: "void", label: "Void", hint: "Voided or cancelled by a credit note — no money received." },
];
const money = (c: number) => `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never");
const dob = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "no date of birth");

export default function AdminXeroPayments() {
  const [view, setView] = useState("needs_review");
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ["/api/admin/xero-registrations", view];
  const { data, isLoading, error } = useQuery<Resp>({
    queryKey: key,
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/xero-registrations?decision=${view}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message || `HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/admin/xero-registrations"] });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/xero-registrations/run")).json(),
    onSuccess: () => { toast({ title: "Checked Xero" }); refresh(); },
    onError: (e: any) => toast({ title: "Xero check failed", description: String(e?.message ?? ""), variant: "destructive" }),
  });

  const count = (k: string) => data?.counts.find((c) => c.decision === k)?.n ?? 0;
  const due = data?.counts.find((c) => c.decision === "awaiting_payment")?.due ?? 0;
  const v = VIEWS.find((x) => x.key === view)!;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-5" data-testid="page-xero-payments">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Xero payments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Families invoiced by the office and paying by bank transfer. When Olga reconciles a payment in Xero, the child becomes a registered player here.</p>
        </div>
        <button onClick={() => run.mutate()} disabled={run.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] px-3 py-2 text-[12.5px] text-white/70 hover:text-white cursor-pointer disabled:opacity-50" data-testid="button-check-xero">
          <RefreshCw className={`w-3.5 h-3.5 ${run.isPending ? "animate-spin" : ""}`} /> Check Xero now
        </button>
      </div>

      {data && (
        <div className={`rounded-xl border px-4 py-3 text-[12.5px] flex flex-wrap gap-x-5 gap-y-1 ${data.mode === "live" ? "border-emerald-500/25 bg-emerald-500/[0.05]" : "border-amber-500/25 bg-amber-500/[0.05]"}`} data-testid="xero-sync-status">
          <span className={`font-semibold ${data.mode === "live" ? "text-emerald-400" : "text-amber-400"}`}>
            {data.mode === "live" ? "Live — paid invoices are added automatically" : data.mode === "shadow" ? "Watching only — nothing is added automatically yet" : "Switched off"}
          </span>
          <span className="text-white/50">Last checked {when(data.state?.last_ok_at)}</span>
          {data.state?.last_error && <span className="text-red-400">Last error: {data.state.last_error}</span>}
          {due > 0 && <span className="text-white/60">{money(due)} still owed on {count("awaiting_payment")} unpaid invoices</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" data-testid="xero-views">
        {VIEWS.filter((x) => x.key !== "would_register" || data?.mode !== "live" || count("would_register") > 0).map((x) => (
          <button key={x.key} onClick={() => setView(x.key)} data-testid={`xero-view-${x.key}`}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border cursor-pointer ${view === x.key ? "bg-blue-500/15 text-blue-400 border-blue-500/25" : "text-white/45 border-white/[0.08] hover:text-white/70"}`}>
            {x.label} <span className={`ml-1 ${x.key === "needs_review" && count(x.key) > 0 ? "text-amber-400" : "text-white/30"}`}>{count(x.key)}</span>
          </button>
        ))}
      </div>
      <p className="text-[12.5px] text-white/45">{v.hint}</p>

      {isLoading ? <div className="py-10 text-center text-sm text-white/40">Loading…</div>
        : error ? <div className="py-10 text-center text-sm text-red-400">{(error as Error).message}</div>
        : !data?.rows.length ? <div className="rounded-xl border border-white/[0.08] p-8 text-center text-sm text-white/40">Nothing here.</div>
        : (
          <div className="space-y-2">
            {data.rows.map((r) => <InvoiceRow key={r.invoice_id} r={r} cands={data.candidates} onDone={refresh} reviewable={["needs_review", "past_term"].includes(view)} />)}
          </div>
        )}
    </div>
  );
}

function InvoiceRow({ r, cands, onDone, reviewable }: { r: Row; cands: Record<string, Cand>; onDone: () => void; reviewable: boolean }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(reviewable);
  const found = useQuery<Cand[]>({
    queryKey: ["/api/admin/xero-registrations/children", q],
    enabled: q.trim().length >= 2,
    queryFn: async () => (await workspaceFetch(`/api/admin/xero-registrations/children?q=${encodeURIComponent(q.trim())}`)).json(),
  });
  const assign = useMutation({
    mutationFn: async (contactId: number) => (await apiRequest("POST", `/api/admin/xero-registrations/${r.invoice_id}/assign`, { contactId })).json(),
    onSuccess: (d: any) => { toast({ title: d.decision === "registered" ? "Registered" : "Linked", description: d.reason ?? undefined }); onDone(); },
    onError: (e: any) => toast({ title: "Not applied", description: String(e?.message ?? ""), variant: "destructive" }),
  });
  const dismiss = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/xero-registrations/${r.invoice_id}/dismiss`, { reason: "Not a registration" })).json(),
    onSuccess: () => { toast({ title: "Dismissed" }); onDone(); },
  });
  const choices: Cand[] = [...(r.candidates ?? []).map((id) => cands[id]).filter(Boolean), ...(found.data ?? [])]
    .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]" data-testid="xero-invoice">
      <button onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer">
        <span className="min-w-[220px] flex-1">
          <span className="font-medium text-white">{r.xero_contact_name}</span>
          <span className="block text-[11.5px] text-white/40">{r.invoice_number} · “{r.reference}”{r.parent_email ? ` · ${r.parent_email}` : ""}</span>
        </span>
        <span className="text-[12.5px] text-white/60 w-[170px]">{r.programme ?? "—"}{r.term_number ? ` · Term ${r.term_number} ${r.year}` : ""}</span>
        <span className="text-[12.5px] w-[150px] text-right">
          {r.payment_state === "paid" ? <span className="text-emerald-400">{money(r.amount_paid_cents)} paid{r.paid_on ? ` ${dob(r.paid_on)}` : ""}</span>
            : r.payment_state === "part_paid" ? <span className="text-amber-400">{money(r.amount_paid_cents)} of {money(r.total_cents)}</span>
            : r.payment_state === "unpaid" ? <span className="text-white/55">{money(r.amount_due_cents)} owed</span>
            : <span className="text-white/35">{r.payment_state}</span>}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-[12.5px]">
          {r.reason && <div className="flex gap-2 text-amber-300/90"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{r.reason}</div>}
          {r.child_id && (
            <div className="text-white/60">
              Child: <Link href={`/admin/people/contact-${r.child_id}`} className="text-blue-400 hover:underline">{r.child_name}</Link> ({dob(r.child_dob)})
              {r.registration_id && <> · registration #{r.registration_id}{r.registered_by_sync ? " (made by the sync)" : ""}</>}
              {r.decided_by && <> · decided by {r.decided_by}</>}
            </div>
          )}
          {reviewable && (
            <>
              <div className="space-y-1.5">
                {choices.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.08] px-3 py-2" data-testid="xero-candidate">
                    <span className="flex-1 min-w-[200px]">
                      <Link href={`/admin/people/contact-${c.id}`} className="text-white hover:text-blue-400">{c.name}</Link>
                      <span className="text-white/40"> · born {dob(c.dob)}</span>
                      <span className="block text-[11.5px] text-white/40">{c.parents ? `Parents: ${c.parents}` : "No parent on record"}{c.programmes ? ` · ${c.programmes}` : ""}</span>
                    </span>
                    <button onClick={() => assign.mutate(c.id)} disabled={assign.isPending} data-testid="button-assign"
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> This is the child
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a different child…" className="premium-input w-full pl-8 pr-3 py-1.5 text-[12.5px]" data-testid="input-find-child" />
                </div>
                <button onClick={() => dismiss.mutate()} className="inline-flex items-center gap-1 text-[12px] text-white/45 hover:text-white/75 cursor-pointer" data-testid="button-dismiss">
                  <X className="w-3.5 h-3.5" /> Not a registration
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
