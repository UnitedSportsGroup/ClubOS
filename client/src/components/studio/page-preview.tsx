// A landing page's preview, the way a visitor sees it. Daniel, 2026-11-01:
// "the preview is so cut off … options to view it full screen … open in a new
// tab … the natural one should be more like a desktop aspect ratio."
//
// Laptop = the page drawn at a real 1440px laptop width and scaled down to
// fit, in a 16:10 frame, so the whole first screen shows (a 1300px-wide iframe
// in a short box showed a strip of the hero). Phone = 390 × 780, real size.
// Full screen fills the window; New tab opens this exact HTML (unsaved edits
// included) as a page of its own.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Maximize2, Monitor, Smartphone, X } from "lucide-react";

type Device = "phone" | "desktop";
const LAPTOP = { w: 1440, h: 900 };
const PHONE = { w: 390, h: 780 };

function ScaledFrame({ html, device, fill }: { html: string; device: Device; fill?: boolean }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const target = device === "phone" ? PHONE : LAPTOP;
  // Full screen: the frame IS the window (laptop at its real width, no scaling when it fits).
  if (fill) {
    const w = device === "phone" ? PHONE.w : Math.max(size.w, 320);
    return (
      <div ref={box} className="flex h-full w-full justify-center overflow-hidden">
        <iframe title="Page preview" srcDoc={html} sandbox="" className="h-full bg-white" style={{ width: w, maxWidth: "100%", border: 0 }} data-testid="studio-page-preview-full" />
      </div>
    );
  }
  // Fit the width, and never taller than the screen leaves room for.
  const room = typeof window !== "undefined" ? Math.max(360, window.innerHeight - 240) : target.h;
  const scale = size.w ? Math.min(1, size.w / target.w, room / target.h) : 1;
  return (
    <div ref={box} className="w-full" style={{ height: Math.round(target.h * scale) }}>
      <div className="mx-auto overflow-hidden rounded-xl border border-border bg-white" style={{ width: Math.round(target.w * scale), height: Math.round(target.h * scale) }}>
        <iframe title="Page preview" srcDoc={html} sandbox="" style={{ width: target.w, height: target.h, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0" }} data-testid="studio-page-preview" />
      </div>
    </div>
  );
}

export function PagePreview({ html, title }: { html: string; title: string }) {
  const [device, setDevice] = useState<Device>("desktop");
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [full]);
  const openTab = () => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 min-h-11 md:min-h-9 text-xs font-medium ${on ? "border-blue-500/50 bg-blue-500/15 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`;
  const deviceChips = (
    <>
      {([["phone", Smartphone, "Phone"], ["desktop", Monitor, "Laptop"]] as const).map(([k, Icon, label]) => (
        <button key={k} type="button" onClick={() => setDevice(k)} className={chip(device === k)} data-testid={`studio-device-${k}`}><Icon className="w-3.5 h-3.5" />{label}</button>
      ))}
    </>
  );
  const tabButton = <button type="button" onClick={openTab} className={chip(false)} data-testid="studio-preview-newtab"><ExternalLink className="w-3.5 h-3.5" />New tab</button>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-end gap-1" data-testid="studio-device">
        {deviceChips}
        <button type="button" onClick={() => setFull(true)} className={chip(false)} data-testid="studio-preview-full"><Maximize2 className="w-3.5 h-3.5" />Full screen</button>
        {tabButton}
      </div>
      <ScaledFrame html={html} device={device} />
      {full && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-background" role="dialog" aria-label={`${title} — full screen preview`} data-testid="studio-preview-overlay">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{title}</span>
            <div className="flex flex-wrap items-center gap-1">
              {deviceChips}
              {tabButton}
              <button type="button" onClick={() => setFull(false)} className={chip(false)} data-testid="studio-preview-close" aria-label="Close full screen"><X className="w-3.5 h-3.5" />Close <span className="hidden sm:inline text-muted-foreground">(Esc)</span></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-muted/40">
            <ScaledFrame html={html} device={device} fill />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
