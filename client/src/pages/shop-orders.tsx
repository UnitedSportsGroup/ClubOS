// Shop Orders — every club shop's paid orders in one list (United Prints).
//
// The shops left Shopify for ClubOS (CUFC, SIU, MFL, CIC). Dima packs for all
// of them, so this is the warehouse's view: which shop, who it's for, pickup or
// courier (with the address), every size, and any name/number to print. The
// same rows and statuses as each brand's own Store tab — a second door, not a
// second pipeline. Cancelling and refunding stay in the Store tab, where the
// money lives.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Package, Truck, Store, Printer, Search, Mail, Phone, MapPin, Shirt, CheckCircle2, StickyNote,
} from "lucide-react";

type Unit = { name?: string; number?: string; printLabel?: string };
type Item = {
  id: number; title: string; colourName: string | null; size: string | null; qty: number;
  imageUrl: string | null; printCents: number; units: Unit[] | null;
  customisation: { label: string; text?: string; logoUrl?: string }[] | null;
};
type Order = {
  id: number; orderNumber: string; brand: { key: string; name: string }; status: string; source: string;
  createdAt: string; firstName: string; lastName: string; email: string; phone: string; teamName: string | null;
  shippingLabel: string | null; ships: boolean;
  address: { line1: string; line2: string | null; suburb: string | null; city: string | null; postcode: string | null } | null;
  totalCents: number; notes: string | null; items: Item[];
  eship?: { orderId: number | null; pushedAt: string | null; error: string | null; international: boolean };
  tracking?: { number: string; carrier: string | null; status: string | null; updatedAt: string | null; url: string } | null;
};
type HubData = {
  brands: { key: string; name: string }[];
  counts: { status: string; brand: string; n: number }[];
  orders: Order[];
};

const VIEWS = [
  { key: "to_pack", label: "To pack", statuses: ["paid", "processing"] },
  { key: "ready_for_pickup", label: "Ready for pickup", statuses: ["ready_for_pickup"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped"] },
  { key: "completed", label: "Done", statuses: ["completed"] },
  { key: "", label: "All", statuses: [] as string[] },
];

const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: "New — paid", cls: "bg-amber-400/10 text-amber-400 border-amber-400/30" },
  processing: { label: "Packing", cls: "bg-blue-400/10 text-blue-400 border-blue-400/30" },
  ready_for_pickup: { label: "Ready for pickup", cls: "bg-purple-400/10 text-purple-400 border-purple-400/30" },
  shipped: { label: "Shipped", cls: "bg-cyan-400/10 text-cyan-400 border-cyan-400/30" },
  completed: { label: "Done", cls: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30" },
  cancelled: { label: "Cancelled", cls: "bg-white/5 text-white/50 border-white/10" },
  refunded: { label: "Refunded", cls: "bg-white/5 text-white/50 border-white/10" },
};

const BRAND_CLS: Record<string, string> = {
  cufc: "bg-blue-600 text-white",
  siu: "bg-neutral-900 text-amber-300",
  mfl: "bg-amber-400 text-black",
  cic: "bg-yellow-600 text-white",
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    view: p.has("view") ? p.get("view") || "" : "to_pack",
    brand: p.get("brand") || "",
    source: p.get("source") === "pos" ? "pos" : "online",
  };
}

/** The next step(s) for an order, in the order Dima works. */
function nextSteps(o: Order): { label: string; status: string; primary?: boolean }[] {
  switch (o.status) {
    case "paid": return [{ label: "Start packing", status: "processing", primary: true }];
    case "processing":
      return o.ships
        ? [{ label: "Mark shipped", status: "shipped", primary: true }]
        : [{ label: "Ready for pickup", status: "ready_for_pickup", primary: true }];
    case "ready_for_pickup": return [{ label: "Collected", status: "completed", primary: true }];
    case "shipped": return [{ label: "Mark done", status: "completed", primary: true }];
    case "completed": return [{ label: "Reopen", status: "processing" }];
    default: return [];
  }
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** A plain black-on-white packing slip in its own window, then the print dialog. */
function printSlip(o: Order) {
  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) return;
  const addr = o.address
    ? [o.address.line1, o.address.line2, o.address.suburb, [o.address.city, o.address.postcode].filter(Boolean).join(" ")].filter(Boolean).map(esc).join("<br>")
    : "Pickup — no address";
  const rows = o.items.map((i) => {
    const units = (i.units || []).filter((u) => u.name || u.number || u.printLabel)
      .map((u) => `<div class="u">☐ ${esc([u.printLabel, u.name, u.number ? `#${u.number}` : ""].filter(Boolean).join(" · "))}</div>`).join("");
    const spons = (i.customisation || []).filter((c) => c.text || c.logoUrl)
      .map((c) => `<div class="u">${esc(c.label)}: ${esc(c.text || "logo (see email/ClubOS)")}</div>`).join("");
    return `<tr><td class="q">${i.qty}</td><td><b>${esc(i.title)}</b><br>${esc([i.colourName, i.size && `Size ${i.size}`].filter(Boolean).join(" · "))}${units}${spons}</td><td class="c">☐</td></tr>`;
  }).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.orderNumber)}</title>
<style>
  body{font:14px/1.45 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:32px}
  h1{font-size:22px;margin:0} .muted{color:#555} table{width:100%;border-collapse:collapse;margin-top:18px}
  td,th{border-bottom:1px solid #ccc;padding:8px 6px;vertical-align:top;text-align:left}
  .q{width:40px;font-size:18px;font-weight:700} .c{width:30px;font-size:18px} .u{margin-top:3px;color:#333}
  .grid{display:flex;gap:40px;margin-top:16px} .box{flex:1} .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#666}
  @media print{body{margin:12mm}}
</style></head><body>
  <div class="muted">${esc(o.brand.name)}</div>
  <h1>Order ${esc(o.orderNumber)}</h1>
  <div class="muted">${esc(when(o.createdAt))}${o.teamName ? ` · Team: ${esc(o.teamName)}` : ""}</div>
  <div class="grid">
    <div class="box"><div class="lbl">For</div><b>${esc(o.firstName)} ${esc(o.lastName)}</b><br>${esc(o.phone)}<br>${esc(o.email)}</div>
    <div class="box"><div class="lbl">${esc(o.shippingLabel || (o.ships ? "Courier" : "Pickup"))}</div>${addr}</div>
  </div>
  <table><thead><tr><th>Qty</th><th>Item</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
  ${o.notes ? `<p><b>Notes:</b> ${esc(o.notes)}</p>` : ""}
  <script>window.onload=()=>{window.print()}</script>
</body></html>`);
  w.document.close();
}

function EshipLine({ o, eshipOn, pending, onSend }: { o: Order; eshipOn: boolean; pending: boolean; onSend: () => void }) {
  if (o.tracking) {
    return (
      <div className="mt-2 text-xs" data-testid={`eship-tracking-${o.id}`}>
        <span className="text-white/50">Tracking </span>
        <a href={o.tracking.url} target="_blank" rel="noreferrer" className="text-blue-300 hover:underline break-all">{o.tracking.number}</a>
        {o.tracking.status && <span className="text-white/50"> · {o.tracking.status}</span>}
      </div>
    );
  }
  if (o.eship?.orderId) {
    return <div className="mt-2 text-xs text-emerald-300" data-testid={`eship-sent-${o.id}`}>In eShip — print the label there. Tracking comes back here on its own.</div>;
  }
  if (o.eship?.international) {
    return <div className="mt-2 text-xs text-amber-300">International — create this one in eShip by hand.</div>;
  }
  if (!eshipOn) return null;
  return (
    <div className="mt-2">
      {o.eship?.error && <div className="text-xs text-red-300 mb-1.5 break-words">eShip: {o.eship.error}</div>}
      {["paid", "processing"].includes(o.status) && (
        <button
          onClick={onSend}
          disabled={pending}
          className="h-10 px-3 rounded-lg border border-white/15 text-white/80 text-sm hover:bg-white/5 disabled:opacity-50 inline-flex items-center gap-1.5"
          data-testid={`button-eship-${o.id}`}
        >
          <Truck className="w-4 h-4" /> {pending ? "Sending…" : o.eship?.error ? "Try eShip again" : "Send to eShip"}
        </button>
      )}
    </div>
  );
}

function OrderCard({ o, eshipOn }: { o: Order; eshipOn: boolean }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(o.notes || "");
  const [editingNotes, setEditingNotes] = useState(false);
  const move = useMutation({
    mutationFn: async (status: string) => (await apiRequest("PATCH", `/api/admin/shop-orders/${o.id}/status`, { status })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["shop-orders-hub"] }),
    onError: (e: any) => toast({ title: "Couldn't update", description: String(e?.message || e), variant: "destructive" }),
  });
  const saveNotes = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/admin/shop-orders/${o.id}/notes`, { notes })).json(),
    onSuccess: () => { setEditingNotes(false); queryClient.invalidateQueries({ queryKey: ["shop-orders-hub"] }); },
    onError: (e: any) => toast({ title: "Couldn't save the note", description: String(e?.message || e), variant: "destructive" }),
  });
  const sendToEship = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/shop-orders/${o.id}/eship`)).json(),
    onSuccess: () => { toast({ title: "Sent to eShip", description: "Print the label in eShip as usual." }); queryClient.invalidateQueries({ queryKey: ["shop-orders-hub"] }); },
    onError: (e: any) => { toast({ title: "Couldn't send to eShip", description: String(e?.message || e), variant: "destructive" }); queryClient.invalidateQueries({ queryKey: ["shop-orders-hub"] }); },
  });
  const st = STATUS[o.status] || { label: o.status, cls: "bg-white/5 text-white/60 border-white/10" };
  const units = o.items.reduce((n, i) => n + i.qty, 0);

  return (
    <div className="glass-card rounded-2xl border border-white/10 p-4 sm:p-5" data-testid={`shop-order-${o.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${BRAND_CLS[o.brand.key] || "bg-white/10 text-white"}`}>{o.brand.name}</span>
            <span className="text-white font-semibold">{o.orderNumber}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
          </div>
          <div className="text-xs text-white/50 mt-1">{when(o.createdAt)} · {units} item{units === 1 ? "" : "s"} · {money(o.totalCents)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {nextSteps(o).map((s) => (
            <button
              key={s.status}
              onClick={() => move.mutate(s.status)}
              disabled={move.isPending}
              className={s.primary
                ? "h-10 px-4 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
                : "h-10 px-4 rounded-lg border border-white/15 text-white/80 text-sm hover:bg-white/5 disabled:opacity-50"}
              data-testid={`button-step-${o.id}-${s.status}`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => printSlip(o)}
            className="h-10 px-3 rounded-lg border border-white/15 text-white/80 text-sm hover:bg-white/5 inline-flex items-center gap-1.5"
            data-testid={`button-print-${o.id}`}
          >
            <Printer className="w-4 h-4" /> Packing slip
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mt-4">
        <div className="text-sm">
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">For</div>
          <div className="text-white font-medium">{o.firstName} {o.lastName}{o.teamName ? <span className="text-white/50 font-normal"> · {o.teamName}</span> : null}</div>
          <a href={`tel:${o.phone}`} className="flex items-center gap-1.5 text-white/70 hover:text-white mt-1"><Phone className="w-3.5 h-3.5" />{o.phone}</a>
          <a href={`mailto:${o.email}`} className="flex items-center gap-1.5 text-white/70 hover:text-white break-all"><Mail className="w-3.5 h-3.5 shrink-0" />{o.email}</a>
        </div>
        <div className="text-sm">
          <div className="text-[11px] uppercase tracking-wider text-white/40 mb-1">{o.ships ? "Courier / post" : "Pickup"}</div>
          <div className="flex items-start gap-1.5 text-white">
            {o.ships ? <Truck className="w-4 h-4 mt-0.5 shrink-0" /> : <Store className="w-4 h-4 mt-0.5 shrink-0" />}
            <div>
              <div className="font-medium">{o.shippingLabel || (o.ships ? "Courier" : "Pickup")}</div>
              {o.address && (
                <div className="text-white/70 flex items-start gap-1 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    {[o.address.line1, o.address.line2, o.address.suburb, [o.address.city, o.address.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                  </span>
                </div>
              )}
              {o.ships && <EshipLine o={o} eshipOn={eshipOn} pending={sendToEship.isPending} onSend={() => sendToEship.mutate()} />}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 divide-y divide-white/5 rounded-xl border border-white/10">
        {o.items.map((i) => {
          const printUnits = (i.units || []).filter((u) => u.name || u.number || u.printLabel);
          return (
            <div key={i.id} className="flex gap-3 p-3">
              {i.imageUrl
                ? <img src={i.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover bg-white/5 shrink-0" loading="lazy" />
                : <div className="w-14 h-14 rounded-lg bg-white/5 grid place-items-center shrink-0"><Package className="w-5 h-5 text-white/30" /></div>}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white font-medium">{i.qty} × {i.title}</div>
                <div className="text-xs text-white/60">{[i.colourName, i.size && `Size ${i.size}`].filter(Boolean).join(" · ") || "One size"}</div>
                {printUnits.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {printUnits.map((u, k) => (
                      <span key={k} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-amber-400/10 text-amber-400 border border-amber-400/30">
                        <Shirt className="w-3 h-3" /> Print: {[u.printLabel, u.name, u.number && `#${u.number}`].filter(Boolean).join(" · ")}
                      </span>
                    ))}
                  </div>
                )}
                {(i.customisation || []).filter((c) => c.text || c.logoUrl).map((c, k) => (
                  <div key={k} className="text-xs text-white/60 mt-1">
                    {c.label}: {c.text || <a href={c.logoUrl} target="_blank" rel="noreferrer" className="underline">logo file</a>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        {editingNotes ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Waiting on size 10 from Kelme" className="premium-input" />
            <div className="flex gap-2">
              <button onClick={() => saveNotes.mutate()} disabled={saveNotes.isPending} className="h-10 px-4 rounded-lg bg-blue-600 text-white text-sm">Save</button>
              <button onClick={() => { setNotes(o.notes || ""); setEditingNotes(false); }} className="h-10 px-3 rounded-lg border border-white/15 text-white/70 text-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditingNotes(true)} className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white min-h-[32px]">
            <StickyNote className="w-3.5 h-3.5" /> {o.notes ? <span className="text-white/80">{o.notes}</span> : "Add a note"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ShopOrdersHub() {
  const { toast } = useToast();
  const [{ view, brand, source }, setParams] = useState(readParams);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  // Filters live in the URL so Back and a shared link land on the same list.
  useEffect(() => {
    const p = new URLSearchParams();
    if (view !== "to_pack") p.set("view", view);
    if (brand) p.set("brand", brand);
    if (source !== "online") p.set("source", source);
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [view, brand, source]);

  const { data, isLoading, error } = useQuery<HubData>({
    queryKey: ["shop-orders-hub", view, brand, source, debounced],
    queryFn: async () => {
      const p = new URLSearchParams({ source });
      if (view) p.set("status", view);
      if (brand) p.set("brand", brand);
      if (debounced) p.set("q", debounced);
      const res = await workspaceFetch(`/api/admin/shop-orders?${p}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || `HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const alerts = useQuery<{ on: boolean; email: string | null }>({
    queryKey: ["shop-orders-alerts"],
    queryFn: async () => {
      const res = await workspaceFetch(`/api/admin/shop-orders/me/alerts`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
  const eshipStatus = useQuery<{ brands: { key: string; connected: boolean; autoPush: boolean }[] }>({
    queryKey: ["shop-orders-eship-status"],
    queryFn: async () => {
      const res = await workspaceFetch(`/api/admin/shop-orders/eship/status`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  const eshipBrands = new Set((eshipStatus.data?.brands || []).filter((b) => b.connected).map((b) => b.key));
  const setAlerts = useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("PUT", `/api/admin/shop-orders/me/alerts`, { on })).json(),
    onSuccess: (r: { on: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["shop-orders-alerts"] });
      toast({ title: r.on ? "You'll get an email for every new order" : "Order emails turned off" });
    },
  });

  const countFor = (statuses: string[], b = brand) =>
    (data?.counts || []).filter((c) => (!b || c.brand === b) && (statuses.length === 0 || statuses.includes(c.status)))
      .reduce((n, c) => n + c.n, 0);
  const toPackBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of data?.counts || []) if (c.status === "paid" || c.status === "processing") m[c.brand] = (m[c.brand] || 0) + c.n;
    return m;
  }, [data]);

  const set = (patch: Partial<{ view: string; brand: string; source: string }>) => setParams((p) => ({ ...p, ...patch }));
  const chip = (active: boolean) =>
    `h-9 px-3 rounded-full text-sm border whitespace-nowrap inline-flex items-center gap-1.5 ${active ? "bg-blue-600 text-white border-blue-600" : "border-white/15 text-white/70 hover:bg-white/5"}`;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto pb-28">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-white">Shop Orders</h1>
          <p className="text-sm text-white/50 mt-1">Every paid order from the Christchurch United, South Island United, Mini Football and CIC shops. Pack it, post it or hand it over from here.</p>
        </div>
        <label className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2 cursor-pointer" data-testid="toggle-order-emails">
          <Mail className="w-4 h-4 text-white/60" />
          <span className="text-sm text-white/80">
            Email me new orders
            {alerts.data?.email && <span className="block text-[11px] text-white/40">{alerts.data.email}</span>}
          </span>
          <Switch checked={!!alerts.data?.on} disabled={alerts.isLoading || setAlerts.isPending} onCheckedChange={(v) => setAlerts.mutate(v)} />
        </label>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {VIEWS.map((v) => (
          <button key={v.key || "all"} className={chip(view === v.key)} onClick={() => set({ view: v.key })} data-testid={`view-${v.key || "all"}`}>
            {v.label}
            {data && <span className={`text-xs ${view === v.key ? "text-white/80" : "text-white/40"}`}>{countFor(v.statuses)}</span>}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 mt-2">
        <button className={chip(!brand)} onClick={() => set({ brand: "" })}>All shops</button>
        {(data?.brands || []).map((b) => (
          <button key={b.key} className={chip(brand === b.key)} onClick={() => set({ brand: b.key })} data-testid={`brand-${b.key}`}>
            {b.name}
            {toPackBy[b.key] ? <span className="text-[11px] px-1.5 rounded-full bg-amber-400 text-black font-semibold">{toPackBy[b.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, order number, team" className="premium-input pl-9" />
        </div>
        <div className="flex gap-2">
          <button className={chip(source === "online")} onClick={() => set({ source: "online" })}>Online orders</button>
          <button className={chip(source === "pos")} onClick={() => set({ source: "pos" })}>Counter sales</button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {isLoading && <div className="text-sm text-white/50">Loading orders…</div>}
        {error && <div className="text-sm text-red-400">Couldn't load orders: {String((error as Error).message)}</div>}
        {data && data.orders.length === 0 && (
          <div className="rounded-2xl border border-white/10 p-8 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <div className="text-white font-medium">{view === "to_pack" ? "Nothing to pack" : "No orders here"}</div>
            <div className="text-sm text-white/50 mt-1">New paid orders from every shop show up here as they come in.</div>
          </div>
        )}
        {data?.orders.map((o) => <OrderCard key={o.id} o={o} eshipOn={eshipBrands.has(o.brand.key)} />)}
      </div>
    </div>
  );
}
