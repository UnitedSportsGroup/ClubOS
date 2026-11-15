// CIC workspace → Packages. Every CIC 2027 package booking from
// packages.cicyouth.com: holds about to lapse, deposits in, balances, who has
// registered, the extras players bought (merch to order, meals, attractions to
// book) and the extras catalogue, editable here with no deploy.
//
// Views live in the URL hash (#bookings, #extras-orders, #catalogue) so Back
// and a shared link land on the same view.
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clock, ExternalLink, Package, Users, Wallet } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const money = (c: number | null | undefined) =>
  c == null ? "—" : "$" + (c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "Pacific/Auckland" }) : "—";

type View = "bookings" | "extras-orders" | "catalogue";
const VIEWS: { id: View; label: string }[] = [
  { id: "bookings", label: "Bookings" }, { id: "extras-orders", label: "Extras bought" }, { id: "catalogue", label: "Extras catalogue" },
];
const STATUS: Record<string, { label: string; cls: string }> = {
  held: { label: "Held, no deposit", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  expired: { label: "Hold lapsed", cls: "bg-white/5 text-white/50 border-white/10" },
  booked: { label: "Booked", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Cancelled", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
};

function useHashView(): [View, (v: View) => void] {
  const read = (): View => {
    const h = window.location.hash.replace("#", "") as View;
    return VIEWS.some((v) => v.id === h) ? h : "bookings";
  };
  const [v, setV] = useState<View>(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [v, (next) => { window.history.replaceState(null, "", `#${next}`); setV(next); }];
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-1.5 text-[12px] text-white/50">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

export default function CicPackagesAdmin() {
  const [view, setView] = useHashView();
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["/api/admin/cic-packages"] });
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (isLoading) return <div className="p-8 text-white/50">Loading…</div>;
  if (error) return <div className="p-8 text-red-300">Couldn't load packages: {(error as Error).message}</div>;

  const all: any[] = data?.bookings ?? [];
  const bookings = all.filter((b) => showAll || (!b.quarantined && b.status !== "expired" && b.status !== "cancelled"));
  const booked = all.filter((b) => b.status === "booked");
  const held = all.filter((b) => b.status === "held" && !b.quarantined);

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-semibold text-white">Packages</h1>
      <p className="mt-1 text-[14px] text-white/50">
        CIC 2027 trips booked on <a href="https://packages.cicyouth.com" target="_blank" rel="noreferrer" className="underline">packages.cicyouth.com</a>.
        10% non-refundable deposit, 14-day hold, then three instalments. Players register on their team's link.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Teams booked" value={String(booked.length)} icon={Users} />
        <Stat label="Held, waiting on deposit" value={String(held.length)} icon={Clock} />
        <Stat label="Paid toward trips" value={money(booked.reduce((s, b) => s + b.paidTowardCents, 0))} icon={Wallet} />
        <Stat label="Extras sold" value={money(all.reduce((s, b) => s + b.extrasPaidCents, 0))} icon={Package} />
      </div>

      <div className="mt-6 flex gap-1 border-b border-white/10">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`min-h-[44px] px-4 text-[14px] ${view === v.id ? "border-b-2 border-amber-400 text-white" : "text-white/45"}`}>{v.label}</button>
        ))}
      </div>

      {view === "bookings" && (
        <div className="mt-4">
          <label className="flex items-center gap-2 text-[13px] text-white/60">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show lapsed, cancelled and flagged
          </label>
          {bookings.length === 0 && <p className="mt-6 text-white/50">No bookings yet. They appear here the moment a club presses Book.</p>}
          <div className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10">
            {bookings.map((b) => (
              <div key={b.id}>
                <button onClick={() => setOpen(open === b.id ? null : b.id)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-white/[0.03]">
                  {open === b.id ? <ChevronDown className="h-4 w-4 text-white/40" /> : <ChevronRight className="h-4 w-4 text-white/40" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-white">{b.clubName}{b.teamName ? ` · ${b.teamName}` : ""} <span className="text-white/45">· {b.ageGroup} · {b.packageName}</span></div>
                    <div className="text-[12px] text-white/45">
                      {b.managerName} · {b.registered}/{b.players} registered · {b.status === "held" ? `hold ends ${day(b.expiresAt)}` : `booked ${day(b.createdAt)}`}
                      {b.quarantined ? " · flagged as likely spam" : ""}
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <div className="tabular-nums text-white">{money(b.paidTowardCents)} <span className="text-white/40">/ {money(b.invoiceCents)}</span></div>
                    {b.overpaidCents > 0 && <div className="text-[12px] text-red-300">Overpaid {money(b.overpaidCents)}: refund</div>}
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS[b.status]?.cls}`}>{STATUS[b.status]?.label}</span>
                </button>
                {open === b.id && <BookingDetail b={b} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "extras-orders" && <ExtrasOrders rows={data?.extrasOrders ?? []} />}
      {view === "catalogue" && <Catalogue extras={data?.extras ?? []} />}
    </div>
  );
}

function BookingDetail({ b }: { b: any }) {
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: [`/api/admin/cic-packages/bookings/${b.id}`] });
  const [notes, setNotes] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: any) => apiRequest("POST", `/api/admin/cic-packages/bookings/${b.id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/admin/cic-packages"] }); qc.invalidateQueries({ queryKey: [`/api/admin/cic-packages/bookings/${b.id}`] }); },
  });
  return (
    <div className="space-y-4 bg-white/[0.02] px-4 pb-5 pt-1 sm:px-11">
      <div className="flex flex-wrap gap-2 text-[13px]">
        <a href={b.teamUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-white/15 px-3 text-white/80">Team page <ExternalLink className="h-3.5 w-3.5" /></a>
        {b.joinUrl && <a href={b.joinUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-white/15 px-3 text-white/80">Players' join link <ExternalLink className="h-3.5 w-3.5" /></a>}
        <span className="inline-flex min-h-[36px] items-center text-white/50">{b.managerEmail} · {b.managerPhone}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-4 text-[13px]">
        <div><div className="text-white/45">Trip total</div><div className="tabular-nums text-white">{money(b.totalCents)}</div></div>
        <div><div className="text-white/45">Invoice (no flights)</div><div className="tabular-nums text-white">{money(b.invoiceCents)}</div></div>
        <div><div className="text-white/45">Deposit</div><div className="tabular-nums text-white">{money(b.depositCents)} {b.depositPaidAt ? `· paid ${day(b.depositPaidAt)}` : "· not paid"}</div></div>
        <div><div className="text-white/45">Still owing</div><div className="tabular-nums text-white">{money(b.outstandingCents)}</div></div>
      </div>
      {data && (
        <>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-white/45">Quote (frozen when booked)</div>
            <ul className="mt-1 space-y-1 text-[13px]">
              {(data.booking.lines || []).map((l: any) => (
                <li key={l.label} className="flex justify-between gap-3"><span className="text-white/75">{l.label} <span className="text-white/40">· {l.detail}</span></span><span className="tabular-nums text-white">{l.amount == null ? "TBC" : money(Math.round(l.amount * 100))}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-white/45">Players ({data.players.length}/{b.players})</div>
            {data.players.length === 0 ? <p className="mt-1 text-[13px] text-white/45">Nobody has registered yet.</p> : (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead className="text-left text-white/45"><tr><th className="py-1 pr-3 font-normal">Player</th><th className="pr-3 font-normal">Born</th><th className="pr-3 font-normal">Parent</th><th className="pr-3 font-normal">Contact</th><th className="font-normal">Medical</th></tr></thead>
                  <tbody>{data.players.map((p: any) => (
                    <tr key={p.id} className="border-t border-white/5 text-white/80"><td className="py-1.5 pr-3">{p.first_name} {p.last_name}</td><td className="pr-3">{p.dob ?? "—"}</td><td className="pr-3">{p.guardian_name}</td><td className="pr-3">{p.guardian_email} · {p.guardian_phone}</td><td>{p.medical || "—"}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-white/45">Payments</div>
            {data.payments.length === 0 ? <p className="mt-1 text-[13px] text-white/45">None yet.</p> : (
              <ul className="mt-1 space-y-1 text-[13px]">{data.payments.map((p: any) => (
                <li key={p.id} className="flex justify-between gap-3 text-white/80"><span>{day(p.paid_at)} · {p.kind}{p.extras_cents ? ` + extras ${money(p.extras_cents)}` : ""}</span><span className="tabular-nums">{money(p.amount_cents + p.extras_cents)}</span></li>
              ))}</ul>
            )}
          </div>
        </>
      )}
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-white/45">Staff notes</div>
        <textarea className="mt-1 w-full rounded-lg border border-white/10 bg-transparent p-2 text-[14px] text-white" rows={2}
          value={notes ?? b.staffNotes ?? ""} onChange={(e) => setNotes(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="min-h-[40px] rounded-lg bg-amber-400 px-4 text-[13px] font-semibold text-black disabled:opacity-40" disabled={notes === null || save.isPending}
            onClick={() => save.mutate({ staffNotes: notes })}>Save notes</button>
          {b.status !== "cancelled" && (cancelReason === null ? (
            <button className="min-h-[40px] rounded-lg border border-red-400/40 px-4 text-[13px] text-red-300" onClick={() => setCancelReason("")}>
              Cancel booking
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <input className="min-h-[40px] rounded-lg border border-white/10 bg-transparent px-2 text-[14px] text-white" placeholder="Why? (refunds are done in Stripe)"
                value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              <button className="min-h-[40px] rounded-lg bg-red-500/80 px-4 text-[13px] font-semibold text-white" onClick={() => { save.mutate({ cancel: true, reason: cancelReason }); setCancelReason(null); }}>Confirm cancel</button>
              <button className="min-h-[40px] px-2 text-[13px] text-white/50" onClick={() => setCancelReason(null)}>Keep it</button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExtrasOrders({ rows }: { rows: any[] }) {
  if (!rows.length) return <p className="mt-6 text-white/50">No extras bought yet.</p>;
  const tally = new Map<string, number>();
  rows.forEach((r) => { const k = `${r.item}${r.option ? ` · ${r.option}` : ""}`; tally.set(k, (tally.get(k) ?? 0) + r.qty); });
  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-xl border border-white/10 p-4">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-white/45">To order / book</div>
        <ul className="mt-2 grid gap-1 text-[14px] sm:grid-cols-2">{Array.from(tally.entries()).sort().map(([k, n]) => (
          <li key={k} className="flex justify-between gap-3 text-white/85"><span>{k}</span><span className="tabular-nums">{n}</span></li>
        ))}</ul>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="text-left text-white/45"><tr><th className="p-3 font-normal">Paid</th><th className="font-normal">Player</th><th className="font-normal">Team</th><th className="font-normal">Item</th><th className="font-normal">Qty</th><th className="pr-3 text-right font-normal">Amount</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 text-white/80"><td className="p-3">{day(r.paidAt)}</td><td>{r.player}<div className="text-[11px] text-white/40">{r.guardianEmail}</div></td><td>{r.club} {r.ageGroup}</td><td>{r.item}{r.option ? ` (${r.option})` : ""}</td><td>{r.qty}</td><td className="pr-3 text-right tabular-nums">{money(r.priceCents * r.qty)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

const CATS = [["promo", "Packs & promotions"], ["merch", "Merch"], ["meal", "Victoria Foods meals"], ["experience", "Attractions"]] as const;

function Catalogue({ extras }: { extras: any[] }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: any }) => {
      const r = await apiRequest("POST", id ? `/api/admin/cic-packages/extras/${id}` : "/api/admin/cic-packages/extras", body);
      return r.json();
    },
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ["/api/admin/cic-packages"] }); },
    onError: (e: any) => setErr(e.message),
  });
  return (
    <div className="mt-4 space-y-3">
      <p className="text-[13px] text-white/50">What players can add on their own page. Leave the price blank to keep an item off sale. Changes show on players' pages straight away.</p>
      {err && <p className="text-[13px] text-red-300">{err}</p>}
      {extras.map((x) => <ExtraRow key={x.id} x={x} onSave={(body) => save.mutate({ id: x.id, body })} />)}
      <ExtraRow x={null} onSave={(body) => save.mutate({ body })} />
    </div>
  );
}

function ExtraRow({ x, onSave }: { x: any | null; onSave: (body: any) => void }) {
  const [f, setF] = useState(() => ({
    category: x?.category ?? "experience", name: x?.name ?? "", description: x?.description ?? "", partner: x?.partner ?? "",
    price: x?.price_cents != null ? (x.price_cents / 100).toFixed(2) : "", options: (x?.options ?? []).join(", "),
    sourceNote: x?.source_note ?? "", active: x?.active ?? true, sort: x?.sort ?? 0,
  }));
  const inp = "min-h-[40px] rounded-lg border border-white/10 bg-transparent px-2 text-[14px] text-white";
  return (
    <div className={`rounded-xl border p-3 ${x ? "border-white/10" : "border-dashed border-white/20"}`}>
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_110px_90px]">
        <div className="flex flex-wrap gap-1">
          {CATS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setF({ ...f, category: id })}
              className={`min-h-[32px] rounded-full border px-2 text-[11px] ${f.category === id ? "border-amber-400 text-white" : "border-white/10 text-white/45"}`}>{label}</button>
          ))}
        </div>
        <input className={inp} placeholder={x ? "Name" : "New item name"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={inp} placeholder="Price $" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <label className="flex items-center gap-1.5 text-[13px] text-white/70"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />On sale</label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input className={inp} placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <input className={inp} placeholder="Sizes / options, comma separated" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} />
        <input className={inp} placeholder="Where the price came from" value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} />
      </div>
      <div className="mt-2 flex justify-end">
        <button className="min-h-[40px] rounded-lg bg-amber-400 px-4 text-[13px] font-semibold text-black disabled:opacity-40" disabled={!f.name.trim()}
          onClick={() => onSave({
            category: f.category, name: f.name, description: f.description, partner: f.partner,
            priceCents: f.price.trim() === "" ? null : Math.round(Number(f.price) * 100),
            options: f.options.split(",").map((s: string) => s.trim()).filter(Boolean),
            sourceNote: f.sourceNote, active: f.active, sort: f.sort,
          })}>{x ? "Save" : "Add item"}</button>
      </div>
    </div>
  );
}
