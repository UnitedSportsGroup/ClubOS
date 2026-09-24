import { useEffect, useRef, useState } from "react";
import { shortCompetitionName, termLabelFromSlug, mflPixelContent } from "@shared/league-captain";
import { useRoute, Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/format";
import { initPixel, trackEvent } from "@/lib/meta-pixel";
import { computeOrderDiscount, computeTeamPayment, type DiscountRule } from "@shared/league-pricing";
import {
  Trophy, Users, Calendar, MapPin, Clock, Zap, ShieldCheck, Star,
  ArrowRight, ChevronDown, Flame, CreditCard, CheckCircle2, Play,
} from "lucide-react";

// MFL premium black + gold brand (matches the MFL app theme).
const BRAND = {
  black: "#000000",
  bg: "#0a0a0a",
  card: "#141414",
  cardSoft: "#1c1c1c",
  border: "#2a2a2a",
  gold: "#d1b96e",
  goldDeep: "#a8915a",
  white: "#ffffff",
  muted: "rgba(255,255,255,0.62)",
  dim: "rgba(255,255,255,0.38)",
  red: "#f0564f",
};
const FONT = "'Inter Tight', Inter, system-ui, -apple-system, sans-serif";
const MFL_LOGO = "/logos/mini-football-leagues.png";
const MFL_CREST = "/logos/mini-football-leagues-crest.png";

/**
 * The promo film in the hero, per offering. Daniel, 2026-09-20: "add our
 * promo video on the page too for the term 4 summer leagues that we ran for
 * ads … above register your team button in that gap as is standard in
 * industry for LP design." It is the ad creative (Meta library 2046145009253661,
 * his Term 4 2025 talking-head + b-roll, 34.5s, names no date or price), served
 * from this bundle — Cloudflare Stream is over quota and Supabase storage is
 * egress-restricted. Keyed by slug so a term whose film says "Summer Leagues"
 * never plays on a winter one by accident.
 */
const PROMO_VIDEO: Record<string, { src: string; poster: string; seconds: number }> = {
  "term-4": { src: "/videos/mfl-summer-leagues.mp4", poster: "/videos/mfl-summer-leagues.jpg", seconds: 35 },
};
// Derived from the term in the URL — a constant here stayed on "Term 3" when Term 4 opened.
const PIXEL_CONTENT = (slug: string | null | undefined) => mflPixelContent(slug);

interface Division {
  id: number; name: string; dayOfWeek: string | null; ageGroup: string | null;
  gender: string | null; maxTeams: number | null; teamCostCents: number;
  teamCount: number; spotsLeft: number | null; badgeText?: string | null;
  /** The usual price for the format when this night sells for less — struck through on the card. */
  listPriceCents?: number | null;
}
interface RegisterData {
  program: any;
  organization: { id: number; name: string; slug: string; logoUrl: string | null } | null;
  competition: any;
  divisions: Division[];
  upsells: { type: string; label: string; priceCents: number }[];
  earlyBird: { deadline: string | null; lateFeeCents: number; active: boolean };
  /** The discount the checkout auto-applies to one team right now (early bird), and when it stops. */
  autoDiscount?: (DiscountRule & { endsAt: string | null }) | null;
  depositCents: number | null;
  paymentPlan?: string;
  numWeeklyPayments?: number;
  /** Player Pay (split the fee across the squad) is on for this league. */
  splitEnabled?: boolean;
}

/**
 * A ticking countdown to an instant. Re-renders once a second; `expired` flips
 * the page back to full prices at the same moment the checkout stops applying
 * the discount (the instant came from the server's own comparison).
 */
function useCountdown(endsAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  const end = endsAt ? Date.parse(endsAt) : NaN;
  const left = Number.isFinite(end) ? Math.max(0, end - now) : 0;
  const s = Math.floor(left / 1000);
  return {
    expired: Number.isFinite(end) ? left <= 0 : false,
    days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600),
    mins: Math.floor((s % 3600) / 60), secs: s % 60,
    endLabel: Number.isFinite(end)
      ? new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(end))
      : "",
  };
}

function Countdown({ c, compact }: { c: ReturnType<typeof useCountdown>; compact?: boolean }) {
  const seg = (n: number, unit: string) => (
    <span key={unit} className="inline-flex items-baseline gap-0.5">
      <span className={compact ? "text-[13px] font-bold tabular-nums" : "text-[18px] sm:text-[20px] font-bold tabular-nums"} style={{ color: BRAND.white }}>{String(n).padStart(2, "0")}</span>
      <span className={compact ? "text-[10px]" : "text-[11px]"} style={{ color: BRAND.muted }}>{unit}</span>
    </span>
  );
  return (
    <span className={`inline-flex items-baseline ${compact ? "gap-1.5" : "gap-2.5"}`}>
      {c.days > 0 && seg(c.days, "d")}{seg(c.hours, "h")}{seg(c.mins, "m")}{seg(c.secs, "s")}
    </span>
  );
}

const FAQS = [
  { q: "Who can enter a team?", a: "Anyone! Grab your mates, your workmates, your five-a-side regulars — one person registers as the team captain and you're in." },
  { q: "How many players do I need?", a: "7-a-side runs with 7 on the pitch (bring subs!), 5-a-side needs 5. You can register with a partial squad and fill spots as you go." },
  { q: "What does it cost?", a: "7-a-side is $600 per team for the term, 5-a-side is $500. That's for the whole team across the full season — split it between your players however you like." },
  { q: "Can I pay in instalments?", a: "Yes — that's how it works. Lock your spot with a $120 deposit today, then we spread the rest into automatic weekly payments across the season. Your deposit covers the final weeks, so there's no big bill up front." },
  { q: "When does it run?", a: "Games run weeknights at United Sports Centre, 466 Yaldhurst Road, Russley. Pick your night when you register — see the options below." },
];

/** "2026-10-12" → "12 Oct", from the y-m-d parts (never through a Date: NZ/UTC shifts a day). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
/** Whole weeks the competition window spans (12 Oct Mon → 18 Dec Fri = 10). */
function seasonWeeks(start: string, end: string): number {
  const ms = Date.UTC(...(end.split("-").map(Number) as [number, number, number])) -
    Date.UTC(...(start.split("-").map(Number) as [number, number, number]));
  return Math.ceil((ms / 86_400_000 + 1) / 7);
}

/** "just now" / "12 minutes ago" / "4 hours ago" / "3 days ago" — from a real timestamp. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Bottom-left "Tikki Mo Solah FC signed up 4 hours ago" (Daniel 2026-09-24).
 * REAL paid sign-ups only, from /recent — if there are none it renders nothing,
 * never an invented team. Sits above the phone's sticky Register bar, stops
 * after one pass, and a tap on × ends it for the visit.
 */
function SignupToast({ slug }: { slug: string }) {
  const [items, setItems] = useState<{ name: string; division: string | null; at: string }[]>([]);
  const [idx, setIdx] = useState(-1);
  const [shown, setShown] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    fetch(`/api/public/league/register/${slug}/recent`).then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.signups?.length) setItems(d.signups.slice(0, 6)); }).catch(() => {});
  }, [slug]);
  useEffect(() => {
    if (!items.length || closed) return;
    let i = 0; const timers: any[] = [];
    const cycle = () => {
      if (i >= items.length) return;
      setIdx(i); setShown(true);
      timers.push(setTimeout(() => setShown(false), 5500));
      i += 1;
      timers.push(setTimeout(cycle, 5500 + 9000));
    };
    timers.push(setTimeout(cycle, 5000));
    return () => timers.forEach(clearTimeout);
  }, [items, closed]);
  if (closed || idx < 0 || !items[idx]) return null;
  const t = items[idx];
  return (
    <div role="status" aria-live="polite"
      className="fixed z-40 left-3 right-3 sm:right-auto sm:left-5 sm:max-w-[340px] bottom-[calc(88px+env(safe-area-inset-bottom))] sm:bottom-5 transition-all duration-500"
      style={{ opacity: shown ? 1 : 0, transform: shown ? "translateY(0)" : "translateY(12px)", pointerEvents: shown ? "auto" : "none" }}
      data-testid="signup-toast">
      <div className="flex items-center gap-3 rounded-2xl pl-3 pr-2 py-2.5"
        style={{ background: "rgba(20,20,20,0.96)", border: `1px solid ${BRAND.border}`, boxShadow: "0 12px 40px rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}>
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full" style={{ background: `${BRAND.gold}1f` }}>
          <Trophy className="h-5 w-5" style={{ color: BRAND.gold }} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-bold" style={{ color: BRAND.white }}>{t.name}</p>
          <p className="truncate text-[12px] mt-0.5" style={{ color: BRAND.muted }}>
            signed up{t.division ? <> for <span style={{ color: BRAND.gold }}>{t.division}</span></> : ""} · {timeAgo(t.at)}
          </p>
        </div>
        <button type="button" onClick={() => setClosed(true)} aria-label="Dismiss"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xl leading-none" style={{ color: BRAND.dim }}>×</button>
      </div>
    </div>
  );
}

/**
 * Slim gold bar across the top that rotates one message every few seconds
 * (Daniel 2026-09-24): the early-bird countdown, the tightest night, the
 * deposit, Player Pay. Every message is built from live data — a message
 * with nothing true to say is simply left out. Taps through to register.
 */
function AnnouncementBar({ messages, href }: { messages: { key: string; node: React.ReactNode }[]; href: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 4500);
    return () => clearInterval(t);
  }, [messages.length]);
  if (!messages.length) return null;
  const m = messages[i % messages.length];
  return (
    <Link href={href}>
      <a className="sticky top-0 z-30 flex h-10 items-center justify-center px-4 text-center text-[12.5px] sm:text-[13.5px] font-semibold"
        style={{ background: BRAND.gold, color: BRAND.black }} data-testid="announcement-bar">
        <style>{`@keyframes mflBarIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.mfl-bar-msg{animation:none!important}}`}</style>
        <span key={m.key} className="mfl-bar-msg inline-flex min-w-0 items-center gap-1.5 truncate" style={{ animation: "mflBarIn .45s ease" }} data-testid={`bar-${m.key}`}>
          <span className="min-w-0 truncate">{m.node}</span>
          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0" />
        </span>
      </a>
    </Link>
  );
}

function Stars() {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} className="w-4 h-4" style={{ color: BRAND.gold, fill: BRAND.gold }} />
      ))}
    </span>
  );
}

export default function MflLandingPage() {
  const [, params] = useRoute("/league/:slug");
  const slug = params?.slug;
  const [data, setData] = useState<RegisterData | null>(null);
  const [list, setList] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [, setLocation] = useLocation();

  // League Builders: capture a ?ref=BUILD-… referral code so it carries through
  // to the register page and attributes the referral on checkout.
  useEffect(() => {
    try { const ref = new URLSearchParams(window.location.search).get("ref"); if (ref) sessionStorage.setItem("mfl_ref", ref.trim()); } catch { /* noop */ }
  }, []);

  // Init the shared Meta pixel + ViewContent (tagged for MFL).
  useEffect(() => {
    const pixelId = (import.meta as any).env?.VITE_META_PIXEL_ID;
    if (pixelId) initPixel(pixelId);
  }, []);
  const trackView = () => {
    if (!(import.meta as any).env?.VITE_META_PIXEL_ID) return;
    trackEvent("ViewContent", { content_name: PIXEL_CONTENT(slug), content_category: "League Team Registration", currency: "NZD" });
  };

  useEffect(() => {
    const url = slug ? `/api/public/league/register/${slug}` : `/api/public/league/register`;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then((d) => {
        if (slug) { setData(d); trackView(); return; }
        // Daniel 2026-09-24: with ONE league open the chooser is a wasted
        // click — go straight to it. replace (not push) so Back doesn't bounce
        // here, and carry the query so utm_*/fbclid/?ref= survive. No
        // ViewContent here: the league page fires its own, once.
        const offerings = d?.offerings ?? [];
        if (offerings.length === 1 && offerings[0]?.slug) {
          setLocation(`/league/${offerings[0].slug}${window.location.search}`, { replace: true });
          return;
        }
        setList(d); trackView();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  // 🔴 Above every early return. A hook below `if (loading) return` is React
  // #310 "Rendered more hooks than during the previous render" — a white
  // screen on the live registration page. The preview harness caught this.
  const countdown = useCountdown(data?.autoDiscount?.endsAt);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BRAND.black }}>
        <Skeleton className="h-40 w-80 rounded-2xl" style={{ background: BRAND.card }} />
      </div>
    );
  }

  // ---- Chooser mode: MFL root with multiple/zero specific slugs ----
  if (!slug) {
    const offerings = list?.offerings ?? [];
    return (
      <div className="min-h-screen" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
        <Hero org={list?.organization} headline="Christchurch's #1 Social Football League" sub="7-a-side & 5-a-side. Grab your mates. Play every week." showCta={false} />
        <section className="max-w-4xl mx-auto px-6 py-14">
          <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: BRAND.gold }}>Choose your format</h2>
          {offerings.length === 0 ? (
            <p className="text-center" style={{ color: BRAND.muted }}>Registrations open soon — check back shortly.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-5">
              {offerings.map((o: any) => (
                <Link key={o.id} href={`/league/${o.slug}`}>
                  <a className="block rounded-2xl p-6 transition-transform hover:-translate-y-0.5" style={{ background: BRAND.card, border: `1px solid ${BRAND.border}` }}>
                    <Trophy className="w-7 h-7 mb-3" style={{ color: BRAND.gold }} />
                    <h3 className="text-lg font-bold">{o.name}</h3>
                    {o.descriptionShort && <p className="text-sm mt-1" style={{ color: BRAND.muted }}>{o.descriptionShort}</p>}
                    <span className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold" style={{ color: BRAND.gold }}>
                      Register your team <ArrowRight className="w-4 h-4" />
                    </span>
                  </a>
                </Link>
              ))}
            </div>
          )}
        </section>
        <Footer />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-6" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
        <div>
          <p style={{ color: BRAND.muted }}>This league isn't available right now.</p>
          <Link href="/league"><a className="mt-3 inline-block font-semibold" style={{ color: BRAND.gold }}>See all leagues</a></Link>
        </div>
      </div>
    );
  }

  const { program, organization, divisions, upsells, earlyBird, depositCents, paymentPlan, numWeeklyPayments } = data;
  // Season card: "10 weeks" + the competition's own dates. Blank dates → "Full term", never a guess.
  const compStart: string | null = data.competition?.startDate ?? null;
  const compEnd: string | null = data.competition?.endDate ?? null;
  const seasonValue = compStart && compEnd
    ? <>{seasonWeeks(compStart, compEnd)} weeks<span className="block font-normal text-[13px] mt-0.5" style={{ color: BRAND.muted }}>{shortDate(compStart)} – {shortDate(compEnd)}</span></>
    : "Full term";
  // Where card: venue name in gold, street on the line below (suburb dropped).
  const [venueName, venueStreet] = (program.location || "United Sports Centre, 466 Yaldhurst Rd")
    .split(",").map((x: string) => x.trim());
  const whereValue = <>
    <span className="block" style={{ color: BRAND.gold }}>{venueName}</span>
    {venueStreet && <span className="block">{venueStreet.replace(/\bRd\b/, "Road")}</span>}
  </>;
  const isWeeklyPlan = paymentPlan === "deposit_weekly";
  const registerHref = `/league/${slug}/register`;

  // 🔴 Early bird, priced by the SAME pure functions the checkout uses
  // (shared/league-pricing.ts): the order discount on one team, then the
  // deposit/weekly split of what's left. The page never invents a figure; it
  // reproduces the checkout's. Once the countdown hits zero the cards revert
  // to full price on their own, because the server's next quote will too.
  const promo = data.autoDiscount && !countdown.expired ? data.autoDiscount : null;
  const priced = (d: { teamCostCents: number; listPriceCents?: number | null }) => {
    const teamCostCents = d.teamCostCents;
    // The stack: usual price → the night's own discount (baked into its cost)
    // → early bird on top. Each rung is a real figure the checkout would show.
    const list = d.listPriceCents && d.listPriceCents > teamCostCents ? d.listPriceCents : null;
    const listPct = list ? Math.round(((list - teamCostCents) / list) * 100) : 0;
    const discount = promo ? computeOrderDiscount(teamCostCents, [promo]).discountTotalCents : 0;
    const total = teamCostCents - discount;
    const pay = computeTeamPayment(total, depositCents ?? null, paymentPlan || "installment", numWeeklyPayments || 8);
    return { full: teamCostCents, list, listPct, total, discount, deposit: pay.depositCents, weekly: pay.isWeeklyPlan ? (pay.weeklyAmountCents ?? 0) : 0 };
  };
  const promoPct = promo && promo.valueType === "percentage" ? `${Math.round(promo.value)}% off` : promo ? `${formatCurrency(Math.round(promo.value * 100), { fromCents: true })} off` : "";
  // Lowest across the nights (varies by 5s/7s), for the "from $X" hints.
  const cheapest = divisions.length ? divisions.map((d) => priced(d)).sort((a, b) => a.total - b.total)[0] : null;
  const lowestWeeklyCents = isWeeklyPlan && cheapest ? cheapest.weekly : 0;
  const lowestCents = cheapest ? cheapest.total : (program.termPriceCents ?? 0);

  // Nights grouped by format, each in weekday order. The format is read from the
  // division name ("Monday 5's"); anything unrecognised gets its own group, never dropped.
  const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayRank = (d: Division) => { const i = DAY_ORDER.indexOf((d.dayOfWeek || "").toLowerCase()); return i < 0 ? 99 : i; };
  const formatOf = (d: Division) => { const m = d.name.match(/\b(\d+)\s*['’]?\s*s\b/i) || d.name.match(/\b(\d+)\s*-?\s*a\s*-?\s*side/i); return m ? m[1] : "other"; };
  const nightGroups = Array.from(
    divisions.reduce((acc, d) => { const k = formatOf(d); acc.set(k, [...(acc.get(k) || []), d]); return acc; }, new Map<string, Division[]>())
  )
    .sort(([a], [b]) => (a === "other" ? 1 : b === "other" ? -1 : Number(a) - Number(b)))
    .map(([k, list]) => {
      const sorted = [...list].sort((a, b) => dayRank(a) - dayRank(b));
      return {
        key: k,
        title: k === "other" ? "More nights" : `${k}-a-side`,
        sub: k === "other" ? "" : `${k} vs ${k} · ${sorted.length} nights a week`,
        divisions: sorted,
        open: sorted.filter((d) => !(d.spotsLeft != null && d.spotsLeft <= 0)).length,
      };
    });

  // Top bar messages — only the ones that are true right now.
  const barMessages: { key: string; node: React.ReactNode }[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  if (promo) barMessages.push({ key: "earlybird", node: <><Flame className="inline h-3.5 w-3.5 -mt-0.5 mr-1 align-middle" />Early bird {promoPct} ends in <span className="tabular-nums font-bold">{countdown.days}d {pad(countdown.hours)}h {pad(countdown.mins)}m {pad(countdown.secs)}s</span></> });
  const tight = divisions
    .filter((d) => d.spotsLeft != null && d.spotsLeft > 0 && d.maxTeams != null && d.maxTeams > 0 && d.teamCount > d.maxTeams / 2)
    .sort((a, b) => (a.spotsLeft ?? 99) - (b.spotsLeft ?? 99))[0];
  if (tight) barMessages.push({ key: "spots", node: <>Only <b>{tight.spotsLeft} spot{tight.spotsLeft === 1 ? "" : "s"}</b> left on {tight.name}</> });
  if (depositCents != null && depositCents > 0) barMessages.push({ key: "deposit", node: <>Lock in your team for just <b>{formatCurrency(depositCents, { fromCents: true }).replace(/\.00$/, "")}</b> — Play Now, Pay Later</> });
  if (data.splitEnabled) barMessages.push({ key: "playerpay", node: <>Chasing mates for fees? Use <b>Player Pay</b></> });

  return (
    <div className="min-h-screen" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
      <AnnouncementBar messages={barMessages} href={registerHref} />
      <Hero
        org={organization}
        headline={program.heroHeadline || program.name}
        sub={program.heroSubheadline || `Register your team for ${shortCompetitionName(program.name) || termLabelFromSlug(slug) || "the term"}. Grab your mates and play every week.`}
        ctaHref={registerHref}
        showCta
        video={PROMO_VIDEO[slug] ?? null}
      />

      {/* Early bird — the price every card shows, and the clock on it. */}
      {promo && (
        <div className="px-6">
          {/* No negative margin: the hero paints over anything pulled up under
              it, which clipped the top of this banner in the first screenshot. */}
          <div className="relative z-10 max-w-4xl mx-auto mt-6 rounded-2xl px-5 py-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6"
            style={{ background: `${BRAND.gold}1a`, border: `1px solid ${BRAND.gold}66` }} data-testid="early-bird-banner">
            <span className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider" style={{ color: BRAND.gold }}>
              <Flame className="w-4 h-4" /> Early bird · {promoPct} every night
            </span>
            <span className="inline-flex items-center gap-2.5 text-sm" style={{ color: BRAND.muted }}>
              Ends in <Countdown c={countdown} />
            </span>
          </div>
          {countdown.endLabel && (
            <p className="max-w-4xl mx-auto mt-2 text-center text-[12px]" style={{ color: BRAND.dim }}>
              Early bird prices come off automatically at checkout until {countdown.endLabel} — no code needed.
            </p>
          )}
        </div>
      )}

      {/* Late-fee urgency banner (programmes that price by a late fee instead) */}
      {!promo && earlyBird.active && earlyBird.deadline && (
        <div className="px-6">
          <div className="relative z-10 max-w-4xl mx-auto mt-6 rounded-xl px-5 py-3 flex items-center justify-center gap-2 text-sm font-semibold"
            style={{ background: `${BRAND.gold}1a`, border: `1px solid ${BRAND.gold}55`, color: BRAND.gold }}>
            <Flame className="w-4 h-4" />
            Early-bird pricing ends {new Date(earlyBird.deadline + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "long" })} — register now to skip the late fee.
          </div>
        </div>
      )}

      {/* Key info */}
      <section className="max-w-5xl mx-auto px-6 py-14 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Trophy, label: "Format", value: "5 vs 5 & 7 vs 7" },
          { icon: CreditCard, label: promo ? "Early bird from" : "From", value: cheapest && (promo || cheapest.list) ? <><s className="font-normal mr-1.5" style={{ color: BRAND.dim }}>{formatCurrency(cheapest.list ?? cheapest.full, { fromCents: true })}</s>{formatCurrency(lowestCents, { fromCents: true })} / team</> : `${formatCurrency(lowestCents, { fromCents: true })} / team` },
          { icon: Calendar, label: "Season", value: seasonValue },
          { icon: MapPin, label: "Where", value: whereValue },
        ].map((c, i) => (
          <div key={i} className="rounded-2xl p-5" style={{ background: BRAND.card, border: `1px solid ${BRAND.border}` }}>
            <c.icon className="w-5 h-5 mb-2.5" style={{ color: BRAND.gold }} />
            <p className="text-[11px] uppercase tracking-wider" style={{ color: BRAND.dim }}>{c.label}</p>
            <p className="text-[15px] font-semibold mt-0.5">{c.value as any}</p>
          </div>
        ))}
      </section>

      {/* 3 ways to pay (Daniel 2026-09-24): Player Pay · Play Now Pay Later (most popular) · Pay upfront.
          Each card shows only if the checkout actually offers it — never promise a route that isn't on sale. */}
      {(() => {
        const ways: { icon: any; title: string; body: React.ReactNode; badge?: string; price?: React.ReactNode }[] = [];
        // "From" figures come from the cheapest night on sale right now (early bird included).
        const money = (c: number) => formatCurrency(c, { fromCents: true }).replace(/\.00$/, "");
        const SPLIT_SQUAD = 8; // the register page's default squad for Player Pay
        if (data.splitEnabled) ways.push({
          icon: Users, title: "Player Pay",
          price: lowestCents > 0 ? <>from {money(Math.ceil(lowestCents / SPLIT_SQUAD / 100) * 100)}<span className="text-sm font-semibold" style={{ color: BRAND.muted }}> / player</span></> : undefined,
          body: `Split the fee across your squad — everyone pays their own share on their own card.${lowestCents > 0 ? ` Based on ${SPLIT_SQUAD} players.` : ""}`,
        });
        if (depositCents != null && depositCents > 0) ways.push({
          icon: Clock, title: "Play Now, Pay Later", badge: "Most popular",
          price: isWeeklyPlan && lowestWeeklyCents > 0 ? <>from {money(lowestWeeklyCents)}<span className="text-sm font-semibold" style={{ color: BRAND.muted }}> / week</span></> : undefined,
          body: isWeeklyPlan
            ? <>{money(depositCents)} deposit today to lock your spot, then small weekly payments.</>
            : <>{formatCurrency(depositCents, { fromCents: true })} deposit today, the balance about three weeks into the term.</>,
        });
        ways.push({ icon: CreditCard, title: "Pay upfront",
          price: lowestCents > 0 ? <>from {money(lowestCents)}<span className="text-sm font-semibold" style={{ color: BRAND.muted }}> / team</span></> : undefined,
          body: "One payment for the whole term and you're done." });
        return (
          <section className="max-w-5xl mx-auto px-6 pb-4">
            <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: BRAND.gold }}>{ways.length} ways to pay</h2>
            <div className={`grid gap-4 ${ways.length === 3 ? "md:grid-cols-3" : ways.length === 2 ? "md:grid-cols-2" : ""}`}>
              {ways.map((w) => (
                <div key={w.title} className="relative rounded-2xl p-6"
                  style={{ background: BRAND.cardSoft, border: `1px solid ${w.badge ? BRAND.gold : BRAND.border}` }}>
                  {w.badge && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
                      style={{ background: BRAND.gold, color: BRAND.black }}>{w.badge}</span>
                  )}
                  <div className="w-11 h-11 rounded-full flex items-center justify-center mb-3" style={{ background: `${BRAND.gold}1f` }}>
                    <w.icon className="w-5 h-5" style={{ color: BRAND.gold }} />
                  </div>
                  <h3 className="text-lg font-bold">{w.title}</h3>
                  {w.price && <p className="text-2xl font-bold mt-1 tracking-tight" style={{ color: BRAND.gold }} data-testid={`way-price-${w.title}`}>{w.price}</p>}
                  <p className="text-sm mt-1.5" style={{ color: BRAND.muted }}>{w.body}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Divisions / nights with spots-left */}
      <section className="max-w-5xl xl:max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <h2 className="text-2xl font-bold mb-2 text-center" style={{ color: BRAND.gold }}>Pick your night</h2>
        {promo && (
          <p className="text-center text-sm mb-2 inline-flex w-full items-center justify-center gap-2 flex-wrap" style={{ color: BRAND.muted }} data-testid="early-bird-cards-line">
            <Flame className="w-3.5 h-3.5" style={{ color: BRAND.gold }} />
            <span>Early bird prices shown · ends in</span> <Countdown c={countdown} compact />
          </p>
        )}
        {(() => {
          const soldOut = divisions.filter((d) => d.spotsLeft != null && d.spotsLeft <= 0);
          return soldOut.length > 0 ? (
            <p className="text-center text-sm mb-6" style={{ color: BRAND.muted }}>
              <span className="font-bold" style={{ color: BRAND.red }}>{soldOut.map((d) => d.name).join(" & ")} sold out</span> — other nights are filling fast.
            </p>
          ) : <div className="mb-6" />;
        })()}
        {/* Grouped by format (Daniel 2026-09-24): all the 5-a-side nights together,
            then all the 7-a-side, each Mon→Thu. 4 across on a big screen,
            2×2 on a tablet/small laptop, 1 per row on a phone. */}
        <div className="mt-8 space-y-12">
        {nightGroups.map((g) => (
        <div key={g.key} data-testid={`night-group-${g.key}`}>
          <div className="flex items-end justify-between gap-3 mb-4 pb-3" style={{ borderBottom: `1px solid ${BRAND.border}` }}>
            <div>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight">{g.title}</h3>
              {g.sub && <p className="text-[13px] mt-0.5" style={{ color: BRAND.muted }}>{g.sub}</p>}
            </div>
            <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: BRAND.gold }}>
              {g.open} of {g.divisions.length} nights open
            </span>
          </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {g.divisions.map((d) => {
            const full = d.spotsLeft != null && d.spotsLeft <= 0;
            const lowSpots = !full && d.spotsLeft != null && d.spotsLeft <= 4;
            // More than half full → say how many are left, up top (Daniel 2026-09-24).
            const halfFull = !full && d.spotsLeft != null && d.spotsLeft > 0 && d.maxTeams != null && d.maxTeams > 0 && d.teamCount > d.maxTeams / 2;
            const price = priced(d);
            const weeklyCents = isWeeklyPlan ? price.weekly : 0;
            const href = full ? `/league/${slug}/waitlist?division=${d.id}` : `${registerHref}?division=${d.id}`;
            return (
              <Link key={d.id} href={href}>
                <a
                  className="group rounded-2xl p-5 flex flex-col transition-all relative overflow-hidden"
                  style={{ background: BRAND.card, border: `1px solid ${full ? `${BRAND.red}66` : BRAND.border}`, cursor: "pointer" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = full ? BRAND.red : BRAND.gold; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = full ? `${BRAND.red}66` : BRAND.border; }}
                  data-testid={`division-card-${d.id}`}
                >
                  {full && (
                    <span className="absolute top-0 right-0 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-bl-xl" style={{ background: BRAND.red, color: "#fff" }} data-testid={`sold-out-badge-${d.id}`}>
                      Sold out
                    </span>
                  )}
                  {/* Sold out always wins — a full night must never advertise a
                      discount it can't honour. Sits above the title rather than
                      as a corner ribbon because the price occupies the top-right
                      of every night that is still open. */}
                  {!full && (promo || d.badgeText || halfFull) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {/* The early bird pill is the urgency; a night's own badge
                          (a structural price, like the new-league discount) sits
                          beside it outlined so the two read as different things. */}
                      {promo && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full" style={{ background: BRAND.gold, color: BRAND.black }} data-testid={`early-bird-badge-${d.id}`}>
                          <Flame className="w-3 h-3" /> Early bird · {promoPct}
                        </span>
                      )}
                      {halfFull && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full" style={{ background: BRAND.red, color: "#fff" }} data-testid={`spots-badge-${d.id}`}>
                          <Flame className="w-3 h-3" /> {d.spotsLeft} spot{d.spotsLeft === 1 ? "" : "s"} left
                        </span>
                      )}
                      {d.badgeText && (
                        <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full" style={promo ? { border: `1px solid ${BRAND.gold}88`, color: BRAND.gold } : { background: BRAND.gold, color: BRAND.black }} data-testid={`division-badge-${d.id}`}>
                          {d.badgeText}{price.listPct > 0 ? ` · ${price.listPct}% off` : ""}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-lg font-bold">{d.name}</h3>
                    {!full && (
                      <span className="text-right leading-tight flex-shrink-0">
                        {(price.discount > 0 || price.list) && (
                          <s className="block text-[12px]" style={{ color: BRAND.dim }} data-testid={`full-price-${d.id}`}>{formatCurrency(price.list ?? price.full, { fromCents: true })}</s>
                        )}
                        <span className="text-[17px] font-bold" style={{ color: BRAND.gold }} data-testid={`price-${d.id}`}>{formatCurrency(price.total, { fromCents: true })}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: BRAND.muted }}>
                    <Clock className="w-3.5 h-3.5" /> {d.dayOfWeek || "Weeknights"}{d.ageGroup ? ` · ${d.ageGroup}` : ""}
                  </p>
                  {full ? (
                    <p className="text-[12px] mt-1" style={{ color: BRAND.dim }}>
                      This night filled up — waitlisted teams get first call.
                    </p>
                  ) : weeklyCents > 0 && (
                    <p className="text-[12px] mt-1" style={{ color: BRAND.dim }}>
                      {formatCurrency(price.deposit, { fromCents: true })} deposit · {formatCurrency(weeklyCents, { fromCents: true })}/week
                    </p>
                  )}
                  {/* Stack & save — every rung is a figure the checkout would
                      show: the usual price, the night's own discount, early
                      bird on top. Only drawn when there is something to stack. */}
                  {!full && (price.list || price.discount > 0) && (
                    <div className="mt-3 rounded-lg px-3 py-2 text-[11px] space-y-0.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${BRAND.border}` }} data-testid={`stack-${d.id}`}>
                      <div className="text-[9px] font-bold uppercase tracking-[0.18em] mb-1" style={{ color: BRAND.gold }}>Stack &amp; save</div>
                      <div className="flex justify-between gap-3"><span style={{ color: BRAND.dim }}>Usual price</span><s style={{ color: BRAND.dim }}>{formatCurrency(price.list ?? price.full, { fromCents: true })}</s></div>
                      {price.list && (
                        <div className="flex justify-between gap-3"><span style={{ color: BRAND.muted }}>{d.badgeText || "Night discount"} · {price.listPct}% off</span><span style={{ color: BRAND.white }}>{formatCurrency(price.full, { fromCents: true })}</span></div>
                      )}
                      {price.discount > 0 && (
                        <div className="flex justify-between gap-3"><span style={{ color: BRAND.muted }}>Early bird · {promoPct}</span><span className="font-bold" style={{ color: BRAND.gold }}>{formatCurrency(price.total, { fromCents: true })}</span></div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-auto pt-4">
                    {full ? (
                      <span className="text-[12px] font-bold inline-flex items-center gap-1" style={{ color: BRAND.red }}>
                        <Flame className="w-3.5 h-3.5" /> Waitlist open
                      </span>
                    ) : d.spotsLeft != null ? (
                      <span className="text-[12px] font-bold inline-flex items-center gap-1" style={{ color: lowSpots ? BRAND.red : BRAND.gold }}>
                        {lowSpots && <Flame className="w-3.5 h-3.5" />}
                        {lowSpots ? `Only ${d.spotsLeft} spot${d.spotsLeft === 1 ? "" : "s"} left` : `${d.spotsLeft} spot${d.spotsLeft === 1 ? "" : "s"} left`}
                      </span>
                    ) : <span />}
                    <span className="text-[13px] font-semibold inline-flex items-center gap-1 opacity-80 group-hover:opacity-100" style={{ color: BRAND.gold }}>
                      {full ? "Join waitlist" : "Register"} <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </a>
              </Link>
            );
          })}
        </div>
        </div>
        ))}
        </div>
      </section>

      {/* Upsells preview */}
      {upsells.length > 0 && (
        <section className="max-w-4xl mx-auto px-6 pb-12">
          <div className="grid sm:grid-cols-2 gap-4">
            {upsells.map((u) => (
              <div key={u.type} className="rounded-2xl p-5 flex items-center gap-4" style={{ background: BRAND.cardSoft, border: `1px solid ${BRAND.border}` }}>
                <Zap className="w-5 h-5 flex-shrink-0" style={{ color: BRAND.gold }} />
                <div className="flex-1">
                  <p className="font-semibold">{u.label}</p>
                  <p className="text-sm" style={{ color: BRAND.muted }}>Add at checkout</p>
                </div>
                <span className="font-bold" style={{ color: BRAND.gold }}>+{formatCurrency(u.priceCents, { fromCents: true })}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trust */}
      <section className="max-w-4xl mx-auto px-6 py-10 text-center">
        <div className="flex items-center justify-center gap-2 mb-2"><Stars /></div>
        <p style={{ color: BRAND.muted }}>50+ teams already playing</p>
        <div className="flex items-center justify-center gap-6 mt-5 text-sm" style={{ color: BRAND.dim }}>
          <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Social & competitive</span>
          <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Qualified refs</span>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: BRAND.gold }}>Questions?</h2>
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <div key={i} className="rounded-xl overflow-hidden" style={{ background: BRAND.card, border: `1px solid ${BRAND.border}` }}>
              <button className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                {f.q}
                <ChevronDown className="w-4 h-4 transition-transform" style={{ color: BRAND.gold, transform: openFaq === i ? "rotate(180deg)" : "none" }} />
              </button>
              {openFaq === i && <p className="px-5 pb-4 text-sm" style={{ color: BRAND.muted }}>{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h2 className="text-3xl font-bold">Ready to play?</h2>
        <p className="mt-2" style={{ color: BRAND.muted }}>Register your team in under two minutes.</p>
        <Link href={registerHref}>
          <a className="inline-flex items-center gap-2 mt-6 px-9 py-3.5 rounded-full font-bold" style={{ background: BRAND.gold, color: BRAND.black }} data-testid="cta-register-bottom">
            Register your team <ArrowRight className="w-4 h-4" />
          </a>
        </Link>
      </section>

      <Footer />

      {/* Sticky mobile CTA */}
      {slug && <SignupToast slug={slug} />}
      <div className="fixed bottom-0 inset-x-0 sm:hidden px-4 py-3" style={{ background: "rgba(0,0,0,0.92)", borderTop: `1px solid ${BRAND.border}`, paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <Link href={registerHref}>
          <a className="flex items-center justify-center gap-2 w-full py-3.5 rounded-full font-bold" style={{ background: BRAND.gold, color: BRAND.black }}>
            Register your team <ArrowRight className="w-4 h-4" />
          </a>
        </Link>
      </div>
    </div>
  );
}

/**
 * A vertical (9:16) film in a phone-shaped frame: poster and a gold play button
 * until tapped, then the real controls with sound — a talking-head makes no
 * sense muted, so it never autoplays.
 */
function HeroVideo({ src, poster, seconds }: { src: string; poster: string; seconds: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative mx-auto mt-8 overflow-hidden rounded-2xl" data-testid="hero-video"
         style={{ maxWidth: 300, aspectRatio: "9 / 16", background: BRAND.card, border: `1px solid ${BRAND.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.6)" }}>
      <video ref={ref} src={src} poster={poster} playsInline preload="metadata" controls={playing}
             className="h-full w-full object-cover" onPlay={() => setPlaying(true)} onEnded={() => setPlaying(false)} />
      {!playing && (
        <button type="button" onClick={() => { ref.current?.play().catch(() => {}); }}
                className="absolute inset-0 flex items-center justify-center" aria-label="Play the Summer Leagues video" data-testid="hero-video-play">
          <span className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: BRAND.gold, color: BRAND.black, boxShadow: "0 8px 30px rgba(209,185,110,0.45)" }}>
            <Play className="w-7 h-7 ml-1" fill="currentColor" />
          </span>
          <span className="absolute bottom-4 left-0 right-0 text-center text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BRAND.white, textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
            Watch · {seconds} sec
          </span>
        </button>
      )}
    </div>
  );
}

function Hero({ org, headline, sub, ctaHref, showCta, video }: { org: any; headline: string; sub: string; ctaHref?: string; showCta: boolean; video?: { src: string; poster: string; seconds: number } | null }) {
  return (
    <header className="relative overflow-hidden" style={{ background: `radial-gradient(120% 80% at 50% 0%, ${BRAND.cardSoft} 0%, ${BRAND.black} 60%)` }}>
      <div className="max-w-3xl mx-auto px-6 pt-8 sm:pt-12 pb-12 text-center">
        {/* The trimmed crest: the org logo file carries ~11% transparent padding per side, which read as dead space. */}
        <img src={MFL_CREST} alt="Mini Football Leagues" className="h-16 sm:h-20 w-auto mx-auto mb-5 sm:mb-6 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).src = org?.logoUrl || MFL_LOGO; }} />
        <h1 className="text-3xl sm:text-5xl font-bold leading-[1.08] tracking-tight whitespace-pre-line">
          {/* *Words in asterisks* render gold; a newline in the data breaks the line. */}
          {headline.split(/\*([^*]+)\*/).map((part, i) => i % 2 ? <span key={i} className="whitespace-nowrap" style={{ color: BRAND.gold }}>{part}</span> : part)}
        </h1>
        <p className="text-base sm:text-lg mt-4" style={{ color: BRAND.muted }}>{sub}</p>
        {video && <HeroVideo {...video} />}
        {showCta && ctaHref && (
          <Link href={ctaHref}>
            <a className="inline-flex items-center gap-2 mt-8 px-10 py-3.5 rounded-full font-bold shadow-lg" style={{ background: BRAND.gold, color: BRAND.black }} data-testid="cta-register-hero">
              Register your team <ArrowRight className="w-4 h-4" />
            </a>
          </Link>
        )}
        <div className="flex items-center justify-center gap-2 mt-6 text-sm" style={{ color: BRAND.dim }}>
          <Stars /> <span>50+ teams playing</span>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t mt-8" style={{ borderColor: BRAND.border }}>
      <div className="max-w-4xl mx-auto px-6 py-8 text-center text-[12px]" style={{ color: BRAND.dim }}>
        <CheckCircle2 className="w-4 h-4 inline mr-1.5" style={{ color: BRAND.goldDeep }} />
        Mini Football Leagues · United Sports Centre, 466 Yaldhurst Rd, Christchurch
      </div>
    </footer>
  );
}
