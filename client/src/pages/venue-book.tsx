import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Calendar as CalendarIcon, Clock, MapPin, Plus, Trash2, ArrowLeft, ArrowRight,
  CheckCircle2, Lightbulb, Users, ShoppingCart, Loader2, Lock, ChevronLeft, ChevronRight,
} from "lucide-react";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

type FacilityType = "field" | "mini_pitch" | "meeting_room" | "changing_room" | "futsal" | "court" | "other";

interface PricingRule {
  id: number;
  facilityId: number;
  name: string;
  dayOfWeek: number | null;
  startTime: string | null;
  endTime: string | null;
  pricePerHour: string;
  isDefault: boolean | null;
}

interface Addon {
  id: number;
  name: string;
  description: string | null;
  price: string;
  unit: string;
  appliesToAll: boolean | null;
  active: boolean;
}

interface PublicFacility {
  id: number;
  organizationId: number;
  name: string;
  type: FacilityType;
  description: string | null;
  imageUrl: string | null;
  halfFull: boolean | null;
  floodlights: boolean | null;
  bufferMinutes: number | null;
  pricePerHourCents: number | null;
  halfFieldPricePerHourCents: number | null;
  pricingRules: PricingRule[];
  addons: Addon[];
}

interface VenueSettings {
  id: number;
  organizationId: number;
  siteTitle: string;
  introText: string | null;
  brandColor: string | null;
  openingTime: string;
  closingTime: string;
  slotMinutes: number;
  minDurationMinutes: number;
  advanceBookingDays: number;
  gstRatePercent: string;
  contactEmail: string | null;
  contactPhone: string | null;
  footerText: string | null;
  paymentPolicy: string | null;
  successMessage: string | null;
}

interface ResolveResp {
  organization: { id: number; name: string; slug: string; logoUrl: string | null };
  settings: VenueSettings;
}

interface AvailabilitySlot {
  date: string;
  startTime: string;
  endTime: string;
  halfFull: string | null;
  status: string;
}

interface CartItem {
  id: string;
  facility: PublicFacility;
  date: string;
  startTime: string;
  endTime: string;
  halfFull: "half" | "full" | null;
  addons: { addonId: number; qty: number }[];
}

interface QuoteLine {
  facilityId: number;
  facilityName: string;
  date: string;
  startTime: string;
  endTime: string;
  halfFull: string | null;
  hours: number;
  baseCents: number;
  addons: { addonId: number; name: string; unit: string; qty: number; priceCents: number }[];
  totalCents: number;
}
interface Quote {
  lineItems: QuoteLine[];
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  gstRate: number;
}

const FACILITY_TYPE_LABELS: Record<FacilityType, string> = {
  field: "Field", mini_pitch: "Mini Pitch", meeting_room: "Meeting Room",
  changing_room: "Changing Room", futsal: "Futsal", court: "Court", other: "Other",
};

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function getOrgSlug(): string | undefined {
  const url = new URL(window.location.href);
  const slug = url.searchParams.get("slug");
  if (slug) return slug;
  // In dev, fall back to USC slug so /book works directly
  const host = window.location.hostname;
  if (host === "localhost" || host.endsWith(".replit.dev") || host.endsWith(".repl.co") || host.endsWith(".replit.app")) {
    return "united-sports-centre";
  }
  return undefined;
}

function fmtDateLong(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function genTimeSlots(opening: string, closing: string, slotMin: number): string[] {
  const [oh, om] = opening.split(":").map(Number);
  const [ch, cm] = closing.split(":").map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  const out: string[] = [];
  for (let t = start; t <= end; t += slotMin) {
    const h = Math.floor(t / 60), m = t % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return out;
}

// ============ MAIN PAGE ============
export default function VenueBookPage() {
  const slug = getOrgSlug();
  const [resolved, setResolved] = useState<ResolveResp | null>(null);
  const [loadingResolve, setLoadingResolve] = useState(true);
  const [errResolve, setErrResolve] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const url = slug ? `/api/public/venue/resolve?slug=${encodeURIComponent(slug)}` : `/api/public/venue/resolve`;
        const r = await fetch(url);
        if (!r.ok) throw new Error((await r.json()).message || "Venue not found");
        setResolved(await r.json());
      } catch (e: any) {
        setErrResolve(e.message);
      } finally {
        setLoadingResolve(false);
      }
    })();
  }, [slug]);

  if (loadingResolve) {
    return <FullPageLoader label="Loading booking site…" />;
  }
  if (errResolve || !resolved) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold mb-2">Venue not found</h1>
          <p className="text-white/60 text-sm">{errResolve || "We couldn't find this booking site."}</p>
        </div>
      </div>
    );
  }
  return <BookingFlow resolved={resolved} />;
}

function FullPageLoader({ label }: { label: string }) {
  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-white/60" />
        <p className="text-white/60 text-sm">{label}</p>
      </div>
    </div>
  );
}

// ============ BOOKING FLOW ============
type Step = "items" | "review" | "details" | "payment";

function BookingFlow({ resolved }: { resolved: ResolveResp }) {
  const { organization, settings } = resolved;
  const brand = settings.brandColor || "#6366f1";
  const [step, setStep] = useState<Step>("items");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  const [facilities, setFacilities] = useState<PublicFacility[] | null>(null);
  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/public/venue/${organization.id}/facilities`);
      if (r.ok) setFacilities(await r.json());
    })();
  }, [organization.id]);

  // Recompute quote whenever cart changes
  useEffect(() => {
    if (cart.length === 0) { setQuote(null); return; }
    setLoadingQuote(true);
    (async () => {
      try {
        const r = await fetch(`/api/public/venue/${organization.id}/bookings/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.map(c => ({
              facilityId: c.facility.id,
              date: c.date,
              startTime: c.startTime,
              endTime: c.endTime,
              halfFull: c.halfFull,
              addons: c.addons,
            })),
          }),
        });
        if (r.ok) setQuote(await r.json());
      } finally {
        setLoadingQuote(false);
      }
    })();
  }, [cart, organization.id]);

  const removeFromCart = (id: string) => setCart(prev => prev.filter(c => c.id !== id));

  const [customer, setCustomer] = useState({ name: "", email: "", phone: "", club: "", notes: "" });
  const [checkout, setCheckout] = useState<{ clientSecret: string; bookingGroupId: string; quote: Quote } | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

  const startCheckout = async () => {
    setCheckingOut(true);
    setCheckoutErr(null);
    try {
      const r = await fetch(`/api/public/venue/${organization.id}/bookings/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer,
          items: cart.map(c => ({
            facilityId: c.facility.id,
            date: c.date,
            startTime: c.startTime,
            endTime: c.endTime,
            halfFull: c.halfFull,
            addons: c.addons,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Checkout failed");
      // Use the server-returned quote so the displayed total is guaranteed to match the Stripe PI amount
      setCheckout({ clientSecret: data.clientSecret, bookingGroupId: data.bookingGroupId, quote: data.quote });
      // Stash the email so the success page can authenticate its read of the booking group
      try {
        sessionStorage.setItem(`vbg:${data.bookingGroupId}`, customer.email);
      } catch {}
      setStep("payment");
    } catch (e: any) {
      setCheckoutErr(e.message);
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="min-h-screen text-white" style={{ background: "linear-gradient(180deg, #0a0e1a 0%, #050810 100%)" }}>
      {/* Header */}
      <header className="border-b border-white/[0.06] backdrop-blur-xl sticky top-0 z-30" style={{ background: "rgba(10,14,26,0.85)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          {organization.logoUrl ? (
            <img src={organization.logoUrl} alt={organization.name} className="h-8 w-auto" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: brand }}>
              <MapPin className="w-4 h-4 text-white" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate" data-testid="text-site-title">{settings.siteTitle}</div>
            <div className="text-[11px] text-white/40 truncate">{organization.name}</div>
          </div>
          {settings.contactPhone && (
            <a href={`tel:${settings.contactPhone}`} className="hidden sm:flex text-xs text-white/60 hover:text-white">
              {settings.contactPhone}
            </a>
          )}
        </div>
        <Stepper step={step} brand={brand} />
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div>
          {step === "items" && (
            <AddItemsStep
              facilities={facilities}
              settings={settings}
              brand={brand}
              cart={cart}
              setCart={setCart}
            />
          )}
          {step === "review" && (
            <ReviewStep cart={cart} setCart={setCart} brand={brand} onBack={() => setStep("items")} onNext={() => setStep("details")} />
          )}
          {step === "details" && (
            <DetailsStep
              customer={customer}
              setCustomer={setCustomer}
              brand={brand}
              onBack={() => setStep("review")}
              onSubmit={startCheckout}
              loading={checkingOut}
              error={checkoutErr}
            />
          )}
          {step === "payment" && checkout && (
            <Elements stripe={stripePromise} options={{ clientSecret: checkout.clientSecret, appearance: { theme: "night" } }}>
              <PaymentStep
                bookingGroupId={checkout.bookingGroupId}
                customer={customer}
                quote={checkout.quote}
                brand={brand}
                onBack={async () => {
                  // Release the held slots so the user can change details and resubmit without conflict.
                  // The endpoint requires the customer email (proof-of-ownership of the group id).
                  try {
                    await fetch(`/api/public/venue/booking-group/${checkout.bookingGroupId}/cancel-pending`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ email: customer.email }),
                    });
                  } catch {}
                  setCheckout(null);
                  setStep("details");
                }}
              />
            </Elements>
          )}
        </div>

        {/* Cart sidebar */}
        <aside className="order-first lg:order-last">
          <CartSummary
            cart={cart}
            quote={quote}
            loadingQuote={loadingQuote}
            brand={brand}
            onRemove={removeFromCart}
            step={step}
            onContinue={() => {
              if (step === "items") setStep("review");
              else if (step === "review") setStep("details");
            }}
          />
        </aside>
      </main>

      {settings.footerText && (
        <footer className="border-t border-white/[0.06] mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 text-xs text-white/40 whitespace-pre-wrap">{settings.footerText}</div>
        </footer>
      )}
    </div>
  );
}

function Stepper({ step, brand }: { step: Step; brand: string }) {
  const steps: { k: Step; label: string }[] = [
    { k: "items", label: "Add Items" },
    { k: "review", label: "Review Cart" },
    { k: "details", label: "Your Details" },
    { k: "payment", label: "Payment" },
  ];
  const idx = steps.findIndex(s => s.k === step);
  return (
    <div className="border-t border-white/[0.04]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2 overflow-x-auto">
        {steps.map((s, i) => {
          const active = i === idx, done = i < idx;
          return (
            <div key={s.k} className="flex items-center gap-2 shrink-0" data-testid={`step-${s.k}`}>
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{
                  background: done || active ? brand : "rgba(255,255,255,0.06)",
                  color: done || active ? "white" : "rgba(255,255,255,0.4)",
                }}>
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <div className={`text-xs ${active ? "text-white" : "text-white/40"}`}>{s.label}</div>
              {i < steps.length - 1 && <div className="w-6 h-px bg-white/10 mx-1" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============ STEP 1 — Add Items ============
function AddItemsStep({
  facilities, settings, brand, cart, setCart,
}: {
  facilities: PublicFacility[] | null;
  settings: VenueSettings;
  brand: string;
  cart: CartItem[];
  setCart: (fn: (prev: CartItem[]) => CartItem[]) => void;
}) {
  const [selectedFacility, setSelectedFacility] = useState<PublicFacility | null>(null);
  return (
    <div>
      {settings.introText && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 mb-5">
          <p className="text-sm text-white/70 whitespace-pre-wrap">{settings.introText}</p>
        </div>
      )}
      {!facilities ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : facilities.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] p-12 text-center text-white/50">
          No facilities available right now.
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold mb-3">Choose a facility</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {facilities.map(f => (
              <button
                key={f.id}
                onClick={() => setSelectedFacility(f)}
                data-testid={`button-facility-${f.id}`}
                className="text-left rounded-2xl border p-4 transition hover-elevate active-elevate-2"
                style={{
                  borderColor: selectedFacility?.id === f.id ? brand : "rgba(255,255,255,0.08)",
                  background: selectedFacility?.id === f.id ? `${brand}15` : "rgba(255,255,255,0.02)",
                }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-semibold">{f.name}</div>
                    <div className="text-[11px] text-white/40 mt-0.5">{FACILITY_TYPE_LABELS[f.type]}</div>
                  </div>
                  <div className="flex gap-1">
                    {f.floodlights && <Lightbulb className="w-3.5 h-3.5 text-yellow-400/70" />}
                    {f.halfFull && <Users className="w-3.5 h-3.5 text-blue-400/70" />}
                  </div>
                </div>
                {f.description && <p className="text-xs text-white/50 line-clamp-2">{f.description}</p>}
                <div className="text-xs text-white/60 mt-2">
                  From {f.pricingRules.length > 0
                    ? `$${parseFloat(f.pricingRules[0].pricePerHour).toFixed(2)}/hr`
                    : f.pricePerHourCents
                      ? `$${(f.pricePerHourCents / 100).toFixed(2)}/hr`
                      : "—"}
                </div>
              </button>
            ))}
          </div>

          {selectedFacility && (
            <ConfigureFacility
              facility={selectedFacility}
              settings={settings}
              brand={brand}
              onAdd={(items) => setCart(prev => [...prev, ...items])}
              cart={cart}
            />
          )}
        </>
      )}
    </div>
  );
}

function ConfigureFacility({
  facility, settings, brand, onAdd, cart,
}: {
  facility: PublicFacility;
  settings: VenueSettings;
  brand: string;
  onAdd: (items: CartItem[]) => void;
  cart: CartItem[];
}) {
  const slots = useMemo(
    () => genTimeSlots(settings.openingTime, settings.closingTime, settings.slotMinutes),
    [settings.openingTime, settings.closingTime, settings.slotMinutes],
  );
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState(slots[Math.floor(slots.length / 2)] || "17:00");
  const [duration, setDuration] = useState(60); // minutes
  const [halfFull, setHalfFull] = useState<"half" | "full">(facility.halfFull ? "half" : "full");
  const [selectedAddons, setSelectedAddons] = useState<Record<number, number>>({});
  const [multiDay, setMultiDay] = useState(false);
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [busy, setBusy] = useState<AvailabilitySlot[]>([]);

  // Compute end time
  const endTime = useMemo(() => {
    const [h, m] = startTime.split(":").map(Number);
    const total = h * 60 + m + duration;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }, [startTime, duration]);

  const allDates = useMemo(() => Array.from(new Set([date, ...extraDates])), [date, extraDates]);

  // Fetch availability whenever facility/dates change
  useEffect(() => {
    if (allDates.length === 0) return;
    (async () => {
      const r = await fetch(`/api/public/venue/${facility.organizationId}/availability?facilityId=${facility.id}&dates=${allDates.join(",")}`);
      if (r.ok) setBusy(await r.json());
    })();
  }, [facility.id, facility.organizationId, allDates.join(",")]);

  const cartConflicts = (d: string, s: string, e: string) =>
    cart.some(c => c.facility.id === facility.id && c.date === d && c.startTime < e && c.endTime > s);

  const isSlotConflicted = (d: string, s: string, e: string) =>
    busy.some(b => b.date === d && b.startTime < e && b.endTime > s) || cartConflicts(d, s, e);

  const conflictDates = allDates.filter(d => isSlotConflicted(d, startTime, endTime));
  const validDates = allDates.filter(d => !isSlotConflicted(d, startTime, endTime));

  const handleAdd = () => {
    const items: CartItem[] = validDates.map(d => ({
      id: `${facility.id}-${d}-${startTime}-${Math.random().toString(36).slice(2, 8)}`,
      facility,
      date: d,
      startTime,
      endTime,
      halfFull: facility.halfFull ? halfFull : null,
      addons: Object.entries(selectedAddons).filter(([, q]) => q > 0).map(([id, q]) => ({ addonId: parseInt(id), qty: q })),
    }));
    if (items.length > 0) onAdd(items);
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        Configure: {facility.name}
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <Label className="text-xs text-white/60 mb-1.5 block">Date</Label>
          <Input
            type="date"
            value={date}
            min={todayISO()}
            max={addDays(todayISO(), settings.advanceBookingDays)}
            onChange={e => setDate(e.target.value)}
            data-testid="input-date"
            className="bg-white/[0.04] border-white/10 text-white"
          />
        </div>
        <div>
          <Label className="text-xs text-white/60 mb-1.5 block">Start time</Label>
          <select
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            data-testid="select-start-time"
            className="w-full h-10 rounded-md bg-white/[0.04] border border-white/10 px-3 text-sm"
          >
            {slots.map(s => <option key={s} value={s}>{fmtTime(s)}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <Label className="text-xs text-white/60 mb-1.5 block">Duration</Label>
        <div className="flex flex-wrap gap-2">
          {[settings.minDurationMinutes, 90, 120, 180].filter((v, i, a) => a.indexOf(v) === i).map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              data-testid={`button-duration-${d}`}
              className="px-3 py-1.5 rounded-lg text-xs border transition"
              style={{
                borderColor: duration === d ? brand : "rgba(255,255,255,0.1)",
                background: duration === d ? `${brand}25` : "transparent",
                color: duration === d ? "white" : "rgba(255,255,255,0.7)",
              }}
            >
              {d >= 60 ? `${d / 60} hr${d > 60 ? "s" : ""}` : `${d} min`}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-white/40 mt-1.5">Ends at {fmtTime(endTime)}</div>
      </div>

      {facility.halfFull && (
        <div className="mb-4">
          <Label className="text-xs text-white/60 mb-1.5 block">Field size</Label>
          <div className="flex gap-2">
            {(["full", "half"] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setHalfFull(opt)}
                data-testid={`button-size-${opt}`}
                className="flex-1 px-3 py-2 rounded-lg text-sm border transition capitalize"
                style={{
                  borderColor: halfFull === opt ? brand : "rgba(255,255,255,0.1)",
                  background: halfFull === opt ? `${brand}25` : "transparent",
                  color: halfFull === opt ? "white" : "rgba(255,255,255,0.7)",
                }}
              >
                {opt} field
              </button>
            ))}
          </div>
        </div>
      )}

      {facility.addons.length > 0 && (
        <div className="mb-4">
          <Label className="text-xs text-white/60 mb-1.5 block">Add-ons</Label>
          <div className="space-y-2">
            {facility.addons.map(addon => {
              const qty = selectedAddons[addon.id] || 0;
              return (
                <div key={addon.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="min-w-0">
                    <div className="text-sm">{addon.name}</div>
                    <div className="text-[11px] text-white/40">${parseFloat(addon.price).toFixed(2)} {addon.unit === "per_hour" ? "/ hour" : "/ booking"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={qty > 0}
                      onCheckedChange={(on) => setSelectedAddons(prev => ({ ...prev, [addon.id]: on ? 1 : 0 }))}
                      data-testid={`switch-addon-${addon.id}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium flex items-center gap-2">
              <CalendarIcon className="w-3.5 h-3.5 text-white/40" /> Multi-day booking
            </div>
            <div className="text-[11px] text-white/40 mt-0.5">Repeat the same time on additional dates</div>
          </div>
          <Switch checked={multiDay} onCheckedChange={setMultiDay} data-testid="switch-multiday" />
        </div>
        {multiDay && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {extraDates.map(d => (
                <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] text-[11px]">
                  {fmtDateLong(d)}
                  <button onClick={() => setExtraDates(prev => prev.filter(x => x !== d))} className="text-white/40 hover:text-white">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="date"
                min={todayISO()}
                max={addDays(todayISO(), settings.advanceBookingDays)}
                onChange={e => {
                  const v = e.target.value;
                  if (v && v !== date && !extraDates.includes(v)) setExtraDates(prev => [...prev, v].sort());
                  e.target.value = "";
                }}
                data-testid="input-extra-date"
                className="bg-white/[0.04] border-white/10 text-white max-w-[200px]"
              />
            </div>
          </div>
        )}
      </div>

      {conflictDates.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs p-2.5 mb-3">
          {conflictDates.length} date{conflictDates.length > 1 ? "s" : ""} unavailable at that time and will be skipped.
        </div>
      )}

      <Button
        onClick={handleAdd}
        disabled={validDates.length === 0}
        data-testid="button-add-to-cart"
        className="w-full text-white border-0"
        style={{ background: brand }}
      >
        <Plus className="w-4 h-4 mr-1.5" />
        Add {validDates.length > 1 ? `${validDates.length} bookings` : "to cart"}
      </Button>
    </div>
  );
}

// ============ STEP 2 — Review ============
function ReviewStep({
  cart, setCart, brand, onBack, onNext,
}: {
  cart: CartItem[];
  setCart: (fn: (prev: CartItem[]) => CartItem[]) => void;
  brand: string;
  onBack: () => void;
  onNext: () => void;
}) {
  if (cart.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-12 text-center">
        <ShoppingCart className="w-10 h-10 text-white/20 mx-auto mb-3" />
        <p className="text-white/60 mb-4">Your cart is empty</p>
        <Button onClick={onBack} variant="outline" data-testid="button-back-to-items">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Add items
        </Button>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Review your cart</h2>
      <div className="space-y-2 mb-5">
        {cart.map(c => (
          <div key={c.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-start justify-between gap-4" data-testid={`cart-item-${c.id}`}>
            <div className="min-w-0">
              <div className="font-medium">{c.facility.name} {c.halfFull && <span className="text-xs text-white/40">({c.halfFull})</span>}</div>
              <div className="text-xs text-white/60 mt-0.5">{fmtDateLong(c.date)} · {fmtTime(c.startTime)} – {fmtTime(c.endTime)}</div>
              {c.addons.length > 0 && (
                <div className="text-[11px] text-white/40 mt-1">
                  + {c.addons.map(a => c.facility.addons.find(x => x.id === a.addonId)?.name).filter(Boolean).join(", ")}
                </div>
              )}
            </div>
            <button onClick={() => setCart(prev => prev.filter(x => x.id !== c.id))} className="text-white/40 hover:text-red-400" data-testid={`button-remove-${c.id}`}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 justify-between">
        <Button variant="outline" onClick={onBack} data-testid="button-back-review">
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Add more
        </Button>
        <Button onClick={onNext} className="text-white border-0" style={{ background: brand }} data-testid="button-continue-details">
          Continue <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );
}

// ============ STEP 3 — Details ============
function DetailsStep({
  customer, setCustomer, brand, onBack, onSubmit, loading, error,
}: {
  customer: { name: string; email: string; phone: string; club: string; notes: string };
  setCustomer: (c: { name: string; email: string; phone: string; club: string; notes: string }) => void;
  brand: string;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
}) {
  const valid = customer.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customer.email);
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Your details</h2>
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4 mb-5">
        <div>
          <Label className="text-xs text-white/60 mb-1.5 block">Full name *</Label>
          <Input value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} data-testid="input-name" className="bg-white/[0.04] border-white/10 text-white" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Email *</Label>
            <Input type="email" value={customer.email} onChange={e => setCustomer({ ...customer, email: e.target.value })} data-testid="input-email" className="bg-white/[0.04] border-white/10 text-white" />
          </div>
          <div>
            <Label className="text-xs text-white/60 mb-1.5 block">Phone</Label>
            <Input value={customer.phone} onChange={e => setCustomer({ ...customer, phone: e.target.value })} data-testid="input-phone" className="bg-white/[0.04] border-white/10 text-white" />
          </div>
        </div>
        <div>
          <Label className="text-xs text-white/60 mb-1.5 block">Club / organisation</Label>
          <Input value={customer.club} onChange={e => setCustomer({ ...customer, club: e.target.value })} data-testid="input-club" className="bg-white/[0.04] border-white/10 text-white" />
        </div>
        <div>
          <Label className="text-xs text-white/60 mb-1.5 block">Notes</Label>
          <Textarea value={customer.notes} onChange={e => setCustomer({ ...customer, notes: e.target.value })} data-testid="input-notes" className="bg-white/[0.04] border-white/10 text-white min-h-[80px]" />
        </div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">{error}</div>}
      </div>
      <div className="flex gap-2 justify-between">
        <Button variant="outline" onClick={onBack} data-testid="button-back-details" disabled={loading}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
        </Button>
        <Button onClick={onSubmit} disabled={!valid || loading} className="text-white border-0" style={{ background: brand }} data-testid="button-continue-payment">
          {loading ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Preparing…</> : <>Continue to payment <ArrowRight className="w-4 h-4 ml-1.5" /></>}
        </Button>
      </div>
    </div>
  );
}

// ============ STEP 4 — Payment ============
function PaymentStep({
  bookingGroupId, customer, quote, brand, onBack,
}: {
  bookingGroupId: string;
  customer: { email: string; name: string };
  quote: Quote;
  brand: string;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [, setLocation] = useLocation();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    setError(null);
    const returnUrl = `${window.location.origin}/book/success?ref=${bookingGroupId}`;
    const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl, receipt_email: customer.email },
      redirect: "if_required",
    });
    if (stripeErr) {
      setError(stripeErr.message || "Payment failed");
      setProcessing(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      setLocation(`/book/success?ref=${bookingGroupId}`);
    } else {
      setError("Payment couldn't be processed.");
      setProcessing(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Lock className="w-4 h-4 text-white/40" /> Secure payment</h2>
      <form onSubmit={submit} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
        <PaymentElement />
        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">{error}</div>}
        <div className="flex gap-2 justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={processing} data-testid="button-back-payment">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back
          </Button>
          <Button type="submit" disabled={!stripe || processing} className="text-white border-0" style={{ background: brand }} data-testid="button-pay">
            {processing ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Processing…</> : <>Pay {fmtMoney(quote.totalCents)}</>}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ============ Cart sidebar ============
function CartSummary({
  cart, quote, loadingQuote, brand, onRemove, step, onContinue,
}: {
  cart: CartItem[];
  quote: Quote | null;
  loadingQuote: boolean;
  brand: string;
  onRemove: (id: string) => void;
  step: Step;
  onContinue: () => void;
}) {
  const showContinue = step === "items" && cart.length > 0;
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sticky top-[110px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Cart</h3>
        <span className="text-xs text-white/40">{cart.length} item{cart.length !== 1 ? "s" : ""}</span>
      </div>
      {cart.length === 0 ? (
        <p className="text-sm text-white/40 py-6 text-center">No items yet. Choose a facility to start.</p>
      ) : (
        <>
          <div className="space-y-2 mb-3 max-h-[40vh] overflow-y-auto">
            {cart.map(c => (
              <div key={c.id} className="text-xs rounded-lg bg-white/[0.03] p-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-white/90 truncate">{c.facility.name}{c.halfFull === "half" ? " (Half)" : ""}</div>
                  <div className="text-white/40 mt-0.5">{fmtDateLong(c.date)}</div>
                  <div className="text-white/40">{fmtTime(c.startTime)}–{fmtTime(c.endTime)}</div>
                </div>
                {step === "items" && (
                  <button onClick={() => onRemove(c.id)} className="text-white/30 hover:text-red-400" data-testid={`button-cart-remove-${c.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-white/[0.06] pt-3 space-y-1.5 text-xs">
            {loadingQuote ? <Skeleton className="h-4 w-32" /> : quote && (
              <>
                <div className="flex justify-between text-white/60"><span>Subtotal</span><span>{fmtMoney(quote.subtotalCents)}</span></div>
                <div className="flex justify-between text-white/60"><span>GST ({quote.gstRate}%)</span><span>{fmtMoney(quote.gstCents)}</span></div>
                <div className="flex justify-between text-white font-semibold pt-1 border-t border-white/[0.06] text-sm">
                  <span>Total</span><span data-testid="text-cart-total">{fmtMoney(quote.totalCents)}</span>
                </div>
              </>
            )}
          </div>
          {showContinue && (
            <Button onClick={onContinue} className="w-full mt-3 text-white border-0" style={{ background: brand }} data-testid="button-continue-cart">
              Review cart <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
