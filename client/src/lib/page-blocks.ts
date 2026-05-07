// Custom block types for the landing-page builder. Append-only sections
// rendered between the FAQ and the footer on the public page. Each block
// has a stable id (so React keys are stable across edits) and a type-specific
// props bag.
//
// To add a new block type:
//   1. Add it to BlockType union
//   2. Add a Props interface
//   3. Add a default in createDefaultBlock()
//   4. Render it in PublicBlock + EditableBlock components
//   5. Add an entry to BLOCK_PALETTE for the 'Add block' menu

export type BlockType = "stats" | "features" | "cta" | "image_text" | "video" | "testimonials" | "logos" | "coaches" | "map" | "custom_html" | "gallery" | "pricing" | "newsletter";

// Optional per-block style overrides. `auto` (or omitted) means the block
// uses its built-in defaults — we only apply overrides when the admin sets
// them. Padding maps to vertical padding only; the heaviest is for headline
// sections, the lightest is for tight stacks.
export type BlockPadding = "compact" | "normal" | "spacious";

export interface StatsBlockProps {
  eyebrow?: string;             // small uppercase line above the stats
  title?: string;               // optional heading
  items: { value: string; label: string }[];  // 4 items recommended
}

export interface FeaturesBlockProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  items: { title: string; body: string }[];   // 3-4 items recommended
}

export interface CtaBlockProps {
  headline: string;
  subheadline?: string;
  buttonText?: string;
  buttonHref?: string;
}

export interface ImageTextBlockProps {
  imageUrl?: string;
  imagePosition?: "left" | "right";
  eyebrow?: string;
  title?: string;
  body?: string;
  buttonText?: string;
  buttonHref?: string;
}

export interface VideoBlockProps {
  wistiaId?: string;        // primary path (matches existing hero pattern)
  youtubeUrl?: string;      // optional
  caption?: string;
}

export interface TestimonialsBlockProps {
  eyebrow?: string;
  title?: string;
  items: { quote: string; name: string; role?: string; avatarUrl?: string }[];
}

export interface LogosBlockProps {
  eyebrow?: string;
  items: { src: string; alt?: string; href?: string }[];
}

export interface CoachesBlockProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  items: { name: string; role?: string; bio?: string; photoUrl?: string }[];
}

export interface MapBlockProps {
  title?: string;
  address?: string;
  // Either an embed src (Google Maps share → embed iframe URL) OR raw lat/lng;
  // we keep it as a single string so the editor stays simple.
  embedUrl?: string;
  height?: number;
}

export interface CustomHtmlBlockProps {
  html: string;
  // Stored on the block itself — not edited per-instance unless the user
  // overrides. Allows the admin to constrain a custom block to a max width
  // (e.g. for embeds).
  maxWidth?: "narrow" | "wide" | "full";
}

export interface GalleryBlockProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  layout?: "grid" | "masonry";
  items: { url: string; caption?: string; alt?: string }[];
}

export interface PricingTierBlockProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  items: {
    name: string;
    price: string;            // free-form so admins can write "$295" or "From $50/wk"
    period?: string;          // e.g. "per term"
    features: string[];       // bullet list
    buttonText?: string;
    buttonHref?: string;
    highlighted?: boolean;    // bumps tier into the brand-blue spotlight card
    badge?: string;           // optional ribbon copy ("Most popular")
  }[];
}

export interface NewsletterBlockProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  buttonText?: string;
  successMessage?: string;
  // Optional list/audience identifier. Forwarded to the server endpoint so
  // we can route to a Mailchimp/Beehiiv list later. For v1 we just store
  // captures in the registrations log.
  listId?: string;
}

export interface PageBlock<T = any> {
  id: string;
  type: BlockType;
  props: T;
  padding?: BlockPadding;
}

export const BLOCK_PALETTE: Array<{ type: BlockType; label: string; description: string; icon: string }> = [
  { type: "stats",        label: "Stats Strip",     description: "4 numbers + labels — credibility / by-the-numbers", icon: "📊" },
  { type: "features",     label: "Feature Grid",    description: "3-4 cards with title + description — differentiators", icon: "🎯" },
  { type: "cta",          label: "CTA Strip",       description: "Big call-to-action band — headline + button",         icon: "👉" },
  { type: "image_text",   label: "Image + Text",    description: "Image on one side, copy + button on the other — story / about / coach intro",         icon: "🖼️" },
  { type: "video",        label: "Video",           description: "Embed a Wistia video with optional caption",          icon: "🎬" },
  { type: "testimonials", label: "Testimonials",    description: "3-card grid of parent / customer quotes",             icon: "💬" },
  { type: "logos",        label: "Logo Strip",      description: "Sponsor / partner / press logos in a horizontal strip", icon: "🏷️" },
  { type: "coaches",      label: "Coach Cards",     description: "Photo + name + role + bio grid — meet-the-team",       icon: "👋" },
  { type: "gallery",      label: "Photo Gallery",   description: "Image grid — venue, sessions, kids in action",         icon: "🖼️" },
  { type: "pricing",      label: "Pricing Tiers",   description: "Side-by-side pricing cards — packages or membership",  icon: "💰" },
  { type: "newsletter",   label: "Newsletter Signup", description: "Email capture form — wait list, drops, updates",     icon: "✉️" },
  { type: "map",          label: "Map / Location",  description: "Embedded map for the venue — Google Maps share URL",   icon: "📍" },
  { type: "custom_html",  label: "Custom HTML",     description: "Paste raw HTML — embeds, scripts, anything custom",    icon: "🧩" },
];

// Map block padding values to actual Tailwind classes. Used by every
// renderer so a single source of truth controls vertical rhythm.
export const PADDING_CLASS: Record<BlockPadding, string> = {
  compact: "py-8 sm:py-12",
  normal: "py-12 sm:py-20",
  spacious: "py-20 sm:py-28",
};

export function paddingClass(p?: BlockPadding, fallback: BlockPadding = "normal"): string {
  return PADDING_CLASS[p ?? fallback];
}

let _idCounter = Date.now();
export function newBlockId(): string {
  return `b_${(_idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultBlock(type: BlockType): PageBlock {
  switch (type) {
    case "stats":
      return {
        id: newBlockId(),
        type: "stats",
        props: {
          eyebrow: "BY THE NUMBERS",
          title: "",
          items: [
            { value: "50", label: "years of CUFC" },
            { value: "200+", label: "Hornby families" },
            { value: "5", label: "named coaches" },
            { value: "10", label: "sessions per term" },
          ],
        } as StatsBlockProps,
      };
    case "features":
      return {
        id: newBlockId(),
        type: "features",
        props: {
          eyebrow: "WHY US",
          title: "Built for the kid in front of us",
          subtitle: "Not the medal table. Not the Instagram reel. Your kid.",
          items: [
            { title: "A club, not an academy", body: "Every kid welcome. No tryouts, no elite hype, no pressure." },
            { title: "Coaches who know your kid's name", body: "Same NZ-qualified coach every week. No drop-in volunteers." },
            { title: "Prices on the page", body: "Term price up front. Sibling discount auto-applied. No surprises." },
            { title: "Hornby, sorted", body: "One venue, easy parking, sibling slots back-to-back." },
          ],
        } as FeaturesBlockProps,
      };
    case "cta":
      return {
        id: newBlockId(),
        type: "cta",
        props: {
          headline: "Ready to start?",
          subheadline: "Free first class. No uniform until you're sure.",
          buttonText: "Book a free trial",
          buttonHref: "",
        } as CtaBlockProps,
      };
    case "image_text":
      return {
        id: newBlockId(),
        type: "image_text",
        props: {
          imageUrl: "",
          imagePosition: "right",
          eyebrow: "OUR STORY",
          title: "Built by a 50-year-old club",
          body: "Christchurch United has run sport in this city since 1976. We brought that long-game thinking — real coaches, term-by-term, no surprises — to gymnastics in 2020. Same not-for-profit, same belief that a good club is the long game.",
          buttonText: "About the club",
          buttonHref: "",
        } as ImageTextBlockProps,
      };
    case "video":
      return {
        id: newBlockId(),
        type: "video",
        props: {
          wistiaId: "",
          caption: "",
        } as VideoBlockProps,
      };
    case "testimonials":
      return {
        id: newBlockId(),
        type: "testimonials",
        props: {
          eyebrow: "PARENTS SAY",
          title: "Real Hornby parents, real kids",
          items: [
            { quote: "She asks me every Saturday morning if it's gym day yet. That's the whole review.", name: "Kelly", role: "mum of Olivia, 5" },
            { quote: "I love that the prices are on the page. No back-and-forth, just book it.", name: "Brent", role: "dad of Cooper + Tilly" },
            { quote: "The coach knew her name on day one. That doesn't sound like much until your kid feels it.", name: "Priya", role: "mum of Aanya, 8" },
          ],
        } as TestimonialsBlockProps,
      };
    case "logos":
      return {
        id: newBlockId(),
        type: "logos",
        props: {
          eyebrow: "PART OF",
          items: [
            { src: "/logos/christchurch-united.png", alt: "Christchurch United FC" },
            { src: "/logos/united-sports-group.png", alt: "United Sports Group" },
            { src: "/logos/united-sports-centre.png", alt: "United Sports Centre" },
          ],
        } as LogosBlockProps,
      };
    case "coaches":
      return {
        id: newBlockId(),
        type: "coaches",
        props: {
          eyebrow: "MEET THE TEAM",
          title: "Coaches who know your kid's name",
          subtitle: "Same coach every week. NZ-qualified. Real teaching, not babysitting.",
          items: [
            { name: "Coach Name", role: "Head Coach — Recreational", bio: "10 years coaching, NZ Gymnastics Level 2.", photoUrl: "" },
            { name: "Coach Name", role: "Beginner Stream Lead",      bio: "Former competitive gymnast, loves the 5–7 age group.", photoUrl: "" },
            { name: "Coach Name", role: "Saturday Sessions",         bio: "Patient, calm, parent-favourite for first-timers.", photoUrl: "" },
          ],
        } as CoachesBlockProps,
      };
    case "map":
      return {
        id: newBlockId(),
        type: "map",
        props: {
          title: "Find us",
          address: "United Sports Centre, Hornby, Christchurch",
          embedUrl: "",
          height: 360,
        } as MapBlockProps,
      };
    case "custom_html":
      return {
        id: newBlockId(),
        type: "custom_html",
        props: {
          html: "<!-- Paste your embed or HTML here -->\n<div style=\"text-align:center; padding: 2rem; color: #888;\">Your custom HTML will render here.</div>",
          maxWidth: "wide",
        } as CustomHtmlBlockProps,
      };
    case "gallery":
      return {
        id: newBlockId(),
        type: "gallery",
        props: {
          eyebrow: "INSIDE THE GYM",
          title: "What sessions actually look like",
          subtitle: "",
          layout: "grid",
          items: [
            { url: "", caption: "" },
            { url: "", caption: "" },
            { url: "", caption: "" },
            { url: "", caption: "" },
            { url: "", caption: "" },
            { url: "", caption: "" },
          ],
        } as GalleryBlockProps,
      };
    case "pricing":
      return {
        id: newBlockId(),
        type: "pricing",
        props: {
          eyebrow: "PRICING",
          title: "Simple. Transparent. On the page.",
          subtitle: "Sibling discount applied automatically. No surprises at checkout.",
          items: [
            { name: "Saturday Class", price: "$350", period: "per term", features: ["10 sessions", "60 minutes", "All ages 4–6", "Saturday morning"], buttonText: "Book Saturday" },
            { name: "Combo (Both)",   price: "$565", period: "per term", features: ["20 sessions across the week", "75 mins per class", "Best value", "Sibling discount applies"], buttonText: "Book Combo", highlighted: true, badge: "Most popular" },
            { name: "Thursday Class", price: "$295", period: "per term", features: ["8 sessions", "60 minutes", "All ages 4–6", "Thursday afternoon"], buttonText: "Book Thursday" },
          ],
        } as PricingTierBlockProps,
      };
    case "newsletter":
      return {
        id: newBlockId(),
        type: "newsletter",
        props: {
          eyebrow: "GET ON THE LIST",
          title: "Term 3 enrolments open soon",
          subtitle: "Drop your email and we'll let you know the moment booking opens. No spam, no daily club updates — just enrolment news.",
          buttonText: "Notify me",
          successMessage: "You're on the list. We'll be in touch.",
          listId: "default",
        } as NewsletterBlockProps,
      };
  }
}
