import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function avifSiblingFor(webpUrl: string): string | null {
  return /\.webp(\?|$)/i.test(webpUrl) ? webpUrl.replace(/\.webp(\?|$)/i, ".avif$1") : null;
}

export function FacilityCarousel({
  images,
  alt,
  brand,
  size = "card",
  testIdPrefix,
  className = "",
}: {
  images: string[];
  alt: string;
  brand: string;
  size?: "card" | "hero";
  testIdPrefix: string;
  className?: string;
}) {
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  if (images.length === 0) return null;

  const clamped = Math.min(idx, images.length - 1);
  const go = (n: number) => setIdx(((n % images.length) + images.length) % images.length);
  const prev = (e?: React.MouseEvent | React.KeyboardEvent) => { e?.preventDefault?.(); e?.stopPropagation?.(); go(clamped - 1); };
  const next = (e?: React.MouseEvent | React.KeyboardEvent) => { e?.preventDefault?.(); e?.stopPropagation?.(); go(clamped + 1); };

  return (
    <div
      className={`relative overflow-hidden bg-white/[0.03] ${size === "hero" ? "aspect-video max-h-72" : "aspect-video"} ${className}`}
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStartX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        if (Math.abs(dx) > 30) (dx < 0 ? next() : prev());
        touchStartX.current = null;
      }}
      data-testid={`${testIdPrefix}-carousel`}
    >
      <picture className="block w-full h-full">
        {avifSiblingFor(images[clamped]) && (
          <source srcSet={avifSiblingFor(images[clamped])!} type="image/avif" />
        )}
        <img
          src={images[clamped]}
          alt={alt}
          className="w-full h-full object-cover transition-opacity"
          draggable={false}
          data-testid={`${testIdPrefix}-image-${clamped}`}
        />
      </picture>
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center backdrop-blur-sm transition"
            aria-label="Previous photo"
            data-testid={`${testIdPrefix}-prev`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={next}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center backdrop-blur-sm transition"
            aria-label="Next photo"
            data-testid={`${testIdPrefix}-next`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/45 backdrop-blur-sm px-2 py-1 rounded-full">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={e => { e.preventDefault(); e.stopPropagation(); go(i); }}
                aria-label={`Go to photo ${i + 1}`}
                className="w-1.5 h-1.5 rounded-full transition"
                style={{ background: i === clamped ? brand : "rgba(255,255,255,0.4)" }}
                data-testid={`${testIdPrefix}-dot-${i}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
