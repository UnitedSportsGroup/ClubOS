// Email History — what was sent, who sent it, who got it, who opened it.
//
// Daniel, relaying Olga: "add history drop down menu item under mailer too and
// make it look one for one like this… really important to be able for anyone to
// see what is sent and who sent it so we have transparency and can track it."
// Then: "really important to be able to click recipients and see who has
// received, not received, opened etc… with actual name of person next to it"
// and "also important to be able to click see message and see what was sent."
//
// Built one-for-one with Friendly Manager's Email History: entries/page, a
// search box, sortable Date / Subject / Sender / Recipients, the recipient count
// as a link, View Message, and "Showing X to Y of Z entries".
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronUp, ChevronDown, Mail, Search, Check, X as XIcon, AlertTriangle } from "lucide-react";
import { workspaceFetch } from "@/lib/queryClient";

type Campaign = {
  id: number; subject: string; fromEmail: string | null; segmentType: string | null;
  recipientCount: number | null; sentCount: number | null; failedCount: number | null;
  status: string | null; sentAt: string | null; createdAt: string;
  createdByUserId: number | null; senderName: string | null;
};
type SortKey = "date" | "subject" | "sender" | "recipients";

/** dd/mm/yyyy h:mm am — Friendly Manager's own format, and NZ's. */
function whenLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-NZ", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).replace(",", "");
}

/**
 * 🔴 WHO SENT IT — and never an invented person.
 * A campaign sent before the sender was recorded reads as the ADDRESS it went
 * out under, which is true and still useful, visibly marked as not-a-person.
 */
function Sender({ c }: { c: Campaign }) {
  if (c.senderName) return <span className="text-[13px] text-white/70">{c.senderName}</span>;
  const addr = (c.fromEmail ?? "").replace(/\s*<[^>]*>\s*/, "").trim() || c.fromEmail || "—";
  return (
    <span className="text-[13px] text-white/40 italic" title="Sender not recorded — this campaign predates the sender being stored. Showing the address it was sent from.">
      {addr}
    </span>
  );
}

function SortHead({ label, k, sort, dir, onSort, className = "" }: {
  label: string; k: SortKey; sort: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string;
}) {
  const on = sort === k;
  return (
    <th className={`px-4 py-2 text-left text-[11px] uppercase tracking-wider font-semibold ${className}`}
        aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 transition-colors cursor-pointer ${on ? "text-blue-400/80" : "text-blue-300/30 hover:text-blue-300/60"}`}
        data-testid={`sort-history-${k}`}>
        {label}
        {on && (dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
    </th>
  );
}

/** Everyone one campaign went to, by name, and whether they opened it. */
function RecipientsDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/mailer/campaigns", campaign.id, "recipients"],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/mailer/campaigns/${campaign.id}/recipients`);
      if (!r.ok) throw new Error("Could not load the recipients");
      return r.json();
    },
  });
  const [q, setQ] = useState("");
  const people: any[] = data?.people ?? [];
  const shown = people.filter(p =>
    !q.trim() || `${p.name ?? ""} ${p.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Recipients: {campaign.subject}</DialogTitle>
        </DialogHeader>

        {isLoading ? <Skeleton className="h-40 w-full rounded-xl bg-blue-500/[0.04]" /> : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4 text-[12px]">
                <span className="text-white/50">{data?.recipientCount ?? 0} sent</span>
                <span className="text-emerald-500">{data?.openedCount ?? 0} opened</span>
                {!!data?.failedCount && <span className="text-red-500">{data.failedCount} failed</span>}
              </div>
              {people.length > 8 && (
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person…"
                    className="premium-input text-white/80 pl-9 h-8 w-56 text-[12px]" data-testid="input-recipient-filter" />
                </div>
              )}
            </div>

            {/* 🔴 A campaign with a COUNT but no per-person list is not a
                campaign nobody received — it was sent before per-recipient
                tracking existed. An empty table here would read as the opposite. */}
            {!data?.tracked ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-[12px] text-amber-600 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This campaign went to <strong>{data?.recipientCount ?? 0}</strong> {(data?.recipientCount ?? 0) === 1 ? "person" : "people"},
                  but it was sent before ClubOS recorded who each one was. The names aren't on file for this one.
                </span>
              </div>
            ) : (
              <div className="rounded-xl border border-blue-500/[0.08] overflow-hidden max-h-[50vh] overflow-y-auto">
                <table className="w-full" data-testid="table-recipients">
                  <thead className="sticky top-0 bg-[hsl(var(--background))]">
                    <tr className="border-b border-blue-500/[0.08]">
                      <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider font-semibold text-blue-300/30">Name</th>
                      <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider font-semibold text-blue-300/30">Sent</th>
                      <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider font-semibold text-blue-300/30">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(p => (
                      <tr key={p.email} className="border-b border-blue-500/[0.03]" data-testid={`row-recipient-${p.email}`}>
                        <td className="px-4 py-2">
                          {/* 🔴 The NAME first — that is the whole ask. An address
                              we cannot place shows as itself, never blank. */}
                          {p.name
                            ? <span className="text-[13px] text-white/80">{p.name} <span className="text-white/35">&lt;{p.email}&gt;</span></span>
                            : <span className="text-[13px] text-white/55">{p.email}</span>}
                        </td>
                        <td className="px-4 py-2">
                          {p.status === "failed"
                            ? <span className="inline-flex items-center gap-1 text-[11px] text-red-500"><XIcon className="w-3 h-3" />Failed</span>
                            : p.sentAt
                              ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500"><Check className="w-3 h-3" />Sent</span>
                              : <span className="text-[11px] text-white/30">—</span>}
                        </td>
                        <td className="px-4 py-2">
                          {p.firstOpenedAt
                            ? <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500"><Check className="w-3 h-3" />
                                {whenLabel(p.firstOpenedAt)}{p.openCount > 1 ? ` · ${p.openCount}×` : ""}</span>
                            : <span className="text-[11px] text-white/30">Not opened</span>}
                        </td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-[12px] text-white/25">Nobody matches “{q}”.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 🔴 The honest caveat, and it is not boilerplate. "Sent" means
                Resend accepted it — there is no delivery webhook, so a hard
                bounce is invisible. Apple Mail pre-loads images, so an open can
                be a machine. Friendly Manager prints the same warning. */}
            <p className="text-[11px] text-white/35 leading-relaxed">
              “Sent” means our email provider accepted the message — it is not proof it reached an inbox.
              Opens are counted by an image load, and Apple Mail loads images automatically, so treat them
              as a guide rather than a headcount.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The email exactly as it went out. */
function MessageDialog({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/mailer/campaigns", campaign.id],
    queryFn: async () => {
      const r = await workspaceFetch(`/api/admin/mailer/campaigns/${campaign.id}`);
      if (!r.ok) throw new Error("Could not load the message");
      return r.json();
    },
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{campaign.subject}</DialogTitle>
        </DialogHeader>
        <div className="text-[11px] text-white/40 -mt-2">
          {whenLabel(campaign.sentAt ?? campaign.createdAt)} · from {campaign.fromEmail ?? "—"}
        </div>
        {isLoading ? <Skeleton className="h-[60vh] w-full rounded-xl bg-blue-500/[0.04]" /> : (
          // 🔴 A SANDBOXED FRAME, never dangerouslySetInnerHTML. This is email
          // HTML — much of it pasted or built by staff — rendered inside the
          // admin. An empty `sandbox` blocks scripts, forms and navigation, so a
          // campaign body can never run anything against a signed-in session.
          <iframe
            title="The email as it was sent"
            sandbox=""
            srcDoc={data?.body ?? "<p style='font-family:sans-serif;color:#666'>No content recorded for this campaign.</p>"}
            className="w-full h-[60vh] rounded-xl border border-blue-500/[0.08] bg-white"
            data-testid="frame-message"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AdminMailerHistory() {
  const [q, setQ] = useState("");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [seeRecipients, setSeeRecipients] = useState<Campaign | null>(null);
  const [seeMessage, setSeeMessage] = useState<Campaign | null>(null);

  const { data, isLoading } = useQuery<{ campaigns: Campaign[]; total: number }>({
    queryKey: ["/api/admin/mailer/campaigns", q, perPage, page],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: String(perPage), offset: String(page * perPage) });
      if (q.trim()) p.set("q", q.trim());
      const r = await workspaceFetch(`/api/admin/mailer/campaigns?${p}`);
      if (!r.ok) throw new Error("Could not load the history");
      return r.json();
    },
  });

  const rows = useMemo(() => {
    const list = [...(data?.campaigns ?? [])];
    const flip = dir === "asc" ? 1 : -1;
    const val = (c: Campaign) =>
      sort === "subject" ? (c.subject ?? "").toLowerCase()
      : sort === "sender" ? (c.senderName ?? c.fromEmail ?? "").toLowerCase()
      : sort === "recipients" ? (c.recipientCount ?? 0)
      : (c.sentAt ?? c.createdAt ?? "");
    return list.sort((a, b) => {
      const [x, y] = [val(a), val(b)];
      if (typeof x === "number" && typeof y === "number") return (x - y) * flip;
      return String(x).localeCompare(String(y), "en-NZ") * flip;
    });
  }, [data, sort, dir]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : page * perPage + 1;
  const to = Math.min((page + 1) * perPage, total);
  const onSort = (k: SortKey) => {
    if (k === sort) setDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSort(k); setDir(k === "date" || k === "recipients" ? "desc" : "asc"); }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="page-mailer-history">
      <div className="flex items-center gap-2">
        <Mail className="w-5 h-5 text-blue-400/60" />
        <h1 className="text-xl font-semibold text-white/85">Email History</h1>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[12px] text-white/45">
          {/* A drawn control, never the browser's own — see the standing rule. */}
          <select
            value={perPage}
            onChange={e => { setPerPage(Number(e.target.value)); setPage(0); }}
            className="premium-input h-8 px-2 text-[12px] text-white/80 rounded-lg"
            data-testid="select-per-page"
          >
            {[20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          entries/page
        </label>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(0); }}
            placeholder="Search a subject…" className="premium-input text-white/80 pl-9 h-9 w-64"
            data-testid="input-history-search" />
        </div>
      </div>

      <div className="rounded-xl border border-blue-500/[0.08] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]" data-testid="table-history">
            <thead>
              <tr className="border-b border-blue-500/[0.08] bg-blue-500/[0.03]">
                <SortHead label="Date" k="date" sort={sort} dir={dir} onSort={onSort} />
                <SortHead label="Subject" k="subject" sort={sort} dir={dir} onSort={onSort} />
                <SortHead label="Sender" k="sender" sort={sort} dir={dir} onSort={onSort} />
                <SortHead label="Recipients" k="recipients" sort={sort} dir={dir} onSort={onSort} />
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? [...Array(6)].map((_, i) => (
                <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-4 w-full bg-blue-500/[0.04]" /></td></tr>
              )) : rows.map(c => {
                const n = c.recipientCount ?? 0;
                return (
                  <tr key={c.id} className="border-b border-blue-500/[0.03] hover:bg-blue-500/[0.03] transition-colors" data-testid={`row-campaign-${c.id}`}>
                    <td className="px-4 py-3 text-[13px] text-white/60 whitespace-nowrap">{whenLabel(c.sentAt ?? c.createdAt)}</td>
                    <td className="px-4 py-3 text-[13px] text-white/80">{c.subject}</td>
                    <td className="px-4 py-3"><Sender c={c} /></td>
                    <td className="px-4 py-3">
                      <button onClick={() => setSeeRecipients(c)}
                        className="text-[13px] text-blue-400 hover:underline cursor-pointer"
                        data-testid={`link-recipients-${c.id}`}>
                        {n} {n === 1 ? "person" : "people"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setSeeMessage(c)}
                        className="text-[13px] text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
                        data-testid={`link-message-${c.id}`}>
                        View Message
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-white/25">
                  {q.trim() ? `No campaign matches “${q.trim()}”.` : "Nothing has been sent from here yet."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[12px] text-white/35" data-testid="text-showing">
          Showing {from} to {to} of {total} {total === 1 ? "entry" : "entries"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="h-8 text-[12px] border-white/[0.08]" data-testid="button-prev">Previous</Button>
          <span className="px-3 text-[12px] text-white/45">{page + 1} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}
            className="h-8 text-[12px] border-white/[0.08]" data-testid="button-next">Next</Button>
        </div>
      </div>

      {seeRecipients && <RecipientsDialog campaign={seeRecipients} onClose={() => setSeeRecipients(null)} />}
      {seeMessage && <MessageDialog campaign={seeMessage} onClose={() => setSeeMessage(null)} />}
    </div>
  );
}
