// Shared bits for the CIC 2027 package pages on join.cicyouth.com: the brand,
// a fetch helper, and the embedded card form. Paid state is ALWAYS asked of our
// server, which asks Stripe — the browser saying "it worked" is not evidence.
import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";
import { brandFor } from "@shared/teampay";
import { Button, Card, Notice } from "../teampay/shell";

export const brand = brandFor("cic");
/** $1,700.00 — with the thousands comma (Team Pay's money() has none). */
export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : "$" + (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

export const API = "/api/public/cic/packages";

export async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 404) { const e: any = new Error("not_found"); e.notFound = true; throw e; }
  if (!r.ok) throw new Error(body?.message || "Something went wrong.");
  return body;
}

export const nzDate = (iso: string | null | undefined, withTime = false) =>
  iso ? new Date(iso).toLocaleString("en-NZ", {
    weekday: "short", day: "numeric", month: "long", timeZone: "Pacific/Auckland",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }) : "";

/** Card form for a payment the server has already created and priced. */
export function CardPay({ clientSecret, amountCents, confirmUrl, paymentId, onPaid, label }: {
  clientSecret: string; amountCents: number; confirmUrl: string; paymentId: number; onPaid: () => void; label?: string;
}) {
  if (!stripePromise) return <Notice brand={brand} tone="error">Card payments aren't switched on here. Email info@cicyouth.com.</Notice>;
  return (
    <Elements stripe={stripePromise} options={{
      clientSecret,
      appearance: {
        theme: "night",
        variables: {
          colorPrimary: brand.accent, colorBackground: brand.bg, colorText: brand.ink,
          colorTextPlaceholder: brand.mute, colorDanger: "#FF6961",
          fontFamily: "Inter, system-ui, sans-serif", borderRadius: "10px",
        },
      },
    }}>
      <PayForm amountCents={amountCents} confirmUrl={confirmUrl} paymentId={paymentId} onPaid={onPaid} label={label} />
    </Elements>
  );
}

function PayForm({ amountCents, confirmUrl, paymentId, onPaid, label }: {
  amountCents: number; confirmUrl: string; paymentId: number; onPaid: () => void; label?: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setError(null);
    const { error: err } = await stripe.confirmPayment({ elements, redirect: "if_required", confirmParams: { return_url: window.location.href } });
    if (err) { setError(err.message || "That card was declined. Try another one."); setBusy(false); return; }
    try {
      const r = await api(confirmUrl, { method: "POST", body: JSON.stringify({ paymentId }) });
      if (r.paid) onPaid();
      else setError("Your bank is still processing that. Give it a moment and refresh.");
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  return (
    <Card brand={brand} className="p-5 sm:p-6">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <div className="mt-4"><Notice brand={brand} tone="error">{error}</Notice></div>}
      <div className="mt-5">
        <Button brand={brand} onClick={submit} disabled={!stripe || busy} className="w-full">
          {busy ? <Loader2 size={17} className="mr-2 animate-spin" /> : <Lock size={15} className="mr-2" />}
          {label ?? "Pay"} {money(amountCents)}
        </Button>
      </div>
      <p className="mt-3 text-center text-[12px]" style={{ color: brand.mute }}>Card details go straight to Stripe. We never see or store them.</p>
    </Card>
  );
}

export function Row({ label, value, strong, sub }: { label: string; value: string; strong?: boolean; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="min-w-0 text-[14px]" style={{ color: strong ? brand.ink : brand.mute }}>
        {label}{sub && <span className="block text-[12px]" style={{ color: brand.mute }}>{sub}</span>}
      </span>
      <span className="shrink-0 tabular-nums" style={{ color: strong ? brand.accent : brand.ink, fontWeight: strong ? 700 : 500, fontSize: strong ? 18 : 14 }}>{value}</span>
    </div>
  );
}
