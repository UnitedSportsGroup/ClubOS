/**
 * Sponsor proposals — United Sports Group → Sponsorship → Prospects →
 * Proposals & contracts.
 *
 * Ryan, 14 Nov 2026: "be good to get those contract and proposal templates in
 * club OS for easy builds and sends." Daniel: the same thing he builds by hand
 * in apps/partners, filled in from a form, on brand, with the contract behind it.
 *
 * One rule per question, read by the server, the builder and the public page:
 *   PROPOSAL_BRANDS        the two clubs a proposal can wear, and the host it is sent on
 *   AUDIENCE_STATS         the ONLY numbers a proposal may show, each with its source
 *   cleanProposal()        every save is rebuilt field by field from this shape
 *   publishProblems()      why a draft cannot go to a sponsor yet
 *   proposalStage()        where it is up to. DERIVED, never stored
 *   contractVariablesFor() what the Sponsorship Agreement is pre-filled with
 *
 * 🔴 A proposal never shows a number a person typed in as an "audience" figure.
 *    Staff tick figures from AUDIENCE_STATS; each carries where it came from and
 *    the day it was read. A new figure is a line here with its source.
 * 🔴 Money is cents here and dollars on screen. A fee of NULL is "not priced
 *    yet", never $0, and a contract cannot be made from it.
 */

export const SPONSOR_PROPOSALS_WORKSPACE = "united-sports-group";
export const SPONSOR_PROPOSALS_TAB = "sponsorship";

// ── Brands ──────────────────────────────────────────────────────────────────

export type ProposalBrandKey = "siu" | "cufc";

export type ProposalBrand = {
  key: ProposalBrandKey;
  name: string;
  /** The party named in the agreement, as the club's own contracts name it. */
  short: string;
  /** Host the public page is sent on. The page also opens on app.usg.co.nz. */
  publicBase: string;
  crest: string;
  hero: string;
  bg: string;
  panel: string;
  line: string;
  accent: string;
  ink: string;
  muted: string;
  display: string;
  body: string;
  /** Uppercase headlines (Rough Cut has one weight and is set in capitals). */
  upper: boolean;
  /** Fonts to load: our own hosted files, or a Google Fonts stylesheet. */
  fontFaces: { family: string; weight: number; url: string }[];
  fontCss: string | null;
  /** e-Sign template slug for this club's Sponsorship Agreement. */
  templateSlug: string;
};

export const PROPOSAL_BRANDS: Record<ProposalBrandKey, ProposalBrand> = {
  siu: {
    key: "siu",
    name: "South Island United",
    short: "SIU",
    publicBase: "https://join.southislandunited.com",
    crest: "/logos/south-island-united.png",
    hero: "/mailer/siu/hero.jpg",
    bg: "#050505",
    panel: "#101010",
    line: "rgba(197,153,73,0.22)",
    accent: "#C59949",
    ink: "#F4F1EA",
    muted: "rgba(244,241,234,0.62)",
    display: "'Rough Cut', 'Arial Narrow', Impact, sans-serif",
    body: "Arpona, 'Helvetica Neue', Arial, sans-serif",
    upper: true,
    fontFaces: [
      { family: "Rough Cut", weight: 400, url: "/studio-fonts/siu/RoughCut.woff2" },
      { family: "Arpona", weight: 300, url: "/studio-fonts/siu/Arpona-Light.woff2" },
      { family: "Arpona", weight: 400, url: "/studio-fonts/siu/Arpona-Regular.woff2" },
      { family: "Arpona", weight: 600, url: "/studio-fonts/siu/Arpona-SemiBold.woff2" },
    ],
    fontCss: null,
    templateSlug: "sponsorship-agreement-siu",
  },
  cufc: {
    key: "cufc",
    name: "Christchurch United",
    short: "CUFC",
    publicBase: "https://join.cufc.co.nz",
    crest: "/logos/christchurch-united.png",
    hero: "/mailer/cufc/hero.jpg",
    bg: "#0C1640",
    panel: "#13182F",
    line: "rgba(212,175,55,0.24)",
    accent: "#D4AF37",
    ink: "#FFFFFF",
    muted: "rgba(255,255,255,0.66)",
    display: "Oswald, 'Arial Narrow', Impact, sans-serif",
    body: "Inter, 'Helvetica Neue', Arial, sans-serif",
    upper: true,
    fontFaces: [],
    fontCss: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&family=Oswald:wght@500;600&display=swap",
    templateSlug: "sponsorship-agreement-cufc",
  },
};

export const isProposalBrand = (v: unknown): v is ProposalBrandKey => v === "siu" || v === "cufc";
export const proposalBrand = (key: string | null | undefined): ProposalBrand => PROPOSAL_BRANDS[isProposalBrand(key) ? key : "siu"];

export const PROPOSAL_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;

/** Where a sponsor opens it. */
export function proposalUrl(brand: string, token: string): string {
  return `${proposalBrand(brand).publicBase}/proposal/${token}`;
}

// ── Audience figures (the only numbers a proposal may show) ─────────────────

export type AudienceStat = {
  key: string;
  brand: ProposalBrandKey;
  value: string;
  label: string;
  /** A second line, when the source gives one. */
  detail?: string;
  source: string;
};

const OFC = "OFC Pro League 2026 Season Data Report";
const CUFC_PULL = "Club figures read 20 October 2026 from Facebook, Instagram, Google Analytics and ClubOS";

export const AUDIENCE_STATS: readonly AudienceStat[] = [
  // South Island United: the league's own season report (copy in
  // outputs/sponsorship/2026-10-07-siu-kit-partnerships/source/), as published
  // on partner.southislandunited.com/kit.
  { key: "siu_fifa_streams", brand: "siu", value: "4.5M", label: "streams on FIFA+, 2026 season", detail: "315,800 unique viewers", source: OFC },
  { key: "siu_fb_views", brand: "siu", value: "103.2M", label: "league Facebook post views, 2026", detail: "5.1M video views", source: OFC },
  { key: "siu_ig_views", brand: "siu", value: "23.8M", label: "league Instagram views, 2026", detail: "1.7M accounts reached", source: OFC },
  { key: "siu_tiktok_views", brand: "siu", value: "6.5M", label: "league TikTok post views, 2026", source: OFC },
  { key: "siu_youtube_views", brand: "siu", value: "1.4M", label: "league YouTube views, 2026", detail: "36,200 hours watched", source: OFC },
  { key: "siu_match_crowds", brand: "siu", value: "19,596", label: "fans at South Island United's 18 matches in 2026", source: OFC },
  { key: "siu_biggest_crowd", brand: "siu", value: "5,910", label: "the club's biggest crowd, v Auckland FC at Eden Park", source: OFC },
  { key: "siu_circuit_crowds", brand: "siu", value: "80K+", label: "fans across the league's Circuit Series, 2026", source: OFC },
  { key: "siu_png_tv", brand: "siu", value: "525,000", label: "average television viewers a match on NBC, Papua New Guinea", source: OFC },
  // Christchurch United: the 20 Oct 2026 pulls behind the Fusion5 exposure
  // report (outputs/sponsorship/2026-10-20-fusion5-exposure-report/).
  { key: "cufc_social_followers", brand: "cufc", value: "15,744", label: "followers on Facebook and Instagram", detail: "Facebook 8,854 · Instagram 6,890", source: CUFC_PULL },
  { key: "cufc_fb_views_90d", brand: "cufc", value: "1.15M", label: "Facebook content views in 90 days", detail: "paid and organic", source: CUFC_PULL },
  { key: "cufc_ig_views_90d", brand: "cufc", value: "979,376", label: "Instagram views in 90 days", source: CUFC_PULL },
  { key: "cufc_web_users_2026", brand: "cufc", value: "37,949", label: "people on cufc.co.nz in 2026, to 19 October", source: CUFC_PULL },
  { key: "cufc_ad_reach_12m", brand: "cufc", value: "216,539", label: "people reached by the club's ads in 12 months", source: CUFC_PULL },
  { key: "cufc_cic_2026", brand: "cufc", value: "132", label: "teams at the Christchurch International Cup, July 2026", detail: "1,661 players · 56 clubs", source: CUFC_PULL },
  { key: "cufc_mfl_t4_2026", brand: "cufc", value: "93", label: "teams in Mini Football Leagues, Term 4 2026", source: CUFC_PULL },
];

export function audienceFor(brand: string): AudienceStat[] {
  return AUDIENCE_STATS.filter((s) => s.brand === brand);
}
export function pickAudience(brand: string, keys: string[]): AudienceStat[] {
  const allowed = audienceFor(brand);
  return keys.map((k) => allowed.find((s) => s.key === k)).filter((s): s is AudienceStat => Boolean(s));
}

/**
 * Benefits every partner gets in the club's own agreement (Schedule A,
 * "Additionally"). Offered as ticks in the builder so nobody retypes them.
 */
export const STANDARD_BENEFITS: readonly string[] = [
  "Access to the partner network and match-day hospitality",
  "A launch post across the club's social platforms",
  "Invitations to the quarterly Business Hub networking sessions",
  "A feature in the club newsletter introducing the partnership",
  "Logo and link on the club website",
  "A one-page report at the end of the year",
];

// ── The proposal ────────────────────────────────────────────────────────────

export type ProposalAsset = { name: string; detail: string; priceCents: number | null };

export type ProposalInput = {
  brand: ProposalBrandKey;
  sponsorCompany: string;
  sponsorLegalName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
  /** The ground the logo was drawn for: "dark" = light artwork, shown as it is. */
  logoGround: "light" | "dark" | null;
  partnershipTitle: string;
  seasonLabel: string | null;
  intro: string | null;
  assets: ProposalAsset[];
  benefits: string[];
  audienceKeys: string[];
  termStart: string | null;
  termEnd: string | null;
  feeCents: number | null;
  paymentTerms: string | null;
  contra: string | null;
  specialConditions: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const line = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const para = (v: unknown, max: number): string => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const centsOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 100_000_000_00 ? n : null;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A logo may only be a picture ClubOS hosts itself (the Mailer's image store). */
export function isHostedLogo(url: string | null | undefined): boolean {
  return typeof url === "string" && /^(https:\/\/app\.usg\.co\.nz)?\/mailer\/img\/[a-f0-9]{16,64}\.(png|jpg|gif)$/.test(url);
}
/** The path form, so the page loads it from whichever host it is opened on. */
export function logoPath(url: string | null | undefined): string | null {
  if (!isHostedLogo(url)) return null;
  return (url as string).replace(/^https:\/\/app\.usg\.co\.nz/, "");
}

/** Rebuild a proposal from untrusted input. Nothing outside this shape is kept. */
export function cleanProposal(raw: any): ProposalInput {
  const r = raw ?? {};
  const brand: ProposalBrandKey = isProposalBrand(r.brand) ? r.brand : "siu";
  const assets: ProposalAsset[] = [];
  for (const a of Array.isArray(r.assets) ? r.assets.slice(0, 12) : []) {
    const name = line(a?.name, 120);
    if (!name) continue;
    assets.push({ name, detail: para(a?.detail, 400), priceCents: centsOrNull(a?.priceCents) });
  }
  const benefits = (Array.isArray(r.benefits) ? r.benefits : []).map((b: unknown) => line(b, 220)).filter(Boolean).slice(0, 20);
  const allowed = new Set(audienceFor(brand).map((s) => s.key));
  const audienceKeys = Array.from(new Set<string>((Array.isArray(r.audienceKeys) ? r.audienceKeys : []).filter((k: unknown): k is string => typeof k === "string" && allowed.has(k)))).slice(0, 9);
  const email = line(r.contactEmail, 200).toLowerCase();
  const termStart = isDay(r.termStart) ? r.termStart : null;
  const termEnd = isDay(r.termEnd) ? r.termEnd : null;
  return {
    brand,
    sponsorCompany: line(r.sponsorCompany, 160),
    sponsorLegalName: line(r.sponsorLegalName, 200) || null,
    contactName: line(r.contactName, 120) || null,
    contactEmail: EMAIL.test(email) ? email : null,
    contactPhone: line(r.contactPhone, 40) || null,
    logoUrl: isHostedLogo(r.logoUrl) ? logoPath(r.logoUrl) : null,
    logoGround: r.logoGround === "light" || r.logoGround === "dark" ? r.logoGround : null,
    partnershipTitle: line(r.partnershipTitle, 80),
    seasonLabel: line(r.seasonLabel, 60) || null,
    intro: para(r.intro, 600) || null,
    assets,
    benefits,
    audienceKeys,
    termStart,
    termEnd,
    feeCents: centsOrNull(r.feeCents),
    paymentTerms: para(r.paymentTerms, 400) || null,
    contra: para(r.contra, 400) || null,
    specialConditions: para(r.specialConditions, 600) || null,
  };
}

/** Why a draft cannot be sent to a sponsor yet. Empty = ready. */
export function publishProblems(p: ProposalInput): string[] {
  const out: string[] = [];
  if (!p.sponsorCompany) out.push("Add the sponsor's name.");
  if (!p.partnershipTitle) out.push("Add the partnership title, e.g. Official Shorts Partner.");
  if (!p.assets.length) out.push("Add at least one thing they are being offered.");
  if (p.termStart && p.termEnd && p.termEnd < p.termStart) out.push("The term cannot end before it starts.");
  return out;
}

/** Why a contract cannot be made from it yet. Empty = ready. */
export function contractProblems(p: ProposalInput): string[] {
  const out = publishProblems(p);
  if (p.feeCents == null) out.push("Set the fee. A contract needs an amount.");
  if (!p.termStart || !p.termEnd) out.push("Set the first and last day of the term.");
  if (!p.contactEmail) out.push("Add the email of the person who will sign for the sponsor.");
  if (!p.paymentTerms) out.push("Say when the fee is paid, e.g. one payment on 20 January 2027.");
  return out;
}

// ── Where a proposal is up to (derived) ─────────────────────────────────────

export type ProposalStage = "draft" | "sent" | "opened" | "accepted" | "contract_out" | "signed" | "withdrawn" | "archived";

export const STAGE_LABEL: Record<ProposalStage, string> = {
  draft: "Draft",
  sent: "Ready to send",
  opened: "Opened",
  accepted: "Accepted",
  contract_out: "Contract out",
  signed: "Signed",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

export type StageFacts = {
  archivedAt: string | null;
  withdrawnAt: string | null;
  publishedAt: string | null;
  acceptedAt: string | null;
  /** Opens by people who are not staff. */
  opens: number;
  /** The linked e-Sign document's own status, or null when there is none. */
  esignStatus: string | null;
};

/**
 * Read from the facts every time. A voided or declined contract drops the
 * proposal back to where it was (accepted, or opened), so a second one can go.
 */
export function proposalStage(f: StageFacts): ProposalStage {
  if (f.archivedAt) return "archived";
  if (f.esignStatus === "completed") return "signed";
  if (f.withdrawnAt) return "withdrawn";
  if (f.esignStatus === "sent" || f.esignStatus === "viewed" || f.esignStatus === "draft") return "contract_out";
  if (f.acceptedAt) return "accepted";
  if (!f.publishedAt) return "draft";
  return f.opens > 0 ? "opened" : "sent";
}

/** A contract that was voided or declined no longer blocks a new one. */
export const esignIsLive = (status: string | null | undefined): boolean => status === "draft" || status === "sent" || status === "viewed" || status === "completed";

// ── Words for the page and the contract ─────────────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "20 January 2027" from an ISO day, read by its parts (never through a local Date). */
export function longDay(iso: string | null | undefined): string {
  if (!isDay(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "$15,000" or "$15,000.50". */
export function dollars(cents: number | null | undefined): string {
  if (cents == null) return "";
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The hero headline: the offer, written to the prospect. */
export function proposalHeadline(p: Pick<ProposalInput, "partnershipTitle" | "brand">): { before: string; key: string; after: string } {
  return { before: "Become the", key: p.partnershipTitle || "Official Partner", after: `of ${proposalBrand(p.brand).name}` };
}

export const AGREEMENT_VARIABLE_CAP = 1500;

/**
 * What the Sponsorship Agreement is pre-filled with. Keys match the template's
 * sender-set variables (script/seed-sponsorship-agreement-templates.ts).
 * An optional part with nothing in it reads "None", never a blank line.
 */
export function contractVariablesFor(p: ProposalInput): Record<string, string> {
  const rights = p.assets.map((a) => (a.detail ? `${a.name}: ${a.detail}` : a.name)).join("; ");
  return {
    sponsor_name: (p.sponsorLegalName || p.sponsorCompany).slice(0, 200),
    sponsorship_rights: `${p.partnershipTitle}. ${rights}`.slice(0, AGREEMENT_VARIABLE_CAP),
    additional_benefits: (p.benefits.length ? p.benefits.join("; ") : "None").slice(0, AGREEMENT_VARIABLE_CAP),
    commencement_date: p.termStart ?? "",
    expiry_date: p.termEnd ?? "",
    sponsorship_fee: p.feeCents == null ? "" : `${dollars(p.feeCents)} plus GST`,
    payment_schedule: (p.paymentTerms ?? "").slice(0, AGREEMENT_VARIABLE_CAP),
    contra: (p.contra || "None").slice(0, AGREEMENT_VARIABLE_CAP),
    special_conditions: (p.specialConditions || "None").slice(0, AGREEMENT_VARIABLE_CAP),
  };
}

// ── What the API returns ────────────────────────────────────────────────────

export type ProposalRow = ProposalInput & {
  id: number;
  token: string;
  url: string;
  stage: ProposalStage;
  publishedAt: string | null;
  withdrawnAt: string | null;
  archivedAt: string | null;
  acceptedAt: string | null;
  acceptedName: string | null;
  acceptedEmail: string | null;
  acceptedRole: string | null;
  /** The acceptance tripped the spam checks: kept, flagged, staff were not emailed. */
  acceptedHeld: boolean;
  opens: number;
  visitors: number;
  lastOpenedAt: string | null;
  esignDocumentId: number | null;
  esignStatus: string | null;
  partnerId: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  publishProblems: string[];
  contractProblems: string[];
};

/** What a sponsor's browser is given. No contact details, no internal ids. */
export type PublicProposal = {
  brand: ProposalBrandKey;
  sponsorCompany: string;
  logoUrl: string | null;
  logoGround: "light" | "dark" | null;
  partnershipTitle: string;
  seasonLabel: string | null;
  intro: string | null;
  assets: ProposalAsset[];
  benefits: string[];
  audience: AudienceStat[];
  termStart: string | null;
  termEnd: string | null;
  feeCents: number | null;
  paymentTerms: string | null;
  contra: string | null;
  specialConditions: string | null;
  accepted: boolean;
  preparedBy: { name: string; email: string } | null;
  formToken: string | null;
};
