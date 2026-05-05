import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Package, Phone, Mail } from "lucide-react";

interface OrderStatus {
  orderNumber: string;
  status: string;
  customerName: string;
  customerEmail: string;
  totalCents: number;
  pickupReadyDate: string | null;
  materialName: string;
  artworkPath: string;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_LABELS: Record<string, { label: string; description: string }> = {
  draft: { label: "Draft", description: "Working on your quote" },
  quote_sent: { label: "Awaiting payment", description: "Payment is the next step. We'll get cracking once that's through." },
  paid: { label: "Order received", description: "We've got your order — heading into design now." },
  artwork_pending: { label: "Awaiting artwork", description: "Send us your design via the link in your email." },
  in_design: { label: "In design", description: "Our team is preparing your file for print." },
  in_proof: { label: "Proof sent", description: "Check your email for a proof to approve." },
  proof_approved: { label: "Approved — heading to production", description: "" },
  in_production: { label: "In production", description: "On the press. Almost there." },
  finishing: { label: "Finishing", description: "Trimming, hemming, eyeleting." },
  ready: { label: "Ready for pickup", description: "Come grab it — 466 Yaldhurst Rd, Hornby." },
  delivered: { label: "Delivered", description: "Hope you love it." },
  cancelled: { label: "Cancelled", description: "" },
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

  const status = STATUS_LABELS[order.status] ?? { label: order.status, description: "" };

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => setLocation("/print")} className="flex items-center gap-2 text-sm font-medium hover:text-zinc-600">
            <Package className="w-4 h-4" /> United Prints
          </button>
          <a href="tel:0800800199" className="text-sm font-medium hover:text-zinc-600">0800 800 199</a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="text-center mb-10">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-2">
            Order #{order.orderNumber}
          </h1>
          <p className="text-zinc-500">Confirmation sent to {order.customerEmail}</p>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-6 mb-6">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Current status</div>
          <div className="text-2xl font-bold mb-1">{status.label}</div>
          {status.description && <p className="text-sm text-zinc-600">{status.description}</p>}
        </div>

        <div className="rounded-2xl border border-zinc-200 p-6 mb-6">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Order details</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-zinc-500">Product</div>
              <div className="font-semibold">{order.materialName}</div>
            </div>
            <div>
              <div className="text-zinc-500">Total</div>
              <div className="font-semibold">{money(order.totalCents)}</div>
            </div>
            <div>
              <div className="text-zinc-500">Customer</div>
              <div className="font-semibold">{order.customerName}</div>
            </div>
            {order.pickupReadyDate && (
              <div>
                <div className="text-zinc-500">Ready by</div>
                <div className="font-semibold">{order.pickupReadyDate}</div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 p-6 mb-6">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-3">What happens next</div>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</div>
              <div>
                <div className="font-semibold">Pay for your order</div>
                <div className="text-zinc-600">Stripe payment integration is being finalised. For now we'll email you a payment link within an hour.</div>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-700 text-xs font-bold flex items-center justify-center flex-shrink-0">2</div>
              <div>
                <div className="font-semibold">Send us your artwork</div>
                <div className="text-zinc-600">
                  {order.artworkPath === "design_help" ? "Our designer will be in touch to start the design." :
                    order.artworkPath === "upload_later" ? "Look out for a magic-link upload email shortly." :
                    "Reply to your confirmation email with your file attached."}
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-zinc-200 text-zinc-700 text-xs font-bold flex items-center justify-center flex-shrink-0">3</div>
              <div>
                <div className="font-semibold">We make it</div>
                <div className="text-zinc-600">Design → proof → production → ready. You'll get an email at every stage.</div>
              </div>
            </li>
          </ol>
        </div>

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
