// Warehouse → Transfers (2026-11-04). Shopify's Transfers, stage 1:
// a list, "Create transfer" (from → to, products + quantities, reference,
// note), and a transfer's own page. Stock moves only when a transfer is
// marked Transferred — one ledger group on the server, never in the browser.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Plus, Search, Trash2, Loader2, X } from "lucide-react";
import { apiRequest, queryClient, workspaceFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { askConfirm } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { locationLabel, TRANSFER_STATUS_LABELS, SHOP_SHORT_LABELS, type TransferStatus, type BrandOwner } from "@shared/warehouse";
import type { WhLocation } from "@shared/schema";

interface TransferRow {
  id: number;
  number: string;
  status: TransferStatus;
  reference: string | null;
  origin: string;
  destination: string;
  createdBy: string | null;
  createdAt: string;
  transferredAt: string | null;
  lineCount: number;
  units: number;
}
interface TransferList {
  stats: { transfers: number; units: number; items: number };
  transfers: TransferRow[];
}
interface TransferDetail {
  id: number;
  number: string;
  status: TransferStatus;
  reference: string | null;
  note: string | null;
  origin: string;
  destination: string;
  createdBy: string | null;
  createdAt: string;
  transferredBy: string | null;
  transferredAt: string | null;
  lines: { id: number; itemId: number; qty: number; sku: string; title: string; variant: string | null; originOnHand: number; destinationOnHand: number }[];
}
interface CatalogueRow {
  id: number;
  sku: string;
  name: string;
  shop: string;
  productTitle: string;
  colour: string | null;
  size: string | null;
  active: boolean;
}

const LIST_KEY = ["/api/admin/warehouse/transfers"];

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
}
function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function StatusBadge({ status }: { status: TransferStatus }) {
  const cls = status === "transferred" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400";
  return <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{TRANSFER_STATUS_LABELS[status]}</span>;
}

function TransferListView() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError } = useQuery<TransferList>({
    queryKey: LIST_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/transfers")).json(),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Transfers</h1>
          <p className="text-sm text-white/40 mt-0.5">Stock moved from one place to another — warehouse to office, shed to print shop.</p>
        </div>
        <Button onClick={() => setLocation("/admin/warehouse/transfers/new")} className="bg-blue-600 hover:bg-blue-700 flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Create transfer
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Transfers", value: data?.stats.transfers },
          { label: "Units moved", value: data?.stats.units },
          { label: "Different items", value: data?.stats.items },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="text-[11px] text-white/40">{s.label} · last 30 days</div>
            <div className="text-xl font-semibold text-white mt-1">{s.value === undefined ? "—" : n(s.value)}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-white/40 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <div className="py-16 text-center text-sm text-red-400">Couldn't load transfers. Refresh to try again.</div>
      ) : !data || data.transfers.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-white/50">No transfers yet.</p>
          <p className="text-xs text-white/30 mt-1">Create one when stock leaves the warehouse for the office, a shed or the print shop.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/5 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-white/[0.03] text-[11px] text-white/40 text-left">
                <th className="px-4 py-2 font-medium">Transfer</th>
                <th className="px-4 py-2 font-medium">Origin</th>
                <th className="px-4 py-2 font-medium">Destination</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Units</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.transfers.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setLocation(`/admin/warehouse/transfers/${t.id}`)}
                  className="border-t border-white/5 hover:bg-white/[0.03] cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <span className="font-semibold text-white">{t.number}</span>
                    {t.reference && <span className="text-white/60 ml-2">{t.reference}</span>}
                  </td>
                  <td className="px-4 py-3 text-white/70">{t.origin}</td>
                  <td className="px-4 py-3 text-white/70">{t.destination}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-right font-mono text-white/80">{n(t.units)}</td>
                  <td className="px-4 py-3 text-white/50 whitespace-nowrap">{fmtDate(t.createdAt)}{t.createdBy ? ` · ${t.createdBy}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateTransferView() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [originId, setOriginId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<{ item: CatalogueRow; qty: string }[]>([]);

  const { data: locations = [] } = useQuery<WhLocation[]>({
    queryKey: ["/api/admin/warehouse/locations", "active"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/locations?active=true")).json(),
  });
  const places = locations.filter((l) => l.kind !== "virtual");
  const { data: catalogue = [] } = useQuery<CatalogueRow[]>({
    queryKey: ["/api/admin/warehouse/catalogue", true],
    queryFn: async () => (await apiRequest("GET", "/api/admin/warehouse/catalogue?active=true")).json(),
  });

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const taken = new Set(lines.map((l) => l.item.id));
    return catalogue
      .filter((r) => {
        if (taken.has(r.id)) return false;
        const hay = `${r.productTitle} ${r.colour ?? ""} ${r.size ?? ""} ${r.sku} ${r.name}`.toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      })
      .slice(0, 12);
  }, [search, catalogue, lines]);

  const create = useMutation({
    mutationFn: async (transferNow: boolean) => {
      const res = await workspaceFetch("/api/admin/warehouse/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originLocationId: Number(originId),
          destinationLocationId: Number(destinationId),
          reference,
          note,
          transferNow,
          lines: lines.map((l) => ({ itemId: l.item.id, qty: Number(l.qty) })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      // A transfer saved as a draft because the stock couldn't move still has an id.
      if (!res.ok && !body.id) throw new Error(body.message || "Couldn't create the transfer");
      return { ok: res.ok, ...body } as { ok: boolean; id: number; number: string; message?: string };
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
      if (r.ok) toast({ title: `${r.number} created` });
      else toast({ title: `${r.number} saved as a draft`, description: r.message, variant: "destructive" });
      setLocation(`/admin/warehouse/transfers/${r.id}`);
    },
    onError: (e: Error) => toast({ title: "Couldn't create the transfer", description: e.message, variant: "destructive" }),
  });

  const validQty = lines.every((l) => Number(l.qty) > 0);
  const ready = originId && destinationId && originId !== destinationId && lines.length > 0 && validQty;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <button onClick={() => setLocation("/admin/warehouse/transfers")} className="text-sm text-white/50 hover:text-white flex items-center gap-1.5 min-h-[44px]">
        <ArrowLeft className="w-4 h-4" /> Transfers
      </button>
      <h1 className="text-2xl font-bold text-white">Create transfer</h1>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <div>
          <label className="text-xs text-white/50">Origin</label>
          <Select value={originId} onValueChange={setOriginId}>
            <SelectTrigger className="bg-white/[0.02] border-white/10 text-white mt-1"><SelectValue placeholder="Where it's coming from" /></SelectTrigger>
            <SelectContent>{places.map((l) => <SelectItem key={l.id} value={String(l.id)}>{locationLabel(l)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <ArrowRight className="w-4 h-4 text-white/30 hidden sm:block mb-3" />
        <div>
          <label className="text-xs text-white/50">Destination</label>
          <Select value={destinationId} onValueChange={setDestinationId}>
            <SelectTrigger className="bg-white/[0.02] border-white/10 text-white mt-1"><SelectValue placeholder="Where it's going" /></SelectTrigger>
            <SelectContent>{places.filter((l) => String(l.id) !== originId).map((l) => <SelectItem key={l.id} value={String(l.id)}>{locationLabel(l)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Products</h2>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <Input placeholder="Search products to add — name, size, SKU" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 bg-white/[0.02] border-white/10 text-white" />
        </div>
        {matches.length > 0 && (
          <div className="rounded-xl border border-white/10 divide-y divide-white/5 max-h-72 overflow-y-auto">
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => { setLines((prev) => [...prev, { item: m, qty: "1" }]); setSearch(""); }}
                className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] flex items-center justify-between gap-3 min-h-[44px]"
              >
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">{m.productTitle}</div>
                  <div className="text-[11px] text-white/40 truncate">{[m.colour, m.size].filter(Boolean).join(" / ")} · {m.sku}</div>
                </div>
                <span className="text-[10px] text-white/40 flex-shrink-0">{SHOP_SHORT_LABELS[m.shop as BrandOwner] ?? m.shop}</span>
              </button>
            ))}
          </div>
        )}
        {lines.length === 0 ? (
          <p className="text-sm text-white/30 py-4 text-center">No products added yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {lines.map((l, i) => (
              <div key={l.item.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{l.item.productTitle}</div>
                  <div className="text-[11px] text-white/40 truncate">{[l.item.colour, l.item.size].filter(Boolean).join(" / ")} · {l.item.sku}</div>
                </div>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={l.qty}
                  onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                  className="w-20 bg-white/[0.02] border-white/10 text-white text-right"
                  aria-label={`Quantity of ${l.item.productTitle}`}
                />
                <button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="text-white/30 hover:text-red-400 w-11 h-11 flex items-center justify-center" aria-label="Remove">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-white/50">Reference (optional)</label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Kits for U10 Blue" className="bg-white/[0.02] border-white/10 text-white mt-1" />
        </div>
        <div>
          <label className="text-xs text-white/50">Note (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person should know" className="bg-white/[0.02] border-white/10 text-white mt-1" />
        </div>
      </div>

      <div className="flex justify-end gap-2 flex-wrap">
        <Button variant="ghost" onClick={() => create.mutate(false)} disabled={!ready || create.isPending}>Save as draft</Button>
        <Button onClick={() => create.mutate(true)} disabled={!ready || create.isPending} className="bg-blue-600 hover:bg-blue-700">
          {create.isPending ? "Saving…" : "Create and move stock"}
        </Button>
      </div>
    </div>
  );
}

function TransferDetailView({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const key = ["/api/admin/warehouse/transfers", id];
  const { data: t, isLoading, isError } = useQuery<TransferDetail>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/admin/warehouse/transfers/${id}`)).json(),
  });

  const transfer = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/admin/warehouse/transfers/${id}/transfer`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/warehouse/catalogue"] });
      toast({ title: "Stock moved" });
    },
    onError: (e: Error) => toast({ title: "Stock not moved", description: e.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/admin/warehouse/transfers/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LIST_KEY });
      toast({ title: "Draft deleted" });
      setLocation("/admin/warehouse/transfers");
    },
    onError: (e: Error) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <button onClick={() => setLocation("/admin/warehouse/transfers")} className="text-sm text-white/50 hover:text-white flex items-center gap-1.5 min-h-[44px]">
        <ArrowLeft className="w-4 h-4" /> Transfers
      </button>
      {isLoading ? (
        <div className="py-10 text-center text-sm text-white/40 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : isError || !t ? (
        <div className="py-16 text-center text-sm text-red-400">Couldn't load this transfer.</div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">{t.number}</h1>
                <StatusBadge status={t.status} />
              </div>
              {t.reference && <p className="text-sm text-white/60 mt-0.5">{t.reference}</p>}
            </div>
            {t.status === "draft" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => { if (await askConfirm("Delete this draft? Nothing has moved, so no stock changes.", { confirmLabel: "Delete" })) remove.mutate(); }}
                  className="px-3 py-2 rounded-lg text-xs text-red-400 border border-red-500/20 hover:bg-red-500/10 flex items-center gap-1.5 min-h-[44px]"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete draft
                </button>
                <Button onClick={() => transfer.mutate()} disabled={transfer.isPending} className="bg-blue-600 hover:bg-blue-700">
                  {transfer.isPending ? "Moving…" : "Mark as transferred"}
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
            <div><div className="text-[11px] text-white/40">Origin</div><div className="text-sm text-white">{t.origin}</div></div>
            <ArrowRight className="w-4 h-4 text-white/30" />
            <div><div className="text-[11px] text-white/40">Destination</div><div className="text-sm text-white">{t.destination}</div></div>
          </div>

          <div className="rounded-2xl border border-white/5 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-white/[0.03] text-[11px] text-white/40 text-left">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium text-right">Quantity</th>
                  <th className="px-4 py-2 font-medium text-right">{t.origin}</th>
                  <th className="px-4 py-2 font-medium text-right">{t.destination}</th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id} className="border-t border-white/5">
                    <td className="px-4 py-3">
                      <div className="text-white">{l.title}</div>
                      <div className="text-[11px] text-white/40">{l.variant ? `${l.variant} · ` : ""}{l.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-white">{n(l.qty)}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-400">−{n(l.qty)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-400">+{n(l.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 text-sm space-y-1.5">
            <div className="text-white/60">Created {fmtDate(t.createdAt)}{t.createdBy ? ` by ${t.createdBy}` : ""}</div>
            {t.transferredAt && <div className="text-white/60">Transferred {fmtDate(t.transferredAt)}{t.transferredBy ? ` by ${t.transferredBy}` : ""}</div>}
            {t.note && <div className="text-white/80 pt-1">{t.note}</div>}
          </div>
        </>
      )}
    </div>
  );
}

export default function WarehouseTransfers() {
  const [isNew] = useRoute("/admin/warehouse/transfers/new");
  const [isDetail, params] = useRoute<{ id: string }>("/admin/warehouse/transfers/:id");
  if (isNew) return <CreateTransferView />;
  if (isDetail && params && /^\d+$/.test(params.id)) return <TransferDetailView id={Number(params.id)} />;
  return <TransferListView />;
}
