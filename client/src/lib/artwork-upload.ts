// Customer artwork upload, any size (2026-10-01) — the browser half of
// server/print-artwork-storage.ts. A file is split into ≤45MB parts and each
// part is PUT straight to storage on its own signed URL, so nothing passes
// through ClubOS and no part hits storage's 50MB per-object limit.
// 🔴 The same code lives in apps/united-print-website/src/lib/artworkUpload.ts —
// change both together.

export type ArtworkResult = { ok: true } | { ok: false; message: string };

/** PUT one part with progress (fetch can't report upload progress). */
function putPart(url: string, blob: Blob, contentType: string, onBytes: (n: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", contentType);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`storage answered ${x.status}`)));
    x.onerror = () => reject(new Error("network"));
    x.send(blob);
  });
}

/**
 * `uploadPath` is the signed per-line path ClubOS handed out
 * (…/items/:itemId/artwork?exp=…&sig=…); `origin` is where ClubOS answers.
 */
export async function uploadArtwork(origin: string, uploadPath: string, file: File, onProgress?: (pct: number) => void): Promise<ArtworkResult> {
  const base = new URL(uploadPath, origin);
  const at = (suffix: string) => `${base.origin}${base.pathname}${suffix}${base.search}`;
  try {
    const start = await fetch(at("/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
    });
    const s = await start.json().catch(() => ({}));
    if (!start.ok) return { ok: false, message: s?.message || "That file didn't upload." };
    const urls: string[] = s.urls ?? [];
    const partBytes: number = s.partBytes;
    let done = 0;
    for (let i = 0; i < urls.length; i++) {
      const blob = file.slice(i * partBytes, Math.min(file.size, (i + 1) * partBytes));
      // A single-part file keeps its real type so it can be previewed in the browser.
      const type = urls.length === 1 ? (file.type || "application/octet-stream") : "application/octet-stream";
      let attempt = 0;
      for (;;) {
        try {
          await putPart(urls[i], blob, type, (n) => onProgress?.(Math.min(99, Math.round(((done + n) / file.size) * 100))));
          break;
        } catch (e) {
          if (++attempt >= 3) throw e;           // a dropped connection mid-part gets two retries
        }
      }
      done += blob.size;
    }
    const fin = await fetch(at(`/${s.fileId}/finish`), { method: "POST" });
    const f = await fin.json().catch(() => ({}));
    if (!fin.ok) return { ok: false, message: f?.message || "That file didn't arrive complete." };
    onProgress?.(100);
    return { ok: true };
  } catch {
    return { ok: false, message: "The connection dropped while uploading — try again, or email it to orders@unitedprints.co.nz." };
  }
}

export function fileSizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
