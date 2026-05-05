import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { ArrowLeft, Upload, Mail, Wand2, Lock } from "lucide-react";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

interface SavedConfig { materialSlug: string; config: any; quote: any; }

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface PaymentFormProps {
  orderToken: string;
  totalCents: number;
  onSuccess: () => void;
}

function PaymentForm({ orderToken, totalCents, onSuccess }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/print/order/${orderToken}`,
      },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message || "Payment failed. Try again.");
      setProcessing(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      onSuccess();
    } else {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full py-3.5 rounded-xl bg-zinc-900 text-white font-semibold hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
      >
        {processing ? "Processing..." : <><Lock className="w-4 h-4" /> Pay {money(totalCents)}</>}
      </button>
      <p className="text-[11px] text-center text-zinc-500">
        Secured by Stripe. Your card is never stored on our servers.
      </p>
    </form>
  );
}

export default function PrintCheckout() {
  const [, setLocation] = useLocation();
  const [saved, setSaved] = useState<SavedConfig | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("printOrderConfig");
    if (!raw) { setLocation("/print"); return; }
    try { setSaved(JSON.parse(raw)); } catch { setLocation("/print"); }
  }, [setLocation]);

  // Customer details
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [delivery, setDelivery] = useState<"pickup" | "delivery">("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [artworkPath, setArtworkPath] = useState<"upload_now" | "upload_later" | "design_help">("upload_later");

  // Order + payment intent state (loaded after "Continue to payment")
  const [orderToken, setOrderToken] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid = firstName.trim() && lastName.trim() && /\S+@\S+\.\S+/.test(email) && phone.trim() &&
    (delivery === "pickup" || deliveryAddress.trim());

  const proceedToPayment = async () => {
    if (!saved || !formValid) return;
    setCreating(true);
    setError(null);
    try {
      // 1. Create the order
      const orderRes = await fetch("/api/print/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialSlug: saved.materialSlug,
          config: saved.config,
          customer: { firstName, lastName, email, phone, company },
          delivery: { method: delivery, address: deliveryAddress },
          artworkPath,
          customerNotes: notes,
        }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) throw new Error(orderData.message || "Couldn't create order");

      // 2. Create the PaymentIntent
      const piRes = await fetch(`/api/print/orders/${orderData.magicLinkToken}/payment-intent`, { method: "POST" });
      const piData = await piRes.json();
      if (!piRes.ok) throw new Error(piData.message || "Couldn't start payment");

      setOrderToken(orderData.magicLinkToken);
      setOrderNumber(orderData.orderNumber);
      setClientSecret(piData.clientSecret);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handlePaymentSuccess = () => {
    sessionStorage.removeItem("printOrderConfig");
    sessionStorage.setItem("printOrderToken", orderToken!);
    setLocation(`/print/order/${orderToken}`);
  };

  if (!saved) return <div className="min-h-screen bg-white flex items-center justify-center text-zinc-500">Loading...</div>;
  const totals = saved.quote?.totals;
  const materialName = saved.quote?.material?.name ?? "Print order";

  // ── Once we have a clientSecret, render the Stripe Elements step ──────
  if (clientSecret && totals) {
    return (
      <div className="min-h-screen bg-white text-zinc-900">
        <header className="border-b border-zinc-200 bg-white sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="text-sm font-medium text-zinc-500">Order {orderNumber}</div>
            <a href="tel:0800800199" className="text-sm font-medium hover:text-zinc-600">0800 800 199</a>
          </div>
        </header>
        <div className="max-w-xl mx-auto px-6 py-12">
          <h1 className="text-3xl font-black tracking-tight mb-2">Pay {money(totals.totalCents)}</h1>
          <p className="text-zinc-500 mb-8">All in incl GST. Receipt + confirmation sent to {email}.</p>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: "stripe" },
            }}
          >
            <PaymentForm orderToken={orderToken!} totalCents={totals.totalCents} onSuccess={handlePaymentSuccess} />
          </Elements>
        </div>
      </div>
    );
  }

  // ── Otherwise show the customer details form ─────────────────────────
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={() => window.history.back()} className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <a href="tel:0800800199" className="text-sm font-medium hover:text-zinc-600">0800 800 199</a>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr,380px] gap-10">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight mb-8">Your details</h1>
          <section className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1.5">First name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5">Last name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none" />
              <div className="text-xs text-zinc-500 mt-1">We'll send your confirmation, receipt, and ready-for-pickup notice here.</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold mb-1.5">Mobile</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="022 ..." className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1.5">Company <span className="text-zinc-400 font-normal">(optional)</span></label>
                <input value={company} onChange={e => setCompany(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none" />
              </div>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-bold mb-3">Pickup or delivery</h2>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => setDelivery("pickup")} className={`p-4 rounded-xl border text-left transition ${delivery === "pickup" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"}`}>
                <div className="font-semibold text-sm">Pickup (free)</div>
                <div className={`text-xs mt-0.5 ${delivery === "pickup" ? "text-zinc-300" : "text-zinc-500"}`}>466 Yaldhurst Rd, Hornby</div>
              </button>
              <button onClick={() => setDelivery("delivery")} className={`p-4 rounded-xl border text-left transition ${delivery === "delivery" ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 hover:border-zinc-400"}`}>
                <div className="font-semibold text-sm">Delivery</div>
                <div className={`text-xs mt-0.5 ${delivery === "delivery" ? "text-zinc-300" : "text-zinc-500"}`}>Quoted separately</div>
              </button>
            </div>
            {delivery === "delivery" && (
              <textarea value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Delivery address — we'll come back with a delivery quote before charging." className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none min-h-[80px]" />
            )}
          </section>

          <section className="mt-10">
            <h2 className="text-lg font-bold mb-1">Artwork</h2>
            <p className="text-sm text-zinc-500 mb-4">Three options — pick whichever fits.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { id: "upload_later" as const, icon: Mail, title: "I'll upload after paying", sub: "Magic link emailed to you" },
                { id: "upload_now" as const, icon: Upload, title: "I have artwork ready", sub: "Upload after this step" },
                { id: "design_help" as const, icon: Wand2, title: "I need design help", sub: "+$80, credited to order" },
              ].map(opt => (
                <button key={opt.id} onClick={() => setArtworkPath(opt.id)} className={`p-4 rounded-xl border text-left transition ${artworkPath === opt.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-300"}`}>
                  <opt.icon className="w-4 h-4 mb-2 text-zinc-700" />
                  <div className="font-semibold text-sm">{opt.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <label className="block text-sm font-semibold mb-1.5">Anything we should know? <span className="text-zinc-400 font-normal">(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Specific colours, fonts, deadlines, or anything else..." className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none min-h-[80px]" />
          </section>

          {error && (
            <div className="mt-6 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Order summary</div>
            <div className="text-base font-bold mb-1">{materialName}</div>
            <div className="text-xs text-zinc-500 mb-4">
              {saved.config.quantity} × {saved.config.widthMm ? `${saved.config.widthMm} × ${saved.config.heightMm}mm` : ""}
              {saved.config.sides === 2 ? " · double-sided" : ""}
              {saved.config.rush ? " · rush" : ""}
            </div>
            {totals && (
              <div className="space-y-1.5 text-sm pt-4 border-t border-zinc-200">
                <div className="flex justify-between text-zinc-600">
                  <span>Subtotal</span>
                  <span className="font-mono">{money(totals.subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-zinc-600">
                  <span>GST 15%</span>
                  <span className="font-mono">{money(totals.gstCents)}</span>
                </div>
                <div className="flex justify-between font-bold text-base pt-2 border-t border-zinc-200 mt-2">
                  <span>Total</span>
                  <span className="font-mono">{money(totals.totalCents)}</span>
                </div>
              </div>
            )}
            <button onClick={proceedToPayment} disabled={!formValid || creating} className="w-full mt-6 py-3.5 rounded-xl bg-zinc-900 text-white font-semibold hover:bg-zinc-800 disabled:bg-zinc-300 disabled:cursor-not-allowed transition">
              {creating ? "Creating order..." : "Continue to payment →"}
            </button>
            <p className="text-[11px] text-zinc-500 mt-3 text-center">Secured by Stripe. Your card is never stored on our servers.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
