import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck, Database, Eye, Share2, Lock, UserCheck, Cookie, Mail, FileText } from "lucide-react";
import cuFcLogoPath from "@assets/CUFC_LOGO_1772823768518.png";

const BRAND = {
  blue: "#22399B",
  white: "#FBFBFC",
  gold: "#D9B10F",
  darkBlue: "#221F7A",
};

const LAST_UPDATED = "23 April 2026";

type Section = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string;
  body: React.ReactNode;
  testId: string;
  accent?: "blue" | "gold";
};

const sections: Section[] = [
  {
    icon: FileText,
    title: "1. About this Privacy Policy",
    testId: "section-about",
    body: (
      <>
        <p>
          Christchurch United Football Club Incorporated ("CUFC", "we", "us" or "our") is committed to
          protecting the privacy of personal information we collect, hold, use and disclose. This Privacy
          Policy explains how we manage personal information in accordance with the{" "}
          <strong className="text-slate-800">Privacy Act 2020 (New Zealand)</strong> and the Information
          Privacy Principles.
        </p>
        <p>
          This policy applies to all personal information collected through our website, holiday camp
          programs, academy programs, registrations, events, and other interactions with our club.
        </p>
      </>
    ),
  },
  {
    icon: Database,
    title: "2. Information we collect",
    testId: "section-collect",
    accent: "blue",
    body: (
      <>
        <p>We may collect the following types of personal information:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-slate-800">Parent/guardian details</strong> — name, email address, phone
            number, postal address, and emergency contact information.
          </li>
          <li>
            <strong className="text-slate-800">Child details</strong> — name, date of birth, gender, school,
            year level, and football experience.
          </li>
          <li>
            <strong className="text-slate-800">Medical and welfare information</strong> — allergies, medical
            conditions, medications, dietary requirements, and any other relevant health information needed
            to keep your child safe in our programs.
          </li>
          <li>
            <strong className="text-slate-800">Payment information</strong> — billing details processed
            securely by our payment provider, Stripe. We do not store full credit card numbers on our
            systems.
          </li>
          <li>
            <strong className="text-slate-800">Photos and video</strong> — images or footage taken at our
            programs and events, where you have provided consent.
          </li>
          <li>
            <strong className="text-slate-800">Website and communication data</strong> — IP address, browser
            type, pages visited, referral source, and email open/click activity, collected through cookies
            and analytics tools.
          </li>
        </ul>
      </>
    ),
  },
  {
    icon: Eye,
    title: "3. How we use your information",
    testId: "section-use",
    body: (
      <>
        <p>We use the personal information we collect for purposes including:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Registering and managing your child's participation in our programs.</li>
          <li>Communicating with you about bookings, schedules, cancellations, and refunds.</li>
          <li>Ensuring the safety and welfare of your child during our programs.</li>
          <li>Processing payments, refunds and credits.</li>
          <li>
            Sending you information about upcoming programs, events, and offers we think may be of interest
            (you can unsubscribe at any time).
          </li>
          <li>Improving our website, programs and services.</li>
          <li>Meeting our legal, regulatory and insurance obligations.</li>
        </ul>
      </>
    ),
  },
  {
    icon: Share2,
    title: "4. Sharing your information",
    testId: "section-sharing",
    body: (
      <>
        <p>
          We do not sell your personal information. We may share it with trusted third parties only where
          necessary, including:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-slate-800">Our coaches and staff</strong> — to deliver programs safely
            and respond to medical or welfare needs.
          </li>
          <li>
            <strong className="text-slate-800">Service providers</strong> — payment processors (Stripe),
            email delivery services (Resend), website hosting and analytics providers, and similar vendors
            who help us run the club.
          </li>
          <li>
            <strong className="text-slate-800">Emergency services or medical professionals</strong> — if
            urgently required to protect a child's health or safety.
          </li>
          <li>
            <strong className="text-slate-800">Regulatory or legal authorities</strong> — where we are
            required to do so by law.
          </li>
        </ul>
        <p>
          Some of our service providers may store data overseas. Where this happens, we take reasonable
          steps to ensure your information is handled in line with the protections required by the New
          Zealand Privacy Act 2020.
        </p>
      </>
    ),
  },
  {
    icon: Lock,
    title: "5. Storage and security",
    testId: "section-security",
    accent: "gold",
    body: (
      <>
        <p>
          We take reasonable technical and organisational steps to protect personal information from loss,
          unauthorised access, modification or disclosure. These steps include encrypted database
          connections, secure password storage, restricted staff access, and HTTPS encryption across our
          website.
        </p>
        <p>
          We retain personal information only for as long as it is needed for the purposes set out in this
          policy, or as required by law (for example, financial records). When information is no longer
          needed, we securely delete or anonymise it.
        </p>
      </>
    ),
  },
  {
    icon: UserCheck,
    title: "6. Your rights",
    testId: "section-rights",
    body: (
      <>
        <p>Under the Privacy Act 2020 you have the right to:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Request access to the personal information we hold about you or your child.</li>
          <li>Request correction of any information that is inaccurate, incomplete or out of date.</li>
          <li>Withdraw consent for marketing communications at any time.</li>
          <li>
            Make a complaint about how we have handled your personal information, either to us directly or
            to the{" "}
            <a
              href="https://www.privacy.org.nz/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium hover:underline"
              style={{ color: BRAND.blue }}
              data-testid="link-opc"
            >
              Office of the Privacy Commissioner
            </a>
            .
          </li>
        </ul>
        <p>
          To make a request or raise a concern, please contact our office using the details at the bottom of
          this page.
        </p>
      </>
    ),
  },
  {
    icon: Cookie,
    title: "7. Cookies and tracking",
    testId: "section-cookies",
    body: (
      <>
        <p>
          Our website uses cookies and similar technologies to remember your preferences, keep you logged in
          where applicable, and understand how the site is used. We also use the Meta Pixel to measure the
          effectiveness of our advertising on Facebook and Instagram.
        </p>
        <p>
          You can disable cookies in your browser settings, but parts of our site may not work as intended
          if you do so.
        </p>
      </>
    ),
  },
  {
    icon: ShieldCheck,
    title: "8. Children's privacy",
    testId: "section-children",
    body: (
      <>
        <p>
          Our programs are designed for children, and we collect information about children only with the
          consent of a parent or legal guardian, who completes the registration on the child's behalf.
        </p>
        <p>
          If you believe we have collected information about your child without your consent, please contact
          us and we will remove it promptly.
        </p>
      </>
    ),
  },
  {
    icon: FileText,
    title: "9. Changes to this policy",
    testId: "section-changes",
    body: (
      <>
        <p>
          We may update this Privacy Policy from time to time to reflect changes to our practices or legal
          obligations. The latest version will always be available on this page, with the "Last updated"
          date shown at the top.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy — Christchurch United FC";
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: BRAND.white }}>
      {/* Header */}
      <header className="border-b border-slate-100" style={{ background: BRAND.white }}>
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group" data-testid="link-home">
            <img src={cuFcLogoPath} alt="Christchurch United FC" className="w-9 h-9 object-contain" />
            <div>
              <p className="text-[12px] font-bold tracking-wide text-slate-700">CHRISTCHURCH UNITED FC</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Holiday Camps</p>
            </div>
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
            data-testid="link-back"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Camps
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)`,
        }}
      >
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 50%, ${BRAND.gold} 0%, transparent 50%), radial-gradient(circle at 80% 80%, ${BRAND.gold} 0%, transparent 40%)`,
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6 py-16 text-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
            style={{
              background: `${BRAND.gold}25`,
              border: `1px solid ${BRAND.gold}50`,
            }}
          >
            <Lock className="w-3.5 h-3.5" style={{ color: BRAND.gold }} />
            <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: BRAND.gold }}>
              Your Privacy Matters
            </span>
          </div>
          <h1
            className="text-[34px] sm:text-[44px] font-bold leading-tight mb-3"
            style={{ color: BRAND.white }}
            data-testid="heading-privacy"
          >
            Privacy Policy
          </h1>
          <p className="text-[14px] sm:text-[15px] max-w-xl mx-auto mb-2" style={{ color: 'rgba(251,251,252,0.7)' }}>
            How Christchurch United Football Club Incorporated collects, uses and protects your personal
            information.
          </p>
          <p className="text-[12px]" style={{ color: 'rgba(251,251,252,0.45)' }} data-testid="text-last-updated">
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <div className="space-y-10">
          {sections.map((s, i) => {
            const Icon = s.icon;
            const accentColor = s.accent === "gold" ? BRAND.gold : BRAND.blue;
            const accentAlpha = s.accent === "gold" ? "30" : "25";
            return (
              <div key={s.testId}>
                <section data-testid={s.testId}>
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background: `${accentColor}15`,
                        border: `1px solid ${accentColor}${accentAlpha}`,
                      }}
                    >
                      <Icon className="w-4 h-4" style={{ color: accentColor }} />
                    </div>
                    <h2 className="text-[20px] sm:text-[24px] font-bold text-slate-800">{s.title}</h2>
                  </div>
                  <div className="space-y-3 text-[14px] sm:text-[15px] leading-relaxed text-slate-600 pl-13">
                    {s.body}
                  </div>
                </section>
                {i < sections.length - 1 && <div className="border-t border-slate-100 mt-10" />}
              </div>
            );
          })}

          {/* Contact */}
          <section data-testid="section-contact" className="pt-2">
            <div
              className="rounded-2xl p-6 sm:p-8 text-center"
              style={{
                background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)`,
              }}
            >
              <Mail className="w-6 h-6 mx-auto mb-3" style={{ color: BRAND.gold }} />
              <h3 className="text-[18px] sm:text-[20px] font-bold mb-2" style={{ color: BRAND.white }}>
                Contact us about your privacy
              </h3>
              <p className="text-[13px] mb-4" style={{ color: 'rgba(251,251,252,0.7)' }}>
                Christchurch United Football Club Incorporated · Christchurch, New Zealand
              </p>
              <a
                href="mailto:office@cufc.co.nz"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-[13px] transition-transform hover:scale-105"
                style={{ background: BRAND.gold, color: BRAND.darkBlue }}
                data-testid="link-email-office"
              >
                <Mail className="w-3.5 h-3.5" /> office@cufc.co.nz
              </a>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ background: BRAND.darkBlue }}>
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex flex-col items-center text-center">
            <img src={cuFcLogoPath} alt="Christchurch United FC" className="w-10 h-10 object-contain opacity-50 mb-3" />
            <p className="text-[12px] font-semibold mb-4" style={{ color: 'rgba(251,251,252,0.35)' }}>
              Christchurch United Football Club
            </p>
            <div className="flex items-center gap-5 mb-4">
              <a href="/privacy" className="text-[11px] hover:underline transition-colors" style={{ color: 'rgba(251,251,252,0.3)' }} data-testid="link-privacy">
                Privacy Policy
              </a>
              <a href="/terms" className="text-[11px] hover:underline transition-colors" style={{ color: 'rgba(251,251,252,0.3)' }} data-testid="link-terms">
                Terms & Conditions
              </a>
            </div>
            <div className="w-full max-w-xs h-px mb-4" style={{ background: 'rgba(251,251,252,0.06)' }} />
            <p className="text-[11px]" style={{ color: 'rgba(251,251,252,0.2)' }}>
              &copy; {new Date().getFullYear()} Christchurch United FC. All Rights Reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
