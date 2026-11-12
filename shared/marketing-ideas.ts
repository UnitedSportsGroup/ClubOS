// ─────────────────────────────────────────────────────────────────────────────
// Marketing → Ideas. United Sports Group.
//
// Daniel, 2026-11-12: "an ideas backlog … when anything pops up, I can just log
// it in there … a title, a little description, which section out of all those
// tabs down the side it belongs to … on each of those tabs there's an ideas tab,
// and the ones I add on the main marketing tab filter through to the
// appropriate one … two sections: the plan and an ideas backlog … optionally
// approximately how much it would cost and how much time it would take … we can
// promote an idea from the ideas backlog to the plan."
//
// ONE list (marketing_ideas). An idea names the Marketing section it belongs to;
// the main Ideas tab shows all of them, each section's own page shows its own.
// `stage` is "idea" (backlog) or "plan" (promoted).
//
// 🔴 A blank cost or time is NULL and drawn "—", never zero.
// 🔴 Removing an idea archives it.
// ─────────────────────────────────────────────────────────────────────────────

export const IDEAS_TAB = "marketing-ideas";
export const IDEAS_URL = "/admin/marketing-ideas";

export type IdeaStage = "idea" | "plan";

/** A Marketing section an idea can belong to. `key` is that section's tab slug. */
export type IdeaSection = { key: string; label: string; url: string };

export const IDEA_SECTIONS: IdeaSection[] = [
  { key: "marketing-hub", label: "General marketing", url: "/admin/marketing-hub" },
  { key: "campaign-planner", label: "Campaigns", url: "/admin/campaigns" },
  { key: "social-media", label: "Social Media", url: "/admin/social-media" },
  { key: "web-analytics", label: "Websites", url: "/admin/web-analytics" },
  { key: "paid-ads", label: "Paid Ads", url: "/admin/paid-ads" },
  { key: "email-stats", label: "Email", url: "/admin/email-stats" },
  { key: "sms-stats", label: "SMS", url: "/admin/sms-stats" },
  { key: "whatsapp-stats", label: "WhatsApp", url: "/admin/whatsapp-stats" },
  { key: "signage", label: "Signage", url: "/admin/signage" },
  { key: "billboards", label: "Billboards", url: "/admin/billboards" },
  { key: "traditional-media", label: "Traditional Media", url: "/admin/traditional-media" },
  { key: "flyers-print", label: "Flyers & Print", url: "/admin/flyers-print" },
  { key: "events-activations", label: "Events & Activations", url: "/admin/events-activations" },
  { key: "search-reviews", label: "Search & Reviews", url: "/admin/search-reviews" },
  { key: "listings", label: "Listings", url: "/admin/listings" },
  { key: "mobile-apps", label: "Mobile Apps", url: "/admin/mobile-apps" },
  { key: "partners-ambassadors", label: "Partners & Ambassadors", url: "/admin/partners-ambassadors" },
  { key: "word-of-mouth", label: "Word of Mouth", url: "/admin/word-of-mouth" },
  { key: "offers-codes", label: "Offers & Codes", url: "/admin/offers-codes" },
  { key: "product-quality", label: "Product Quality", url: "/admin/product-quality" },
];

export const ideaSection = (key: unknown): IdeaSection | null => IDEA_SECTIONS.find((s) => s.key === key) ?? null;

/** The section whose page this path is (a campaign's own page counts as Campaigns), or null. */
export function ideaSectionForPath(path: string): IdeaSection | null {
  return IDEA_SECTIONS.find((s) => path === s.url || path.startsWith(`${s.url}/`)) ?? null;
}

export type MarketingIdea = {
  id: number;
  title: string;
  description: string | null;
  section: string;
  stage: IdeaStage;
  /** Roughly what it would cost. Null = not estimated. */
  costCents: number | null;
  /** Roughly how long it would take, as typed ("2 weeks"). Null = not estimated. */
  timeEstimate: string | null;
  createdAt: string;
  createdByName: string | null;
  promotedAt: string | null;
  promotedByName: string | null;
  archived: boolean;
};

export type IdeasResponse = {
  ideas: MarketingIdea[];
  /** Section keys this person may log ideas against. */
  sections: string[];
};

export type IdeaInput = {
  title: string;
  description: string | null;
  section: string;
  costCents: number | null;
  timeEstimate: string | null;
};

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Checks what was typed. Runs in the form and again on the server. */
export function parseIdeaInput(body: any): { value: IdeaInput } | { error: string } {
  const title = text(body?.title, 160);
  if (!title) return { error: "Give the idea a title." };
  const section = ideaSection(body?.section);
  if (!section) return { error: "Choose which part of marketing it belongs to." };
  let costCents: number | null = null;
  if (body?.costCents != null && body.costCents !== "") {
    const n = Number(body.costCents);
    if (!Number.isInteger(n) || n < 0 || n > 2_000_000_000) return { error: "The cost needs to be a dollar amount." };
    costCents = n;
  }
  return { value: { title, description: text(body?.description, 4000), section: section.key, costCents, timeEstimate: text(body?.timeEstimate, 60) } };
}
