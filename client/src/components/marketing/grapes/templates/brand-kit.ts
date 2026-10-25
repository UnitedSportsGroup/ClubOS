// ─────────────────────────────────────────────────────────────────────────────
// grapes/templates/brand-kit.ts — what a brand's NEWSLETTER needs beyond colours.
//
// Daniel, 2026-10-25: "rebuild this type of template for newsletters, and then
// have a version for SIU, CUFC, CUGC, Mini Football Leagues etc., with all the
// different brand identities." brand.ts knows each brand's colours and font;
// a newsletter also needs its crest, its photographs, where its socials live,
// what sits in its footer, and the words that make sense for THAT club (a
// gymnastics club has no "next home match"). That is this file.
//
// 🔴 Every image here is served by ClubOS itself from client/public/mailer/<brand>
// (resized to 1200×800 for a 600px column on a 2× screen) — never the Supabase
// bucket, whose egress quota has 402'd twice. Crests come from /logos.
// 🔴 Nothing is invented: a social that is not known is left out (no icon row
// for a brand with no accounts on file), an address we do not hold reads as the
// city only.
// ─────────────────────────────────────────────────────────────────────────────

export type SocialKey = "instagram" | "facebook" | "tiktok" | "x" | "youtube" | "linkedin";

export interface BrandKit {
  key: string;
  /** Crest on the header (full-colour artwork that reads on white). */
  crest: string;
  /** Pixel width of the crest in the header. Wordmarks are wider than badges. */
  crestWidth: number;
  /** The brand's website, shop and the place people register / buy tickets. */
  site: string;
  shop?: string;
  action?: { label: string; href: string };
  /** Header nav — three short links at most. */
  nav: { label: string; href: string }[];
  /** Full-width photographs, 3:2, in the order the template uses them. */
  photos: { src: string; alt: string }[];
  /** Product shots on white (the club shop's own), for the shop template. */
  products?: { src: string; alt: string }[];
  socials: Partial<Record<SocialKey, string>>;
  /** One line under the socials. */
  address: string;
  /** Footer ground + the ink on it. Dark brands use their own black/navy. */
  footerBg: string;
  footerText: string;
  footerAccent: string;
  /** Headline face for the hero line (email-safe stack); section labels and
   *  body use the brand's system stack. */
  headlineFont: string;
  /** The gold/blue that carries a headline word and a link on WHITE. For a gold
   *  brand this is darker than the button gold so small text still reads. */
  link: string;
  /** Button ground + label. */
  button: string;
  onButton: string;
}

const HOST = "https://app.usg.co.nz";
const ADDRESS_USC = "466 Yaldhurst Road, Christchurch 8042, New Zealand";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const BRAND_KITS: Record<string, BrandKit> = {
  siu: {
    key: "siu",
    crest: `${HOST}/logos/south-island-united.png`, crestWidth: 54,
    site: "https://www.southislandunited.com",
    shop: "https://shop.southislandunited.com",
    action: { label: "Get tickets", href: "https://www.southislandunited.com" },
    nav: [
      { label: "Fixtures", href: "https://www.southislandunited.com" },
      { label: "Shop", href: "https://shop.southislandunited.com" },
      { label: "Tickets", href: "https://www.southislandunited.com" },
    ],
    photos: [
      { src: `${HOST}/mailer/siu/hero.jpg`, alt: "South Island United in action" },
      { src: `${HOST}/mailer/siu/game.jpg`, alt: "Match day at the ground" },
      { src: `${HOST}/mailer/siu/match.jpg`, alt: "South Island United v Auckland FC" },
      { src: `${HOST}/mailer/siu/kit.jpg`, alt: "The home jersey" },
      { src: `${HOST}/mailer/siu/bfc.jpg`, alt: "Bula FC v South Island United" },
    ],
    products: [
      { src: `${HOST}/mailer/siu/shop-home-jersey.jpg`, alt: "2026 home jersey" },
      { src: `${HOST}/mailer/siu/shop-scarf.jpg`, alt: "Fan scarf" },
      { src: `${HOST}/mailer/siu/shop-hoodie.jpg`, alt: "Casual hoodie" },
    ],
    socials: {
      instagram: "https://www.instagram.com/southislandunited/",
      facebook: "https://www.facebook.com/SouthIslandUnited",
      tiktok: "https://www.tiktok.com/@southislandunited",
      x: "https://x.com/SouthIslandUtd",
      youtube: "https://www.youtube.com/@SouthIslandUnited",
    },
    address: ADDRESS_USC,
    footerBg: "#0a0a09", footerText: "#9a9a9a", footerAccent: "#c59949",
    headlineFont: "Georgia, 'Times New Roman', serif",
    link: "#9a7430", button: "#111111", onButton: "#c59949",
  },
  cufc: {
    key: "cufc",
    crest: `${HOST}/logos/christchurch-united.png`, crestWidth: 56,
    site: "https://cufc.co.nz",
    shop: "https://shop.cufc.co.nz",
    action: { label: "Register now", href: "https://cufc.co.nz/register" },
    nav: [
      { label: "Programmes", href: "https://cufc.co.nz/register" },
      { label: "Shop", href: "https://shop.cufc.co.nz" },
      { label: "News", href: "https://cufc.co.nz/news" },
    ],
    photos: [
      { src: `${HOST}/mailer/cufc/hero.jpg`, alt: "Christchurch United players" },
      { src: `${HOST}/mailer/cufc/academy.jpg`, alt: "Academy training" },
      { src: `${HOST}/mailer/cufc/funino.jpg`, alt: "FUNiño U4–U8" },
      { src: `${HOST}/mailer/cufc/technification.jpg`, alt: "Technification" },
      { src: `${HOST}/mailer/cufc/photo-14.jpg`, alt: "Match day" },
    ],
    products: [
      { src: `${HOST}/mailer/cufc/shop-set-adults.jpg`, alt: "Short-sleeve football set, adults" },
      { src: `${HOST}/mailer/cufc/shop-set-kids.jpg`, alt: "Short-sleeve football set, kids" },
      { src: `${HOST}/mailer/cufc/shop-jacket.jpg`, alt: "Full-zip training jacket" },
    ],
    socials: {
      instagram: "https://www.instagram.com/christchurchunitedfc",
      facebook: "https://www.facebook.com/christchurchunitedfc",
    },
    address: ADDRESS_USC,
    footerBg: "#0c1226", footerText: "#aab3cf", footerAccent: "#ffffff",
    headlineFont: SANS,
    link: "#1d3fae", button: "#1d3fae", onButton: "#ffffff",
  },
  cugc: {
    key: "cugc",
    crest: `${HOST}/logos/united-gymnastics.png`, crestWidth: 56,
    site: "https://cugc.co.nz",
    action: { label: "Book a free session", href: "https://cugc.co.nz/free-session" },
    nav: [
      { label: "Classes", href: "https://cugc.co.nz/programs" },
      { label: "Free session", href: "https://cugc.co.nz/free-session" },
      { label: "Enrol", href: "https://cugc.co.nz/enrol" },
    ],
    photos: [
      { src: `${HOST}/mailer/cugc/hero.jpg`, alt: "United Gymnastics class" },
      { src: `${HOST}/mailer/cugc/program-2.jpg`, alt: "Gymnasts training" },
      { src: `${HOST}/mailer/cugc/club.jpg`, alt: "The gym" },
      { src: `${HOST}/mailer/cugc/program-3.jpg`, alt: "Holiday programme" },
    ],
    socials: {
      instagram: "https://www.instagram.com/unitedgymnasticsnz/",
      facebook: "https://www.facebook.com/chchunitedRG/",
    },
    address: "Christchurch, New Zealand",
    footerBg: "#013590", footerText: "#c9d4f0", footerAccent: "#ffffff",
    headlineFont: SANS,
    link: "#013590", button: "#013590", onButton: "#ffffff",
  },
  mfl: {
    key: "mfl",
    crest: `${HOST}/logos/mini-football-leagues-crest.png`, crestWidth: 54,
    site: "https://minifootball.co.nz",
    shop: "https://shop.minifootball.co.nz",
    action: { label: "Enter a team", href: "https://join.minifootball.co.nz" },
    nav: [
      { label: "Leagues", href: "https://minifootball.co.nz" },
      { label: "Shop", href: "https://shop.minifootball.co.nz" },
      { label: "Enter a team", href: "https://join.minifootball.co.nz" },
    ],
    photos: [
      { src: `${HOST}/mailer/mfl/hero.jpg`, alt: "5-a-side under lights" },
      { src: `${HOST}/mailer/mfl/7aside.jpg`, alt: "7-a-side league" },
      { src: `${HOST}/mailer/mfl/field.jpg`, alt: "The pitches at United Sports Centre" },
    ],
    socials: {
      instagram: "https://www.instagram.com/minifootballnz/",
      facebook: "https://www.facebook.com/minifootballleaguesnz/",
    },
    address: ADDRESS_USC,
    footerBg: "#000000", footerText: "#9a9a9a", footerAccent: "#d1b96e",
    headlineFont: "Impact, 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
    link: "#7a6a2c", button: "#111111", onButton: "#d1b96e",
  },
  cic: {
    key: "cic",
    crest: `${HOST}/logos/christchurch-international-cup.png`, crestWidth: 56,
    site: "https://cicyouth.com",
    action: { label: "Register your interest", href: "https://cicyouth.com" },
    nav: [
      { label: "Tournament", href: "https://cicyouth.com" },
      { label: "Register", href: "https://join.cicyouth.com" },
    ],
    photos: [
      { src: `${HOST}/mailer/cic/hero.jpg`, alt: "Christchurch International Cup" },
      { src: `${HOST}/mailer/cic/celebrate.jpg`, alt: "Celebrations" },
      { src: `${HOST}/mailer/cic/tournaments.jpg`, alt: "Tournament football" },
    ],
    products: [
      { src: `${HOST}/mailer/cic/shop-hoodie.jpg`, alt: "Tournament hoodie" },
      { src: `${HOST}/mailer/cic/shop-cap.jpg`, alt: "Tournament cap" },
      { src: `${HOST}/mailer/cic/shop-pin.jpg`, alt: "Pin badge" },
    ],
    socials: {},
    address: ADDRESS_USC,
    footerBg: "#0b0b08", footerText: "#9a9a8a", footerAccent: "#c9a43e",
    headlineFont: SANS,
    link: "#8a6f1f", button: "#111111", onButton: "#c9a43e",
  },
  usc: {
    key: "usc",
    crest: `${HOST}/logos/united-sports-group-royal.png`, crestWidth: 56,
    site: "https://book.unitedsportscentre.com",
    action: { label: "Book a pitch", href: "https://book.unitedsportscentre.com" },
    nav: [{ label: "Book a pitch", href: "https://book.unitedsportscentre.com" }],
    photos: [],
    socials: {},
    address: ADDRESS_USC,
    footerBg: "#0d1222", footerText: "#aab3cf", footerAccent: "#ffffff",
    headlineFont: SANS,
    link: "#4f46e5", button: "#4f46e5", onButton: "#ffffff",
  },
  usg: {
    key: "usg",
    crest: `${HOST}/logos/united-sports-group-royal.png`, crestWidth: 56,
    site: "https://app.usg.co.nz",
    nav: [],
    photos: [],
    socials: {},
    address: ADDRESS_USC,
    footerBg: "#0d1120", footerText: "#aab3cf", footerAccent: "#ffffff",
    headlineFont: SANS,
    link: "#1d3fae", button: "#1d3fae", onButton: "#ffffff",
  },
  prints: {
    key: "prints",
    crest: `${HOST}/logos/united-prints-wordmark.png`, crestWidth: 150,
    site: "https://unitedprints.co.nz",
    shop: "https://shop.unitedprints.co.nz",
    action: { label: "Get an instant quote", href: "https://unitedprints.co.nz/instant-quote" },
    nav: [
      { label: "Instant quote", href: "https://unitedprints.co.nz/instant-quote" },
      { label: "Shop", href: "https://shop.unitedprints.co.nz" },
    ],
    photos: [],
    socials: {},
    address: ADDRESS_USC,
    footerBg: "#161311", footerText: "#b9b0a8", footerAccent: "#ff7a45",
    headlineFont: SANS,
    link: "#d4541f", button: "#d4541f", onButton: "#ffffff",
  },
};

const NEUTRAL: BrandKit = {
  key: "neutral",
  crest: `${HOST}/logos/united-sports-group-royal.png`, crestWidth: 56,
  site: "https://app.usg.co.nz",
  nav: [],
  photos: [],
  socials: {},
  address: "Christchurch, New Zealand",
  footerBg: "#14171f", footerText: "#aab3cf", footerAccent: "#ffffff",
  headlineFont: SANS,
  link: "#1d3fae", button: "#1d3fae", onButton: "#ffffff",
};

export function brandKit(brandKey: string | null | undefined): BrandKit {
  const k = (brandKey || "").toLowerCase();
  return BRAND_KITS[k] ?? NEUTRAL;
}

/** The white glyphs the dark footer uses, served by ClubOS. */
export const SOCIAL_ICON: Record<SocialKey, { src: string; label: string }> = {
  instagram: { src: `${HOST}/mailer/icons/instagram.png`, label: "Instagram" },
  facebook: { src: `${HOST}/mailer/icons/facebook.png`, label: "Facebook" },
  tiktok: { src: `${HOST}/mailer/icons/tiktok.png`, label: "TikTok" },
  x: { src: `${HOST}/mailer/icons/x.png`, label: "X" },
  youtube: { src: `${HOST}/mailer/icons/youtube.png`, label: "YouTube" },
  linkedin: { src: `${HOST}/mailer/icons/linkedin.png`, label: "LinkedIn" },
};
export const SOCIAL_ORDER: SocialKey[] = ["facebook", "instagram", "tiktok", "x", "youtube", "linkedin"];
