import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Package, Phone, Mail, Upload, FileCheck } from "lucide-react";

interface OrderStatus {
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  subtotalCents: number;
  gstCents: number;
  paidCents: number;
  pickupReadyDate: string | null;
  deliveryMethod: string;
  materialName: string;
  materialDetails: { quantity: number; widthMm: number | null; heightMm: number | null; sides: number } | null;
  artworkPath: string;
  fileCount: number;
  events: { type: string; label: string; at: string }[];
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_LABELS: Record<string, { label: string; description: string; tone: string }> = {
  draft:           { label: "Draft", description: "Working on your quote", tone: "zinc" },
  quote_sent:      { label: "Awaiting payment", description: "Pay the quote and we'll get cracking.", tone: "amber" },
  paid:            { label: "Order received", description: "We've got your order — heading into design.", tone: "blue" },
  artwork_pending: { label: "Awaiting artwork", description: "Send us your design via the upload link.", tone: "amber" },
  in_design:       { label: "In design", description: "Our team is preparing your file for print.", tone: "blue" },
  in_proof:        { label: "Proof sent", description: "Check your email for a proof to approve.", tone: "purple" },
  proof_approved:  { label: "Proof approved", description: "Heading to the press.", tone: "blue" },
  in_production:   { label: "In production", description: "On the press. Almost there.", tone: "purple" },
  finishing:       { label: "Finishing", description: "Trimming, hemming, eyeleting.", tone: "purple" },
  ready:           { label: "Ready for pickup", description: "Come grab it — 466 Yaldhurst Rd, Hornby.", tone: "green" },
  delivered:       { label: "Delivered", description: "Hope you love it.", tone: "green" },
  cancelled:       { label: "Cancelled", description: "This order was cancelled and refunded.", tone: "red" },
};

const TONE_CLASS: Record<string, { bg: string; text: string; ring: string }> = {
  zinc:   { bg: "bg-zinc-100",      text: "text-zinc-700",      ring: "ring-zinc-200" },
  amber:  { bg: "bg-amber-50",      text: "text-amber-800",     ring: "ring-amber-200" },
  blue:   { bg: "bg-blue-50",       text: "text-blue-800",      ring: "ring-blue-200" },
  purple: { bg: "bg-purple-50",     text: "text-purple-800",    ring: "ring-purple-200" },
  green:  { bg: "bg-emerald-50",    text: "text-emerald-800",   ring: "ring-emerald-200" },
  red:    { bg: "bg-red-50",        text: "text-red-800",       ring: "ring-red-200" },
};

export default function PrintOrderStatus() {
  const [, params] = useRoute("/print/order/:token");
  const [, setLocation] = useLocation();
  const token = params?.token;

  const { data: order, isLoading, error } = useQuery<OrderStatus>({
    queryKey: ["/api/print/orders/by-token", token],
    queryFn: () => fetch(`/api/print/orders/by-token/${token}`).then(r => {
      if (!r.ok) throw new Error("Order not found");
      return r.json();
    }),
    enabled: !!token,
    refetchInterval: 60000,  // refresh every minute so customers see status changes
  });

  if (isLoading) {
    return <div className="min-h-screen bg-white flex items-center justify-center text-zinc-500">Loading...</div>;
  }
  if (error || !order) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Order not found</h2>
          <p className="text-zinc-500 mb-4">This link may have expired.</p>
          <button onClick={() => setLocation("/print")} className="text-blue-600 underline">Start a new order</button>
        </div>
      </div>
    );
  }

  const status = STATUS_LABELS[order.status] ?? { label: order.status, description: "", tone: "zinc" };
  const tone = TONE_CLASS[status.tone];
  const needsArtwork = (order.status === "paid" || order.status === "artwork_pending") && order.fileCount === 0;

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => setLocation("/print")} className="flex items-center gap-2 text-sm font-medium hover:text-zinc-600">
            <Package className="w-4 h-4" /> United Prints
          </button>
          <a href="tel:0800800199" className="text-sm font-medium hover:text-zinc-600">0800 800 199</a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          {order.status === "cancelled"
            ? <Package className="w-12 h-12 text-red-400 mx-auto mb-4" />
            : <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />}
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
            Order #{order.orderNumber}
          </h1>
          <p className="text-zinc-500">Confirmation sent to {order.customerEmail}</p>
        </div>

        <div className={`rounded-2xl border ring-1 ${tone.bg} ${tone.ring} p-6 mb-6`}>
          <div className={`text-[10px] uppercase tracking-wider font-semibold ${tone.text} mb-2 opacity-70`}>Current status</div>
          <div className={`text-2xl font-bold ${tone.text}`}>{status.label}</div>
          {status.description && <p className={`text-sm mt-1 ${tone.text} opacity-80`}>{status.description}</p>}
        </div>

        {needsArtwork && (
          <div className="rounded-2xl border-2 border-blue-500/30 bg-blue-50 p-6 mb-6 flex items-center gap-4">
            <Upload className="w-8 h-8 text-blue-600 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-bold text-blue-900">We're waiting on your artwork</div>
              <div className="text-sm text-blue-800 mt-0.5">Upload now to get your order on the press.</div>
            </div>
            <button
              onClick={() => setLocation(`/print/order/${token}/upload`)}
              className="px-4 py-2 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 flex-shrink-0"
            >
              Upload artwork
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-zinc-200 p-6 mb-6">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Order details</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-zinc-500">Product</div>
              <div className="font-semibold">{order.materialName}</div>
              {order.materialDetails && (
                <div className="text-xs text-zinc-500 mt-0.5">
                  {order.materialDetails.widthMm
                    ? `${order.materialDetails.widthMm} × ${order.materialDetails.heightMm}mm · `
                    : ""}
                  Qty {order.materialDetails.quantity}
                  {order.materialDetails.sides === 2 ? " · double-sided" : ""}
                </div>
              )}
            </div>
            <div>
              <div className="text-zinc-500">Total paid</div>
              <div className="font-semibold">{money(order.totalCents)}</div>
              <div className="text-xs text-zinc-500 mt-0.5">incl GST {money(order.gstCents)}</div>
            </div>
            <div>
              <div className="text-zinc-500">Customer</div>
              <div className="font-semibold">{order.customerName}</div>
            </div>
            {order.pickupReadyDate && (
              <div>
                <div className="text-zinc-500">Ready by</div>
                <div className="font-semibold">{order.pickupReadyDate}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {order.deliveryMethod === "delivery" ? "Delivery" : "Pickup from 466 Yaldhurst Rd"}
                </div>
              </div>
            )}
          </div>
        </div>

        {order.fileCount > 0 && (
          <div className="rounded-2xl border border-zinc-200 p-6 mb-6 flex items-center gap-3">
            <FileCheck className="w-5 h-5 text-green-600" />
            <div className="flex-1 text-sm">
              <span className="font-semibold">{order.fileCount} file{order.fileCount === 1 ? "" : "s"}</span> uploaded
            </div>
            <button onClick={() => setLocation(`/print/order/${token}/upload`)} className="text-sm text-blue-600 hover:underline">
              Add more
            </button>
          </div>
        )}

        {/* Activity timeline */}
        {order.events && order.events.length > 0 && (
          <div className="rounded-2xl border border-zinc-200 p-6 mb-6">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-4">Progress</div>
            <div className="space-y-3">
              {order.events.map((e, i) => {
                const isLatest = i === order.events.length - 1;
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                      isLatest ? "bg-blue-600 ring-4 ring-blue-100" : "bg-zinc-300"
                    }`} />
                    <div className="flex-1">
                      <div className={`text-sm ${isLatest ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>
                        {e.label}
                      </div>
                      <div className="text-xs text-zinc-400">
                        {new Date(e.at).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-zinc-200 p-6 bg-zinc-50">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-3">Get in touch</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a href="tel:0800800199" className="flex items-center gap-2 text-sm font-medium hover:text-zinc-600">
              <Phone className="w-4 h-4" /> 0800 800 199
            </a>
            <a href={`mailto:orders@unitedprints.co.nz?subject=Order ${order.orderNumber}`} className="flex items-center gap-2 text-sm font-medium hover:text-zinc-600">
              <Mail className="w-4 h-4" /> orders@unitedprints.co.nz
            </a>
          </div>
        </div>

        <div className="text-center mt-8 text-xs text-zinc-500">
          Bookmark this page to check your order status anytime.
        </div>
      </div>
    </div>
  );
}
