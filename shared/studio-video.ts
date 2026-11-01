// Content Studio — the video editor's contract.
//
// Daniel, 2026-11-01: "Let's also build the video editor … that level of
// output [the CUGC videos, the SIU Gala Dinner video] through our content
// studio." Staff upload their clips to a piece; a WORKER (the editing kit's
// Remotion renderer, on the club Mac for now) transcribes, plans the edit with
// Claude, renders it in the brand's style, looks at its own render and fixes
// it, then hands back an MP4 and the EDIT itself. The edit is data — every
// caption and card line is a box a person can change, then "Render again"
// re-renders without re-planning (no model call).
//
// ClubOS owns: the piece, the clips list, the queue, the edit, the words.
// The worker owns: transcription, the plan, the render, the files it makes.
// This file is the one place both sides agree; change it on both or neither.

/** A clip a person uploaded (Vercel Blob, public unguessable URL). */
export interface VideoClip {
  url: string;
  name: string;
  bytes: number;
  /** Filled by the worker after it probes the file. */
  seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

/** One stretch of source footage, in the order it plays. */
export interface EdlSegment {
  /** Index into the piece's clips. */
  clip: number;
  /** Source seconds. */
  in: number;
  out: number;
  /** talk = someone speaking to camera (their audio is the voice track); broll = muted cutaway over the voice. */
  role: "talk" | "broll";
  /** Horizontal centre of the 9:16 crop, 0–1 of the source width (0.5 = centre). */
  focusX?: number;
}

/** A caption chunk, timed on the OUTPUT timeline (seconds). */
export interface EdlCaption {
  at: number;
  until: number;
  text: string;
  /** One word in the chunk drawn in the highlight face, if any. */
  highlight?: string | null;
}

/** A colour card over the edit, timed on the output timeline. */
export interface EdlCard {
  from: number;
  to: number;
  /** "primary" (the brand's main colour) or "light" (its paper colour); cards alternate. */
  colour: "primary" | "light";
  /** Up to four short lines; *word* marks the highlight word. */
  lines: string[];
}

export interface Edl {
  /** 1080×1920 or 1920×1080. */
  format: "vertical" | "landscape";
  fps: 25;
  segments: EdlSegment[];
  captions: EdlCaption[];
  cards: EdlCard[];
  /** The hook: the first words on screen (big type), 1–2 lines. */
  hook?: { lines: string[]; until: number } | null;
  end: { line: string; site: string };
  /** Total output length in seconds (segments + end card). */
  seconds: number;
}

/** What the worker is handed. */
export interface VideoJob {
  id: number;
  pieceId: number;
  /** plan = transcribe + plan + render; render = render the stored edl as it is (words edited). */
  kind: "plan" | "render";
  brand: string;
  brief: string;
  format: "vertical" | "landscape";
  lengthSeconds: number;
  clips: VideoClip[];
  edl: Edl | null;
  theme: VideoTheme;
}

/** The brand's look, from shared/studio-brand-packs.ts. */
export interface VideoTheme {
  name: string;
  primary: string;
  light: string;
  ink: string;
  accent: string;
  /** Google font family names. */
  displayFont: string;
  bodyFont: string;
  crestUrl: string | null;
  site: string;
}

/** What the worker hands back. */
export interface VideoJobResult {
  ok: boolean;
  error?: string | null;
  edl?: Edl | null;
  clips?: VideoClip[];
  videoUrl?: string | null;
  posterUrl?: string | null;
  seconds?: number | null;
  /** Model spend for this job, US cents. */
  costCents?: number | null;
  /** Plain-English note for the person ("I opened on Paris's line about …"). */
  note?: string | null;
}

export const VIDEO_CLIP_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB a clip
export const VIDEO_CLIPS_MAX = 12;

/** The words in an edl as boxes: captions and card lines. Paths: "captions.3.text", "cards.1.lines.0", "hook.lines.0", "end.line". */
export function edlFields(edl: Edl): { path: string; label: string; value: string }[] {
  const out: { path: string; label: string; value: string }[] = [];
  edl.hook?.lines.forEach((l, i) => out.push({ path: `hook.lines.${i}`, label: `Hook line ${i + 1}`, value: l }));
  edl.cards.forEach((c, ci) => c.lines.forEach((l, li) => out.push({ path: `cards.${ci}.lines.${li}`, label: `Card ${ci + 1} · line ${li + 1}`, value: l })));
  edl.captions.forEach((c, i) => out.push({ path: `captions.${i}.text`, label: `Caption at ${c.at.toFixed(1)}s`, value: c.text }));
  out.push({ path: "end.line", label: "End card line", value: edl.end.line });
  return out;
}

/** Set one word box. Only the paths edlFields() lists are writable. */
export function applyEdlField(edl: Edl, path: string, value: string): Edl {
  const v = String(value ?? "").slice(0, 160);
  const next: Edl = JSON.parse(JSON.stringify(edl));
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^hook\.lines\.(\d+)$/)) && next.hook?.lines[+m[1]] !== undefined) next.hook.lines[+m[1]] = v;
  else if ((m = path.match(/^cards\.(\d+)\.lines\.(\d+)$/)) && next.cards[+m[1]]?.lines[+m[2]] !== undefined) next.cards[+m[1]].lines[+m[2]] = v;
  else if ((m = path.match(/^captions\.(\d+)\.text$/)) && next.captions[+m[1]]) next.captions[+m[1]].text = v;
  else if (path === "end.line") next.end.line = v;
  return next;
}
