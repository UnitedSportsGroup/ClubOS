import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRoute, Link, useLocation } from "wouter";
import { ArrowLeft, Plus, X, User, Baby, Calendar, DollarSign, ShieldCheck } from "lucide-react";

interface ChildData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  allergies: string;
  epiPen: boolean;
  medicalNotes: string;
}

interface BookingItem {
  childIndex: number;
  campDateId: number;
  productType: string;
  dateName: string;
}

export default function BookingPage() {
  const [, params] = useRoute("/:slug/book");
  const slug = params?.slug || "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [parentFirst, setParentFirst] = useState("");
  const [parentLast, setParentLast] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");

  const [children, setChildren] = useState<ChildData[]>([{
    firstName: "", lastName: "", dateOfBirth: "", gender: "", allergies: "", epiPen: false, medicalNotes: "",
  }]);

  const [items, setItems] = useState<BookingItem[]>([]);

  const { data, isLoading } = useQuery<{ camp: any; pricing: any[]; dates: any[]; discounts: any[] }>({
    queryKey: ["/api/public/camps", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/camps/${slug}`);
      if (!res.ok) throw new Error("Camp not found");
      return res.json();
    },
  });

  const bookMutation = useMutation({
    mutationFn: async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const res = await apiRequest("POST", "/api/public/book", {
        campSlug: slug,
        parent: { firstName: parentFirst, lastName: parentLast, email: parentEmail, phone: parentPhone },
        children: children.filter(c => c.firstName),
        items: items.map(i => ({ childIndex: i.childIndex, campDateId: i.campDateId, productType: i.productType })),
        utmSource: urlParams.get("utm_source"),
        utmMedium: urlParams.get("utm_medium"),
        utmCampaign: urlParams.get("utm_campaign"),
        fbclid: urlParams.get("fbclid"),
      });
      return res.json();
    },
    onSuccess: (result: any) => {
      if (result.totalCents === 0) {
        fetch("/api/public/book/confirm-free", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ registrationId: result.registrationId }),
        });
      }
      setLocation(`/${slug}/success?registrationId=${result.registrationId}&total=${result.totalCents}`);
    },
    onError: (e: Error) => toast({ title: "Booking failed", description: e.message, variant: "destructive" }),
  });

  const addChild = () => setChildren([...children, { firstName: "", lastName: "", dateOfBirth: "", gender: "", allergies: "", epiPen: false, medicalNotes: "" }]);
  const removeChild = (i: number) => {
    setChildren(children.filter((_, idx) => idx !== i));
    setItems(items.filter(item => item.childIndex !== i).map(item => item.childIndex > i ? { ...item, childIndex: item.childIndex - 1 } : item));
  };
  const updateChild = (i: number, field: keyof ChildData, value: any) => {
    const n = [...children];
    (n[i] as any)[field] = value;
    setChildren(n);
  };

  const toggleItem = (childIndex: number, campDateId: number, productType: string, dateName: string) => {
    const exists = items.find(i => i.childIndex === childIndex && i.campDateId === campDateId && i.productType === productType);
    if (exists) {
      setItems(items.filter(i => !(i.childIndex === childIndex && i.campDateId === campDateId && i.productType === productType)));
    } else {
      const conflicting = items.filter(i => i.childIndex === childIndex && i.campDateId === campDateId);
      const filtered = items.filter(i => !(i.childIndex === childIndex && i.campDateId === campDateId));
      setItems([...filtered, { childIndex, campDateId, productType, dateName }]);
    }
  };

  const calcTotal = () => {
    if (!data) return { subtotal: 0, discount: 0, total: 0, discountLabel: "" };
    let subtotal = 0;
    items.forEach(item => {
      const p = data.pricing.find(p => p.productType === item.productType);
      if (p) subtotal += p.priceCents;
    });
    let discount = 0;
    let discountLabel = "";
    const applicable = data.discounts
      .filter((d: any) => items.length >= d.minBookings)
      .sort((a: any, b: any) => Number(b.discountPercent) - Number(a.discountPercent))[0];
    if (applicable) {
      discount = Math.round(subtotal * Number(applicable.discountPercent) / 100);
      discountLabel = `${applicable.discountPercent}%`;
    }
    return { subtotal, discount, total: subtotal - discount, discountLabel };
  };

  const pricing = calcTotal();

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: '#02060E' }}>
        <div className="max-w-2xl mx-auto px-6 py-16 space-y-6">
          <Skeleton className="h-10 w-48 bg-blue-500/[0.04]" />
          <Skeleton className="h-[400px] w-full rounded-2xl bg-blue-500/[0.04]" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen" style={{ background: '#02060E' }}>
      <header className="border-b border-blue-500/[0.08] backdrop-blur-2xl sticky top-0 z-10" style={{ background: 'rgba(2,6,14,0.85)' }}>
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href={`/${slug}`}>
            <button className="flex items-center gap-2 text-white/40 hover:text-white/60 transition-colors cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[13px]">Back</span>
            </button>
          </Link>
          <span className="text-[13px] text-white/40 font-medium">Book — {data.camp.name}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <div className="flex gap-2">
          {[1, 2, 3].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full transition-all duration-500 ${step >= s ? 'bg-blue-500' : 'bg-white/[0.06]'}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
            <div>
              <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2" data-testid="text-step-title">
                <User className="w-5 h-5 text-blue-400" /> Parent Details
              </h2>
              <p className="text-[13px] text-white/30 mt-1">Enter the parent or guardian's contact information</p>
            </div>
            <div className="rounded-2xl glass-card p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">First Name</label>
                  <Input value={parentFirst} onChange={e => setParentFirst(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-first" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Last Name</label>
                  <Input value={parentLast} onChange={e => setParentLast(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-last" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Email</label>
                <Input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-email" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Phone</label>
                <Input value={parentPhone} onChange={e => setParentPhone(e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid="input-parent-phone" />
              </div>
            </div>
            <Button
              onClick={() => setStep(2)}
              disabled={!parentFirst || !parentLast || !parentEmail}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-11 text-[14px] glow-btn"
              data-testid="button-next-step-2"
            >
              Continue to Children
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
            <div>
              <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2" data-testid="text-step-title">
                <Baby className="w-5 h-5 text-blue-400" /> Children
              </h2>
              <p className="text-[13px] text-white/30 mt-1">Add children attending the camp</p>
            </div>
            {children.map((child, i) => (
              <div key={i} className="rounded-2xl glass-card p-5 space-y-3" data-testid={`card-child-${i}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-blue-400/50 font-medium">Child {i + 1}</span>
                  {children.length > 1 && (
                    <button onClick={() => removeChild(i)} className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center hover:bg-red-500/10 transition-colors cursor-pointer" data-testid={`button-remove-child-${i}`}>
                      <X className="w-3.5 h-3.5 text-white/30" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">First Name</label>
                    <Input value={child.firstName} onChange={e => updateChild(i, "firstName", e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid={`input-child-first-${i}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Last Name</label>
                    <Input value={child.lastName} onChange={e => updateChild(i, "lastName", e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid={`input-child-last-${i}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Date of Birth</label>
                    <Input type="date" value={child.dateOfBirth} onChange={e => updateChild(i, "dateOfBirth", e.target.value)} className="premium-input text-white/80 rounded-xl" data-testid={`input-child-dob-${i}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Gender</label>
                    <select value={child.gender} onChange={e => updateChild(i, "gender", e.target.value)} className="w-full h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[13px] text-white/70 focus:outline-none focus:border-blue-500/30" data-testid={`select-child-gender-${i}`}>
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Allergies / Medical</label>
                  <Input value={child.allergies} onChange={e => updateChild(i, "allergies", e.target.value)} placeholder="None" className="premium-input text-white/80 rounded-xl" data-testid={`input-child-allergies-${i}`} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={child.epiPen} onChange={e => updateChild(i, "epiPen", e.target.checked)} className="rounded" data-testid={`input-child-epipen-${i}`} />
                  <span className="text-[12px] text-white/50">Child carries an EpiPen</span>
                </label>
              </div>
            ))}
            <Button variant="outline" onClick={addChild} className="w-full rounded-xl h-9 text-[13px] border-blue-500/20 text-blue-400/60 hover:bg-blue-500/5" data-testid="button-add-child">
              <Plus className="w-4 h-4 mr-1.5" /> Add Another Child
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1 rounded-xl h-11 text-[14px] border-white/[0.08] text-white/50" data-testid="button-back-step-1">Back</Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!children.some(c => c.firstName && c.lastName)}
                className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-11 text-[14px] glow-btn"
                data-testid="button-next-step-3"
              >
                Choose Sessions
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-fade-in-up" style={{ animationDelay: '0ms', opacity: 0 }}>
            <div>
              <h2 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2" data-testid="text-step-title">
                <Calendar className="w-5 h-5 text-blue-400" /> Choose Sessions
              </h2>
              <p className="text-[13px] text-white/30 mt-1">Select days and session types for each child</p>
            </div>

            {children.filter(c => c.firstName).map((child, childIndex) => (
              <div key={childIndex} className="rounded-2xl glass-card p-5 space-y-4" data-testid={`booking-child-${childIndex}`}>
                <h3 className="text-[14px] font-medium text-white/70">{child.firstName} {child.lastName}</h3>
                <div className="space-y-2">
                  {data.dates.map((d: any) => {
                    const dateLabel = new Date(d.date + 'T12:00:00').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <div key={d.id} className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] text-white/40 w-24 flex-shrink-0">{dateLabel}</span>
                        {["FULL_DAY", "MORNING", "AFTERNOON"].map(pt => {
                          const isSelected = items.some(i => i.childIndex === childIndex && i.campDateId === d.id && i.productType === pt);
                          const price = data.pricing.find((p: any) => p.productType === pt);
                          const labels: Record<string, string> = { FULL_DAY: "Full Day", MORNING: "Morning", AFTERNOON: "Afternoon" };
                          return (
                            <button
                              key={pt}
                              onClick={() => toggleItem(childIndex, d.id, pt, dateLabel)}
                              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ${
                                isSelected
                                  ? "bg-blue-500/15 border-blue-500/30 text-blue-400"
                                  : "bg-white/[0.02] border-white/[0.06] text-white/30 hover:border-blue-500/20 hover:text-white/50"
                              }`}
                              data-testid={`toggle-${childIndex}-${d.id}-${pt}`}
                            >
                              {labels[pt]} ${price ? (price.priceCents / 100).toFixed(0) : "?"}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {items.length > 0 && (
              <div className="rounded-2xl glass-card p-5 space-y-3" data-testid="card-pricing-summary">
                <h3 className="text-[11px] text-blue-300/25 uppercase tracking-wider font-semibold">Pricing Summary</h3>
                <div className="space-y-1">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-white/40">{items.length} session{items.length !== 1 ? "s" : ""}</span>
                    <span className="text-white/60">${(pricing.subtotal / 100).toFixed(2)}</span>
                  </div>
                  {pricing.discount > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className="text-emerald-400/60">Discount ({pricing.discountLabel})</span>
                      <span className="text-emerald-400/70">-${(pricing.discount / 100).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[15px] font-semibold pt-2 border-t border-white/[0.04]">
                    <span className="text-white/70">Total</span>
                    <span className="text-white" data-testid="text-total">${(pricing.total / 100).toFixed(2)} NZD</span>
                  </div>
                </div>
                {data.discounts.length > 0 && pricing.discount === 0 && (
                  <p className="text-[11px] text-amber-400/50">
                    Book {data.discounts[0]?.minBookings}+ sessions to unlock {data.discounts[0]?.discountPercent}% discount
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1 rounded-xl h-11 text-[14px] border-white/[0.08] text-white/50" data-testid="button-back-step-2">Back</Button>
              <Button
                onClick={() => bookMutation.mutate()}
                disabled={items.length === 0 || bookMutation.isPending}
                className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white border-0 rounded-xl h-11 text-[14px] glow-btn"
                data-testid="button-submit-booking"
              >
                <ShieldCheck className="w-4 h-4 mr-1.5" />
                {bookMutation.isPending ? "Processing..." : pricing.total > 0 ? `Pay $${(pricing.total / 100).toFixed(2)}` : "Confirm Booking"}
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
