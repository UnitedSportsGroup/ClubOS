import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRoute, Link, useLocation } from "wouter";
import { ArrowLeft, Plus, X, User, Baby, Calendar, DollarSign, ShieldCheck, Clock, ArrowRight, CheckCircle } from "lucide-react";
import { trackEvent, getFbp, getFbc, generateEventId } from "@/lib/meta-pixel";

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
        fbp: getFbp(),
        fbc: getFbc(),
        userAgent: navigator.userAgent,
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
        setLocation(`/${slug}/success?registrationId=${result.registrationId}&total=${result.totalCents}`);
      } else if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        setLocation(`/${slug}/success?registrationId=${result.registrationId}&total=${result.totalCents}`);
      }
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

  useEffect(() => {
    if (step === 3 && items.length > 0) {
      const pixelId = (import.meta as any).env?.VITE_META_PIXEL_ID;
      if (pixelId) {
        trackEvent("InitiateCheckout", {
          content_name: data?.camp?.name,
          value: pricing.total / 100,
          currency: "NZD",
          num_items: items.length,
        });
      }
    }
  }, [step]);

  const sessionTypes: Record<string, { label: string; time: string; color: string }> = {
    MORNING: { label: "Morning", time: "9am–12pm", color: "bg-amber-50 border-amber-200 text-amber-700" },
    AFTERNOON: { label: "Afternoon", time: "1pm–4pm", color: "bg-purple-50 border-purple-200 text-purple-700" },
    FULL_DAY: { label: "Full Day", time: "9am–4pm", color: "bg-blue-50 border-blue-200 text-blue-700" },
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-2xl mx-auto px-6 py-16 space-y-6">
          <Skeleton className="h-10 w-48 bg-slate-100" />
          <Skeleton className="h-[400px] w-full rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const stepLabels = ["Parent Details", "Children", "Sessions & Pay"];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href={`/${slug}`}>
            <button className="flex items-center gap-2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[13px] font-medium">Back</span>
            </button>
          </Link>
          <span className="text-[13px] text-slate-500 font-medium">Book — {data.camp.name}</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center gap-2">
          {stepLabels.map((label, i) => {
            const s = i + 1;
            const active = step === s;
            const done = step > s;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0 transition-all ${done ? 'bg-emerald-100 text-emerald-600' : active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {done ? <CheckCircle className="w-4 h-4" /> : s}
                </div>
                <span className={`text-[12px] font-medium hidden sm:block ${active ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
                {i < 2 && <div className={`flex-1 h-0.5 rounded-full ${done ? 'bg-emerald-200' : 'bg-slate-100'}`} />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2" data-testid="text-step-title">
                <User className="w-5 h-5 text-blue-600" /> Parent / Guardian Details
              </h2>
              <p className="text-[13px] text-slate-500 mt-1">We'll use this to send your booking confirmation</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[12px] text-slate-500 font-medium">First Name *</label>
                  <Input value={parentFirst} onChange={e => setParentFirst(e.target.value)} className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20" placeholder="Jane" data-testid="input-parent-first" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] text-slate-500 font-medium">Last Name *</label>
                  <Input value={parentLast} onChange={e => setParentLast(e.target.value)} className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20" placeholder="Smith" data-testid="input-parent-last" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] text-slate-500 font-medium">Email *</label>
                <Input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20" placeholder="jane@example.com" data-testid="input-parent-email" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12px] text-slate-500 font-medium">Phone</label>
                <Input value={parentPhone} onChange={e => setParentPhone(e.target.value)} className="rounded-xl border-slate-200 focus:border-blue-400 focus:ring-blue-400/20" placeholder="021 123 4567" data-testid="input-parent-phone" />
              </div>
            </div>
            <Button
              onClick={() => setStep(2)}
              disabled={!parentFirst || !parentLast || !parentEmail}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white border-0 rounded-xl h-12 text-[15px] font-semibold shadow-sm"
              data-testid="button-next-step-2"
            >
              Continue <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2" data-testid="text-step-title">
                <Baby className="w-5 h-5 text-blue-600" /> Children
              </h2>
              <p className="text-[13px] text-slate-500 mt-1">Add each child attending the camp</p>
            </div>
            {children.map((child, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm" data-testid={`card-child-${i}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-blue-600 font-semibold">Child {i + 1}</span>
                  {children.length > 1 && (
                    <button onClick={() => removeChild(i)} className="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center hover:bg-red-50 transition-colors cursor-pointer" data-testid={`button-remove-child-${i}`}>
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-slate-500 font-medium">First Name *</label>
                    <Input value={child.firstName} onChange={e => updateChild(i, "firstName", e.target.value)} className="rounded-xl border-slate-200" data-testid={`input-child-first-${i}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-slate-500 font-medium">Last Name *</label>
                    <Input value={child.lastName} onChange={e => updateChild(i, "lastName", e.target.value)} className="rounded-xl border-slate-200" data-testid={`input-child-last-${i}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-slate-500 font-medium">Date of Birth</label>
                    <Input type="date" value={child.dateOfBirth} onChange={e => updateChild(i, "dateOfBirth", e.target.value)} className="rounded-xl border-slate-200" data-testid={`input-child-dob-${i}`} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[12px] text-slate-500 font-medium">Gender</label>
                    <select value={child.gender} onChange={e => updateChild(i, "gender", e.target.value)} className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200 text-[13px] text-slate-700 focus:outline-none focus:border-blue-400" data-testid={`select-child-gender-${i}`}>
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[12px] text-slate-500 font-medium">Allergies / Medical Notes</label>
                  <Input value={child.allergies} onChange={e => updateChild(i, "allergies", e.target.value)} placeholder="None" className="rounded-xl border-slate-200" data-testid={`input-child-allergies-${i}`} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={child.epiPen} onChange={e => updateChild(i, "epiPen", e.target.checked)} className="rounded" data-testid={`input-child-epipen-${i}`} />
                  <span className="text-[13px] text-slate-600">Child carries an EpiPen</span>
                </label>
              </div>
            ))}
            <button onClick={addChild} className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 text-[13px] text-slate-500 font-medium hover:border-blue-300 hover:text-blue-600 transition-all cursor-pointer flex items-center justify-center gap-1.5" data-testid="button-add-child">
              <Plus className="w-4 h-4" /> Add Another Child
            </button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1 rounded-xl h-12 text-[14px] border-slate-200 text-slate-600" data-testid="button-back-step-1">Back</Button>
              <Button
                onClick={() => setStep(3)}
                disabled={!children.some(c => c.firstName && c.lastName)}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white border-0 rounded-xl h-12 text-[14px] font-semibold shadow-sm"
                data-testid="button-next-step-3"
              >
                Choose Sessions <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2" data-testid="text-step-title">
                <Calendar className="w-5 h-5 text-blue-600" /> Choose Sessions
              </h2>
              <p className="text-[13px] text-slate-500 mt-1">Tap to select session types for each day</p>
            </div>

            {children.filter(c => c.firstName).map((child, childIndex) => (
              <div key={childIndex} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm" data-testid={`booking-child-${childIndex}`}>
                <h3 className="text-[14px] font-semibold text-slate-700">{child.firstName} {child.lastName}</h3>
                <div className="space-y-3">
                  {data.dates.map((d: any) => {
                    const dateObj = new Date(d.date + 'T12:00:00');
                    const dateLabel = dateObj.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <div key={d.id} className="flex items-center gap-3 flex-wrap">
                        <span className="text-[13px] text-slate-500 font-medium w-28 flex-shrink-0">{dateLabel}</span>
                        <div className="flex gap-2">
                          {(["MORNING", "AFTERNOON", "FULL_DAY"] as const).map(pt => {
                            const isSelected = items.some(i => i.childIndex === childIndex && i.campDateId === d.id && i.productType === pt);
                            const price = data.pricing.find((p: any) => p.productType === pt);
                            const info = sessionTypes[pt];
                            return (
                              <button
                                key={pt}
                                onClick={() => toggleItem(childIndex, d.id, pt, dateLabel)}
                                className={`px-3 py-2 rounded-xl text-[12px] font-medium transition-all cursor-pointer border ${
                                  isSelected
                                    ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                                    : "bg-white border-slate-200 text-slate-600 hover:border-blue-300"
                                }`}
                                data-testid={`toggle-${childIndex}-${d.id}-${pt}`}
                              >
                                <span className="block">{info.label}</span>
                                <span className={`text-[10px] ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>${price ? (price.priceCents / 100).toFixed(0) : "?"}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {items.length > 0 && (
              <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/50 p-6 space-y-3" data-testid="card-pricing-summary">
                <h3 className="text-[13px] text-blue-800 font-semibold flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4" /> Pricing Summary
                </h3>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[14px]">
                    <span className="text-slate-600">{items.length} session{items.length !== 1 ? "s" : ""}</span>
                    <span className="text-slate-700 font-medium">${(pricing.subtotal / 100).toFixed(2)}</span>
                  </div>
                  {pricing.discount > 0 && (
                    <div className="flex justify-between text-[14px]">
                      <span className="text-emerald-600">Discount ({pricing.discountLabel})</span>
                      <span className="text-emerald-600 font-medium">-${(pricing.discount / 100).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[16px] font-bold pt-2 border-t border-blue-200/50">
                    <span className="text-slate-800">Total</span>
                    <span className="text-slate-900" data-testid="text-total">${(pricing.total / 100).toFixed(2)} NZD</span>
                  </div>
                </div>
                {data.discounts.length > 0 && pricing.discount === 0 && (
                  <p className="text-[12px] text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
                    Book {data.discounts[0]?.minBookings}+ sessions to unlock {data.discounts[0]?.discountPercent}% discount
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1 rounded-xl h-12 text-[14px] border-slate-200 text-slate-600" data-testid="button-back-step-2">Back</Button>
              <Button
                onClick={() => bookMutation.mutate()}
                disabled={items.length === 0 || bookMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white border-0 rounded-xl h-12 text-[15px] font-semibold shadow-lg shadow-blue-600/20"
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
