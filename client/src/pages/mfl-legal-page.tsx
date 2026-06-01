import { Link } from "wouter";

// Public legal pages for the MFL app store listings:
//   /league/privacy        → privacy policy
//   /league/delete-account → how to delete your account (Apple/Google require
//                            a publicly reachable URL, not just an in-app path)
const BRAND = {
  black: "#000000", card: "#141414", border: "#2a2a2a",
  gold: "#d1b96e", white: "#ffffff", muted: "rgba(255,255,255,0.66)", dim: "rgba(255,255,255,0.4)",
};
const FONT = "'Inter Tight', Inter, system-ui, -apple-system, sans-serif";
const MFL_LOGO = "/logos/mini-football-leagues.png";
const SUPPORT_EMAIL = "minifootball@cufc.co.nz";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: BRAND.black, color: BRAND.white, fontFamily: FONT }}>
      <header className="border-b" style={{ borderColor: BRAND.border }}>
        <div className="max-w-2xl mx-auto px-6 h-16 flex items-center gap-3">
          <img src={MFL_LOGO} alt="Mini Football Leagues" className="h-9 w-auto object-contain" />
          <span className="text-sm" style={{ color: BRAND.dim }}>Mini Football Leagues</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">{title}</h1>
        <p className="text-[13px] mb-8" style={{ color: BRAND.dim }}>Christchurch United Football Club · Last updated June 2026</p>
        <div className="space-y-6 text-[15px] leading-relaxed" style={{ color: BRAND.muted }}>{children}</div>
        <div className="mt-12 pt-6 border-t text-[13px]" style={{ borderColor: BRAND.border, color: BRAND.dim }}>
          <Link href="/league"><a style={{ color: BRAND.gold }}>← Back to Mini Football Leagues</a></Link>
        </div>
      </main>
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold mt-2" style={{ color: BRAND.white }}>{children}</h2>;
}

export default function MflLegalPage({ kind }: { kind: "privacy" | "delete" }) {
  if (kind === "delete") {
    return (
      <Shell title="Delete your account">
        <p>You can permanently delete your Mini Football Leagues account and personal information at any time.</p>
        <H>In the app</H>
        <p>Open the app → <strong style={{ color: BRAND.white }}>Profile</strong> tab → <strong style={{ color: BRAND.white }}>Delete account</strong>, then confirm. Your account is deleted immediately.</p>
        <H>By email</H>
        <p>If you can't access the app, email <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete my MFL account`} style={{ color: BRAND.gold }}>{SUPPORT_EMAIL}</a> from the email address on your account and we'll delete it within 7 days.</p>
        <H>What gets deleted</H>
        <p>Your name, email, phone number and login credentials are permanently removed, and your account is deactivated so it can no longer be signed in to.</p>
        <H>What we keep</H>
        <p>Anonymised records required for accounting, tax and competition history (for example, that a team paid an entry fee) are retained without any personal information attached, as required by law.</p>
      </Shell>
    );
  }

  return (
    <Shell title="Privacy Policy">
      <p>Mini Football Leagues is run by Christchurch United Football Club Incorporated (“we”, “us”). This policy explains what we collect through the Mini Football Leagues app and registration pages, and how we use it.</p>
      <H>What we collect</H>
      <p>Account details (name, email, phone), the teams you create or play for, fixtures and results, referee assignments, and — when you register a team — payment details processed securely by our payment provider. We never see or store your full card number.</p>
      <H>How we use it</H>
      <p>To run the leagues: manage your account and team, schedule and score games, take registration payments, send confirmations and notices, and improve the service. We use aggregate, non-identifying analytics to understand how the app and registration pages are used.</p>
      <H>Who we share it with</H>
      <p>Service providers who help us operate: Stripe (payments), Resend (email), Meta (advertising measurement). They process data only on our behalf. We don't sell your personal information.</p>
      <H>Retention &amp; your rights</H>
      <p>We keep your information while your account is active. You can access, correct or delete your data at any time — see <Link href="/league/delete-account"><a style={{ color: BRAND.gold }}>Delete your account</a></Link>. After deletion, only anonymised financial/competition records are retained as required by law.</p>
      <H>Contact</H>
      <p>Questions? Email <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: BRAND.gold }}>{SUPPORT_EMAIL}</a>.</p>
    </Shell>
  );
}
