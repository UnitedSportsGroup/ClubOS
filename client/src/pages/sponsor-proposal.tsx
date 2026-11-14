/**
 * The page a sponsor opens: /proposal/<token>.
 *
 * ONE fixed design, lifted from the hand-built partner pages (the kit
 * partnerships page): the club's crest beside the sponsor's logo, the offer as
 * the headline, what is included, the audience figures with their source, the
 * proposed terms, and an Accept box. Each club wears its own colours and type
 * (PROPOSAL_BRANDS).
 *
 * 🔴 Every colour here is inline, like the signing page: the admin's light
 *    theme must not be able to repaint a page a sponsor reads.
 * 🔴 "Opened" is a POST made after the page has drawn, never the GET.
 * 🔴 Accepting is not the contract. It tells the club, who send the agreement.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { dollars, longDay, proposalBrand, proposalHeadline, type ProposalBrand, type PublicProposal } from "@shared/sponsor-proposals";

const EASE = "cubic-bezier(0.16,1,0.3,1)";

function visitorId(): string {
  try {
    const k = "usg_proposal_visitor";
    let v = window.localStorage.getItem(k);
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); window.localStorage.setItem(k, v); }
    return v;
  } catch { return ""; }
}

function useBrandFonts(B: ProposalBrand | null) {
  useEffect(() => {
    if (!B) return;
    const added: HTMLElement[] = [];
    if (B.fontFaces.length) {
      const style = document.createElement("style");
      style.textContent = B.fontFaces.map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;font-display:swap;src:url('${f.url}') format('woff2');}`).join("");
      document.head.appendChild(style); added.push(style);
    }
    if (B.fontCss) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = B.fontCss;
      document.head.appendChild(link); added.push(link);
    }
    return () => { for (const el of added) el.remove(); };
  }, [B]);
}

function Shell({ B, children }: { B: ProposalBrand; children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", background: B.bg, color: B.ink, fontFamily: B.body, WebkitFontSmoothing: "antialiased", overflowX: "hidden" }} data-testid="proposal-page">
      {children}
    </main>
  );
}

function Message({ B, title, sub }: { B: ProposalBrand; title: string; sub: string }) {
  return (
    <Shell B={B}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "120px 24px", textAlign: "center" }}>
        <img src={B.crest} alt={B.name} style={{ width: 72, height: 72, objectFit: "contain", margin: "0 auto 28px" }} />
        <h1 style={{ fontFamily: B.display, fontSize: 30, lineHeight: 1.1, textTransform: B.upper ? "uppercase" : "none", letterSpacing: "0.02em", margin: 0 }}>{title}</h1>
        <p style={{ marginTop: 14, color: B.muted, fontSize: 16, lineHeight: 1.6 }}>{sub}</p>
      </div>
    </Shell>
  );
}

function Eyebrow({ B, children }: { B: ProposalBrand; children: React.ReactNode }) {
  return <div style={{ fontFamily: B.display, color: B.accent, fontSize: 13, letterSpacing: "0.22em", textTransform: "uppercase" }}>{children}</div>;
}

function Heading({ B, children }: { B: ProposalBrand; children: React.ReactNode }) {
  return <h2 style={{ fontFamily: B.display, fontSize: "clamp(28px, 4.4vw, 44px)", lineHeight: 1.05, margin: "12px 0 0", textTransform: B.upper ? "uppercase" : "none", letterSpacing: "0.015em", fontWeight: B.key === "cufc" ? 600 : 400 }}>{children}</h2>;
}

function Block({ B, id, tone, children }: { B: ProposalBrand; id?: string; tone?: "panel"; children: React.ReactNode }) {
  return (
    <section id={id} style={{ background: tone === "panel" ? B.panel : "transparent", borderTop: `1px solid ${B.line}` }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "clamp(56px, 8vw, 96px) clamp(20px, 4vw, 32px)" }}>{children}</div>
    </section>
  );
}

export default function SponsorProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const preview = useMemo(() => new URLSearchParams(window.location.search).has("preview"), []);
  const [state, setState] = useState<{ status: "loading" | "missing" | "ready"; proposal: PublicProposal | null; draft: boolean }>({ status: "loading", proposal: null, draft: false });
  const [form, setForm] = useState({ name: "", role: "", email: "", website: "", agree: false });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    fetch(`/api/public/sponsor-proposal/${encodeURIComponent(token)}`, { credentials: "include" })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) return setState({ status: "missing", proposal: null, draft: false });
        const j = await r.json();
        setState({ status: "ready", proposal: j.proposal, draft: Boolean(j.preview) });
        document.title = `${j.proposal.sponsorCompany} — ${proposalBrand(j.proposal.brand).name}`;
        // Counted only once the page has really drawn in a browser, and never for a staff preview.
        if (!preview && !j.preview) {
          fetch(`/api/public/sponsor-proposal/${encodeURIComponent(token)}/open`, {
            method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitorId() }),
          }).catch(() => undefined);
        }
      })
      .catch(() => alive && setState({ status: "missing", proposal: null, draft: false }));
    return () => { alive = false; meta.remove(); };
  }, [token, preview]);

  const p = state.proposal;
  const B = p ? proposalBrand(p.brand) : null;
  useBrandFonts(B);

  if (state.status === "loading") return <main style={{ minHeight: "100vh", background: "#050505" }} />;
  if (state.status === "missing" || !p || !B) {
    return <Message B={proposalBrand("siu")} title="This proposal is not available" sub="The link may have been switched off. Please ask the person who sent it to you for a new one." />;
  }

  const head = proposalHeadline(p);
  const accepted = p.accepted || done;
  const hasTerms = Boolean(p.termStart || p.termEnd || p.feeCents != null || p.paymentTerms || p.contra || p.specialConditions);
  const source = p.audience[0]?.source;
  const upper = B.upper ? ("uppercase" as const) : ("none" as const);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (form.name.trim().length < 2) return setErr("Please enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return setErr("Please enter a valid email address.");
    if (!form.agree) return setErr("Please tick the box to confirm.");
    setSending(true);
    try {
      const r = await fetch(`/api/public/sponsor-proposal/${encodeURIComponent(token)}/accept`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, role: form.role, email: form.email, website: form.website, agree: true, formToken: p.formToken }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message || "Something went wrong. Please try again.");
      setDone(true);
    } catch (e: any) { setErr(e.message); } finally { setSending(false); }
  };

  const input: React.CSSProperties = {
    width: "100%", height: 52, borderRadius: 12, border: `1px solid ${B.line}`, background: "rgba(255,255,255,0.04)", color: B.ink,
    padding: "0 16px", fontSize: 16, fontFamily: B.body, outline: "none", boxSizing: "border-box",
  };
  const cta: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 52, padding: "0 28px", borderRadius: 999, border: "none",
    background: B.accent, color: "#0b0b0a", fontFamily: B.display, fontSize: 15, letterSpacing: "0.12em", textTransform: "uppercase",
    cursor: "pointer", textDecoration: "none", transition: `transform 0.4s ${EASE}`, fontWeight: B.key === "cufc" ? 600 : 400,
  };

  return (
    <Shell B={B}>
      <style>{`
        .sp-two { display: grid; gap: 16px; grid-template-columns: 1fr; }
        .sp-stats { display: grid; gap: 1px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .sp-hero { min-height: 78svh; }
        @media (min-width: 760px) { .sp-two { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sp-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (min-height: 0px) and (max-height: 820px) and (min-width: 760px) { .sp-hero { min-height: 0; } }
        .sp-input::placeholder { color: ${B.muted}; }
        .sp-input:focus { border-color: ${B.accent}; }
        @media (prefers-reduced-motion: no-preference) { .sp-rise { animation: sp-rise 0.9s ${EASE} both; } }
        @keyframes sp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
      `}</style>

      {state.draft && (
        <div style={{ background: B.accent, color: "#0b0b0a", textAlign: "center", padding: "10px 16px", fontSize: 14, fontWeight: 600 }} data-testid="proposal-draft-banner">
          Preview. Only club staff can see this until the link is made live.
        </div>
      )}

      {/* Top bar: the club, and who this is for. */}
      <header style={{ borderBottom: `1px solid ${B.line}` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "16px clamp(20px, 4vw, 32px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <img src={B.crest} alt={B.name} style={{ width: 48, height: 48, objectFit: "contain", flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: B.display, fontSize: 16, lineHeight: 1.1, textTransform: upper, letterSpacing: "0.03em" }}>{B.name}</div>
              <div style={{ color: B.muted, fontSize: 12, marginTop: 3 }}>Partnership proposal</div>
            </div>
          </div>
          {p.logoUrl && (
            <img src={p.logoUrl} alt={p.sponsorCompany} data-testid="proposal-sponsor-logo"
              style={{ height: 48, maxWidth: 150, objectFit: "contain", flexShrink: 0, ...(p.logoGround === "dark" ? {} : { background: "#ffffff", borderRadius: 10, padding: "6px 10px", boxSizing: "border-box" }) }} />
          )}
        </div>
      </header>

      {/* Hero: the offer, written to them. */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${B.hero})`, backgroundSize: "cover", backgroundPosition: "center" }} aria-hidden="true" />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, ${B.bg} 0%, ${B.bg}E6 38%, ${B.bg}8C 100%)` }} aria-hidden="true" />
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, ${B.bg}99 0%, ${B.bg}66 40%, ${B.bg} 100%)` }} aria-hidden="true" />
        <div className="sp-hero" style={{ position: "relative", maxWidth: 1080, margin: "0 auto", padding: "clamp(56px, 9vw, 110px) clamp(20px, 4vw, 32px)", display: "flex", flexDirection: "column", justifyContent: "center", boxSizing: "border-box" }}>
          <div className="sp-rise">
            <Eyebrow B={B}>{p.seasonLabel || `Prepared for ${p.sponsorCompany}`}</Eyebrow>
            <h1 data-testid="proposal-h1" style={{ fontFamily: B.display, fontSize: "clamp(38px, 7vw, 84px)", lineHeight: 0.98, margin: "20px 0 0", maxWidth: 900, textTransform: upper, letterSpacing: "0.01em", fontWeight: B.key === "cufc" ? 600 : 400, textWrap: "balance" as any }}>
              {head.before} <span style={{ color: B.accent }}>{head.key}</span> {head.after}
            </h1>
            <p style={{ marginTop: 24, maxWidth: 640, fontSize: "clamp(16px, 1.6vw, 19px)", lineHeight: 1.65, color: B.muted, fontWeight: 300 }} data-testid="proposal-intro-text">
              {p.intro || `A proposal from ${B.name} for ${p.sponsorCompany}. What is included, who sees it, and the proposed terms are set out below.`}
            </p>
            <div style={{ marginTop: 32, display: "flex", flexWrap: "wrap", gap: 12 }}>
              <a href="#accept" style={cta}>{accepted ? "Accepted" : "Accept this proposal"}</a>
              <a href="#proposal" style={{ ...cta, background: "transparent", color: B.ink, border: `1px solid ${B.line}` }}>See the proposal</a>
            </div>
          </div>
        </div>
      </section>

      {/* 1. The proposal */}
      <Block B={B} id="proposal">
        <Eyebrow B={B}>The proposal</Eyebrow>
        <Heading B={B}>What {p.sponsorCompany} would hold</Heading>
        <div className="sp-two" style={{ marginTop: 36 }}>
          {p.assets.map((a, i) => (
            <div key={i} data-testid="proposal-asset-card" style={{ border: `1px solid ${B.line}`, borderRadius: 18, padding: "24px 24px 26px", background: "rgba(255,255,255,0.025)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
                <h3 style={{ fontFamily: B.display, fontSize: 22, lineHeight: 1.15, margin: 0, textTransform: upper, letterSpacing: "0.02em", fontWeight: B.key === "cufc" ? 600 : 400 }}>{a.name}</h3>
                {a.priceCents != null && <div style={{ fontFamily: B.display, color: B.accent, fontSize: 20, whiteSpace: "nowrap" }}>{dollars(a.priceCents)} <span style={{ fontSize: 12, color: B.muted, fontFamily: B.body }}>plus GST</span></div>}
              </div>
              {a.detail && <p style={{ margin: "12px 0 0", color: B.muted, fontSize: 15.5, lineHeight: 1.65, fontWeight: 300, whiteSpace: "pre-line" }}>{a.detail}</p>}
            </div>
          ))}
        </div>
      </Block>

      {/* 2. What is included */}
      {p.benefits.length > 0 && (
        <Block B={B} tone="panel">
          <Eyebrow B={B}>What is included</Eyebrow>
          <Heading B={B}>Alongside the placement</Heading>
          <ul className="sp-two" style={{ listStyle: "none", padding: 0, margin: "32px 0 0" }}>
            {p.benefits.map((b, i) => (
              <li key={i} data-testid="proposal-benefit" style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 0", borderBottom: `1px solid ${B.line}`, fontSize: 16, lineHeight: 1.55 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: B.accent, marginTop: 9, flexShrink: 0 }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {/* 3. Audience */}
      {p.audience.length > 0 && (
        <Block B={B}>
          <Eyebrow B={B}>Audience</Eyebrow>
          <Heading B={B}>Who sees it</Heading>
          <div className="sp-stats" style={{ marginTop: 36, border: `1px solid ${B.line}`, borderRadius: 18, overflow: "hidden", background: B.bg }}>
            {p.audience.map((s) => (
              <div key={s.key} data-testid="proposal-stat" style={{ background: B.bg, padding: "26px 22px", boxShadow: `0 0 0 1px ${B.line}` }}>
                <div style={{ fontFamily: B.display, color: B.accent, fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1 }}>{s.value}</div>
                <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.45 }}>{s.label}</div>
                {s.detail && <div style={{ marginTop: 6, fontSize: 12.5, color: B.muted, lineHeight: 1.45 }}>{s.detail}</div>}
              </div>
            ))}
          </div>
          {source && <p style={{ marginTop: 16, fontSize: 12.5, color: B.muted }} data-testid="proposal-source">Source: {source}.</p>}
        </Block>
      )}

      {/* 4. Proposed terms */}
      {hasTerms && (
        <Block B={B} tone="panel">
          <Eyebrow B={B}>Proposed terms</Eyebrow>
          <Heading B={B}>Term and fee</Heading>
          <dl style={{ margin: "32px 0 0", border: `1px solid ${B.line}`, borderRadius: 18, overflow: "hidden" }} data-testid="proposal-terms">
            {([
              ["Term", p.termStart && p.termEnd ? `${longDay(p.termStart)} to ${longDay(p.termEnd)}` : p.termStart ? `From ${longDay(p.termStart)}` : ""],
              ["Fee", p.feeCents != null ? `${dollars(p.feeCents)} plus GST` : ""],
              ["Payment", p.paymentTerms ?? ""],
              ["Contra", p.contra ?? ""],
              ["Conditions", p.specialConditions ?? ""],
            ] as const).filter(([, v]) => v).map(([k, v], i) => (
              <div key={k} style={{ display: "flex", flexWrap: "wrap", gap: "6px 24px", padding: "18px 22px", borderTop: i ? `1px solid ${B.line}` : "none" }}>
                <dt style={{ width: 130, flexShrink: 0, color: B.muted, fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", paddingTop: 3 }}>{k}</dt>
                <dd style={{ margin: 0, flex: "1 1 260px", minWidth: 0, fontSize: 17, lineHeight: 1.55, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p style={{ marginTop: 16, fontSize: 13.5, color: B.muted, lineHeight: 1.6 }}>These terms are a proposal. They become binding only when both parties sign the sponsorship agreement.</p>
        </Block>
      )}

      {/* 5. Accept */}
      <Block B={B} id="accept">
        <div style={{ maxWidth: 640 }}>
          <Eyebrow B={B}>Next step</Eyebrow>
          {accepted ? (
            <div data-testid="proposal-accepted-state">
              <Heading B={B}>Thank you</Heading>
              <p style={{ marginTop: 18, fontSize: 17, lineHeight: 1.65, color: B.muted }}>
                {B.name} has been told you accept. The sponsorship agreement will be sent to you for signature.
              </p>
            </div>
          ) : (
            <>
              <Heading B={B}>Accept this proposal</Heading>
              <p style={{ marginTop: 18, fontSize: 16.5, lineHeight: 1.65, color: B.muted }}>
                Accepting tells {B.name} you would like to go ahead. It is not the contract: we then send the sponsorship agreement for both parties to sign.
              </p>
              <form onSubmit={submit} noValidate style={{ marginTop: 28, display: "grid", gap: 14 }} data-testid="proposal-accept-form">
                <input className="sp-input" style={input} placeholder="Your full name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="proposal-accept-name" />
                <input className="sp-input" style={input} placeholder="Your position (optional)" autoComplete="organization-title" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="proposal-accept-role" />
                <input className="sp-input" style={input} placeholder="Email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="proposal-accept-email" />
                {/* A field a person can neither see nor tab to. */}
                <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} name="website" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
                <label style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 15, lineHeight: 1.55, cursor: "pointer", minHeight: 44 }}>
                  <input type="checkbox" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} style={{ width: 22, height: 22, marginTop: 1, accentColor: B.accent, flexShrink: 0 }} data-testid="proposal-accept-agree" />
                  <span>I accept this proposal on behalf of {p.sponsorCompany}, subject to the sponsorship agreement.</span>
                </label>
                {err && <p role="alert" style={{ margin: 0, color: "#F0A07A", fontSize: 15 }} data-testid="proposal-accept-error">{err}</p>}
                <div><button type="submit" disabled={sending} style={{ ...cta, opacity: sending ? 0.6 : 1, width: "100%", maxWidth: 320 }} data-testid="proposal-accept-submit">{sending ? "Sending…" : "Accept this proposal"}</button></div>
              </form>
            </>
          )}
          {p.preparedBy && (
            <p style={{ marginTop: 32, fontSize: 15, lineHeight: 1.6, color: B.muted }} data-testid="proposal-prepared-by">
              Questions: {p.preparedBy.name}, <a href={`mailto:${p.preparedBy.email}`} style={{ color: B.accent, display: "inline-flex", alignItems: "center", minHeight: 44, overflowWrap: "anywhere" }}>{p.preparedBy.email}</a>
            </p>
          )}
        </div>
      </Block>

      <footer style={{ borderTop: `1px solid ${B.line}` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px clamp(20px, 4vw, 32px) 40px", display: "flex", alignItems: "center", gap: 12, color: B.muted, fontSize: 12.5 }}>
          <img src={B.crest} alt="" style={{ width: 28, height: 28, objectFit: "contain" }} />
          <span>Prepared by {B.name} for {p.sponsorCompany}. This page is private to people with the link.</span>
        </div>
      </footer>
    </Shell>
  );
}
