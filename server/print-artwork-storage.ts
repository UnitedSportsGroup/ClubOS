// ─────────────────────────────────────────────────────────────────────────────
// Customer artwork of ANY size (2026-10-01).
//
// Storage refuses a single object over 50MB — a project-wide Supabase setting
// we can't raise from here — and our own server takes 50MB per request. Print
// artwork is often bigger. So the customer's BROWSER splits a file into parts
// of ≤45MB and PUTs each one straight to storage on a signed upload URL: the
// bytes never pass through ClubOS, and no part is ever over the limit.
// Downloading streams the parts back, in order, as one file.
//
// Keys: `quote-art/<uuid>/<n>` — flat, never derived from the customer's name.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from "crypto";
import { Readable } from "stream";
import type { Response } from "express";
import { createClient } from "@supabase/supabase-js";

export const ART_PART_BYTES = 45 * 1024 * 1024;
export const ART_MAX_BYTES = 2000 * 1024 * 1024;   // 2GB — fits the integer column, and any real print file

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "clubos-uploads";
let client: ReturnType<typeof createClient> | null = null;
const sb = () => (client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }));

export function newArtPrefix(): string { return `quote-art/${randomUUID()}`; }
export const partKey = (prefix: string, i: number) => `${prefix}/${i}`;

/** One signed upload URL per part (valid ~2h). The browser PUTs each part to its URL. */
export async function signArtParts(prefix: string, parts: number): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < parts; i++) {
    const { data, error } = await sb().storage.from(BUCKET).createSignedUploadUrl(partKey(prefix, i));
    if (error || !data?.signedUrl) throw new Error(`Couldn't prepare the upload: ${error?.message ?? "no url"}`);
    urls.push(data.signedUrl);
  }
  return urls;
}

/** What actually landed: part index → bytes. */
export async function listArtParts(prefix: string): Promise<Map<number, number>> {
  const { data, error } = await sb().storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Couldn't check the upload: ${error.message}`);
  const out = new Map<number, number>();
  for (const o of data ?? []) {
    const n = Number(o.name);
    if (Number.isInteger(n)) out.set(n, Number((o as any).metadata?.size ?? 0));
  }
  return out;
}

export async function signedArtUrl(key: string, opts: { download?: string; expiresIn?: number } = {}): Promise<string> {
  const { data, error } = await sb().storage.from(BUCKET)
    .createSignedUrl(key, opts.expiresIn ?? 300, opts.download ? { download: opts.download } : undefined);
  if (error || !data?.signedUrl) throw new Error(`Couldn't open the file: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

/** Stream a split file back as one, part by part — never all in memory. */
export async function streamArtParts(res: Response, f: { storageKey: string; parts: number; sizeBytes: number; filename: string; contentType: string }, download: boolean) {
  res.setHeader("Content-Type", f.contentType || "application/octet-stream");
  res.setHeader("Content-Length", String(f.sizeBytes));
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
  res.setHeader("Cache-Control", "private, no-store");
  for (let i = 0; i < f.parts; i++) {
    const url = await signedArtUrl(partKey(f.storageKey, i), { expiresIn: 600 });
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`part ${i} answered ${r.status}`);
    await new Promise<void>((resolve, reject) => {
      const s = Readable.fromWeb(r.body as any);
      s.on("error", reject);
      s.on("end", resolve);
      s.pipe(res, { end: false });
    });
  }
  res.end();
}

export async function removeArt(prefix: string, parts: number) {
  await sb().storage.from(BUCKET).remove(Array.from({ length: parts }, (_, i) => partKey(prefix, i)));
}
