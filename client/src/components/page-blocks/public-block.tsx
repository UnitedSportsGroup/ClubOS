// Public-facing renderer for custom page blocks. Used on the camp/program
// landing page (camp-page.tsx) to render whatever the admin has added in
// the editor between the FAQ and footer.

import type {
  PageBlock,
  StatsBlockProps, FeaturesBlockProps, CtaBlockProps,
  ImageTextBlockProps, VideoBlockProps, TestimonialsBlockProps, LogosBlockProps,
} from "@/lib/page-blocks";
import { useEffect } from "react";

const BRAND = {
  blue: "#22399B",
  white: "#FBFBFC",
  gold: "#D9B10F",
  darkBlue: "#0F1841",
};

export function PublicBlock({ block, primaryButtonHref }: { block: PageBlock; primaryButtonHref?: string }) {
  switch (block.type) {
    case "stats":
      return <StatsBlock props={block.props as StatsBlockProps} />;
    case "features":
      return <FeaturesBlock props={block.props as FeaturesBlockProps} />;
    case "cta":
      return <CtaBlock props={block.props as CtaBlockProps} fallbackHref={primaryButtonHref} />;
    case "image_text":
      return <ImageTextBlock props={block.props as ImageTextBlockProps} fallbackHref={primaryButtonHref} />;
    case "video":
      return <VideoBlock props={block.props as VideoBlockProps} />;
    case "testimonials":
      return <TestimonialsBlock props={block.props as TestimonialsBlockProps} />;
    case "logos":
      return <LogosBlock props={block.props as LogosBlockProps} />;
    default:
      return null;
  }
}

function StatsBlock({ props }: { props: StatsBlockProps }) {
  return (
    <section className="py-12 sm:py-16" style={{ background: BRAND.darkBlue }}>
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

function FeaturesBlock({ props }: { props: FeaturesBlockProps }) {
  return (
    <section className="py-12 sm:py-20 bg-white">
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

function CtaBlock({ props, fallbackHref }: { props: CtaBlockProps; fallbackHref?: string }) {
  const href = props.buttonHref || fallbackHref || "#";
  return (
    <section className="py-12 sm:py-16" style={{ background: BRAND.blue }}>
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
function ImageTextBlock({ props, fallbackHref }: { props: ImageTextBlockProps; fallbackHref?: string }) {
  const isLeft = props.imagePosition === "left";
  const href = props.buttonHref || fallbackHref || "";
  return (
    <section className="py-12 sm:py-20 bg-white">
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
function VideoBlock({ props }: { props: VideoBlockProps }) {
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
    <section className="py-12 sm:py-16" style={{ background: BRAND.darkBlue }}>
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
function TestimonialsBlock({ props }: { props: TestimonialsBlockProps }) {
  return (
    <section className="py-12 sm:py-20 bg-slate-50">
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

// ── Logo Strip ─────────────────────────────────────────────────────────
function LogosBlock({ props }: { props: LogosBlockProps }) {
  return (
    <section className="py-10 sm:py-12 bg-white border-y border-slate-100">
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
