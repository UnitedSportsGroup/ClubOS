/**
 * Per-club branding for the public holiday-camp flow (booking form, checkout,
 * success, feedback). The landing page carries the full brand identity in its
 * own component; these tokens keep the utility pages (light forms) on-brand
 * without forking them.
 *
 * The org slug comes from the camp's owning organisation — returned by
 * /api/public/camps/:slug (organization.slug) and /api/public/checkout/:id
 * (organizationSlug).
 */

export const SIU_ORG_SLUG = "south-island-united";

export interface CampBrand {
  /** Primary action colour (buttons, selected states, step markers). */
  primary: string;
  /** Dark heading / emphasis colour. */
  dark: string;
  /** Page background. */
  pageBg: string;
  /** Accent (highlights, selection summary). */
  gold: string;
  /** Short mark shown in the compact header chip. */
  monogram: string;
  /** Club display name for headers/footers. */
  clubName: string;
  /** Crest served from client/public. */
  logoUrl: string;
}

export const CUFC_BRAND: CampBrand = {
  primary: "#22399B",
  dark: "#221F7A",
  pageBg: "#FBFBFC",
  gold: "#D9B10F",
  monogram: "CU",
  clubName: "Christchurch United FC",
  logoUrl: "/logos/christchurch-united.png",
};

export const SIU_BRAND: CampBrand = {
  // Pupila identity — Unity Black, Leader Green, Ambition Gold.
  primary: "#1B3D24",
  dark: "#000000",
  pageBg: "#FBFBFC",
  gold: "#C59949",
  monogram: "SIU",
  clubName: "South Island United",
  logoUrl: "/logos/south-island-united.png",
};

export const CUGC_ORG_SLUG = "united-gymnastics";

export const CUGC_BRAND: CampBrand = {
  // cugc.co.nz palette (apps/cugc-website/tailwind.config.js): navy crest blue,
  // warm cream page, crest-ring gold.
  primary: "#013590",
  dark: "#01296e",
  pageBg: "#fff8f0",
  gold: "#d9b10f",
  monogram: "UG",
  clubName: "United Gymnastics",
  logoUrl: "/logos/united-gymnastics.png",
};

export function brandForOrg(orgSlug: string | null | undefined): CampBrand {
  if (orgSlug === SIU_ORG_SLUG) return SIU_BRAND;
  if (orgSlug === CUGC_ORG_SLUG) return CUGC_BRAND;
  return CUFC_BRAND;
}

/**
 * The camp's booking page, carrying the landing page's query string (utm_*,
 * fbclid, source) — the booking form reads attribution from ITS OWN URL, so a
 * bare `/slug/book` link turned every ad click into a "direct" booking.
 */
export function campBookHref(slug: string): string {
  const qs = typeof window !== "undefined" ? window.location.search : "";
  return `/${slug}/book${qs}`;
}
