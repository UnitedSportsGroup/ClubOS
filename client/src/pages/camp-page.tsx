import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Tent, MapPin, Calendar, Users, DollarSign, ArrowRight, Clock, ChevronDown, ChevronUp, Star, ChevronRight, ChevronLeft, Shield, Sparkles, Heart, Zap, Gamepad2, UserPlus, Sun, CloudRain, CalendarCheck, HelpCircle } from "lucide-react";
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

const defaultFaq = [
  { q: "Does my child need football experience?", a: "Not at all! Our camps are designed for all skill levels. Whether your child is kicking a ball for the first time or already plays in a team, our coaches adapt activities so everyone has fun and improves." },
  { q: "What should they bring?", a: "Comfortable sports clothing, shin pads, boots or trainers, a water bottle, and sunscreen. For full-day campers, please pack a lunch and snacks. We provide all footballs and equipment." },
  { q: "What happens if it rains?", a: "Our camps run rain or shine! We have access to covered and indoor facilities at the Christchurch Football Centre, so your child will always have a great experience regardless of weather." },
  { q: "Can I book multiple days?", a: "Absolutely! You can pick and choose individual days or book the full week. Multi-day bookings receive automatic discounts at checkout." },
  { q: "Does my child need to be a CUFC player?", a: "No — our holiday camps are open to all children in the community, regardless of which club they play for or whether they play at all. Everyone is welcome." },
];

const schedule = [
  { time: "9:00 AM", label: "Drop Off & Welcome Games", highlight: false },
  { time: "9:30 AM", label: "Skill Activities & Ball Mastery", highlight: false },
  { time: "10:15 AM", label: "Fun Challenges & Small Games", highlight: false },
  { time: "11:00 AM", label: "Match Play & Themed Games", highlight: false },
  { time: "12:00 PM", label: "Morning Session Pick Up", highlight: true },
  { time: "1:00 PM", label: "Afternoon Session Drop Off", highlight: true },
  { time: "3:00 PM", label: "Afternoon / Full Day Pick Up", highlight: true },
];

const trustPoints = [
  { icon: Shield, title: "Trusted Since 2014", desc: "Canterbury families have relied on CUFC for over a decade" },
  { icon: Heart, title: "Safe & Supervised", desc: "Proper check-in procedures with qualified, vetted coaches" },
  { icon: Zap, title: "Professional Facilities", desc: "Christchurch Football Centre — purpose-built for football" },
  { icon: Sparkles, title: "Fun First, Skills Second", desc: "Every child leaves smiling, confident, and wanting to come back" },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-4 sm:py-5 text-left cursor-pointer group" data-testid={`faq-toggle-${index}`}>
        <span className="font-semibold text-[14px] sm:text-[15px] text-slate-800 pr-4 group-hover:text-[#22399B] transition-colors">{q}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </button>
      {open && <p className="text-[13px] sm:text-[14px] text-slate-500 pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

function ReviewCard({ review, index }: { review: typeof reviews[0]; index: number }) {
  return (
    <div
      className="min-w-[300px] sm:min-w-[360px] bg-white rounded-2xl border border-slate-100 p-6 sm:p-7 flex flex-col gap-3.5 shadow-sm hover:shadow-md transition-shadow duration-300"
      data-testid={`review-card-${index}`}
    >
      <div className="flex gap-0.5">
        {Array.from({ length: review.stars }).map((_, i) => (
          <Star key={i} className="w-3.5 h-3.5 fill-[#D9B10F] text-[#D9B10F]" />
        ))}
      </div>
      <h4 className="text-[16px] font-bold text-slate-900 leading-snug">{review.highlight}</h4>
      <p className="text-[13px] sm:text-[14px] text-slate-500 leading-relaxed flex-1">"{review.text}"</p>
      <div className="flex items-center gap-3 pt-3 border-t border-slate-50">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold" style={{ background: BRAND.blue }}>
          {review.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div>
          <p className="text-[13px] font-semibold text-slate-800">{review.name}</p>
          <p className="text-[11px] text-slate-400">{review.role}</p>
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
      try { document.head.removeChild(wistiaScript); } catch {}
      try { document.head.removeChild(wistiaLib); } catch {}
    };
  }, []);

  const scrollReviews = (direction: "left" | "right") => {
    if (reviewsRef.current) {
      reviewsRef.current.scrollBy({
        left: direction === "right" ? 400 : -400,
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
          <Skeleton className="h-[300px] w-full rounded-2xl bg-slate-100" />
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
          <Link href="/"><button className="text-[#22399B] text-[14px] font-semibold hover:underline cursor-pointer" data-testid="link-back">Back to camps</button></Link>
        </div>
      </div>
    );
  }

  const { camp, pricing, dates, discounts } = data;
  let faq: { q: string; a: string }[] = [];
  try { faq = camp.faqJson ? JSON.parse(camp.faqJson) : []; } catch { faq = []; }
  const faqItems = faq.length > 0 ? faq : defaultFaq;
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

  const dateRange = camp.startDate && camp.endDate
    ? `${new Date(camp.startDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric' })}–${new Date(camp.endDate + 'T12:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' })}`
    : 'TBD';

  return (
    <div className="min-h-screen" style={{ fontFamily: "'Inter Tight', sans-serif" }}>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — HERO
      ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, #0a0e1a 0%, ${BRAND.darkBlue} 40%, ${BRAND.blue} 100%)` }}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] opacity-[0.07] rounded-full" style={{ background: `radial-gradient(ellipse, ${BRAND.gold} 0%, transparent 70%)` }} />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>

        <div className="relative max-w-3xl mx-auto px-6 pt-8 pb-10 md:pt-10 md:pb-12">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 animate-[fadeInDown_0.6s_ease-out]">
              <img
                src={cuFcLogoPath}
                alt="Christchurch United FC"
                className="w-14 h-14 md:w-18 md:h-18 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
                data-testid="img-club-logo"
              />
            </div>

            <h1
              className="text-[28px] sm:text-4xl md:text-5xl lg:text-[52px] font-bold tracking-tight leading-[1.08] mb-3 animate-[fadeInUp_0.7s_ease-out]"
              style={{ color: BRAND.white }}
              data-testid="text-hero-headline"
            >
              {camp.heroHeadline || camp.name}
            </h1>

            <p
              className="text-[14px] sm:text-[16px] md:text-[18px] leading-relaxed mb-6 max-w-xl animate-[fadeInUp_0.8s_ease-out]"
              style={{ color: 'rgba(251,251,252,0.55)' }}
              data-testid="text-hero-sub"
            >
              {camp.heroSubheadline || camp.descriptionShort || "Fun, engaging football camps for young players. Build confidence, make friends, and fall in love with football."}
            </p>

            <div className="w-full max-w-[680px] mb-6 animate-[fadeInUp_0.9s_ease-out]">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-black/40" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="wistia_responsive_padding" style={{ padding: '56.25% 0 0 0', position: 'relative' }}>
                  <div className="wistia_responsive_wrapper" style={{ height: '100%', left: 0, position: 'absolute', top: 0, width: '100%' }}>
                    <div className="wistia_embed wistia_async_0l469en6m5 seo=true videoFoam=true" style={{ height: '100%', position: 'relative', width: '100%' }}>
                      <div className="wistia_swatch" style={{ height: '100%', left: 0, opacity: 0, overflow: 'hidden', position: 'absolute', top: 0, transition: 'opacity 200ms', width: '100%' }}>
                        <img src="https://fast.wistia.com/embed/medias/0l469en6m5/swatch" style={{ filter: 'blur(5px)', height: '100%', objectFit: 'contain', width: '100%' }} alt="" />
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
                  className="group relative inline-flex items-center gap-2 px-10 py-3.5 text-[15px] font-bold rounded-full transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
                  style={{ background: BRAND.white, color: BRAND.blue, boxShadow: '0 4px 24px rgba(34,57,155,0.3)' }}
                  data-testid="button-book-now"
                >
                  {camp.primaryCta || "Book Now"}
                  <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              </Link>
            </div>

            <div className="mt-6 animate-[fadeInUp_1.1s_ease-out]">
              <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.2em] font-semibold mb-2" style={{ color: 'rgba(251,251,252,0.28)' }}>
                Trusted by 1,000+ Parents since 2014
              </p>
              <div className="flex items-center justify-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-[#D9B10F] text-[#D9B10F]" />
                ))}
                <span className="ml-1.5 text-[12px] font-semibold" style={{ color: 'rgba(251,251,252,0.4)' }}>5.0</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — TESTIMONIALS
      ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-16 overflow-hidden" style={{ background: '#f8f9fb' }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
                What Parents Are Saying
              </h2>
              <p className="text-[13px] text-slate-400 mt-0.5">Real reviews from real families</p>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <button onClick={() => scrollReviews("left")} className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors cursor-pointer" data-testid="button-reviews-left">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => scrollReviews("right")} className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-colors cursor-pointer" data-testid="button-reviews-right">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div ref={reviewsRef} className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-6 px-6 snap-x snap-mandatory" data-testid="reviews-carousel">
            {reviews.map((review, i) => (
              <div key={i} className="snap-start"><ReviewCard review={review} index={i} /></div>
            ))}
          </div>
          <div className="flex sm:hidden items-center justify-center gap-2 mt-4">
            <button onClick={() => scrollReviews("left")} className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 cursor-pointer" data-testid="button-reviews-left-mobile"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => scrollReviews("right")} className="w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 cursor-pointer" data-testid="button-reviews-right-mobile"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — KEY INFORMATION
      ═══════════════════════════════════════════════════════════════ */}
      <section className="relative py-14 md:py-20 overflow-hidden" style={{ background: BRAND.darkBlue }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] opacity-[0.08] rounded-full" style={{ background: `radial-gradient(ellipse, ${BRAND.gold} 0%, transparent 70%)` }} />
        </div>
        <div className="relative max-w-5xl mx-auto px-6">
          <h2
            className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-center mb-12"
            style={{ background: `linear-gradient(180deg, #E8C840 0%, #D9B10F 50%, #B8940A 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            data-testid="text-key-info-heading"
          >
            Key Information
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">

            <div className="group relative rounded-2xl p-[1px] transition-all duration-500 hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, rgba(217,177,15,0.3) 0%, rgba(34,57,155,0.2) 50%, rgba(217,177,15,0.3) 100%)` }} data-testid="info-card-age">
              <div className="relative rounded-2xl p-5 text-center h-full overflow-hidden" style={{ background: 'rgba(14,12,62,0.85)' }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 100%, rgba(217,177,15,0.1) 0%, transparent 70%)` }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60%] h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, transparent, ${BRAND.gold}, transparent)`, boxShadow: `0 0 12px ${BRAND.gold}, 0 0 24px ${BRAND.gold}40` }} />
                <div className="relative z-10">
                  <Users className="w-5 h-5 mx-auto mb-2.5" style={{ color: `${BRAND.gold}99` }} />
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: 'rgba(251,251,252,0.4)' }}>Age</p>
                  <p className="text-[15px] font-bold text-white">3–8 Years</p>
                </div>
              </div>
            </div>

            <div className="group relative rounded-2xl p-[1px] transition-all duration-500 hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, rgba(217,177,15,0.3) 0%, rgba(34,57,155,0.2) 50%, rgba(217,177,15,0.3) 100%)` }} data-testid="info-card-dates">
              <div className="relative rounded-2xl p-5 text-center h-full overflow-hidden" style={{ background: 'rgba(14,12,62,0.85)' }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 100%, rgba(217,177,15,0.1) 0%, transparent 70%)` }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60%] h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, transparent, ${BRAND.gold}, transparent)`, boxShadow: `0 0 12px ${BRAND.gold}, 0 0 24px ${BRAND.gold}40` }} />
                <div className="relative z-10">
                  <Calendar className="w-5 h-5 mx-auto mb-2.5" style={{ color: `${BRAND.gold}99` }} />
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: 'rgba(251,251,252,0.4)' }}>Dates</p>
                  <p className="text-[13px] font-bold leading-snug text-white">
                    Week 1: 6–10 April
                  </p>
                  <p className="text-[13px] font-bold leading-snug text-white">
                    Week 2: 13–17 April
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: 'rgba(251,251,252,0.35)' }}>Mon – Fri</p>
                </div>
              </div>
            </div>

            <div className="group relative rounded-2xl p-[1px] transition-all duration-500 hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, rgba(217,177,15,0.3) 0%, rgba(34,57,155,0.2) 50%, rgba(217,177,15,0.3) 100%)` }} data-testid="info-card-location">
              <div className="relative rounded-2xl p-5 text-center h-full overflow-hidden" style={{ background: 'rgba(14,12,62,0.85)' }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 100%, rgba(217,177,15,0.1) 0%, transparent 70%)` }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60%] h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, transparent, ${BRAND.gold}, transparent)`, boxShadow: `0 0 12px ${BRAND.gold}, 0 0 24px ${BRAND.gold}40` }} />
                <div className="relative z-10">
                  <MapPin className="w-5 h-5 mx-auto mb-2.5" style={{ color: `${BRAND.gold}99` }} />
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: 'rgba(251,251,252,0.4)' }}>Drop Off + Pick Up</p>
                  <p className="text-[14px] font-bold text-white">United Sports Centre</p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'rgba(251,251,252,0.45)' }}>466 Yaldhurst Road</p>
                </div>
              </div>
            </div>

            <div className="group relative rounded-2xl p-[1px] transition-all duration-500 hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, rgba(217,177,15,0.3) 0%, rgba(34,57,155,0.2) 50%, rgba(217,177,15,0.3) 100%)` }} data-testid="info-card-sessions">
              <div className="relative rounded-2xl p-5 text-center h-full overflow-hidden" style={{ background: 'rgba(14,12,62,0.85)' }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 100%, rgba(217,177,15,0.1) 0%, transparent 70%)` }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60%] h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, transparent, ${BRAND.gold}, transparent)`, boxShadow: `0 0 12px ${BRAND.gold}, 0 0 24px ${BRAND.gold}40` }} />
                <div className="relative z-10">
                  <Clock className="w-5 h-5 mx-auto mb-2.5" style={{ color: `${BRAND.gold}99` }} />
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: 'rgba(251,251,252,0.4)' }}>Session Options</p>
                  <p className="text-[12px] font-semibold" style={{ color: 'rgba(251,251,252,0.85)' }}>Morning: 8am – 1pm</p>
                  <p className="text-[12px] font-semibold" style={{ color: 'rgba(251,251,252,0.85)' }}>Afternoon: 1pm – 5pm</p>
                  <p className="text-[12px] font-semibold" style={{ color: 'rgba(251,251,252,0.85)' }}>Full Day: 9am – 5pm</p>
                </div>
              </div>
            </div>

            <div className="group relative rounded-2xl p-[1px] transition-all duration-500 hover:scale-[1.02]" style={{ background: `linear-gradient(135deg, rgba(217,177,15,0.3) 0%, rgba(34,57,155,0.2) 50%, rgba(217,177,15,0.3) 100%)` }} data-testid="info-card-price">
              <div className="relative rounded-2xl p-5 text-center h-full overflow-hidden" style={{ background: 'rgba(14,12,62,0.85)' }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 100%, rgba(217,177,15,0.1) 0%, transparent 70%)` }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[60%] h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `linear-gradient(90deg, transparent, ${BRAND.gold}, transparent)`, boxShadow: `0 0 12px ${BRAND.gold}, 0 0 24px ${BRAND.gold}40` }} />
                <div className="relative z-10">
                  <DollarSign className="w-5 h-5 mx-auto mb-2.5" style={{ color: `${BRAND.gold}99` }} />
                  <p className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-1.5" style={{ color: 'rgba(251,251,252,0.4)' }}>Price</p>
                  <p className="text-[13px] font-bold text-white">Half Day $40</p>
                  <p className="text-[13px] font-bold text-white">Full Day $60</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — WHAT YOUR CHILD WILL EXPERIENCE
      ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-16" style={{ background: '#f8f9fb' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-2" data-testid="text-experience-heading">
            What Your Child Will Experience
          </h2>
          <p className="text-[14px] text-slate-400 mb-10 max-w-lg mx-auto">
            A safe, fun environment where every child builds confidence and falls in love with football
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Gamepad2, title: "Fun Skill Games", desc: "Age-appropriate drills that feel like play, not practice" },
              { icon: UserPlus, title: "Make New Friends", desc: "Social environment where kids connect and build friendships" },
              { icon: Sparkles, title: "Build Confidence", desc: "Every child is celebrated and encouraged to grow" },
              { icon: Zap, title: "Learn Through Play", desc: "Real football skills developed through engaging activities" },
            ].map((item, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-5 text-center hover:shadow-md transition-all duration-300 hover:-translate-y-0.5" data-testid={`experience-card-${i}`}>
                <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: `${BRAND.blue}0A` }}>
                  <item.icon className="w-5 h-5" style={{ color: BRAND.blue }} />
                </div>
                <h3 className="text-[14px] font-bold text-slate-800 mb-1">{item.title}</h3>
                <p className="text-[12px] text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5 — TYPICAL CAMP DAY
      ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-16 bg-white">
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-2 text-center" data-testid="text-schedule-heading">
            What a Day Looks Like
          </h2>
          <p className="text-[14px] text-slate-400 mb-10 text-center">
            Morning, afternoon, and full-day options available
          </p>
          <div className="relative">
            <div className="absolute left-[72px] sm:left-[88px] top-0 bottom-0 w-px bg-slate-100" />
            <div className="space-y-0">
              {schedule.map((item, i) => (
                <div key={i} className="flex items-center gap-4 sm:gap-6 py-3 relative" data-testid={`schedule-item-${i}`}>
                  <span className={`text-[13px] sm:text-[14px] font-semibold w-[60px] sm:w-[76px] text-right flex-shrink-0 ${item.highlight ? 'text-[#22399B]' : 'text-slate-400'}`}>
                    {item.time}
                  </span>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 z-10 ${item.highlight ? 'ring-4 ring-[#22399B]/10' : ''}`} style={{ background: item.highlight ? BRAND.blue : '#cbd5e1' }} />
                  <span className={`text-[13px] sm:text-[14px] ${item.highlight ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6 — WHY PARENTS TRUST CUFC
      ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-16" style={{ background: '#f8f9fb' }}>
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-2 text-center" data-testid="text-trust-heading">
            Why Families Choose Christchurch United
          </h2>
          <p className="text-[14px] text-slate-400 mb-10 text-center">
            A club and community you can trust
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {trustPoints.map((item, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-5 flex gap-4 items-start hover:shadow-sm transition-all" data-testid={`trust-card-${i}`}>
                <div className="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center" style={{ background: `${BRAND.blue}0A` }}>
                  <item.icon className="w-5 h-5" style={{ color: BRAND.blue }} />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-slate-800 mb-0.5">{item.title}</h3>
                  <p className="text-[12px] sm:text-[13px] text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12">
            {[
              { value: "1,000+", label: "Families" },
              { value: "Since 2014", label: "Established" },
              { value: "5.0", label: "Star Rating", showStars: true },
            ].map((stat, i) => (
              <div key={i} className="text-center" data-testid={`stat-${i}`}>
                <p className="text-2xl sm:text-3xl font-bold" style={{ color: BRAND.blue }}>{stat.value}</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  {stat.showStars && Array.from({ length: 5 }).map((_, j) => (
                    <Star key={j} className="w-3 h-3 fill-[#D9B10F] text-[#D9B10F]" />
                  ))}
                  {!stat.showStars && <p className="text-[12px] text-slate-400 font-medium">{stat.label}</p>}
                </div>
                {stat.showStars && <p className="text-[12px] text-slate-400 font-medium mt-0.5">{stat.label}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 7 — PRICING + BOOKING
      ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-16 bg-white" id="pricing">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 mb-2 text-center" data-testid="text-pricing-heading">
            Choose Your Session
          </h2>
          <p className="text-[14px] text-slate-400 mb-10 text-center">
            Simple online booking. Secure payment. Instant confirmation.
          </p>
          {pricing.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {pricing.map((p: any) => {
                const info = sessionTypes[p.productType] || { label: p.productType, timeLabel: "" };
                const isFullDay = p.productType === "FULL_DAY";
                return (
                  <div
                    key={p.productType}
                    className={`rounded-2xl border-2 p-6 text-center transition-all duration-300 hover:shadow-xl hover:-translate-y-1 relative ${isFullDay ? 'text-white shadow-lg' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                    style={isFullDay ? { background: BRAND.blue, borderColor: BRAND.blue } : {}}
                    data-testid={`price-card-${p.productType}`}
                  >
                    {isFullDay && <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] bg-[#D9B10F] text-white px-3 py-1 rounded-full uppercase tracking-wider font-bold">Best Value</span>}
                    <Clock className={`w-6 h-6 mx-auto mb-2 ${isFullDay ? 'text-blue-200' : ''}`} style={!isFullDay ? { color: BRAND.blue } : {}} />
                    <h3 className={`text-[16px] font-bold ${isFullDay ? 'text-white' : 'text-slate-800'}`}>{info.label}</h3>
                    <p className={`text-[12px] mt-0.5 ${isFullDay ? 'text-blue-200' : 'text-slate-400'}`}>{info.timeLabel}</p>
                    <p className={`text-3xl font-bold mt-4 ${isFullDay ? 'text-white' : 'text-slate-900'}`}>
                      ${(p.priceCents / 100).toFixed(0)}
                    </p>
                    <p className={`text-[11px] ${isFullDay ? 'text-blue-200' : 'text-slate-400'}`}>NZD per day</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-slate-400 text-[14px] mb-8">Pricing coming soon</p>
          )}
          {discounts.length > 0 && (
            <div className="max-w-md mx-auto mb-8 p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
              <p className="text-[13px] font-semibold text-emerald-700">
                {discounts.map((d: any) => `Book ${d.minBookings}+ sessions and save ${d.discountPercent}%`).join(' · ')}
              </p>
            </div>
          )}
          <div className="text-center">
            <Link href={`/${slug}/book`}>
              <button
                onClick={handleBookClick}
                className="group inline-flex items-center gap-2 px-10 py-3.5 text-[15px] font-bold rounded-full transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer text-white"
                style={{ background: BRAND.blue, boxShadow: '0 4px 20px rgba(34,57,155,0.25)' }}
                data-testid="button-book-pricing"
              >
                Book Now
                <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
              </button>
            </Link>
            <p className="text-[12px] text-slate-400 mt-3">Places are limited for each day</p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 8 — FAQ
      ═══════════════════════════════════════════════════════════════ */}
      <section className="py-12 md:py-16" style={{ background: '#f8f9fb' }}>
        <div className="max-w-2xl mx-auto px-6">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mb-6 text-center" data-testid="text-faq-heading">
            Frequently Asked Questions
          </h2>
          <div className="rounded-2xl border border-slate-100 bg-white px-5 sm:px-6 divide-y divide-slate-100 shadow-sm" data-testid="faq-section">
            {faqItems.slice(0, 5).map((item: any, i: number) => (
              <FAQItem key={i} q={item.q} a={item.a} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 9 — FINAL CTA
      ═══════════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden py-16 md:py-20" style={{ background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)` }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] opacity-[0.06] rounded-full" style={{ background: `radial-gradient(circle, ${BRAND.gold} 0%, transparent 70%)` }} />
        </div>
        <div className="relative max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3" style={{ color: BRAND.white }} data-testid="text-final-cta">
            Give Your Child a Holiday They'll Love
          </h2>
          <p className="text-[14px] sm:text-[16px] mb-8" style={{ color: 'rgba(251,251,252,0.55)' }}>
            Limited places available. Fun, safe environment. Easy online booking.
          </p>
          <Link href={`/${slug}/book`}>
            <button
              onClick={handleBookClick}
              className="group inline-flex items-center gap-2 px-10 py-3.5 text-[15px] font-bold rounded-full transition-all duration-300 hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
              style={{ background: BRAND.white, color: BRAND.blue, boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}
              data-testid="button-book-cta-bottom"
            >
              Book Now
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </button>
          </Link>
          <p className="text-[11px] mt-4" style={{ color: 'rgba(251,251,252,0.3)' }}>
            Secure online booking in under 2 minutes
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 10 — FOOTER
      ═══════════════════════════════════════════════════════════════ */}
      <footer style={{ background: '#0a0e1a' }}>
        <div className="max-w-4xl mx-auto px-6 py-12 md:py-14">
          <div className="flex flex-col items-center text-center">
            <img src={cuFcLogoPath} alt="Christchurch United FC" className="w-12 h-12 object-contain opacity-60 mb-4" />
            <p className="text-[13px] font-semibold mb-6" style={{ color: 'rgba(251,251,252,0.3)' }}>Christchurch United Football Club</p>

            <div className="flex items-center gap-6 mb-6">
              <a href="/privacy" className="text-[12px] hover:underline transition-colors" style={{ color: 'rgba(251,251,252,0.25)' }} data-testid="link-privacy">Privacy Policy</a>
              <a href="/terms" className="text-[12px] hover:underline transition-colors" style={{ color: 'rgba(251,251,252,0.25)' }} data-testid="link-terms">Terms & Conditions</a>
            </div>

            <div className="w-full max-w-xs h-px mb-6" style={{ background: 'rgba(251,251,252,0.06)' }} />

            <p className="text-[10px] leading-relaxed max-w-md mb-4" style={{ color: 'rgba(251,251,252,0.15)' }}>
              This site is not part of the Facebook website or Facebook Inc. Additionally, this site is NOT endorsed by Facebook in any way. FACEBOOK is a trademark of FACEBOOK, Inc.
            </p>
            <p className="text-[11px]" style={{ color: 'rgba(251,251,252,0.2)' }}>
              &copy; {new Date().getFullYear()} Christchurch United FC. All Rights Reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* STICKY MOBILE CTA */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden z-50 bg-white/95 backdrop-blur-lg border-t border-slate-100 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <Link href={`/${slug}/book`}>
          <button
            onClick={handleBookClick}
            className="w-full py-3 text-[14px] font-bold rounded-full transition-all duration-300 cursor-pointer text-white"
            style={{ background: BRAND.blue }}
            data-testid="button-book-sticky"
          >
            Book Now — From ${lowestPrice > 0 ? (lowestPrice / 100).toFixed(0) : '0'}/session
          </button>
        </Link>
      </div>

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
