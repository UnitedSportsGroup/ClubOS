import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tent, MapPin, Calendar, Users, DollarSign, ArrowLeft, Percent, Clock, ChevronDown, ChevronUp, CheckCircle, Shield, Phone, Mail, ArrowRight } from "lucide-react";
import { initPixel, trackEvent, generateEventId } from "@/lib/meta-pixel";

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200/60 last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-4 text-left cursor-pointer group" data-testid={`faq-toggle`}>
        <span className="text-[15px] font-medium text-slate-800 pr-4 group-hover:text-blue-600 transition-colors">{q}</span>
        {open ? <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />}
      </button>
      {open && <p className="text-[14px] text-slate-600 pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

export default function CampPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";

  const { data, isLoading, error } = useQuery<{
    camp: any;
    pricing: any[];
    dates: any[];
    discounts: any[];
  }>({
    queryKey: ["/api/public/camps", slug],
    queryFn: async () => {
      const res = await fetch(`/api/public/camps/${slug}`);
      if (!res.ok) throw new Error("Camp not found");
      return res.json();
    },
  });

  useEffect(() => {
    if (data?.camp) {
      const pixelId = (import.meta as any).env?.VITE_META_PIXEL_ID;
      if (pixelId) {
        initPixel(pixelId);
        trackEvent("ViewContent", {
          content_name: data.camp.name,
          content_category: "Holiday Camp",
          content_ids: [data.camp.slug],
        });
      }
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-6 py-16 space-y-8">
          <Skeleton className="h-16 w-3/4 bg-slate-100" />
          <Skeleton className="h-48 w-full rounded-2xl bg-slate-100" />
          <Skeleton className="h-32 w-full rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Tent className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-slate-700 mb-2">Camp not found</h2>
          <Link href="/"><Button variant="ghost" className="text-blue-600 rounded-xl">Back to camps</Button></Link>
        </div>
      </div>
    );
  }

  const { camp, pricing, dates, discounts } = data;
  const faq: { q: string; a: string }[] = camp.faqJson ? JSON.parse(camp.faqJson) : [];
  const lowestPrice = pricing.length > 0 ? Math.min(...pricing.map((p: any) => p.priceCents)) : 0;

  const handleBookClick = () => {
    const pixelId = (import.meta as any).env?.VITE_META_PIXEL_ID;
    if (pixelId) {
      trackEvent("InitiateCheckout", {
        content_name: camp.name,
        content_category: "Holiday Camp",
        value: lowestPrice / 100,
        currency: "NZD",
      });
    }
  };

  const sessionTypes: Record<string, { label: string; timeLabel: string }> = {
    MORNING: { label: "Morning", timeLabel: "9:00am – 12:00pm" },
    AFTERNOON: { label: "Afternoon", timeLabel: "1:00pm – 4:00pm" },
    FULL_DAY: { label: "Full Day", timeLabel: "9:00am – 4:00pm" },
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <button className="flex items-center gap-2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[13px] font-medium">All Camps</span>
            </button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
              <span className="text-white font-bold text-[9px]">CU</span>
            </div>
            <span className="text-[12px] text-slate-400 font-medium">Christchurch United FC</span>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(59,130,246,0.3) 0%, transparent 70%)' }} />
        <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-24">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 mb-6">
              <Calendar className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[12px] text-blue-300 font-medium">
                {camp.startDate && camp.endDate ? `${new Date(camp.startDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' })} — ${new Date(camp.endDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Dates TBD'}
              </span>
            </div>
            <h1 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-[1.1] mb-4" data-testid="text-hero-headline">
              {camp.heroHeadline || camp.name}
            </h1>
            <p className="text-[16px] md:text-[18px] text-slate-300 leading-relaxed mb-8 max-w-xl" data-testid="text-hero-sub">
              {camp.heroSubheadline || camp.descriptionShort || camp.description}
            </p>
            <div className="flex flex-wrap gap-4 mb-8">
              {camp.ageMin && camp.ageMax && (
                <div className="flex items-center gap-2 text-[13px] text-slate-400">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span>Ages {camp.ageMin}–{camp.ageMax}</span>
                </div>
              )}
              {camp.location && (
                <div className="flex items-center gap-2 text-[13px] text-slate-400">
                  <MapPin className="w-4 h-4 text-blue-400" />
                  <span>{camp.location}</span>
                </div>
              )}
              {lowestPrice > 0 && (
                <div className="flex items-center gap-2 text-[13px] text-slate-400">
                  <DollarSign className="w-4 h-4 text-blue-400" />
                  <span>From ${(lowestPrice / 100).toFixed(0)}/session</span>
                </div>
              )}
            </div>
            <Link href={`/${slug}/book`}>
              <Button
                onClick={handleBookClick}
                className="bg-blue-600 hover:bg-blue-500 text-white border-0 rounded-xl h-14 px-8 text-[16px] font-semibold shadow-lg shadow-blue-600/25 hover:shadow-blue-500/30 transition-all duration-300 hover:-translate-y-0.5"
                data-testid="button-book-now"
              >
                {camp.primaryCta || "Book Now"} <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 -mt-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: Calendar, label: "Dates", value: camp.startDate && camp.endDate ? `${new Date(camp.startDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} – ${new Date(camp.endDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}` : 'TBD' },
            { icon: Users, label: "Ages", value: camp.ageMin && camp.ageMax ? `${camp.ageMin} – ${camp.ageMax} years` : 'All ages' },
            { icon: MapPin, label: "Venue", value: camp.location || 'TBD' },
            { icon: DollarSign, label: "From", value: lowestPrice > 0 ? `$${(lowestPrice / 100).toFixed(0)} NZD` : 'Free' },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow" data-testid={`info-card-${card.label.toLowerCase()}`}>
              <card.icon className="w-5 h-5 text-blue-600 mb-2" />
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">{card.label}</p>
              <p className="text-[14px] text-slate-800 font-semibold mt-0.5">{card.value}</p>
            </div>
          ))}
        </div>
      </section>

      {(camp.descriptionLong || camp.description) && (
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-4">About This Camp</h2>
            <div className="text-[15px] text-slate-600 leading-relaxed whitespace-pre-line" data-testid="text-about">
              {camp.descriptionLong || camp.description}
            </div>
          </div>
        </section>
      )}

      {pricing.length > 0 && (
        <section className="bg-slate-50 py-16" id="pricing">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Pricing</h2>
            <p className="text-[14px] text-slate-500 mb-8">Choose the session type that works best for your family</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {pricing.map((p: any) => {
                const info = sessionTypes[p.productType] || { label: p.productType, timeLabel: "" };
                const isFullDay = p.productType === "FULL_DAY";
                return (
                  <div key={p.productType} className={`rounded-2xl border-2 p-6 text-center transition-all hover:shadow-lg ${isFullDay ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white border-slate-200 hover:border-blue-300'}`} data-testid={`price-card-${p.productType}`}>
                    {isFullDay && <span className="text-[11px] bg-white/20 text-white px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold mb-3 inline-block">Best Value</span>}
                    <Clock className={`w-6 h-6 mx-auto mb-3 ${isFullDay ? 'text-blue-200' : 'text-blue-500'}`} />
                    <h3 className={`text-[16px] font-semibold ${isFullDay ? 'text-white' : 'text-slate-800'}`}>{info.label}</h3>
                    <p className={`text-[13px] mt-1 ${isFullDay ? 'text-blue-200' : 'text-slate-400'}`}>{info.timeLabel}</p>
                    <p className={`text-3xl font-bold mt-4 ${isFullDay ? 'text-white' : 'text-slate-900'}`}>
                      ${(p.priceCents / 100).toFixed(0)}
                    </p>
                    <p className={`text-[12px] ${isFullDay ? 'text-blue-200' : 'text-slate-400'}`}>NZD per day</p>
                  </div>
                );
              })}
            </div>
            {discounts.length > 0 && (
              <div className="mt-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="flex items-start gap-3">
                  <Percent className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[14px] font-semibold text-emerald-800">Multi-booking discounts</p>
                    {discounts.map((d: any, i: number) => (
                      <p key={i} className="text-[13px] text-emerald-700 mt-0.5">
                        Book {d.minBookings}+ sessions and save {d.discountPercent}%
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {dates.length > 0 && (
        <section className="max-w-5xl mx-auto px-6 py-16">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Camp Schedule</h2>
          <p className="text-[14px] text-slate-500 mb-6">Select your preferred days during booking</p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {dates.map((d: any) => {
              const dateObj = new Date(d.date + 'T12:00:00');
              return (
                <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-4 text-center hover:border-blue-300 hover:shadow-sm transition-all" data-testid={`schedule-date-${d.id}`}>
                  <p className="text-[14px] font-semibold text-slate-800">{dateObj.toLocaleDateString('en-NZ', { weekday: 'short' })}</p>
                  <p className="text-[13px] text-slate-500">{dateObj.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(camp.inclusions || camp.whatToBring) && (
        <section className="bg-slate-50 py-16">
          <div className="max-w-5xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {camp.inclusions && (
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-600" /> What's Included
                  </h2>
                  <div className="space-y-2">
                    {camp.inclusions.split('\n').filter(Boolean).map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="text-[14px] text-slate-600">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {camp.whatToBring && (
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2">
                    <Tent className="w-5 h-5 text-blue-600" /> What to Bring
                  </h2>
                  <div className="space-y-2">
                    {camp.whatToBring.split('\n').filter(Boolean).map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                        <span className="text-[14px] text-slate-600">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {faq.length > 0 && (
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-6">Frequently Asked Questions</h2>
            <div className="rounded-2xl border border-slate-200 bg-white px-6 divide-y divide-slate-100" data-testid="faq-section">
              {faq.map((item, i) => <FAQItem key={i} q={item.q} a={item.a} />)}
            </div>
          </div>
        </section>
      )}

      {camp.refundPolicy && (
        <section className="bg-slate-50 py-12">
          <div className="max-w-3xl mx-auto px-6">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-[14px] font-semibold text-slate-700 mb-1">Refund Policy</h3>
                <p className="text-[13px] text-slate-500 leading-relaxed">{camp.refundPolicy}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="bg-gradient-to-r from-blue-600 to-blue-700 py-16">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold text-white tracking-tight mb-3">
            Ready to Book?
          </h2>
          <p className="text-[15px] text-blue-200 mb-8">Secure your child's spot today. Limited spaces available.</p>
          <Link href={`/${slug}/book`}>
            <Button onClick={handleBookClick} className="bg-white text-blue-700 hover:bg-blue-50 border-0 rounded-xl h-14 px-10 text-[16px] font-semibold shadow-lg hover:-translate-y-0.5 transition-all duration-300" data-testid="button-book-cta-bottom">
              {camp.primaryCta || "Book Now"} <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {camp.contactEmail && (
        <section className="max-w-5xl mx-auto px-6 py-10">
          <div className="text-center">
            <p className="text-[14px] text-slate-500 mb-2">Have questions?</p>
            <a href={`mailto:${camp.contactEmail}`} className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-[14px]" data-testid="link-contact-email">
              <Mail className="w-4 h-4" /> {camp.contactEmail}
            </a>
          </div>
        </section>
      )}

      <footer className="border-t border-slate-100 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-[12px] text-slate-400">© {new Date().getFullYear()} Christchurch United Football Club. All rights reserved.</p>
        </div>
      </footer>

      <div className="fixed bottom-0 left-0 right-0 md:hidden z-50 bg-white border-t border-slate-200 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <Link href={`/${slug}/book`}>
          <Button onClick={handleBookClick} className="w-full bg-blue-600 hover:bg-blue-500 text-white border-0 rounded-xl h-12 text-[15px] font-semibold shadow-lg shadow-blue-600/25" data-testid="button-book-sticky">
            {camp.primaryCta || "Book Now"} — From ${lowestPrice > 0 ? (lowestPrice / 100).toFixed(0) : '0'}/session
          </Button>
        </Link>
      </div>
    </div>
  );
}
