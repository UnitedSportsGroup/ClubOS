// Public-facing renderer for custom page blocks. Used on the camp/program
// landing page (camp-page.tsx) to render whatever the admin has added in
// the editor between the FAQ and footer.

import type { PageBlock, StatsBlockProps, FeaturesBlockProps, CtaBlockProps } from "@/lib/page-blocks";

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
