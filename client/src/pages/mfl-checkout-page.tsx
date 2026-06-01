import { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Lock, ShieldCheck, Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/meta-pixel";
import { formatCurrency } from "@/lib/format";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

const BRAND = {
  black: "#000000", bg: "#0a0a0a", card: "#141414", cardSoft: "#1c1c1c", border: "#2a2a2a",
  gold: "#d1b96e", goldDeep: "#a8915a", white: "#ffffff",
  muted: "rgba(255,255,255,0.62)", dim: "rgba(255,255,255,0.38)",
};
const FONT = "'Inter Tight', Inter, system-ui, -apple-system, sans-serif";
const PIXEL_CONTENT = "MFL Term 3 Team Registration";

// Used both for the deposit checkout (?registrationId) and the manual balance
// page (/league/balance/:registrationId) by passing a different `mode`.
interface CheckoutData {
  clientSecret: string;
  registrationId: number;
  teamName: string;
  programName: string;
  slug: string;
  subtotalCents: number;
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  balanceDueDate: string | null;
  isInstalment: boolean;
  amountDueNowCents: number;
  currency: string;
  captainName: string;
  captainEmail: string;
  items: { label: string; priceCents: number; productType: string }[];
}

function PaymentForm({ data, slug, mode }: { data: CheckoutData; slug: string; mode: "deposit" | "balance" }) {
  const stripe = useStripe();
  const elements = useElements();
  const [, setLocation] = useLocation();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);

    const { protocol, host } = window.location;
    const successUrl = mode === "deposit"
      ? `${protocol}//${host}/league/${slug}/success?registrationId=${data.registrationId}`
      : `${protocol}//${host}/league/${data.slug || slug}/success?registrationId=${data.registrationId}`;

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: successUrl, receipt_email: data.captainEmail },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message || "Payment failed. Please try again.");
      setProcessing(false);
      return;
    }

    if (paymentIntent) {
      if (paymentIntent.status === "succeeded") {
        try {
          await fetch("/api/public/confirm-payment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ registrationId: data.registrationId, paymentIntentId: paymentIntent.id }),
          });
        } catch {}
        // Deterministic eventId → dedupe with the server CAPI Purchase.
        if (mode === "deposit") {
          trackEvent("Purchase", {
            content_name: PIXEL_CONTENT,
            content_category: "League Team Registration",
            value: data.amountDueNowCents / 100,
            currency: data.currency,
            content_ids: [slug],
          }, `mfl_purchase_${data.registrationId}`);
        }
        setLocation(`/league/${data.slug || slug}/success?registrationId=${data.registrationId}`);
      } else if (paymentIntent.status === "processing") {
        setLocation(`/league/${data.slug || slug}/success?registrationId=${data.registrationId}`);
      } else if (paymentIntent.status === "requires_action") {
        setError("Additional authentication required. Please complete verification.");
        setProcessing(false);
      } else {
        setError("Payment could not be processed. Please try another card.");
        setProcessing(false);
      }
    }
  };

  const dueCents = mode === "deposit" ? data.amountDueNowCents : data.amountDueNowCents;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-2xl p-6" style={{ background: BRAND.card, border: `1px solid ${BRAND.border}` }}>
        <PaymentElement options={{ layout: "tabs", defaultValues: { billingDetails: { email: data.captainEmail, name: data.captainName } } }} />
      </div>

      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(220,38,38,0.12)", color: "#fca5a5", border: "1px solid rgba(220,38,38,0.3)" }}>{error}</div>}

      <button type="submit" disabled={!stripe || processing}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-full font-bold text-[16px] disabled:opacity-60"
        style={{ background: BRAND.gold, color: BRAND.black }} data-testid="button-pay">
        {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</> : <><Lock className="w-4 h-4" /> Pay {formatCurrency(dueCents, { fromCents: true })} NZD</>}
      </button>

      <div className="flex items-center justify-center gap-5 text-[12px]" style={{ color: BRAND.dim }}>
        <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> SSL encrypted</span>
        <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Stripe secure</span>
      </div>
    </form>
  );
}

export default function MflCheckoutPage({ mode = "deposit" }: { mode?: "deposit" | "balance" }) {
  const [, depositParams] = useRoute("/league/:slug/checkout");
  const [, balanceParams] = useRoute("/league/balance/:registrationId");
  const slug = depositParams?.slug || "";
  const [data, setData] = useState<CheckoutData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "balance") {
      const registrationId = balanceParams?.registrationId;
      if (!registrationId) { setError("Missing registration"); setLoading(false); return; }
      fetch("/api/public/league/balance-intent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registrationId: parseInt(registrationId) }),
      })
        .then((r) => { if (!r.ok) return r.json().then((b) => { throw new Error(b.message); }); return r.json(); })
        .then((b) => setData({
          clientSecret: b.clientSecret, registrationId: b.registrationId, teamName: b.teamName,
          programName: "Mini Football Leagues", slug: b.slug || "", subtotalCents: b.amountCents, totalCents: b.amountCents,
          depositCents: 0, balanceCents: 0, balanceDueDate: null, isInstalment: false,
          amountDueNowCents: b.amountCents, currency: b.currency, captainName: "", captainEmail: "",
          items: [{ label: "Balance payment", priceCents: b.amountCents, productType: "balance" }],
        }))
        .catch((e) => setError(e.message || "Could not load balance"))
        .finally(() => setLoading(false));
      return;
    }

    const registrationId = new URLSearchParams(window.location.search).get("registrationId");
    if (!registrationId) { setError("Missing registration"); setLoading(false); return; }
    fetch(`/api/public/league/checkout/${registrationId}`)
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message || "Could not load checkout"); return b; })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [mode, slug]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.black }}><Skeleton className="h-96 w-[28rem] rounded-2xl" style={{ background: BRAND.card }} /></div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
        <div><p style={{ color: BRAND.muted }}>{error || "Unable to load checkout"}</p><Link href={`/league/${slug}/register`}><a className="mt-3 inline-block font-semibold" style={{ color: BRAND.gold }}>Back to registration</a></Link></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
      <header className="border-b sticky top-0 z-20" style={{ borderColor: BRAND.border, background: "rgba(0,0,0,0.9)" }}>
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          {mode === "deposit" ? (
            <Link href={`/league/${slug}/register`}><a className="flex items-center gap-2 text-sm" style={{ color: BRAND.muted }}><ArrowLeft className="w-4 h-4" /> Back</a></Link>
          ) : <span className="text-sm" style={{ color: BRAND.muted }}>Pay your balance</span>}
          <span className="text-sm flex items-center gap-1.5" style={{ color: BRAND.dim }}><Lock className="w-3.5 h-3.5" /> Secure checkout</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{mode === "deposit" ? "Secure your spot" : "Pay your balance"}</h1>
        <p className="mt-1.5" style={{ color: BRAND.muted }}>{data.teamName ? `${data.teamName} · ${data.programName}` : data.programName}</p>

        {/* Order summary */}
        <div className="rounded-2xl p-5 mt-6 space-y-2.5" style={{ background: BRAND.card, border: `1px solid ${BRAND.border}` }}>
          {data.items.map((it, i) => (
            <div key={i} className="flex justify-between text-sm"><span style={{ color: BRAND.muted }}>{it.label}</span><span>{formatCurrency(it.priceCents || 0, { fromCents: true })}</span></div>
          ))}
          <div className="flex justify-between font-bold pt-2.5 border-t" style={{ borderColor: BRAND.border }}>
            <span>{mode === "deposit" && data.isInstalment ? "Due today (deposit)" : "Total (incl. GST)"}</span>
            <span style={{ color: BRAND.gold }}>{formatCurrency(data.amountDueNowCents, { fromCents: true })} NZD</span>
          </div>
          {mode === "deposit" && data.isInstalment && (
            <p className="text-[12px]" style={{ color: BRAND.dim }}>
              {formatCurrency(data.balanceCents, { fromCents: true })} balance auto-charged{data.balanceDueDate ? ` on ${new Date(data.balanceDueDate + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "long" })}` : " ~3 weeks in"}.
            </p>
          )}
        </div>

        <div className="mt-6">
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: data.clientSecret,
              appearance: {
                theme: "night",
                variables: {
                  colorPrimary: BRAND.gold,
                  colorBackground: BRAND.cardSoft,
                  colorText: BRAND.white,
                  colorDanger: "#ef4444",
                  fontFamily: "Inter Tight, system-ui, sans-serif",
                  spacingUnit: "4px",
                  borderRadius: "12px",
                  fontSizeBase: "15px",
                },
                rules: {
                  ".Input": { border: `1px solid ${BRAND.border}`, backgroundColor: BRAND.bg },
                  ".Tab": { border: `1px solid ${BRAND.border}` },
                  ".Tab--selected": { border: `1px solid ${BRAND.gold}` },
                },
              },
            }}
          >
            <PaymentForm data={data} slug={slug} mode={mode} />
          </Elements>
        </div>
      </main>
    </div>
  );
}
