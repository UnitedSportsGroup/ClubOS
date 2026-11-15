// The photos Rambo designs with — every one, by brand, with the caption that
// tells Rambo who is in it. Daniel, 2026-11-01: "show me where I can see them
// to see what they look like and which ones you've picked."

import { useState } from "react";
import { STUDIO_PHOTOS } from "@shared/studio-photos";
import { STUDIO_BRANDS } from "@shared/studio";

export function PhotoLibrary({ initialBrand }: { initialBrand?: string }) {
  const counts = new Map<string, number>();
  for (const p of STUDIO_PHOTOS) counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1);
  const [brand, setBrand] = useState<string>(initialBrand && counts.has(initialBrand) ? initialBrand : "all");
  const shown = STUDIO_PHOTOS.filter((p) => brand === "all" || p.brand === brand);
  return (
    <div className="space-y-3" data-testid="studio-photo-library">
      <p className="text-xs text-muted-foreground">These are the photos Rambo chooses from when it designs, {STUDIO_PHOTOS.length} in all. It picks by the caption, so the caption says who is in each one and what they are doing. A photo you upload to a piece is added for your workspace too.</p>
      <div className="flex flex-wrap gap-2">
        {[["all", `All (${STUDIO_PHOTOS.length})`] as const, ...STUDIO_BRANDS.map((b) => [b.key, `${b.name} (${counts.get(b.key) ?? 0})`] as const)].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setBrand(k)} className={`rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${brand === k ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`} data-testid={`studio-photos-${k}`}>{label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No photos for this brand yet. Upload some on any piece's Pictures tab.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => (
            <figure key={p.src} className="overflow-hidden rounded-xl border border-border bg-card" data-testid="studio-photo">
              <a href={p.src} target="_blank" rel="noreferrer"><img src={p.src} alt={p.caption} loading="lazy" className="aspect-[4/3] w-full object-cover" /></a>
              <figcaption className="space-y-1 p-2.5">
                <p className="text-[12px] leading-snug text-foreground">{p.caption}</p>
                <p className="text-[11px] text-muted-foreground">{STUDIO_BRANDS.find((b) => b.key === p.brand)?.name ?? p.brand} · {p.w}×{p.h}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
