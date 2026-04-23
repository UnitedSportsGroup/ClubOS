import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck, RefreshCw, Heart, Mail } from "lucide-react";
import cuFcLogoPath from "@assets/CUFC_LOGO_1772823768518.png";

const BRAND = {
  blue: "#22399B",
  white: "#FBFBFC",
  gold: "#D9B10F",
  darkBlue: "#221F7A",
};

export default function TermsPage() {
  useEffect(() => {
    document.title = "Terms & Conditions — Christchurch United FC Holiday Camps";
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
            <ShieldCheck className="w-3.5 h-3.5" style={{ color: BRAND.gold }} />
            <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: BRAND.gold }}>
              Our Promise to You
            </span>
          </div>
          <h1
            className="text-[34px] sm:text-[44px] font-bold leading-tight mb-3"
            style={{ color: BRAND.white }}
            data-testid="heading-terms"
          >
            Terms & Conditions
          </h1>
          <p className="text-[14px] sm:text-[15px] max-w-xl mx-auto" style={{ color: 'rgba(251,251,252,0.7)' }}>
            Cancellations, refunds and credits for our holiday camp programs.
          </p>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <div className="space-y-10">
          {/* Section 1 - Cancellations & Refunds */}
          <section data-testid="section-cancellations">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${BRAND.blue}15`, border: `1px solid ${BRAND.blue}25` }}
              >
                <RefreshCw className="w-4 h-4" style={{ color: BRAND.blue }} />
              </div>
              <h2 className="text-[22px] sm:text-[26px] font-bold text-slate-800">Cancellations & Refunds</h2>
            </div>
            <div className="space-y-4 text-[14px] sm:text-[15px] leading-relaxed text-slate-600 pl-13">
              <p>
                If our program is cancelled by CUFC Staff, a full refund will be given, or you can move
                your child(ren) to another day/session. This will be arranged with the CUFC Office Administrator.
              </p>
              <p>
                Weather would have to be not suitable for an outdoor program to run, for CUFC Staff to cancel
                the session(s). Parents would be advised by no later than{" "}
                <strong className="text-slate-800">8am on the morning of the Program</strong>, giving Staff
                plenty of time to assess the situation, and make an informed decision.
              </p>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          {/* Section 2 - Refunds & Credits */}
          <section data-testid="section-refunds-credits">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${BRAND.gold}15`, border: `1px solid ${BRAND.gold}30` }}
              >
                <Heart className="w-4 h-4" style={{ color: BRAND.gold }} />
              </div>
              <h2 className="text-[22px] sm:text-[26px] font-bold text-slate-800">Refunds & Credits</h2>
            </div>
            <div className="space-y-4 text-[14px] sm:text-[15px] leading-relaxed text-slate-600 pl-13">
              <p>
                Refunds will only be given for medical reasons, and a{" "}
                <strong className="text-slate-800">medical certificate must be provided</strong> for a refund
                to be approved. If you are unable to come to a day/session, you will have this credit which
                can be used for other days/sessions.
              </p>
              <p>
                When the child does not attend the session for any other reason but medical or exceptional
                circumstances, we are unable to offer a refund because every day we employ coaches to ensure
                there are enough coaches for all children to get the best experience on the day.
              </p>

              <div
                className="rounded-xl p-5 my-2"
                style={{
                  background: `${BRAND.blue}06`,
                  border: `1px solid ${BRAND.blue}15`,
                }}
              >
                <p className="text-[13px] font-semibold mb-1.5" style={{ color: BRAND.blue }}>
                  Credit usage
                </p>
                <p className="text-[14px] text-slate-600">
                  This credit must be used by the end of the current school holiday programs. For example,
                  if you are enrolled in one of our Summer Holiday Programs, your credit must be used by the
                  end of those Summer Holiday Programs.
                </p>
              </div>

              <p>
                You will be advised by email if you are receiving a full refund, or you have a credit to use.
                A final date it can be used will be given in this email.
              </p>
            </div>
          </section>

          <div className="border-t border-slate-100" />

          {/* Contact */}
          <section data-testid="section-contact">
            <div
              className="rounded-2xl p-6 sm:p-8 text-center"
              style={{
                background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, ${BRAND.blue} 100%)`,
              }}
            >
              <Mail className="w-6 h-6 mx-auto mb-3" style={{ color: BRAND.gold }} />
              <h3 className="text-[18px] sm:text-[20px] font-bold mb-2" style={{ color: BRAND.white }}>
                Questions about a refund or credit?
              </h3>
              <p className="text-[13px] mb-4" style={{ color: 'rgba(251,251,252,0.7)' }}>
                Get in touch with our office administrator and we'll sort it out for you.
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
