import { Link } from "wouter";
import { useState } from "react";
import { Calendar, Clock, MapPin, Users, ArrowRight, ChevronDown, Sparkles, Heart, Star, ShieldCheck, Smile, Music } from "lucide-react";
import { campSessions, parsePageContent } from "@/lib/camp-sessions";
import { campBookHref } from "@/lib/camp-brand";

/**
 * United Gymnastics holiday camp landing page (first: GymFun, 21–23 Dec 2026).
 *
 * The cugc.co.nz look, not the football camp page: warm cream ground, navy
 * crest blue, Satoshi bold italic for the hero, Instrument Serif italic for
 * section headings, Inter for everything else (apps/cugc-website).
 *
 * 🔴 Every colour is INLINE on purpose. ClubOS admin is light-only and its
 * generated light-theme CSS rewrites colour CLASSES (bg-[#…], text-white) —
 * it once turned a navy arbitrary class into a white panel. Inline styles are
 * outside its reach. Tailwind is used for layout and spacing only.
 *
 * 🔴 No testimonials, no "1,000+ families", no star rating: this is the gym's
 * first holiday camp and nothing like that exists yet. Real reviews can be
 * added later through pageContentJson.reviews.
 *
 * Copy lives in programs.page_content_json (edit at Holiday Camps → the camp
 * → Edit page); the defaults below only cover a field left empty.
 */

const C = {
  cream: "#fff8f0",
  sand: "#f4ecdf",
  beige: "#e8dbc9",
  navy: "#013590",
  navyDark: "#01296e",
  sky: "#0099ff",
  gold: "#d9b10f",
  ink: "#191919",
  slate: "#3d3d3d",
  muted: "#6b6255",
};
const HERO = "'Satoshi', 'Inter', system-ui, sans-serif";
const DISPLAY = "'Instrument Serif', Georgia, serif";
const BODY = "'Inter', system-ui, -apple-system, sans-serif";

const ICONS: Record<string, any> = { Sparkles, Heart, Star, ShieldCheck, Smile, Music, Users };

const fmtDay = (iso: string) =>
  new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });

export default function CugcCampPage({ data, slug, onBookClick }: {
  data: { camp: any; organization?: { name: string; slug: string; logoUrl: string | null }; pricing: any[]; dates: any[] };
  slug: string;
  onBookClick: () => void;
}) {
  const { camp, pricing } = data;
  const pc = parsePageContent(camp.pageContentJson);
  const sessions = campSessions(pricing, pc);
  const lowest = sessions.length ? Math.min(...sessions.map((s) => s.priceCents)) : 0;
  const bookHref = campBookHref(slug);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  let faq: { q: string; a: string }[] = [];
  try { faq = camp.faqJson ? JSON.parse(camp.faqJson) : []; } catch { faq = []; }

  const days: string[] = (data.dates || []).map((d: any) => String(d.date).slice(0, 10)).sort();
  const datesLine = pc.infoDates || (days.length ? `${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}` : "");
  const ageLine = pc.infoAge || (camp.ageMin && camp.ageMax ? `Ages ${camp.ageMin}–${camp.ageMax}` : "");
  const crest = data.organization?.logoUrl || "/logos/united-gymnastics.png";

  const schedule: { time: string; label: string }[] = Array.isArray(pc.schedule) ? pc.schedule : [];
  const experience: { icon?: string; title: string; desc: string }[] = Array.isArray(pc.experience) ? pc.experience : [];
  const trust: { title: string; desc: string }[] = Array.isArray(pc.trust) ? pc.trust : [];

  const BookButton = ({ label, testId, full }: { label: string; testId: string; full?: boolean }) => (
    <Link href={bookHref}>
      <button
        onClick={onBookClick}
        data-testid={testId}
        className={`group inline-flex items-center justify-center gap-2 rounded-[10px] px-7 py-3.5 text-[15px] font-semibold transition-transform active:scale-[0.98] cursor-pointer ${full ? "w-full" : ""}`}
        style={{ background: C.navy, color: "#ffffff", boxShadow: "0 10px 30px -12px rgba(1,53,144,0.55)", minHeight: 48 }}
      >
        {label}
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </Link>
  );

  const facts = [
    { icon: Calendar, label: "When", value: datesLine, sub: pc.infoDatesNote || "Book one day or all three" },
    { icon: Users, label: "Ages", value: ageLine, sub: pc.infoAgeNote || "No experience needed" },
    { icon: Clock, label: "Times", value: pc.infoTimes || "9am – 3pm", sub: pc.infoTimesNote || "Half or full days" },
    { icon: MapPin, label: "Where", value: pc.infoLocation || "United Gymnastics", sub: pc.infoLocationAddress || "466 Yaldhurst Road" },
  ];

  return (
    <div className="min-h-screen" style={{ background: C.cream, color: C.slate, fontFamily: BODY }}>
      <style>{`
        @font-face { font-family: 'Satoshi'; src: url('/studio-fonts/cugc/Satoshi-BoldItalic.woff2') format('woff2'); font-weight: 700; font-style: italic; font-display: swap; }
        @font-face { font-family: 'Satoshi'; src: url('/studio-fonts/cugc/Satoshi-Bold.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
        @keyframes ugRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        .ug-rise { animation: ugRise .8s cubic-bezier(0.16,1,0.3,1) both; }
        @media (prefers-reduced-motion: reduce) { .ug-rise { animation: none; } }
      `}</style>

      {/* Header */}
      <header className="sticky top-0 z-40" style={{ background: "rgba(255,248,240,0.92)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.beige}` }}>
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 h-16 flex items-center justify-between">
          <a href="https://cugc.co.nz" className="flex items-center gap-2.5" data-testid="link-cugc-home">
            <img src={crest} alt="United Gymnastics" className="w-9 h-9 object-contain" />
            <span className="text-[15px] font-bold tracking-tight" style={{ color: C.navy }}>United Gymnastics</span>
          </a>
          <Link href={bookHref}>
            <button onClick={onBookClick} className="rounded-[10px] px-4 py-2.5 text-[14px] font-semibold cursor-pointer" style={{ background: C.navy, color: "#fff", minHeight: 44 }} data-testid="button-book-header">
              Book now
            </button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1200px] px-4 sm:px-8 pt-8 sm:pt-14 pb-12 sm:pb-20 grid gap-8 lg:gap-14 lg:grid-cols-[1.05fr_1fr] items-center">
        <div className="ug-rise order-2 lg:order-1">
          <p className="text-[12px] font-bold uppercase tracking-[0.22em]" style={{ color: C.navy }}>
            {pc.heroEyebrow || "School holiday camp"}
          </p>
          <h1 className="mt-3 text-[44px] sm:text-[64px] lg:text-[76px]" style={{ fontFamily: HERO, fontWeight: 700, fontStyle: "italic", lineHeight: 1.0, letterSpacing: "-0.01em", color: C.ink }}>
            {camp.heroHeadline || camp.name}
          </h1>
          <p className="mt-5 text-[17px] sm:text-[18px] leading-relaxed max-w-[34rem]" style={{ color: C.slate }}>
            {camp.heroSubheadline || camp.descriptionShort}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {sessions.map((s) => (
              <span key={s.type} className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold" style={{ background: "#fff", border: `1px solid ${C.beige}`, color: C.ink }}>
                {s.label} · ${(s.priceCents / 100).toFixed(0)}
              </span>
            ))}
          </div>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <BookButton label={camp.primaryCta || "Book a spot"} testId="button-book-now" />
            <a href="#sessions" className="inline-flex items-center justify-center rounded-[10px] px-7 py-3.5 text-[15px] font-semibold" style={{ border: `1px solid ${C.navy}40`, color: C.navy, background: "rgba(255,255,255,0.7)", minHeight: 48 }}>
              See the sessions
            </a>
          </div>
        </div>
        <div className="ug-rise order-1 lg:order-2 relative">
          <div className="overflow-hidden rounded-[22px]" style={{ boxShadow: "0 30px 60px -30px rgba(1,53,144,0.45)", aspectRatio: "4 / 3", background: C.sand }}>
            <img src={camp.heroImage || "/mailer/cugc/hero.jpg"} alt="Young gymnasts warming up together on the gym floor" className="w-full h-full object-cover" fetchPriority="high" />
          </div>
          <div className="absolute -bottom-5 left-4 sm:left-6 rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: "#fff", boxShadow: "0 18px 40px -18px rgba(0,0,0,0.25)", border: `1px solid ${C.beige}` }}>
            <span className="text-[26px] leading-none" style={{ fontFamily: DISPLAY, fontStyle: "italic", color: C.navy }}>{days.length || 3}</span>
            <span className="text-[13px] leading-tight font-medium" style={{ color: C.ink }}>{pc.heroBadge || "days of gymnastics fun"}<br /><span style={{ color: C.muted }}>{datesLine}</span></span>
          </div>
        </div>
      </section>

      {/* Key facts */}
      <section style={{ background: "#fff", borderTop: `1px solid ${C.beige}`, borderBottom: `1px solid ${C.beige}` }}>
        <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 grid grid-cols-2 lg:grid-cols-4 gap-6">
          {facts.map((f) => (
            <div key={f.label} className="flex gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${C.navy}0D` }}>
                <f.icon className="w-5 h-5" style={{ color: C.navy }} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: C.muted }}>{f.label}</p>
                <p className="text-[15px] font-semibold" style={{ color: C.ink }}>{f.value}</p>
                <p className="text-[13px]" style={{ color: C.muted }}>{f.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sessions */}
      <section id="sessions" className="mx-auto max-w-[1200px] px-4 sm:px-8 py-16 sm:py-24" style={{ scrollMarginTop: 80 }}>
        <div className="max-w-2xl">
          <h2 className="text-[38px] sm:text-[52px]" style={{ fontFamily: DISPLAY, fontStyle: "italic", lineHeight: 1.08, color: C.ink }}>{pc.pricingTitle || "Pick your session"}</h2>
          <p className="mt-3 text-[16px]" style={{ color: C.slate }}>{pc.pricingSub || "Book a morning, an afternoon or the full day, on one day or all three. Secure online payment and instant confirmation."}</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {sessions.map((s) => {
            const best = s.type === "FULL_DAY" && sessions.length > 1;
            return (
              <div key={s.type} className="relative rounded-2xl p-6 flex flex-col" style={{ background: "#fff", border: best ? `2px solid ${C.navy}` : `1px solid ${C.beige}`, boxShadow: "0 18px 50px -20px rgba(1,53,144,0.18)" }} data-testid={`card-session-${s.type}`}>
                {best && <span className="absolute -top-3 left-6 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ background: C.gold, color: C.ink }}>Best value</span>}
                <p className="text-[13px] font-bold uppercase tracking-[0.16em]" style={{ color: C.navy }}>{s.label}</p>
                <p className="mt-2 text-[15px]" style={{ color: C.muted }}>{s.time}</p>
                <p className="mt-5" style={{ color: C.ink }}>
                  <span className="text-[44px] font-bold tracking-tight">${(s.priceCents / 100).toFixed(0)}</span>
                  <span className="text-[14px] ml-1" style={{ color: C.muted }}>per day</span>
                </p>
                <div className="mt-auto pt-6"><BookButton label="Book" testId={`button-book-${s.type}`} full /></div>
              </div>
            );
          })}
        </div>
        {lowest > 0 && <p className="mt-5 text-[13px]" style={{ color: C.muted }}>{pc.pricingFootnote || "Book brothers and sisters together in one checkout."}</p>}
      </section>

      {/* What they'll do */}
      {experience.length > 0 && (
        <section style={{ background: C.sand }}>
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-16 sm:py-24 grid gap-10 lg:grid-cols-[1fr_1.1fr] items-center">
            <div className="overflow-hidden rounded-[22px]" style={{ aspectRatio: "4 / 3" }}>
              <img src={pc.experienceImage || "/mailer/cugc/autumn-glory.jpg"} alt="Four young United Gymnastics gymnasts jumping for joy on a podium" className="w-full h-full object-cover" loading="lazy" />
            </div>
            <div>
              <h2 className="text-[38px] sm:text-[52px]" style={{ fontFamily: DISPLAY, fontStyle: "italic", lineHeight: 1.08, color: C.ink }}>{pc.experienceTitle || "What they'll do"}</h2>
              {pc.experienceSub && <p className="mt-3 text-[16px]" style={{ color: C.slate }}>{pc.experienceSub}</p>}
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                {experience.map((e) => {
                  const Icon = ICONS[e.icon || ""] || Sparkles;
                  return (
                    <div key={e.title} className="flex gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#fff" }}>
                        <Icon className="w-5 h-5" style={{ color: C.navy }} />
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold" style={{ color: C.ink }}>{e.title}</p>
                        <p className="text-[14px] leading-relaxed" style={{ color: C.slate }}>{e.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* A day at camp */}
      {schedule.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[38px] sm:text-[52px]" style={{ fontFamily: DISPLAY, fontStyle: "italic", lineHeight: 1.08, color: C.ink }}>{pc.scheduleTitle || "A day at camp"}</h2>
          {pc.scheduleSub && <p className="mt-3 text-[16px] max-w-2xl" style={{ color: C.slate }}>{pc.scheduleSub}</p>}
          <ol className="mt-10 grid gap-0 max-w-3xl">
            {schedule.map((s, i) => (
              <li key={`${s.time}-${i}`} className="grid grid-cols-[88px_1fr] sm:grid-cols-[120px_1fr] gap-4 py-4" style={{ borderTop: `1px solid ${C.beige}` }}>
                <span className="text-[14px] font-semibold tabular-nums" style={{ color: C.navy }}>{s.time}</span>
                <span className="text-[16px]" style={{ color: C.ink }}>{s.label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Why United Gymnastics */}
      {trust.length > 0 && (
        <section style={{ background: "#fff", borderTop: `1px solid ${C.beige}`, borderBottom: `1px solid ${C.beige}` }}>
          <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-16 sm:py-20">
            <h2 className="text-[38px] sm:text-[52px]" style={{ fontFamily: DISPLAY, fontStyle: "italic", lineHeight: 1.08, color: C.ink }}>{pc.trustTitle || "Why United Gymnastics"}</h2>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {trust.map((t) => (
                <div key={t.title} style={{ borderTop: `2px solid ${C.navy}`, paddingTop: 16 }}>
                  <p className="text-[16px] font-semibold" style={{ color: C.ink }}>{t.title}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: C.slate }}>{t.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      {faq.length > 0 && (
        <section className="mx-auto max-w-[860px] px-4 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[38px] sm:text-[52px]" style={{ fontFamily: DISPLAY, fontStyle: "italic", lineHeight: 1.08, color: C.ink }}>Questions parents ask</h2>
          <div className="mt-8">
            {faq.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={f.q} style={{ borderTop: `1px solid ${C.beige}` }}>
                  <button onClick={() => setOpenFaq(open ? null : i)} className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer" aria-expanded={open} data-testid={`button-faq-${i}`}>
                    <span className="text-[16px] font-semibold" style={{ color: C.ink }}>{f.q}</span>
                    <ChevronDown className="w-5 h-5 shrink-0 transition-transform" style={{ color: C.navy, transform: open ? "rotate(180deg)" : "none" }} />
                  </button>
                  {open && <p className="pb-5 -mt-1 text-[15px] leading-relaxed" style={{ color: C.slate }}>{f.a}</p>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Final call */}
      <section className="px-4 sm:px-8 pb-28 sm:pb-20">
        <div className="mx-auto max-w-[1200px] rounded-[26px] px-6 sm:px-12 py-12 sm:py-16 text-center" style={{ background: C.sand, border: `1px solid ${C.beige}` }}>
          <p className="text-[12px] font-bold uppercase tracking-[0.22em]" style={{ color: C.navy }}>{pc.finalCtaEyebrow || datesLine}</p>
          <h2 className="mt-3 text-[38px] sm:text-[56px]" style={{ fontFamily: DISPLAY, fontStyle: "italic", lineHeight: 1.05, color: C.ink }}>{pc.finalCtaTitle || "Save their spot"}</h2>
          {pc.finalCtaSub && <p className="mt-3 text-[16px]" style={{ color: C.slate }}>{pc.finalCtaSub}</p>}
          <div className="mt-8 flex justify-center"><BookButton label={pc.finalCtaButton || "Book now"} testId="button-book-final" /></div>
        </div>
        <p className="mx-auto max-w-[1200px] mt-10 text-center text-[12px]" style={{ color: C.muted }}>
          {pc.footerDisclaimer || "United Gymnastics · 466 Yaldhurst Road, Christchurch · info@cugc.co.nz · 021 535 005"}
        </p>
      </section>

      {/* Sticky book bar, phones only */}
      <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden px-4 pt-3" style={{ background: "rgba(255,248,240,0.96)", borderTop: `1px solid ${C.beige}`, paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
        <BookButton label={pc.stickyCtaText || (lowest ? `Book now · from $${(lowest / 100).toFixed(0)}` : "Book now")} testId="button-book-sticky" full />
      </div>
    </div>
  );
}
