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
  CheckCircle2, Lightbulb, Users, ShoppingCart, Loader2, Lock, X,
  ChevronLeft, ChevronRight, Shield, Minus,
} from "lucide-react";
import { FacilityCarousel } from "@/components/FacilityCarousel";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "");

function facilityImages(f: { imageUrls: string[] | null; imageUrl: string | null }): string[] {
  const arr = (f.imageUrls || []).filter(Boolean);
  if (arr.length > 0) return arr;
  return f.imageUrl ? [f.imageUrl] : [];
}

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
  imageUrls: string[] | null;
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
  halfPosition: "front" | "back" | null;
  status: string;
}

interface CartItem {
  id: string;
  facility: PublicFacility;
  date: string;
  startTime: string;
  endTime: string;
  halfFull: "half" | "full" | null;
  halfPosition: "front" | "back" | null;
  addons: { addonId: number; qty: number }[];
}

interface QuoteLine {
  facilityId: number;
  facilityName: string;
  date: string;
  startTime: string;
  endTime: string;
  halfFull: string | null;
  halfPosition: "front" | "back" | null;
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
              halfPosition: c.halfPosition,
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
            halfPosition: c.halfPosition,
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
          <Skeleton className="aspect-video rounded-2xl" />
          <Skeleton className="aspect-video rounded-2xl" />
        </div>
      ) : facilities.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] p-12 text-center text-white/50">
          No facilities available right now.
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold mb-3">Choose a facility</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {facilities.map(f => {
              const selected = selectedFacility?.id === f.id;
              const subtitle = f.halfFull ? "Half or Full Field" : FACILITY_TYPE_LABELS[f.type];
              const imgs = facilityImages(f);
              return (
                <div
                  key={f.id}
                  onClick={() => setSelectedFacility(selected ? null : f)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedFacility(selected ? null : f); } }}
                  data-testid={`button-facility-${f.id}`}
                  className="group cursor-pointer rounded-2xl border overflow-hidden transition-all duration-200 ease-out hover:bg-white/[0.04]"
                  style={{
                    borderColor: selected ? brand : "rgba(255,255,255,0.08)",
                    background: selected ? `${brand}10` : "rgba(255,255,255,0.02)",
                  }}
                >
                  {imgs.length > 0 && (
                    <FacilityCarousel
                      images={imgs}
                      alt={f.name}
                      brand={brand}
                      testIdPrefix={`facility-${f.id}-card`}
                      className="w-full"
                    />
                  )}
                  <div className="flex items-center gap-3 p-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors"
                      style={{
                        background: selected ? `${brand}30` : "rgba(255,255,255,0.04)",
                        color: selected ? brand : "rgba(255,255,255,0.5)",
                      }}
                    >
                      <Shield className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate flex items-center gap-1.5">
                        {f.name}
                        {f.floodlights && <Lightbulb className="w-3 h-3 text-yellow-400/70 flex-shrink-0" />}
                      </div>
                      <div className="text-[11px] text-white/40 mt-0.5 truncate">{subtitle}</div>
                    </div>
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200"
                      style={{
                        background: selected ? brand : "rgba(255,255,255,0.04)",
                        color: selected ? "white" : "rgba(255,255,255,0.4)",
                        transform: selected ? "rotate(45deg)" : "rotate(0)",
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {selectedFacility && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-200">
              <ConfigureFacility
                facility={selectedFacility}
                settings={settings}
                brand={brand}
                onAdd={(items) => setCart(prev => [...prev, ...items])}
                cart={cart}
                onClose={() => setSelectedFacility(null)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ConfigureFacility({
  facility, settings, brand, onAdd, cart, onClose,
}: {
  facility: PublicFacility;
  settings: VenueSettings;
  brand: string;
  onAdd: (items: CartItem[]) => void;
  cart: CartItem[];
  onClose?: () => void;
}) {
  const slots = useMemo(
    () => genTimeSlots(settings.openingTime, settings.closingTime, settings.slotMinutes),
    [settings.openingTime, settings.closingTime, settings.slotMinutes],
  );
  const [date, setDate] = useState(todayISO());
  // Tap-to-pick time selection: first tap sets start, second tap sets end.
  // Null start means "waiting for first tap"; null end means "waiting for end tap".
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [halfFull, setHalfFull] = useState<"half" | "full">(facility.halfFull ? "half" : "full");
  const [halfPosition, setHalfPosition] = useState<"front" | "back">("front");
  const [selectedAddons, setSelectedAddons] = useState<Record<number, number>>({});
  const [multiDay, setMultiDay] = useState(false);
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [busy, setBusy] = useState<AvailabilitySlot[]>([]);

  const durationMinutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }, [startTime, endTime]);

  const allDates = useMemo(() => Array.from(new Set([date, ...extraDates])), [date, extraDates]);

  // Fetch availability whenever facility/dates change
  useEffect(() => {
    if (allDates.length === 0) return;
    (async () => {
      const r = await fetch(`/api/public/venue/${facility.organizationId}/availability?facilityId=${facility.id}&dates=${allDates.join(",")}`);
      if (r.ok) setBusy(await r.json());
    })();
  }, [facility.id, facility.organizationId, allDates.join(",")]);

  // Half-field conflict matrix: full vs anything = conflict; two halves only conflict
  // if they're on the same side (front × front, back × back).
  const wantHalf = facility.halfFull && halfFull === "half";
  const wantPos: "front" | "back" | null = wantHalf ? halfPosition : null;
  const halfBlocks = (existingHalf: string | null, existingPos: "front" | "back" | null | string | undefined) => {
    if (existingHalf !== "half" || !wantHalf) return true;
    // Legacy/migrated bookings without a known half position block both halves.
    if (!existingPos || !wantPos) return true;
    return existingPos === wantPos;
  };
  const cartConflicts = (d: string, s: string, e: string) =>
    cart.some(c =>
      c.facility.id === facility.id &&
      c.date === d &&
      c.startTime < e &&
      c.endTime > s &&
      halfBlocks(c.halfFull, c.halfPosition)
    );

  const isSlotConflicted = (d: string, s: string, e: string) =>
    busy.some(b =>
      b.date === d &&
      b.startTime < e &&
      b.endTime > s &&
      halfBlocks(b.halfFull, b.halfPosition)
    ) || cartConflicts(d, s, e);

  const conflictDates = startTime && endTime
    ? allDates.filter(d => isSlotConflicted(d, startTime, endTime))
    : [];
  const validDates = startTime && endTime
    ? allDates.filter(d => !isSlotConflicted(d, startTime, endTime))
    : [];

  const canAdd = !!startTime && !!endTime && validDates.length > 0
    && durationMinutes >= settings.minDurationMinutes;

  const handleAdd = () => {
    if (!startTime || !endTime) return;
    const items: CartItem[] = validDates.map(d => ({
      id: `${facility.id}-${d}-${startTime}-${Math.random().toString(36).slice(2, 8)}`,
      facility,
      date: d,
      startTime,
      endTime,
      halfFull: facility.halfFull ? halfFull : null,
      halfPosition: facility.halfFull && halfFull === "half" ? halfPosition : null,
      addons: Object.entries(selectedAddons).filter(([, q]) => q > 0).map(([id, q]) => ({ addonId: parseInt(id), qty: q })),
    }));
    if (items.length > 0) {
      onAdd(items);
      // Reset time selection after adding so the customer can configure another slot.
      setStartTime(null);
      setEndTime(null);
    }
  };

  // Slot click handler — first click sets start, second click sets end (must be after start).
  // Clicking the current start clears the selection.
  const handleSlotClick = (slot: string) => {
    if (slot === startTime && !endTime) { setStartTime(null); return; }
    if (!startTime) { setStartTime(slot); setEndTime(null); return; }
    if (!endTime) {
      // End must be strictly after start (which is the slot label, e.g. "17:00")
      if (slot > startTime) {
        // Slot label is the start of a slot; end of that slot = slot + slotMinutes.
        // Picking 18:00 as the "end slot" means booking ends at 18:00.
        setEndTime(slot);
      } else {
        // User picked an earlier slot — treat as new start.
        setStartTime(slot);
      }
      return;
    }
    // Both already set — start a new selection.
    setStartTime(slot);
    setEndTime(null);
  };

  const heroImages = facilityImages(facility);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden transition-all duration-300 ease-out">
      {heroImages.length > 0 && (
        <FacilityCarousel
          images={heroImages}
          alt={facility.name}
          brand={brand}
          size="hero"
          testIdPrefix={`facility-${facility.id}-hero`}
          className="w-full"
        />
      )}
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold flex items-center gap-2 text-white">
              <MapPin className="w-4 h-4 text-white/40" />
              Configure: {facility.name}
            </h3>
            {facility.description && (
              <p className="text-xs text-white/50 mt-1">{facility.description}</p>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition flex-shrink-0"
              data-testid="button-close-configure"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Calendar grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-white/60">Date</Label>
            <button
              onClick={() => setMultiDay(v => !v)}
              className={`text-[10px] flex items-center gap-1 px-2 py-0.5 rounded transition ${multiDay ? "text-blue-300 bg-blue-500/10" : "text-white/40 hover:text-white/60"}`}
              data-testid="button-toggle-multiday"
            >
              <CalendarIcon className="w-3 h-3" />
              Multi-day
            </button>
          </div>
          <CalendarPicker
            date={date}
            setDate={setDate}
            extraDates={multiDay ? extraDates : []}
            toggleExtraDate={multiDay ? (d) => setExtraDates(prev =>
              prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()
            ) : undefined}
            min={todayISO()}
            max={addDays(todayISO(), settings.advanceBookingDays)}
            brand={brand}
          />
        </div>

        {/* Time slot grid */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-white/60">Time</Label>
            <span className="text-[10px] text-white/40">
              {!startTime ? "Tap your start time" : !endTime ? "Tap your end time" : "Time selected"}
            </span>
          </div>
          <TimeSlotGrid
            slots={slots}
            startTime={startTime}
            endTime={endTime}
            onSelect={handleSlotClick}
            isBusy={(s, e) => allDates.some(d => isSlotConflicted(d, s, e))}
            brand={brand}
          />
          {startTime && endTime && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40">Start</div>
                <div className="text-sm font-semibold">{fmtTime(startTime)}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-white/30" />
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40">End</div>
                <div className="text-sm font-semibold">{fmtTime(endTime)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-white/40">Duration</div>
                <div className="text-sm font-semibold">{durationMinutes >= 60 ? `${durationMinutes / 60}hr` : `${durationMinutes}m`}</div>
              </div>
            </div>
          )}
        </div>
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
          {halfFull === "half" && (
            <div className="mt-3">
              <Label className="text-xs text-white/60 mb-1.5 block">Which half?</Label>
              <div className="flex gap-2">
                {(["front", "back"] as const).map(pos => (
                  <button
                    key={pos}
                    onClick={() => setHalfPosition(pos)}
                    data-testid={`button-half-${pos}`}
                    className="flex-1 px-3 py-2 rounded-lg text-sm border transition capitalize"
                    style={{
                      borderColor: halfPosition === pos ? brand : "rgba(255,255,255,0.1)",
                      background: halfPosition === pos ? `${brand}25` : "transparent",
                      color: halfPosition === pos ? "white" : "rgba(255,255,255,0.7)",
                    }}
                  >
                    {pos} half
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/40 mt-1.5">Booking one half leaves the other half free for someone else.</p>
            </div>
          )}
        </div>
      )}

      {facility.addons.length > 0 && (
        <div className="mb-4">
          <Label className="text-xs text-white/60 mb-2 block">Add-ons</Label>
          <div className="space-y-2">
            {facility.addons.map(addon => {
              const qty = selectedAddons[addon.id] || 0;
              const useStepper = addon.unit === "per_booking";
              return (
                <div key={addon.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center flex-shrink-0 text-yellow-300/70">
                      <Lightbulb className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{addon.name}</div>
                      <div className="text-[11px] text-white/40">${parseFloat(addon.price).toFixed(2)} {addon.unit === "per_hour" ? "/ hour" : "per team / game"} inc GST</div>
                    </div>
                  </div>
                  {useStepper ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => setSelectedAddons(prev => ({ ...prev, [addon.id]: Math.max(0, (prev[addon.id] || 0) - 1) }))}
                        disabled={qty === 0}
                        data-testid={`button-addon-${addon.id}-minus`}
                        className="w-7 h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-8 text-center text-sm font-medium tabular-nums" data-testid={`addon-${addon.id}-qty`}>{qty}</div>
                      <button
                        onClick={() => setSelectedAddons(prev => ({ ...prev, [addon.id]: (prev[addon.id] || 0) + 1 }))}
                        data-testid={`button-addon-${addon.id}-plus`}
                        className="w-7 h-7 rounded-md bg-white/[0.06] hover:bg-white/[0.1] flex items-center justify-center transition"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <Switch
                      checked={qty > 0}
                      onCheckedChange={(on) => setSelectedAddons(prev => ({ ...prev, [addon.id]: on ? 1 : 0 }))}
                      data-testid={`switch-addon-${addon.id}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {multiDay && extraDates.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 mb-4">
          <div className="text-[11px] text-white/40 mb-2">
            Multi-day: same time on {extraDates.length + 1} dates
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[date, ...extraDates].map(d => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] text-[11px]" data-testid={`chip-date-${d}`}>
                {fmtDateLong(d)}
              </span>
            ))}
          </div>
        </div>
      )}

      {startTime && endTime && conflictDates.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs p-2.5 mb-3">
          {conflictDates.length} date{conflictDates.length > 1 ? "s" : ""} unavailable at that time and will be skipped.
        </div>
      )}

      <Button
        onClick={handleAdd}
        disabled={!canAdd}
        data-testid="button-add-to-cart"
        className="w-full h-11 text-white border-0 text-sm font-semibold transition-all duration-200 disabled:opacity-30"
        style={{ background: brand }}
      >
        <ShoppingCart className="w-4 h-4 mr-2" />
        {!startTime || !endTime
          ? "Select a time to continue"
          : validDates.length > 1
            ? `Add ${validDates.length} bookings to cart`
            : "Add to cart"}
      </Button>
      </div>
    </div>
  );
}

// Full-month grid date picker. Shows the month containing `date`, lets user
// click a day to select it. In multi-day mode, additional clicks toggle dates
// in/out of `extraDates`.
function CalendarPicker({
  date, setDate, extraDates, toggleExtraDate, min, max, brand,
}: {
  date: string;
  setDate: (d: string) => void;
  extraDates: string[];
  toggleExtraDate?: (d: string) => void;
  min: string;
  max: string;
  brand: string;
}) {
  const current = new Date(date + "T00:00:00");
  const [viewMonth, setViewMonth] = useState({ year: current.getFullYear(), month: current.getMonth() });
  const first = new Date(viewMonth.year, viewMonth.month, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(viewMonth.year, viewMonth.month, d));

  const monthLabel = first.toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = todayISO();

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3" data-testid="calendar-picker">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setViewMonth(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 })}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition"
          data-testid="button-prev-month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-sm font-medium">{monthLabel}</div>
        <button
          onClick={() => setViewMonth(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 })}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition"
          data-testid="button-next-month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => (
          <div key={d} className="text-[10px] text-white/30 text-center py-1 uppercase tracking-wider">{d.slice(0, 3)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={`p${i}`} />;
          const dStr = ymd(d);
          const isPrimary = dStr === date;
          const isExtra = extraDates.includes(dStr);
          const isToday = dStr === todayStr;
          const disabled = dStr < min || dStr > max;
          const selected = isPrimary || isExtra;
          return (
            <button
              key={dStr}
              disabled={disabled}
              onClick={() => {
                if (toggleExtraDate && !isPrimary) {
                  toggleExtraDate(dStr);
                } else {
                  setDate(dStr);
                }
              }}
              data-testid={`day-${dStr}`}
              className={`aspect-square rounded-full text-xs font-medium transition-all duration-150 border ${
                disabled
                  ? "text-white/15 cursor-not-allowed border-transparent"
                  : isPrimary
                    ? "text-white border-transparent"
                    : isExtra
                      ? "text-white border-transparent"
                      : isToday
                        ? "text-blue-300 border-transparent hover:bg-blue-500/[0.08]"
                        : "text-white/70 border-transparent hover:bg-white/[0.06]"
              }`}
              style={selected ? {
                borderColor: brand,
                background: isPrimary ? `${brand}25` : `${brand}10`,
              } : undefined}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Time slot grid — tap once to set start, tap again to set end. Slots between
// start and (selected) end are highlighted as the range. Busy slots are dimmed.
function TimeSlotGrid({
  slots, startTime, endTime, onSelect, isBusy, brand,
}: {
  slots: string[];
  startTime: string | null;
  endTime: string | null;
  onSelect: (slot: string) => void;
  isBusy: (s: string, e: string) => boolean;
  brand: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3" data-testid="time-slot-grid">
      <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 gap-1 max-h-[300px] overflow-y-auto">
        {slots.map((s, i) => {
          const next = slots[i + 1] || s;
          const slotBusy = isBusy(s, next);
          const isStart = s === startTime;
          // The booking covers [startTime, endTime). End label is a boundary marker,
          // not a booked slot — only highlight slots that are actually within the
          // booking duration: start, and any slot between start and end (exclusive).
          const inBooking = !!(startTime && (
            (endTime && s >= startTime && s < endTime) ||
            (!endTime && isStart)
          ));
          const isEndMarker = s === endTime;
          return (
            <button
              key={s}
              onClick={() => onSelect(s)}
              disabled={slotBusy && !inBooking && !isEndMarker}
              data-testid={`slot-${s}`}
              className={`h-9 rounded-md text-xs font-medium transition-all duration-150 border ${
                slotBusy && !inBooking && !isEndMarker
                  ? "text-white/15 line-through cursor-not-allowed border-transparent bg-white/[0.02]"
                  : inBooking
                    ? "text-white border-transparent"
                    : isEndMarker
                      ? "text-white border-transparent"
                      : "text-white/70 border-white/[0.08] bg-transparent hover:bg-white/[0.05] hover:border-white/15 hover:text-white"
              }`}
              style={
                inBooking || isEndMarker
                  ? {
                      borderColor: brand,
                      background: isStart || isEndMarker
                        ? `${brand}30`
                        : `${brand}15`,
                    }
                  : undefined
              }
            >
              {s}
            </button>
          );
        })}
      </div>
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
              <div className="font-medium">{c.facility.name} {c.halfFull && <span className="text-xs text-white/40">({c.halfFull === "half" && c.halfPosition ? `${c.halfPosition} half` : c.halfFull})</span>}</div>
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
                  <div className="text-white/90 truncate">{c.facility.name}{c.halfFull === "half" ? ` (${c.halfPosition ? `${c.halfPosition} half` : "half"})` : ""}</div>
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
                <div className="flex justify-between text-white font-semibold text-sm">
                  <span>Total</span><span data-testid="text-cart-total">{fmtMoney(quote.totalCents)}</span>
                </div>
                <div className="flex justify-between text-white/40 text-[11px]">
                  <span>Includes {quote.gstRate}% GST</span><span>{fmtMoney(quote.gstCents)}</span>
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
