// A graphic, drawn live from its document and exported to a PNG in the
// browser. The artboard is laid out at its real size (1080px wide) and shown
// scaled to fit; html-to-image captures the unscaled node, so the PNG is the
// size the platform wants. Fonts come from Google Fonts, loaded once per
// brand so the capture embeds them.
import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { renderGraphic } from "@shared/studio-render";
import type { GraphicDoc } from "@shared/studio";

function ensureFonts(href: string) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[data-studio-fonts="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-studio-fonts", href);
  document.head.appendChild(link);
}

export function GraphicArtboard({ doc, sizeKey, brand, maxWidth = 560, onNode }: {
  doc: GraphicDoc;
  sizeKey: string;
  brand: string;
  maxWidth?: number;
  onNode?: (node: HTMLElement | null) => void;
}) {
  const rendered = useMemo(() => renderGraphic(doc, sizeKey, brand), [doc, sizeKey, brand]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => { ensureFonts(rendered.fontsHref); }, [rendered.fontsHref]);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth || maxWidth) / rendered.width));
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [rendered.width, maxWidth]);
  useEffect(() => {
    onNode?.(hostRef.current?.querySelector(".sgx") as HTMLElement | null);
  });
  return (
    <div ref={hostRef} className="w-full" style={{ maxWidth }} data-testid="studio-artboard">
      <style>{rendered.css}</style>
      <div style={{ width: rendered.width * scale, height: rendered.height * scale, position: "relative", overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.08)" }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: rendered.width, height: rendered.height }} dangerouslySetInnerHTML={{ __html: rendered.html }} />
      </div>
    </div>
  );
}

/** The PNG, at the artboard's real size. */
export async function exportArtboardPng(node: HTMLElement, width: number, height: number): Promise<Blob> {
  // Fonts load lazily; give the stylesheet a moment on the first export.
  if (typeof (document as any).fonts?.ready?.then === "function") await (document as any).fonts.ready;
  const dataUrl = await toPng(node, { width, height, pixelRatio: 1, cacheBust: true, backgroundColor: undefined });
  const res = await fetch(dataUrl);
  return res.blob();
}
