import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, FileText, Activity, MessageSquare, Package, Send, Download,
  ExternalLink, RefreshCw, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PrintOrder, PrintOrderItem, PrintOrderFile, PrintOrderEvent } from "@shared/schema";

const NEXT_STATUS: Record<string, string> = {
  quote_sent: "paid",
  paid: "in_design",
  artwork_pending: "in_design",
  in_design: "in_proof",
  in_proof: "proof_approved",
  proof_approved: "in_production",
  in_production: "finishing",
  finishing: "ready",
  ready: "delivered",
};

const STATUS_LABEL: Record<string, string> = {
  quote_sent: "Quote sent",
  paid: "Paid · awaiting artwork",
  artwork_pending: "Awaiting artwork",
  in_design: "In design",
  in_proof: "Proof sent",
  proof_approved: "Proof approved",
  in_production: "In production",
  finishing: "Finishing",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const NEXT_STATUS_LABEL: Record<string, string> = {
  quote_sent: "Mark paid",
  paid: "Start design",
  artwork_pending: "Start design",
  in_design: "Send proof",
  in_proof: "Mark proof approved",
  proof_approved: "Move to production",
  in_production: "Move to finishing",
  finishing: "Mark ready",
  ready: "Mark delivered",
};

function money(cents: number | null | undefined): string {
  if (cents == null) return "$0.00";
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface OrderBundle {
  order: PrintOrder;
  items: PrintOrderItem[];
  files: PrintOrderFile[];
  events: PrintOrderEvent[];
  xeroInvoice?: { id: string; number: string; status: string } | null;
}

export default function PrintsOrderDetail() {
  const [, params] = useRoute("/admin/print-orders/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const orderId = params?.id ? parseInt(params.id) : null;
  const [internalNotes, setInternalNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const { data, isLoading } = useQuery<OrderBundle>({
    queryKey: ["/api/admin/print-orders/detail", orderId],
    queryFn: () => fetch(`/api/admin/print-orders/${orderId}/detail`, { credentials: "include" }).then(r => r.json()),
    enabled: !!orderId,
  });

  const order = data?.order;
  const items = data?.items ?? [];
  const files = data?.files ?? [];
  const events = data?.events ?? [];

  const advance = useMutation({
    mutationFn: async () => {
      const next = order ? NEXT_STATUS[order.status] : null;
      if (!next) throw new Error("No next status from " + order?.status);
      const res = await apiRequest("PATCH", `/api/admin/print-orders/${orderId}`, { status: next });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/print-orders/detail", orderId] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });

  const pushXero = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/print-orders/${orderId}/push-to-xero`);
      return res.json();
    },
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/print-orders/detail", orderId] });
      toast({ title: "Pushed to Xero", description: `Invoice ${r.invoiceNumber}` });
    },
    onError: (e: Error) => toast({ title: "Xero push failed", description: e.message, variant: "destructive" }),
  });

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await apiRequest("PATCH", `/api/admin/print-orders/${orderId}`, { internalNotes });
      toast({ title: "Notes saved" });
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    } finally {
      setSavingNotes(false);
    }
  };

  if (isLoading || !order) {
    return <div className="p-6 text-white/40">Loading order...</div>;
  }

  const nextLabel = NEXT_STATUS_LABEL[order.status];
  const overdue = order.pickupReadyDate
    ? Math.floor((Date.now() - new Date(order.pickupReadyDate + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <button
        onClick={() => setLocation("/admin/print-jobs")}
        className="flex items-center gap-2 text-sm text-white/50 hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" /> Back to jobs
      </button>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-mono text-white/40 mb-1">{order.orderNumber || `Order #${order.id}`}</div>
          <h1 className="text-2xl font-bold text-white">{order.title}</h1>
          <div className="text-sm text-white/50 mt-1">
            {order.customerName} · {order.customerEmail}
            {order.customerPhone ? ` · ${order.customerPhone}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white">{money(order.totalCents)}</div>
          <div className="text-xs text-white/40">Subtotal {money(order.subtotalCents)} · GST {money(order.gstCents)}</div>
        </div>
      </div>

      {/* Status + actions */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40">Status</div>
          <div className="text-lg font-semibold text-white">{STATUS_LABEL[order.status] ?? order.status}</div>
          {order.pickupReadyDate && (
            <div className={`text-xs mt-1 ${overdue > 0 && order.status !== "ready" && order.status !== "delivered" ? "text-red-400" : "text-white/50"}`}>
              {overdue > 0 && order.status !== "ready" && order.status !== "delivered"
                ? `${overdue} days overdue`
                : `Ready ${order.pickupReadyDate}`}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {nextLabel && (
            <Button
              onClick={() => advance.mutate()}
              disabled={advance.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {nextLabel} →
            </Button>
          )}
          {order.status === "paid" && (!data?.xeroInvoice) && (
            <Button onClick={() => pushXero.mutate()} disabled={pushXero.isPending} variant="outline" className="border-white/10">
              <RefreshCw className="w-4 h-4 mr-1" /> Push to Xero
            </Button>
          )}
        </div>
      </div>

      {/* Xero status */}
      {data?.xeroInvoice && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between">
          <div className="text-sm">
            <span className="text-emerald-400 font-semibold">Xero invoice {data.xeroInvoice.number}</span>
            <span className="text-white/50 ml-2">· {data.xeroInvoice.status}</span>
          </div>
          <a
            href={`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${data.xeroInvoice.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
          >
            Open in Xero <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,360px] gap-5">
        <div className="space-y-5">
          {/* Line items */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
              <Package className="w-4 h-4" /> Line items
            </h2>
            <div className="space-y-3">
              {items.map(it => (
                <div key={it.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-sm text-white">{it.materialName}</div>
                      <div className="text-xs text-white/50">
                        {it.widthMm ? `${it.widthMm}×${it.heightMm}mm · ` : ""}
                        Qty {it.quantity}
                        {it.sides === 2 ? " · double-sided" : ""}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-white">{money(it.subtotalCents)}</div>
                  </div>
                  {Array.isArray(it.breakdownJson) && it.breakdownJson.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5 space-y-1 text-[11px]">
                      {(it.breakdownJson as any[]).map((line, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="text-white/50">{line.label}</span>
                          <span className={`font-mono ${line.cents < 0 ? "text-emerald-400" : "text-white/70"}`}>
                            {line.cents < 0 ? "−" : ""}{money(Math.abs(line.cents))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {it.estimatedCostCents > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5 text-[11px] text-white/40">
                      Estimated cost {money(it.estimatedCostCents)} · margin {money(it.subtotalCents - it.estimatedCostCents)}
                      ({Math.round(((it.subtotalCents - it.estimatedCostCents) / it.subtotalCents) * 100)}%)
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Files */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Files ({files.length})
            </h2>
            {files.length === 0 ? (
              <div className="text-sm text-white/30 text-center py-6">
                No files yet. Customer's magic-link upload portal:
                <div className="mt-2">
                  <a
                    href={`/print/order/${order.magicLinkToken}/upload`}
                    target="_blank"
                    className="text-blue-400 hover:underline text-xs"
                  >
                    /print/order/.../upload
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                    <FileText className="w-4 h-4 text-white/40" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{f.filename}</div>
                      <div className="text-[10px] text-white/30">{formatBytes(f.fileSize)} · {f.uploadedBy}</div>
                    </div>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/[0.05] text-white/50">{f.fileType}</span>
                    <a href={f.objectPath} target="_blank" download className="text-white/40 hover:text-white">
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Events */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Activity
            </h2>
            <div className="space-y-2">
              {events.map(e => (
                <div key={e.id} className="flex items-start gap-3 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="text-white/80">{e.notes || e.eventType}</div>
                    <div className="text-[10px] text-white/30">{new Date(e.createdAt).toLocaleString("en-NZ")}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {/* Customer */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3">Customer</h2>
            <div className="space-y-1.5 text-sm">
              <div>
                <div className="text-[10px] uppercase text-white/40">Name</div>
                <div className="text-white">{order.customerName}</div>
              </div>
              {order.customerCompany && (
                <div className="pt-2">
                  <div className="text-[10px] uppercase text-white/40">Company</div>
                  <div className="text-white">{order.customerCompany}</div>
                </div>
              )}
              <div className="pt-2">
                <div className="text-[10px] uppercase text-white/40">Email</div>
                <a href={`mailto:${order.customerEmail}`} className="text-white hover:underline">{order.customerEmail}</a>
              </div>
              {order.customerPhone && (
                <div className="pt-2">
                  <div className="text-[10px] uppercase text-white/40">Phone</div>
                  <a href={`tel:${order.customerPhone}`} className="text-white hover:underline">{order.customerPhone}</a>
                </div>
              )}
            </div>
          </section>

          {/* Delivery */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3">Fulfilment</h2>
            <div className="text-sm text-white/80">
              {order.deliveryMethod === "delivery" ? "Delivery" : "Pickup"}
            </div>
            {order.deliveryAddress && (
              <div className="text-xs text-white/50 mt-1">{order.deliveryAddress}</div>
            )}
            {order.customerNotes && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="text-[10px] uppercase text-white/40">Customer notes</div>
                <div className="text-xs text-white/70 mt-1">{order.customerNotes}</div>
              </div>
            )}
          </section>

          {/* Internal notes */}
          <section className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
            <h2 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> Internal notes
            </h2>
            <Textarea
              value={internalNotes || order.internalNotes || ""}
              onChange={(e) => setInternalNotes(e.target.value)}
              placeholder="Notes only Dima sees..."
              className="bg-white/[0.02] border-white/10 text-white min-h-[100px]"
            />
            <Button
              onClick={saveNotes}
              disabled={savingNotes}
              size="sm"
              className="mt-2 bg-blue-600 hover:bg-blue-700"
            >
              {savingNotes ? "Saving..." : "Save notes"}
            </Button>
          </section>
        </div>
      </div>
    </div>
  );
}
