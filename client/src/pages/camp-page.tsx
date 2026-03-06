import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tent, MapPin, Calendar, Users, DollarSign, ArrowLeft, ArrowRight, Percent, Clock, ChevronDown, ChevronUp, CheckCircle, Shield, Mail, Star, ChevronRight, ChevronLeft } from "lucide-react";
import { initPixel, trackEvent } from "@/lib/meta-pixel";
import cuFcLogoPath from "@assets/CUFC_LOGO_1772823768518.png";

const BRAND = {
  blue: "#22399B",
  white: "#FBFBFC",
  gold: "#D9B10F",
  darkBlue: "#221F7A",
};

const reviews = [
  {
    highlight: "Best Holiday Camp in Canterbury",
    text: "My kids have been going to CUFC holiday camps since they were 4 years old. The coaches are amazing, the activities are fun, and they come home exhausted and happy every single day. Wouldn't send them anywhere else.",
    name: "Sarah Mitchell",
    role: "Parent of 2",
    stars: 5,
  },
  {
    highlight: "My Son's Confidence Has Skyrocketed",
    text: "He used to be so shy on the field, but after just one camp he was running around making friends and loving every minute. The coaches really know how to bring out the best in every child regardless of ability.",
    name: "James Crawford",
    role: "Parent",
    stars: 5,
  },
  {
    highlight: "Worth Every Single Dollar",
    text: "We've tried other holiday programmes and nothing compares. The organisation, the skill development, and the genuine care the coaches show — it's a level above. Our daughter asks to go back every holidays.",
    name: "Michelle Thompson",
    role: "Parent of 3",
    stars: 5,
  },
  {
    highlight: "Safe, Fun and Professional",
    text: "As a parent, safety is my number one priority. CUFC runs an incredibly well-organised camp with proper check-in procedures and qualified coaches. My kids have a blast and I have complete peace of mind.",
    name: "David Chen",
    role: "Parent",
    stars: 5,
  },
  {
    highlight: "They Actually Learn Real Skills",
    text: "It's not just babysitting — my children genuinely improve their football skills every camp. The drills are age-appropriate and the coaches make learning fun. Both my boys can't wait for the next school holidays.",
    name: "Rachel Nguyen",
    role: "Parent of 2",
    stars: 5,
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200/60 last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-4 text-left cursor-pointer group" data-testid={`faq-toggle-${index}`}>
        <span className="font-semibold text-[15px] text-slate-800 pr-4 group-hover:text-[#22399B] transition-colors" style={{ fontFamily: "'Inter Tight', sans-serif" }}>{q}</span>
        {open ? <ChevronUp className="w-5 h-5 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-slate-400 flex-shrink-0" />}
      </button>
      {open && <p className="text-[14px] text-slate-600 pb-4 leading-relaxed" style={{ fontFamily: "'Inter Tight', sans-serif" }}>{a}</p>}
    </div>
  );
}

function ReviewCard({ review, index }: { review: typeof reviews[0]; index: number }) {
  return (
    <div
      className="min-w-[320px] sm:min-w-[380px] bg-white rounded-2xl border border-slate-100 p-6 sm:p-8 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow duration-300"
      style={{ fontFamily: "'Inter Tight', sans-serif", animationDelay: `${index * 100}ms` }}
      data-testid={`review-card-${index}`}
    >
      <div className="flex gap-1">
        {Array.from({ length: review.stars }).map((_, i) => (
          <Star key={i} className="w-4 h-4 fill-[#D9B10F] text-[#D9B10F]" />
        ))}
      </div>
      <h4 className="text-[17px] font-bold text-slate-900 leading-snug">{review.highlight}</h4>
      <p className="text-[14px] text-slate-500 leading-relaxed flex-1">"{review.text}"</p>
      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-bold" style={{ background: BRAND.blue }}>
          {review.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <p className="text-[14px] font-semibold text-slate-800">{review.name}</p>
          <p className="text-[12px] text-slate-400">{review.role}</p>
        </div>
      </div>
    </div>
  );
}

export default function CampPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const reviewsRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const wistiaScript = document.createElement("script");
    wistiaScript.src = "https://fast.wistia.com/embed/medias/0l469en6m5.jsonp";
    wistiaScript.async = true;
    document.head.appendChild(wistiaScript);

    const wistiaLib = document.createElement("script");
    wistiaLib.src = "https://fast.wistia.com/assets/external/E-v1.js";
    wistiaLib.async = true;
    document.head.appendChild(wistiaLib);

    return () => {
      document.head.removeChild(wistiaScript);
      document.head.removeChild(wistiaLib);
    };
  }, []);

  const scrollReviews = (direction: "left" | "right") => {
    if (reviewsRef.current) {
      const scrollAmount = 400;
      reviewsRef.current.scrollBy({
        left: direction === "right" ? scrollAmount : -scrollAmount,
        behavior: "smooth",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen" style={{ background: BRAND.white, fontFamily: "'Inter Tight', sans-serif" }}>
        <div className="max-w-4xl mx-auto px-6 py-16 space-y-8">
          <Skeleton className="h-16 w-16 rounded-full mx-auto bg-slate-100" />
          <Skeleton className="h-12 w-3/4 mx-auto bg-slate-100" />
          <Skeleton className="h-6 w-1/2 mx-auto bg-slate-100" />
          <Skeleton className="h-[400px] w-full rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.white, fontFamily: "'Inter Tight', sans-serif" }}>
        <div className="text-center">
          <Tent className="w-16 h-16 text-slate-200 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-700 mb-2">Camp not found</h2>
          <Link href="/"><Button variant="ghost" className="text-[#22399B] rounded-xl">Back to camps</Button></Link>
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
    <div className="min-h-screen" style={{ fontFamily: "'Inter Tight', sans-serif" }}>

      <header className="sticky top-0 z-50 backdrop-blur-lg border-b" style={{ background: 'rgba(10,14,26,0.85)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <button className="flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[13px] font-medium">All Camps</span>
            </button>
          </Link>
          <div className="flex items-center gap-2.5">
            <img src={cuFcLogoPath} alt="CUFC" className="w-7 h-7 object-contain" />
            <span className="text-[12px] text-white/40 font-medium hidden sm:inline">Christchurch United FC</span>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, #0a0e1a 0%, ${BRAND.darkBlue} 40%, ${BRAND.blue} 100%)` }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-[0.07] rounded-full" style={{ background: `radial-gradient(ellipse, ${BRAND.gold} 0%, transparent 70%)` }} />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>

        <div className="relative max-w-3xl mx-auto px-6 pt-12 pb-16 md:pt-16 md:pb-20">
          <div className="flex flex-col items-center text-center">
            <div className="mb-8 animate-[fadeInDown_0.6s_ease-out]">
              <img
                src={cuFcLogoPath}
                alt="Christchurch United FC"
                className="w-20 h-20 md:w-24 md:h-24 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
                data-testid="img-club-logo"
              />
            </div>

            <h1
              className="text-3xl sm:text-4xl md:text-5xl lg:text-[56px] font-bold tracking-tight leading-[1.08] mb-5 animate-[fadeInUp_0.7s_ease-out]"
              style={{ color: BRAND.white }}
              data-testid="text-hero-headline"
            >
              {camp.heroHeadline || camp.name}
            </h1>

            <p
              className="text-[16px] sm:text-[18px] md:text-[20px] leading-relaxed mb-10 max-w-xl animate-[fadeInUp_0.8s_ease-out]"
              style={{ color: 'rgba(251,251,252,0.6)' }}
              data-testid="text-hero-sub"
            >
              {camp.heroSubheadline || camp.descriptionShort || "Fun, engaging football camps for young players. Build confidence, make friends, and fall in love with football."}
            </p>

            <div className="w-full max-w-[720px] mb-10 animate-[fadeInUp_0.9s_ease-out]">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/40" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="wistia_responsive_padding" style={{ padding: '56.25% 0 0 0', position: 'relative' }}>
                  <div className="wistia_responsive_wrapper" style={{ height: '100%', left: 0, position: 'absolute', top: 0, width: '100%' }}>
                    <div className="wistia_embed wistia_async_0l469en6m5 seo=true videoFoam=true" style={{ height: '100%', position: 'relative', width: '100%' }}>
                      <div className="wistia_swatch" style={{ height: '100%', left: 0, opacity: 0, overflow: 'hidden', position: 'absolute', top: 0, transition: 'opacity 200ms', width: '100%' }}>
                        <img
                          src="https://fast.wistia.com/embed/medias/0l469en6m5/swatch"
                          style={{ filter: 'blur(5px)', height: '100%', objectFit: 'contain', width: '100%' }}
                          alt="Video thumbnail"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="animate-[fadeInUp_1s_ease-out]">
              <Link href={`/${slug}/book`}>
                <button
                  onClick={handleBookClick}
                  className="group relative inline-flex items-center gap-2 px-10 py-4 text-[16px] font-bold rounded-full transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
                  style={{
                    background: BRAND.white,
                    color: BRAND.blue,
                    boxShadow: `0 4px 24px rgba(34,57,155,0.3), 0 0 0 1px rgba(255,255,255,0.1)`,
                  }}
                  data-testid="button-book-now"
                >
                  {camp.primaryCta || "Book Now"}
                  <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              </Link>
            </div>

            <div className="mt-14 animate-[fadeInUp_1.1s_ease-out]">
              <p className="text-[11px] sm:text-[12px] uppercase tracking-[0.2em] font-semibold mb-3" style={{ color: 'rgba(251,251,252,0.3)' }}>
                Trusted by 1,000+ Parents since 2014
              </p>
              <div className="flex items-center justify-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-[#D9B10F] text-[#D9B10F]" />
                ))}
                <span className="ml-2 text-[13px] font-semibold" style={{ color: 'rgba(251,251,252,0.5)' }}>5.0</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-14 md:py-20 overflow-hidden" style={{ background: '#f8f9fb' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
                What Parents Are Saying
              </h2>
              <p className="text-[14px] text-slate-400 mt-1">Real reviews from real families</p>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={() => scrollReviews("left")}
                className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors cursor-pointer"
                data-testid="button-reviews-left"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => scrollReviews("right")}
                className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors cursor-pointer"
                data-testid="button-reviews-right"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div
            ref={reviewsRef}
            className="flex gap-5 overflow-x-auto scrollbar-hide pb-4 -mx-6 px-6 snap-x snap-mandatory"
            data-testid="reviews-carousel"
          >
            {reviews.map((review, i) => (
              <div key={i} className="snap-start">
                <ReviewCard review={review} index={i} />
              </div>
            ))}
          </div>

          <div className="flex sm:hidden items-center justify-center gap-2 mt-6">
            <button
              onClick={() => scrollReviews("left")}
              className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors cursor-pointer"
              data-testid="button-reviews-left-mobile"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => scrollReviews("right")}
              className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors cursor-pointer"
              data-testid="button-reviews-right-mobile"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-14 md:py-20">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Calendar, label: "Dates", value: camp.startDate && camp.endDate ? `${new Date(camp.startDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })} – ${new Date(camp.endDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}` : 'TBD' },
            { icon: Users, label: "Ages", value: camp.ageMin && camp.ageMax ? `${camp.ageMin} – ${camp.ageMax} years` : 'All ages' },
            { icon: MapPin, label: "Venue", value: camp.location || 'TBD' },
            { icon: DollarSign, label: "From", value: lowestPrice > 0 ? `$${(lowestPrice / 100).toFixed(0)} NZD` : 'Free' },
          ].map((card, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5" data-testid={`info-card-${card.label.toLowerCase()}`}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: `${BRAND.blue}0D` }}>
                <card.icon className="w-5 h-5" style={{ color: BRAND.blue }} />
              </div>
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">{card.label}</p>
              <p className="text-[15px] text-slate-800 font-bold mt-0.5" style={{ fontFamily: "'Inter Tight', sans-serif" }}>{card.value}</p>
            </div>
          ))}
        </div>
      </section>

      {(camp.descriptionLong || camp.description) && (
        <section className="max-w-5xl mx-auto px-6 pb-14 md:pb-20">
          <div className="max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-5">About This Camp</h2>
            <div className="text-[15px] text-slate-600 leading-[1.8] whitespace-pre-line" data-testid="text-about" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
              {camp.descriptionLong || camp.description}
            </div>
          </div>
        </section>
      )}

      {pricing.length > 0 && (
        <section className="py-14 md:py-20" style={{ background: '#f8f9fb' }} id="pricing">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Pricing</h2>
            <p className="text-[14px] text-slate-500 mb-8" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Choose the session type that works best for your family</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {pricing.map((p: any) => {
                const info = sessionTypes[p.productType] || { label: p.productType, timeLabel: "" };
                const isFullDay = p.productType === "FULL_DAY";
                return (
                  <div
                    key={p.productType}
                    className={`rounded-2xl border-2 p-7 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${isFullDay ? 'text-white shadow-xl' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                    style={isFullDay ? { background: BRAND.blue, borderColor: BRAND.blue } : {}}
                    data-testid={`price-card-${p.productType}`}
                  >
                    {isFullDay && <span className="text-[11px] bg-white/20 text-white px-3 py-1 rounded-full uppercase tracking-wider font-bold mb-4 inline-block">Best Value</span>}
                    <Clock className={`w-7 h-7 mx-auto mb-3 ${isFullDay ? 'text-blue-200' : ''}`} style={!isFullDay ? { color: BRAND.blue } : {}} />
                    <h3 className={`text-[17px] font-bold ${isFullDay ? 'text-white' : 'text-slate-800'}`}>{info.label}</h3>
                    <p className={`text-[13px] mt-1 ${isFullDay ? 'text-blue-200' : 'text-slate-400'}`}>{info.timeLabel}</p>
                    <p className={`text-4xl font-bold mt-5 ${isFullDay ? 'text-white' : 'text-slate-900'}`}>
                      ${(p.priceCents / 100).toFixed(0)}
                    </p>
                    <p className={`text-[12px] ${isFullDay ? 'text-blue-200' : 'text-slate-400'}`}>NZD per day</p>
                  </div>
                );
              })}
            </div>
            {discounts.length > 0 && (
              <div className="mt-8 p-5 rounded-2xl bg-emerald-50 border border-emerald-200">
                <div className="flex items-start gap-3">
                  <Percent className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-[14px] font-bold text-emerald-800">Multi-booking discounts</p>
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
        <section className="max-w-5xl mx-auto px-6 py-14 md:py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Camp Schedule</h2>
          <p className="text-[14px] text-slate-500 mb-8" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Select your preferred days during booking</p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {dates.map((d: any) => {
              const dateObj = new Date(d.date + 'T12:00:00');
              return (
                <div key={d.id} className="rounded-2xl border border-slate-100 bg-white p-4 text-center hover:border-slate-200 hover:shadow-sm transition-all duration-300" data-testid={`schedule-date-${d.id}`}>
                  <p className="text-[14px] font-bold text-slate-800">{dateObj.toLocaleDateString('en-NZ', { weekday: 'short' })}</p>
                  <p className="text-[13px] text-slate-500">{dateObj.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(camp.inclusions || camp.whatToBring) && (
        <section className="py-14 md:py-20" style={{ background: '#f8f9fb' }}>
          <div className="max-w-5xl mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {camp.inclusions && (
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-5 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-emerald-600" /> What's Included
                  </h2>
                  <div className="space-y-3">
                    {camp.inclusions.split('\n').filter(Boolean).map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <span className="text-[14px] text-slate-600" style={{ fontFamily: "'Inter Tight', sans-serif" }}>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {camp.whatToBring && (
                <div>
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-5 flex items-center gap-2">
                    <Tent className="w-5 h-5" style={{ color: BRAND.blue }} /> What to Bring
                  </h2>
                  <div className="space-y-3">
                    {camp.whatToBring.split('\n').filter(Boolean).map((item: string, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: BRAND.blue }} />
                        <span className="text-[14px] text-slate-600" style={{ fontFamily: "'Inter Tight', sans-serif" }}>{item}</span>
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
        <section className="max-w-5xl mx-auto px-6 py-14 md:py-20">
          <div className="max-w-3xl">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-8">Frequently Asked Questions</h2>
            <div className="rounded-2xl border border-slate-100 bg-white px-6 sm:px-8 divide-y divide-slate-100 shadow-sm" data-testid="faq-section">
              {faq.map((item, i) => <FAQItem key={i} q={item.q} a={item.a} index={i} />)}
            </div>
          </div>
        </section>
      )}

      {camp.refundPolicy && (
        <section className="py-12" style={{ background: '#f8f9fb' }}>
          <div className="max-w-3xl mx-auto px-6">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-[14px] font-bold text-slate-700 mb-1">Refund Policy</h3>
                <p className="text-[13px] text-slate-500 leading-relaxed" style={{ fontFamily: "'Inter Tight', sans-serif" }}>{camp.refundPolicy}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="relative overflow-hidden py-20" style={{ background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)` }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-[400px] h-[400px] opacity-[0.08] rounded-full" style={{ background: `radial-gradient(circle, ${BRAND.gold} 0%, transparent 70%)` }} />
        </div>
        <div className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{ color: BRAND.white }}>
            Ready to Book?
          </h2>
          <p className="text-[15px] sm:text-[17px] mb-10" style={{ color: 'rgba(251,251,252,0.6)' }}>
            Secure your child's spot today. Limited spaces available.
          </p>
          <Link href={`/${slug}/book`}>
            <button
              onClick={handleBookClick}
              className="group relative inline-flex items-center gap-2 px-10 py-4 text-[16px] font-bold rounded-full transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
              style={{
                background: BRAND.white,
                color: BRAND.blue,
                boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
              }}
              data-testid="button-book-cta-bottom"
            >
              {camp.primaryCta || "Book Now"}
              <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </Link>
        </div>
      </section>

      {camp.contactEmail && (
        <section className="max-w-5xl mx-auto px-6 py-10">
          <div className="text-center">
            <p className="text-[14px] text-slate-500 mb-2" style={{ fontFamily: "'Inter Tight', sans-serif" }}>Have questions?</p>
            <a href={`mailto:${camp.contactEmail}`} className="inline-flex items-center gap-2 font-semibold text-[14px] hover:opacity-80 transition-opacity" style={{ color: BRAND.blue }} data-testid="link-contact-email">
              <Mail className="w-4 h-4" /> {camp.contactEmail}
            </a>
          </div>
        </section>
      )}

      <footer className="border-t border-slate-100 py-8">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-[12px] text-slate-400" style={{ fontFamily: "'Inter Tight', sans-serif" }}>
            &copy; {new Date().getFullYear()} Christchurch United Football Club. All rights reserved.
          </p>
        </div>
      </footer>

      <div className="fixed bottom-0 left-0 right-0 md:hidden z-50 bg-white/95 backdrop-blur-lg border-t border-slate-200 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <Link href={`/${slug}/book`}>
          <button
            onClick={handleBookClick}
            className="w-full py-3.5 text-[15px] font-bold rounded-full transition-all duration-300 cursor-pointer"
            style={{ background: BRAND.blue, color: BRAND.white }}
            data-testid="button-book-sticky"
          >
            {camp.primaryCta || "Book Now"} — From ${lowestPrice > 0 ? (lowestPrice / 100).toFixed(0) : '0'}/session
          </button>
        </Link>
      </div>

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
