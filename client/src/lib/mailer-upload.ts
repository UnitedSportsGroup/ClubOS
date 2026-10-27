// A picture for an email, from a file on the person's machine: uploaded to
// ClubOS, shrunk and hosted there (server/mailer-images.ts), never embedded.
// Shared by the designed email (drop on the canvas, the Pictures panel) and
// the written email (the Picture button, paste, drop).
//
// Travis, 28 Oct 2026: "can we add photos to the mailer — the error was that
// size of email is too small and can't add even 1 picture". A photo dropped
// straight on the canvas was embedded as base64 and the 102KB gauge refused
// it; the written email had no way to add one at all.
import { workspaceFetch } from "@/lib/queryClient";

export type HostedImage = { url: string; width: number; height: number; note?: string; reason?: string };

/** The image files in a drop, a paste or a file input — nothing else. */
export function imageFilesOf(dt: DataTransfer | null | undefined, list?: FileList | File[] | null): File[] {
  const files = dt?.files?.length ? Array.from(dt.files) : list ? Array.from(list) : [];
  return files.filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/"));
}

export async function uploadMailerImage(file: File): Promise<HostedImage> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const r = await workspaceFetch("/api/admin/mailer/images", { method: "POST", body: fd });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok || !data?.url) throw new Error(data?.message || `Upload failed (HTTP ${r.status}).`);
  return { url: String(data.url), width: Number(data.width) || 0, height: Number(data.height) || 0, note: data.note, reason: data.reason };
}
