// Public-facing renderer for custom page blocks. Used on the camp/program
// landing page (camp-page.tsx) to render whatever the admin has added in
// the editor between the FAQ and footer.

import type {
  PageBlock, BlockPadding,
  StatsBlockProps, FeaturesBlockProps, CtaBlockProps,
  ImageTextBlockProps, VideoBlockProps, TestimonialsBlockProps, LogosBlockProps,
  CoachesBlockProps, MapBlockProps, CustomHtmlBlockProps,
  GalleryBlockProps, PricingTierBlockProps, NewsletterBlockProps,
} from "@/lib/page-blocks";
import { paddingClass } from "@/lib/page-blocks";
import { useEffect, useState } from "react";

const BRAND = {
  blue: "#22399B",
  white: "#FBFBFC",
  gold: "#D9B10F",
  darkBlue: "#0F1841",
};

export function PublicBlock({ block, primaryButtonHref }: { block: PageBlock; primaryButtonHref?: string }) {
  const pad = block.padding;
  switch (block.type) {
    case "stats":
      return <StatsBlock props={block.props as StatsBlockProps} pad={pad} />;
    case "features":
      return <FeaturesBlock props={block.props as FeaturesBlockProps} pad={pad} />;
    case "cta":
      return <CtaBlock props={block.props as CtaBlockProps} pad={pad} fallbackHref={primaryButtonHref} />;
    case "image_text":
      return <ImageTextBlock props={block.props as ImageTextBlockProps} pad={pad} fallbackHref={primaryButtonHref} />;
    case "video":
      return <VideoBlock props={block.props as VideoBlockProps} pad={pad} />;
    case "testimonials":
      return <TestimonialsBlock props={block.props as TestimonialsBlockProps} pad={pad} />;
    case "logos":
      return <LogosBlock props={block.props as LogosBlockProps} pad={pad} />;
    case "coaches":
      return <CoachesBlock props={block.props as CoachesBlockProps} pad={pad} />;
    case "map":
      return <MapBlock props={block.props as MapBlockProps} pad={pad} />;
    case "custom_html":
      return <CustomHtmlBlock props={block.props as CustomHtmlBlockProps} pad={pad} />;
    case "gallery":
      return <GalleryBlock props={block.props as GalleryBlockProps} pad={pad} />;
    case "pricing":
      return <PricingBlock props={block.props as PricingTierBlockProps} pad={pad} fallbackHref={primaryButtonHref} />;
    case "newsletter":
      return <NewsletterBlock props={block.props as NewsletterBlockProps} pad={pad} />;
    default:
      return null;
  }
}

function StatsBlock({ props, pad }: { props: StatsBlockProps; pad?: BlockPadding }) {
  return (
    <section className={pad ? paddingClass(pad) : "py-12 sm:py-16"} style={{ background: BRAND.darkBlue }}>
      <div className="max-w-5xl mx-auto px-6">
        {props.eyebrow && (
          <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.25em] font-semibold text-center mb-2" style={{ color: BRAND.gold }}>
            {props.eyebrow}
          </div>
        )}
        {props.title && (
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-center mb-8" style={{ color: BRAND.white }}>
            {props.title}
          </h2>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
          {props.items?.map((item, i) => (
            <div key={i} className="text-center">
              <div className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight mb-1" style={{ color: BRAND.white }}>
                {item.value}
              </div>
              <div className="text-[11px] sm:text-[12px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(251,251,252,0.5)' }}>
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesBlock({ props, pad }: { props: FeaturesBlockProps; pad?: BlockPadding }) {
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-20"} bg-white`}>
      <div className="max-w-5xl mx-auto px-6">
        {(props.eyebrow || props.title || props.subtitle) && (
          <div className="text-center mb-10">
            {props.eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.blue }}>
                {props.eyebrow}
              </div>
            )}
            {props.title && (
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
            {props.subtitle && (
              <p className="text-[14px] sm:text-[16px] mt-3 max-w-2xl mx-auto text-slate-500">
                {props.subtitle}
              </p>
            )}
          </div>
        )}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${props.items?.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-4`}>
          {props.items?.map((item, i) => (
            <div key={i} className="rounded-2xl p-5 bg-slate-50 border border-slate-100">
              <div className="text-[15px] font-bold mb-1.5" style={{ color: BRAND.darkBlue }}>
                {item.title}
              </div>
              <div className="text-[13px] sm:text-[14px] leading-relaxed text-slate-600">
                {item.body}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaBlock({ props, fallbackHref, pad }: { props: CtaBlockProps; fallbackHref?: string; pad?: BlockPadding }) {
  const href = props.buttonHref || fallbackHref || "#";
  return (
    <section className={pad ? paddingClass(pad) : "py-12 sm:py-16"} style={{ background: BRAND.blue }}>
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3" style={{ color: BRAND.white }}>
          {props.headline}
        </h2>
        {props.subheadline && (
          <p className="text-[14px] sm:text-[16px] mb-6 max-w-xl mx-auto" style={{ color: 'rgba(251,251,252,0.75)' }}>
            {props.subheadline}
          </p>
        )}
        {props.buttonText && (
          <a
            href={href}
            className="inline-flex items-center gap-2 px-10 py-3.5 text-[15px] font-bold rounded-full hover:scale-[1.02] transition"
            style={{ background: BRAND.white, color: BRAND.blue, boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}
          >
            {props.buttonText} →
          </a>
        )}
      </div>
    </section>
  );
}

// ── Image + Text ───────────────────────────────────────────────────────
function ImageTextBlock({ props, fallbackHref, pad }: { props: ImageTextBlockProps; fallbackHref?: string; pad?: BlockPadding }) {
  const isLeft = props.imagePosition === "left";
  const href = props.buttonHref || fallbackHref || "";
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-20"} bg-white`}>
      <div className="max-w-5xl mx-auto px-6">
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center ${isLeft ? "" : "lg:[&>*:first-child]:order-2"}`}>
          {props.imageUrl ? (
            <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-lg">
              <img src={props.imageUrl} alt={props.title ?? ""} className="w-full h-auto object-cover" />
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-100 aspect-[4/3] flex items-center justify-center text-slate-300 text-sm">
              (No image set)
            </div>
          )}
          <div>
            {props.eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.blue }}>
                {props.eyebrow}
              </div>
            )}
            {props.title && (
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
            {props.body && (
              <p className="text-[14px] sm:text-[16px] leading-relaxed text-slate-600 mb-5 whitespace-pre-wrap">
                {props.body}
              </p>
            )}
            {props.buttonText && (
              <a
                href={href || "#"}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition"
              >
                {props.buttonText} →
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Video ──────────────────────────────────────────────────────────────
function VideoBlock({ props, pad }: { props: VideoBlockProps; pad?: BlockPadding }) {
  // Lazy-load Wistia jsonp once per video id (matches the hero video pattern).
  useEffect(() => {
    if (!props.wistiaId) return;
    const s = document.createElement("script");
    s.src = `https://fast.wistia.com/embed/medias/${props.wistiaId}.jsonp`;
    s.async = true;
    document.head.appendChild(s);
    return () => { try { document.head.removeChild(s); } catch {} };
  }, [props.wistiaId]);

  if (!props.wistiaId && !props.youtubeUrl) return null;

  return (
    <section className={pad ? paddingClass(pad) : "py-12 sm:py-16"} style={{ background: BRAND.darkBlue }}>
      <div className="max-w-3xl mx-auto px-6">
        <div className="rounded-2xl overflow-hidden shadow-2xl shadow-black/40 border border-white/10">
          {props.wistiaId ? (
            <div className="wistia_responsive_padding" style={{ padding: "56.25% 0 0 0", position: "relative" }}>
              <div className="wistia_responsive_wrapper" style={{ height: "100%", left: 0, position: "absolute", top: 0, width: "100%" }}>
                <div className={`wistia_embed wistia_async_${props.wistiaId} seo=true videoFoam=true`} style={{ height: "100%", position: "relative", width: "100%" }}>
                  <div className="wistia_swatch" style={{ height: "100%", left: 0, opacity: 0, overflow: "hidden", position: "absolute", top: 0, transition: "opacity 200ms", width: "100%" }}>
                    <img src={`https://fast.wistia.com/embed/medias/${props.wistiaId}/swatch`} style={{ filter: "blur(5px)", height: "100%", objectFit: "contain", width: "100%" }} alt="" />
                  </div>
                </div>
              </div>
            </div>
          ) : props.youtubeUrl ? (
            <div className="aspect-video">
              <iframe
                src={youtubeEmbed(props.youtubeUrl)}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : null}
        </div>
        {props.caption && (
          <p className="text-[13px] text-center mt-3" style={{ color: "rgba(251,251,252,0.55)" }}>
            {props.caption}
          </p>
        )}
      </div>
    </section>
  );
}

function youtubeEmbed(url: string): string {
  // Accepts youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID
  const m = url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
}

// ── Testimonials ───────────────────────────────────────────────────────
function TestimonialsBlock({ props, pad }: { props: TestimonialsBlockProps; pad?: BlockPadding }) {
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-20"} bg-slate-50`}>
      <div className="max-w-6xl mx-auto px-6">
        {(props.eyebrow || props.title) && (
          <div className="text-center mb-10">
            {props.eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.blue }}>
                {props.eyebrow}
              </div>
            )}
            {props.title && (
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {props.items?.map((t, i) => (
            <div key={i} className="rounded-2xl p-5 bg-white border border-slate-100 shadow-sm flex flex-col">
              <p className="text-[14px] sm:text-[15px] leading-relaxed text-slate-700 mb-4 flex-1">"{t.quote}"</p>
              <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
                {t.avatarUrl ? (
                  <img src={t.avatarUrl} alt={t.name} className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-xs font-semibold">
                    {t.name?.[0] ?? "?"}
                  </div>
                )}
                <div>
                  <div className="text-[13px] font-semibold text-slate-800">{t.name}</div>
                  {t.role && <div className="text-[11px] text-slate-400">{t.role}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Coaches Grid ───────────────────────────────────────────────────────
function CoachesBlock({ props, pad }: { props: CoachesBlockProps; pad?: BlockPadding }) {
  const cols = props.items?.length === 2 ? 'sm:grid-cols-2' : props.items?.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-20"} bg-white`}>
      <div className="max-w-6xl mx-auto px-6">
        {(props.eyebrow || props.title || props.subtitle) && (
          <div className="text-center mb-10">
            {props.eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.blue }}>
                {props.eyebrow}
              </div>
            )}
            {props.title && (
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
            {props.subtitle && (
              <p className="text-[14px] sm:text-[16px] mt-3 max-w-2xl mx-auto text-slate-500">
                {props.subtitle}
              </p>
            )}
          </div>
        )}
        <div className={`grid grid-cols-1 ${cols} gap-5`}>
          {props.items?.map((coach, i) => (
            <div key={i} className="rounded-2xl bg-slate-50 border border-slate-100 overflow-hidden">
              {coach.photoUrl ? (
                <img src={coach.photoUrl} alt={coach.name} className="w-full aspect-[4/5] object-cover" />
              ) : (
                <div className="w-full aspect-[4/5] bg-slate-200 flex items-center justify-center text-slate-400 text-3xl font-bold">
                  {coach.name?.[0] ?? "?"}
                </div>
              )}
              <div className="p-4 sm:p-5">
                <div className="text-[15px] sm:text-[16px] font-bold mb-0.5" style={{ color: BRAND.darkBlue }}>
                  {coach.name}
                </div>
                {coach.role && (
                  <div className="text-[12px] uppercase tracking-wider font-semibold mb-2" style={{ color: BRAND.blue }}>
                    {coach.role}
                  </div>
                )}
                {coach.bio && (
                  <p className="text-[13px] sm:text-[14px] leading-relaxed text-slate-600">
                    {coach.bio}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Map / Location ─────────────────────────────────────────────────────
function MapBlock({ props, pad }: { props: MapBlockProps; pad?: BlockPadding }) {
  // Accept any of: full <iframe ...> snippet, an embed URL, or a plain
  // address. Plain addresses fall back to a generic Google Maps embed.
  const src = (() => {
    if (!props.embedUrl && !props.address) return null;
    if (props.embedUrl) {
      const m = props.embedUrl.match(/src="([^"]+)"/);
      if (m) return m[1];
      return props.embedUrl;
    }
    return `https://www.google.com/maps?q=${encodeURIComponent(props.address!)}&output=embed`;
  })();
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-16"} bg-white`}>
      <div className="max-w-5xl mx-auto px-6">
        {(props.title || props.address) && (
          <div className="text-center mb-6">
            {props.title && (
              <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight mb-1" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
            {props.address && <p className="text-[13px] sm:text-[14px] text-slate-500">{props.address}</p>}
          </div>
        )}
        {src ? (
          <div className="rounded-2xl overflow-hidden border border-slate-100 shadow-sm">
            <iframe
              src={src}
              style={{ height: props.height ?? 360, width: "100%", border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-100 h-[280px] flex items-center justify-center text-slate-400 text-sm">
            (No address or map URL set)
          </div>
        )}
      </div>
    </section>
  );
}

// ── Custom HTML ────────────────────────────────────────────────────────
function CustomHtmlBlock({ props, pad }: { props: CustomHtmlBlockProps; pad?: BlockPadding }) {
  const max = props.maxWidth === "narrow" ? "max-w-2xl" : props.maxWidth === "full" ? "max-w-none" : "max-w-5xl";
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-16"} bg-white`}>
      <div className={`${max} mx-auto px-6`}>
        <div dangerouslySetInnerHTML={{ __html: props.html ?? "" }} />
      </div>
    </section>
  );
}

// ── Logo Strip ─────────────────────────────────────────────────────────
// ── Gallery ────────────────────────────────────────────────────────────
function GalleryBlock({ props, pad }: { props: GalleryBlockProps; pad?: BlockPadding }) {
  const items = (props.items ?? []).filter(i => i.url);
  if (items.length === 0) return null;
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-20"} bg-white`}>
      <div className="max-w-6xl mx-auto px-6">
        {(props.eyebrow || props.title || props.subtitle) && (
          <div className="text-center mb-8">
            {props.eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.blue }}>
                {props.eyebrow}
              </div>
            )}
            {props.title && (
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
            {props.subtitle && (
              <p className="text-[14px] sm:text-[16px] mt-3 max-w-2xl mx-auto text-slate-500">
                {props.subtitle}
              </p>
            )}
          </div>
        )}
        {props.layout === "masonry" ? (
          <div className="columns-2 sm:columns-3 gap-3">
            {items.map((item, i) => (
              <figure key={i} className="mb-3 break-inside-avoid">
                <img src={item.url} alt={item.alt ?? item.caption ?? ""} className="w-full rounded-xl" loading="lazy" />
                {item.caption && <figcaption className="text-[11px] mt-1.5 text-slate-400 italic">{item.caption}</figcaption>}
              </figure>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {items.map((item, i) => (
              <figure key={i}>
                <img src={item.url} alt={item.alt ?? item.caption ?? ""} className="w-full aspect-square object-cover rounded-xl" loading="lazy" />
                {item.caption && <figcaption className="text-[11px] mt-1.5 text-slate-400 italic">{item.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Pricing tiers ──────────────────────────────────────────────────────
function PricingBlock({ props, pad, fallbackHref }: { props: PricingTierBlockProps; pad?: BlockPadding; fallbackHref?: string }) {
  const items = props.items ?? [];
  const cols = items.length === 2 ? "sm:grid-cols-2" : items.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";
  return (
    <section className={`${pad ? paddingClass(pad) : "py-12 sm:py-20"} bg-slate-50`}>
      <div className="max-w-6xl mx-auto px-6">
        {(props.eyebrow || props.title || props.subtitle) && (
          <div className="text-center mb-10">
            {props.eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.blue }}>
                {props.eyebrow}
              </div>
            )}
            {props.title && (
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight" style={{ color: BRAND.darkBlue }}>
                {props.title}
              </h2>
            )}
            {props.subtitle && (
              <p className="text-[14px] sm:text-[16px] mt-3 max-w-2xl mx-auto text-slate-500">
                {props.subtitle}
              </p>
            )}
          </div>
        )}
        <div className={`grid grid-cols-1 ${cols} gap-4 sm:gap-5 items-stretch`}>
          {items.map((tier, i) => {
            const href = tier.buttonHref || fallbackHref || "#";
            const isHighlight = !!tier.highlighted;
            return (
              <div
                key={i}
                className={`relative rounded-2xl p-6 sm:p-7 flex flex-col ${isHighlight
                  ? "shadow-2xl border-2"
                  : "bg-white border border-slate-100 shadow-sm"}`}
                style={isHighlight ? { background: BRAND.darkBlue, borderColor: BRAND.gold, color: BRAND.white } : undefined}
              >
                {tier.badge && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.2em] font-bold px-3 py-1 rounded-full"
                    style={isHighlight ? { background: BRAND.gold, color: BRAND.darkBlue } : { background: BRAND.blue, color: BRAND.white }}
                  >
                    {tier.badge}
                  </div>
                )}
                <div className={`text-[14px] uppercase tracking-wider font-semibold mb-2 ${isHighlight ? "" : ""}`} style={{ color: isHighlight ? BRAND.gold : BRAND.blue }}>
                  {tier.name}
                </div>
                <div className="flex items-baseline gap-1.5 mb-4">
                  <span className="text-3xl sm:text-4xl font-black tracking-tight" style={{ color: isHighlight ? BRAND.white : BRAND.darkBlue }}>
                    {tier.price}
                  </span>
                  {tier.period && (
                    <span className={`text-[12px] sm:text-[13px] ${isHighlight ? "text-white/60" : "text-slate-400"}`}>
                      {tier.period}
                    </span>
                  )}
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {tier.features?.map((f, fi) => (
                    <li key={fi} className={`flex items-start gap-2 text-[13px] sm:text-[14px] ${isHighlight ? "text-white/85" : "text-slate-600"}`}>
                      <span className={`mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0`} style={{ background: isHighlight ? BRAND.gold : BRAND.blue }} />
                      {f}
                    </li>
                  ))}
                </ul>
                {tier.buttonText && (
                  <a
                    href={href}
                    className={`inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-full text-sm font-semibold transition ${isHighlight
                      ? "hover:scale-[1.02]"
                      : "bg-slate-900 hover:bg-slate-800 text-white"}`}
                    style={isHighlight ? { background: BRAND.gold, color: BRAND.darkBlue } : undefined}
                  >
                    {tier.buttonText} →
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Newsletter signup ──────────────────────────────────────────────────
function NewsletterBlock({ props, pad }: { props: NewsletterBlockProps; pad?: BlockPadding }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, listId: props.listId || "default" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Couldn't sign up — please try again.");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={pad ? paddingClass(pad) : "py-12 sm:py-20"} style={{ background: BRAND.darkBlue }}>
      <div className="max-w-2xl mx-auto px-6 text-center">
        {props.eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.25em] font-semibold mb-2" style={{ color: BRAND.gold }}>
            {props.eyebrow}
          </div>
        )}
        {props.title && (
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-3" style={{ color: BRAND.white }}>
            {props.title}
          </h2>
        )}
        {props.subtitle && (
          <p className="text-[14px] sm:text-[16px] mb-6 max-w-xl mx-auto" style={{ color: 'rgba(251,251,252,0.7)' }}>
            {props.subtitle}
          </p>
        )}
        {submitted ? (
          <div className="rounded-xl bg-white/10 border border-white/20 px-6 py-5 text-[14px]" style={{ color: BRAND.white }}>
            ✓ {props.successMessage || "You're on the list. We'll be in touch."}
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First name (optional)"
              className="flex-1 px-4 py-2.5 rounded-full bg-white/[0.08] border border-white/15 text-white placeholder:text-white/40 text-sm focus:outline-none focus:border-white/40"
              autoComplete="given-name"
            />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="flex-1 px-4 py-2.5 rounded-full bg-white/[0.08] border border-white/15 text-white placeholder:text-white/40 text-sm focus:outline-none focus:border-white/40"
              autoComplete="email"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-full font-bold text-sm transition hover:scale-[1.02] disabled:opacity-60"
              style={{ background: BRAND.gold, color: BRAND.darkBlue }}
            >
              {submitting ? "…" : (props.buttonText || "Subscribe")}
            </button>
          </form>
        )}
        {error && <div className="mt-3 text-[12px] text-red-300">{error}</div>}
      </div>
    </section>
  );
}

function LogosBlock({ props, pad }: { props: LogosBlockProps; pad?: BlockPadding }) {
  return (
    <section className={`${pad ? paddingClass(pad) : "py-10 sm:py-12"} bg-white border-y border-slate-100`}>
      <div className="max-w-5xl mx-auto px-6">
        {props.eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.25em] font-semibold text-center mb-6 text-slate-400">
            {props.eyebrow}
          </div>
        )}
        <div className="flex items-center justify-center gap-8 sm:gap-12 flex-wrap">
          {props.items?.map((logo, i) => {
            const img = (
              <img
                src={logo.src}
                alt={logo.alt ?? "Logo"}
                className="h-10 sm:h-12 max-w-[140px] object-contain opacity-70 hover:opacity-100 transition"
              />
            );
            return logo.href ? (
              <a key={i} href={logo.href} target="_blank" rel="noopener noreferrer">{img}</a>
            ) : (
              <div key={i}>{img}</div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
