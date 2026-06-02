import { useEffect, useState, useMemo } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { initPixel, trackEvent, getFbp, getFbc, generateEventId } from "@/lib/meta-pixel";
import { ArrowLeft, ArrowRight, Loader2, Flame } from "lucide-react";

const BRAND = {
  black: "#000000", bg: "#0a0a0a", card: "#141414", cardSoft: "#1c1c1c", border: "#2a2a2a",
  gold: "#d1b96e", goldDeep: "#a8915a", white: "#ffffff",
  muted: "rgba(255,255,255,0.62)", dim: "rgba(255,255,255,0.38)",
};
const FONT = "'Inter Tight', Inter, system-ui, -apple-system, sans-serif";
const PIXEL_CONTENT = "MFL Term 3 Team Registration";

const inputCls = "w-full rounded-xl px-4 py-3 text-[15px] outline-none transition-colors";
const inputStyle: React.CSSProperties = { background: BRAND.cardSoft, border: `1px solid ${BRAND.border}`, color: BRAND.white };

export default function MflRegisterPage() {
  const [, params] = useRoute("/league/:slug/register");
  const slug = params?.slug || "";
  const [, setLocation] = useLocation();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [divisionId, setDivisionId] = useState<number | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedUpsells, setSelectedUpsells] = useState<string[]>([]);

  useEffect(() => {
    const pixelId = (import.meta as any).env?.VITE_META_PIXEL_ID;
    if (pixelId) {
      initPixel(pixelId);
      trackEvent("InitiateCheckout", { content_name: PIXEL_CONTENT, currency: "NZD" });
    }
  }, []);

  useEffect(() => {
    fetch(`/api/public/league/register/${slug}`)
      .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then((d) => {
        setData(d);
        const firstOpen = (d.divisions || []).find((x: any) => x.spotsLeft == null || x.spotsLeft > 0);
        if (firstOpen) setDivisionId(firstOpen.id);
      })
      .catch(() => setError("This league isn't available right now."))
      .finally(() => setLoading(false));
  }, [slug]);

  const division = useMemo(() => data?.divisions?.find((d: any) => d.id === divisionId) || null, [data, divisionId]);
  const upsellDefs: any[] = data?.upsells || [];

  const { subtotalCents, lateFeeCents, depositCents, balanceCents, isInstalment, isWeekly, weeklyAmountCents, weeksTotal } = useMemo(() => {
    const base = division?.teamCostCents || 0;
    let subtotal = base;
    for (const u of selectedUpsells) {
      const def = upsellDefs.find((x) => x.type === u);
      if (def) subtotal += def.priceCents;
    }
    const lateFee = data?.earlyBird && !data.earlyBird.active ? (data.earlyBird.lateFeeCents || 0) : 0;
    subtotal += lateFee;
    const hasDeposit = !!data?.depositCents && data.depositCents > 0 && subtotal > data.depositCents;
    const weekly = data?.paymentPlan === "deposit_weekly" && hasDeposit;
    const numWeeks = data?.numWeeklyPayments || 8;
    // Mirror the server: even weekly charge, deposit absorbs the remainder.
    const weeklyAmt = weekly ? Math.round((subtotal - data.depositCents) / numWeeks) : 0;
    const deposit = weekly ? subtotal - weeklyAmt * numWeeks : (hasDeposit ? data.depositCents : subtotal);
    return {
      subtotalCents: subtotal,
      lateFeeCents: lateFee,
      depositCents: deposit,
      balanceCents: subtotal - deposit,
      isInstalment: !weekly && subtotal > deposit,
      isWeekly: weekly,
      weeklyAmountCents: weeklyAmt,
      weeksTotal: numWeeks,
    };
  }, [division, selectedUpsells, data, upsellDefs]);

  const toggleUpsell = (type: string) =>
    setSelectedUpsells((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!divisionId || !teamName || !firstName || !email) {
      setError("Please fill in your team name, night, and contact details.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const url = new URL(window.location.href);
    const leadEventId = generateEventId();
    // Client-side Lead (deduped server-side by the same eventId).
    trackEvent("Lead", { content_name: PIXEL_CONTENT, value: subtotalCents / 100, currency: "NZD" }, leadEventId);

    try {
      const res = await fetch("/api/public/league/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          teamName,
          divisionId,
          upsells: selectedUpsells,
          captain: { firstName, lastName, email, phone },
          utmSource: url.searchParams.get("utm_source"),
          utmMedium: url.searchParams.get("utm_medium"),
          utmCampaign: url.searchParams.get("utm_campaign"),
          fbclid: url.searchParams.get("fbclid"),
          fbp: getFbp(),
          fbc: getFbc(),
          userAgent: navigator.userAgent,
          leadEventId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Registration failed");
      setLocation(`/league/${slug}/checkout?registrationId=${body.registrationId}`);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.black }}><Skeleton className="h-80 w-96 rounded-2xl" style={{ background: BRAND.card }} /></div>;
  }
  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
        <div><p style={{ color: BRAND.muted }}>{error}</p><Link href="/league"><a className="mt-3 inline-block font-semibold" style={{ color: BRAND.gold }}>See all leagues</a></Link></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
      <header className="border-b sticky top-0 z-20" style={{ borderColor: BRAND.border, background: "rgba(0,0,0,0.9)" }}>
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href={`/league/${slug}`}>
            <a className="flex items-center gap-2 text-sm" style={{ color: BRAND.muted }}><ArrowLeft className="w-4 h-4" /> Back</a>
          </Link>
          <span className="text-sm" style={{ color: BRAND.dim }}>{data?.program?.name}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Register your team</h1>
        <p className="mt-1.5" style={{ color: BRAND.muted }}>Lock your spot for Term 3 in under two minutes.</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          {/* Team name */}
          <div>
            <label className="block text-sm font-semibold mb-2">Team name</label>
            <input className={inputCls} style={inputStyle} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. The Untouchaballs" data-testid="input-team-name" />
          </div>

          {/* Night / division */}
          <div>
            <label className="block text-sm font-semibold mb-2">Pick your night</label>
            <div className="grid sm:grid-cols-2 gap-3">
              {(data?.divisions || []).map((d: any) => {
                const full = d.spotsLeft != null && d.spotsLeft <= 0;
                const active = divisionId === d.id;
                return (
                  <button type="button" key={d.id} disabled={full} onClick={() => setDivisionId(d.id)}
                    className="rounded-xl px-4 py-3 text-left transition-all"
                    style={{ background: active ? `${BRAND.gold}1f` : BRAND.cardSoft, border: `1px solid ${active ? BRAND.gold : BRAND.border}`, opacity: full ? 0.45 : 1 }}
                    data-testid={`division-${d.id}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{d.name}</span>
                      <span className="text-sm font-bold" style={{ color: BRAND.gold }}>{formatCurrency(d.teamCostCents, { fromCents: true })}</span>
                    </div>
                    <span className="text-[12px]" style={{ color: BRAND.muted }}>{d.dayOfWeek || "Weeknights"}{full ? " · full" : d.spotsLeft != null ? ` · ${d.spotsLeft} left` : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Captain details */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-2">First name</label>
              <input className={inputCls} style={inputStyle} value={firstName} onChange={(e) => setFirstName(e.target.value)} data-testid="input-first-name" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Last name</label>
              <input className={inputCls} style={inputStyle} value={lastName} onChange={(e) => setLastName(e.target.value)} data-testid="input-last-name" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Email</label>
              <input type="email" className={inputCls} style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Mobile</label>
              <input className={inputCls} style={inputStyle} value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-phone" />
            </div>
          </div>

          {/* Upsells */}
          {upsellDefs.length > 0 && (
            <div>
              <label className="block text-sm font-semibold mb-2">Add-ons (optional)</label>
              <div className="space-y-2.5">
                {upsellDefs.map((u) => {
                  const on = selectedUpsells.includes(u.type);
                  return (
                    <button type="button" key={u.type} onClick={() => toggleUpsell(u.type)}
                      className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all"
                      style={{ background: on ? `${BRAND.gold}1a` : BRAND.cardSoft, border: `1px solid ${on ? BRAND.gold : BRAND.border}` }}
                      data-testid={`upsell-${u.type}`}>
                      <span className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ border: `1px solid ${on ? BRAND.gold : BRAND.border}`, background: on ? BRAND.gold : "transparent", color: BRAND.black }}>
                        {on ? "✓" : ""}
                      </span>
                      <span className="flex-1 text-[15px]">{u.label}</span>
                      <span className="font-bold" style={{ color: BRAND.gold }}>+{formatCurrency(u.priceCents, { fromCents: true })}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="rounded-2xl p-5 space-y-2.5" style={{ background: BRAND.card, border: `1px solid ${BRAND.border}` }}>
            <div className="flex justify-between text-sm"><span style={{ color: BRAND.muted }}>Team entry{division ? ` (${division.name})` : ""}</span><span>{formatCurrency(division?.teamCostCents || 0, { fromCents: true })}</span></div>
            {selectedUpsells.map((t) => {
              const def = upsellDefs.find((x) => x.type === t);
              return def ? <div key={t} className="flex justify-between text-sm"><span style={{ color: BRAND.muted }}>{def.label}</span><span>{formatCurrency(def.priceCents, { fromCents: true })}</span></div> : null;
            })}
            {lateFeeCents > 0 && (
              <div className="flex justify-between text-sm" style={{ color: BRAND.gold }}>
                <span className="flex items-center gap-1"><Flame className="w-3.5 h-3.5" /> Late registration fee</span><span>{formatCurrency(lateFeeCents, { fromCents: true })}</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-2.5 border-t" style={{ borderColor: BRAND.border }}>
              <span>Total (incl. GST)</span><span>{formatCurrency(subtotalCents, { fromCents: true })} NZD</span>
            </div>
            {isWeekly && (
              <div className="rounded-xl px-4 py-3 mt-1 text-[13px]" style={{ background: `${BRAND.gold}14`, color: BRAND.gold }}>
                Pay <strong>{formatCurrency(depositCents, { fromCents: true })}</strong> deposit now to lock your spot · then <strong>{formatCurrency(weeklyAmountCents, { fromCents: true })}/week</strong> for {weeksTotal} weeks once the season starts. Your deposit covers the final weeks.
              </div>
            )}
            {isInstalment && (
              <div className="rounded-xl px-4 py-3 mt-1 text-[13px]" style={{ background: `${BRAND.gold}14`, color: BRAND.gold }}>
                Pay <strong>{formatCurrency(depositCents, { fromCents: true })}</strong> deposit now to lock your spot · {formatCurrency(balanceCents, { fromCents: true })} balance auto-charged ~3 weeks in.
              </div>
            )}
          </div>

          {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(220,38,38,0.12)", color: "#fca5a5", border: "1px solid rgba(220,38,38,0.3)" }}>{error}</div>}

          <button type="submit" disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-full font-bold text-[16px] disabled:opacity-60"
            style={{ background: BRAND.gold, color: BRAND.black }} data-testid="button-continue-to-payment">
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Securing your spot…</> : <>Continue to payment <ArrowRight className="w-4 h-4" /></>}
          </button>
          <p className="text-center text-[12px]" style={{ color: BRAND.dim }}>Secure payment by Stripe · You'll confirm on the next step</p>
        </form>
      </main>
    </div>
  );
}
