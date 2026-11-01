// Checking what a person or the video worker hands back for a video piece.
// The contract is shared/studio-video.ts; this file decides what is kept.

import type { Edl, VideoClip } from "./studio-video";
import { VIDEO_CLIPS_MAX } from "./studio-video";

/** The club's private footage store — the only place a clip or a render may live. */
export const FOOTAGE_HOST_RE = /^https:\/\/[a-z0-9]+\.private\.blob\.vercel-storage\.com\//;

const num = (v: unknown, lo: number, hi: number): number | null => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

export function checkClips(raw: unknown): VideoClip[] {
  return (Array.isArray(raw) ? raw : []).slice(0, VIDEO_CLIPS_MAX).flatMap((c: any) => {
    const url = txt(c?.url, 600);
    if (!FOOTAGE_HOST_RE.test(url)) return [];
    return [{ url, name: txt(c?.name, 160) || "clip", bytes: Math.max(0, Math.round(Number(c?.bytes) || 0)), seconds: num(c?.seconds, 0, 36000), width: num(c?.width, 0, 10000), height: num(c?.height, 0, 10000) }];
  });
}

/** An edit: every number clamped, every word trimmed, no unknown fields. */
export function checkEdl(raw: unknown, clipCount: number): Edl | null {
  const r = raw as any;
  if (!r || typeof r !== "object" || !Array.isArray(r.segments)) return null;
  const segments = r.segments.slice(0, 200).flatMap((s: any) => {
    const clip = Math.round(Number(s?.clip));
    const a = num(s?.in, 0, 36000), b = num(s?.out, 0, 36000);
    if (!(clip >= 0 && clip < clipCount) || a == null || b == null || b <= a) return [];
    return [{ clip, in: a, out: b, role: s?.role === "broll" ? "broll" : "talk", ...(s?.focusX != null ? { focusX: num(s.focusX, 0, 1) ?? 0.5 } : {}) }];
  });
  if (!segments.length) return null;
  const captions = (Array.isArray(r.captions) ? r.captions : []).slice(0, 600).flatMap((c: any) => {
    const at = num(c?.at, 0, 3600), until = num(c?.until, 0, 3600), text = txt(c?.text, 160);
    return at != null && until != null && until > at && text ? [{ at, until, text, highlight: txt(c?.highlight, 40) || null }] : [];
  });
  const cards = (Array.isArray(r.cards) ? r.cards : []).slice(0, 40).flatMap((c: any) => {
    const from = num(c?.from, 0, 3600), to = num(c?.to, 0, 3600);
    const lines = (Array.isArray(c?.lines) ? c.lines : []).map((l: unknown) => txt(l, 160)).filter(Boolean).slice(0, 4);
    return from != null && to != null && to > from && lines.length ? [{ from, to, colour: c?.colour === "light" ? "light" : "primary", lines }] : [];
  });
  const hookLines = (Array.isArray(r.hook?.lines) ? r.hook.lines : []).map((l: unknown) => txt(l, 160)).filter(Boolean).slice(0, 2);
  const hookUntil = num(r.hook?.until, 0, 30);
  return {
    format: r.format === "landscape" ? "landscape" : "vertical",
    fps: 25,
    segments,
    captions,
    cards,
    hook: hookLines.length && hookUntil ? { lines: hookLines, until: hookUntil } : null,
    end: { line: txt(r.end?.line, 160), site: txt(r.end?.site, 80) },
    seconds: num(r.seconds, 1, 3600) ?? 30,
  };
}
