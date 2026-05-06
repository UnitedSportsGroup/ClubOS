import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { ArrowLeft, Lock, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface QuoteResponse {
  program: { name: string; slug: string; turnaroundDays?: number };
  term: { id: number; year: number; termNumber: number; name: string | null; startDate: string; endDate: string } | null;
  quote: {
    fullPriceCents: number;
    payNowCents: number;
    discountCents: number;
    sessionsRemaining: number;
    totalSessions: number;
    reason: string;
    model: string;
  };
}

interface IntentResponse {
  registrationId: number;
  clientSecret: string;
  paymentIntentId: string;
  quote: QuoteResponse["quote"];
  program: { name: string; slug: string };
  term: QuoteResponse["term"];
}

function PaymentForm({ slug, registrationId, totalCents, parentEmail }: {
  slug: string; registrationId: number; totalCents: number; parentEmail: string;
}) {
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

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/${slug}/success?registrationId=${registrationId}`,
        receipt_email: parentEmail,
      },
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message || "Payment failed. Try again.");
      setProcessing(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      setLocation(`/${slug}/success?registrationId=${registrationId}`);
    } else {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
      >
        {processing ? "Processing..." : <><Lock className="w-4 h-4" /> Pay {money(totalCents)}</>}
      </button>
      <p className="text-[11px] text-center text-zinc-500">Secured by Stripe. Your card is never stored on our servers.</p>
    </form>
  );
}

export default function ClassBookingPage() {
  const [, params] = useRoute("/:slug/class-book");
  const [, setLocation] = useLocation();
  const slug = params?.slug ?? "";

  // Step 1: details form, step 2: payment
  const [step, setStep] = useState<"details" | "payment">("details");

  // Live quote on the details page so the parent sees the price upfront
  const { data: quoteData, isLoading: quoteLoading } = useQuery<QuoteResponse>({
    queryKey: ["/api/public/program-quote", slug],
    queryFn: () => fetch(`/api/public/program-quote/${slug}`).then(r => {
      if (!r.ok) throw new Error("Program not found");
      return r.json();
    }),
    enabled: !!slug,
  });

  // Form state
  const [parentFirst, setParentFirst] = useState("");
  const [parentLast, setParentLast] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [childFirst, setChildFirst] = useState("");
  const [childLast, setChildLast] = useState("");
  const [childDob, setChildDob] = useState("");
  const [notes, setNotes] = useState("");

  // After clicking Continue we exchange the form for a PaymentIntent
  const [intent, setIntent] = useState<IntentResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formValid = parentFirst && parentLast && /\S+@\S+\.\S+/.test(parentEmail) && parentPhone &&
    childFirst && childLast;

  const proceedToPayment = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const sp = new URLSearchParams(window.location.search);
      const utm = {
        source: sp.get("utm_source"),
        medium: sp.get("utm_medium"),
        campaign: sp.get("utm_campaign"),
        content: sp.get("utm_content"),
        fbclid: sp.get("fbclid"),
        gclid: sp.get("gclid"),
      };
      const res = await fetch("/api/public/class-registrations/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programSlug: slug,
          parent: { firstName: parentFirst, lastName: parentLast, email: parentEmail, phone: parentPhone },
          child: { firstName: childFirst, lastName: childLast, dateOfBirth: childDob || null },
          notes,
          utm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Couldn't start payment");
      setIntent(data);
      setStep("payment");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (quoteLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Skeleton className="w-80 h-32 rounded-xl" />
      </div>
    );
  }

  if (!quoteData) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Class not found</h2>
          <button onClick={() => setLocation("/")} className="text-blue-600 underline">Go home</button>
        </div>
      </div>
    );
  }

  const { program, term, quote } = quoteData;
  const liveQuote = intent?.quote ?? quote;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => step === "payment" ? setStep("details") : setLocation(`/${slug}`)}
            className="flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft className="w-4 h-4" /> {step === "payment" ? "Back to details" : "Back"}
          </button>
          <div className="text-sm font-medium text-zinc-700">{program.name}</div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-8">
        <div>
          {step === "details" ? (
            <>
              <h1 className="text-3xl font-black tracking-tight mb-2">Register your child</h1>
              <p className="text-zinc-500 mb-8">
                {term ? `${term.name ?? `Term ${term.termNumber}`} ${term.year}` : "Term registration"} — pay only for the sessions remaining.
              </p>

              <section className="space-y-6">
                <div>
                  <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wider mb-3">Parent / guardian</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">First name</label>
                      <Input value={parentFirst} onChange={e => setParentFirst(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Last name</label>
                      <Input value={parentLast} onChange={e => setParentLast(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Email</label>
                      <Input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} placeholder="you@example.com" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Mobile</label>
                      <Input value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="022 ..." />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-bold text-zinc-700 uppercase tracking-wider mb-3">Your child</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">First name</label>
                      <Input value={childFirst} onChange={e => setChildFirst(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Last name</label>
                      <Input value={childLast} onChange={e => setChildLast(e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-zinc-600 mb-1">Date of birth (optional)</label>
                      <Input type="date" value={childDob} onChange={e => setChildDob(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1">Anything we should know? (optional)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Allergies, medical info, sensitivities, or anything that helps the coach..."
                    className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 focus:border-zinc-900 focus:outline-none min-h-[80px]"
                  />
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
                )}

                <Button
                  onClick={proceedToPayment}
                  disabled={!formValid || submitting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white text-base py-6 rounded-xl"
                >
                  {submitting ? "Loading payment..." : `Continue to payment — ${money(quote.payNowCents)}`}
                </Button>
              </section>
            </>
          ) : intent ? (
            <>
              <h1 className="text-3xl font-black tracking-tight mb-2">Pay {money(intent.quote.payNowCents)}</h1>
              <p className="text-zinc-500 mb-8">Receipt + confirmation will be sent to {parentEmail}.</p>
              <Elements stripe={stripePromise} options={{ clientSecret: intent.clientSecret, appearance: { theme: "stripe" } }}>
                <PaymentForm
                  slug={slug}
                  registrationId={intent.registrationId}
                  totalCents={intent.quote.payNowCents}
                  parentEmail={parentEmail}
                />
              </Elements>
            </>
          ) : null}
        </div>

        {/* Order summary rail */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">Your registration</div>
            <div className="font-bold text-zinc-900 mb-1">{program.name}</div>
            {term && (
              <div className="text-xs text-zinc-500 mb-3">
                {term.name ?? `Term ${term.termNumber}`} {term.year} · {term.startDate} → {term.endDate}
              </div>
            )}

            <div className="pt-3 border-t border-zinc-200 space-y-1.5 text-sm">
              {liveQuote.discountCents > 0 && (
                <>
                  <div className="flex justify-between text-zinc-600">
                    <span>Term price</span>
                    <span className="font-mono line-through">{money(liveQuote.fullPriceCents)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600">
                    <span>Pro-rated discount</span>
                    <span className="font-mono">−{money(liveQuote.discountCents)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t border-zinc-200 mt-2">
                <span>You pay today</span>
                <span className="font-mono">{money(liveQuote.payNowCents)}</span>
              </div>
              {liveQuote.discountCents > 0 && (
                <div className="text-[11px] text-emerald-700 pt-1">
                  {liveQuote.reason}
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-200 text-[11px] text-zinc-500 space-y-1">
              <div className="flex items-start gap-1.5">
                <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span>Pay only for sessions remaining in the term</span>
              </div>
              <div className="flex items-start gap-1.5">
                <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span>Confirmation email sent immediately</span>
              </div>
              <div className="flex items-start gap-1.5">
                <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0 mt-0.5" />
                <span>Card payments via Stripe</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
