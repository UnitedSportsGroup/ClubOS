// Puts sponsor content packs into Club Drive and gives each sponsor a share link.
//
//   npx tsx --env-file=.env script/upload-sponsor-content.ts <packs dir> "<Collection name>" [--commit]
//
// <packs dir> holds one folder per sponsor; inside it, sub-folders of files.
// In the Drive it becomes:  Sponsor Content / <Sponsor> / <Collection name> / <sub-folder> / file
// Safe to run again: a file already in its folder (same name) is left alone.
import fs from "fs";
import path from "path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { driveNodes } from "@shared/schema";
import { driveStorage } from "../server/drive-storage";
import { ensureSponsorContentRoot, createShareLink } from "../server/drive-share";

const [dir, collection] = process.argv.slice(2); const COMMIT = process.argv.includes("--commit"); const USER = 1;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", csv: "text/csv", txt: "text/plain", pdf: "application/pdf" };

async function folder(parentId: number, name: string, description?: string): Promise<number> {
  const ex = (await db.select().from(driveNodes).where(and(eq(driveNodes.parentId, parentId), eq(driveNodes.kind, "folder"), sql`lower(${driveNodes.name}) = lower(${name})`, isNull(driveNodes.trashedAt)))) as any[];
  if (ex[0]) return ex[0].id;
  if (!COMMIT) return -1;
  const [row] = (await db.insert(driveNodes).values({ parentId, kind: "folder", name, brand: "all", description, ownerUserId: USER, createdBy: USER }).returning()) as any[];
  return row.id;
}
async function file(parentId: number, full: string): Promise<"added" | "there"> {
  const name = path.basename(full);
  if (parentId > 0) {
    const ex = (await db.select({ id: driveNodes.id }).from(driveNodes).where(and(eq(driveNodes.parentId, parentId), eq(driveNodes.name, name), isNull(driveNodes.trashedAt)))) as any[];
    if (ex[0]) return "there";
  }
  if (!COMMIT) return "added";
  const buf = fs.readFileSync(full); const mime = MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
  const put = await driveStorage().put(buf, mime, name);
  await db.insert(driveNodes).values({ parentId, kind: "file", name, storageKey: put.storageKey, storageBackend: put.backend, mimeType: mime, sizeBytes: put.sizeBytes, checksum: put.checksum, brand: "all", extractStatus: "unsupported", ownerUserId: USER, createdBy: USER });
  return "added";
}
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).filter((e) => !e.name.startsWith(".")).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

(async () => {
  if (!dir || !collection) throw new Error("usage: upload-sponsor-content.ts <packs dir> \"<Collection name>\" [--commit]");
  const root = COMMIT ? await ensureSponsorContentRoot(USER) : -1;
  for (const sponsor of fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()).sort()) {
    const sId = root > 0 ? await folder(root, sponsor) : -1;
    const cId = sId > 0 ? await folder(sId, collection) : -1;
    let added = 0, there = 0, bytes = 0; const cache = new Map<string, number>();
    for (const f of walk(path.join(dir, sponsor))) {
      const rel = path.relative(path.join(dir, sponsor), path.dirname(f)); let pid = cId;
      if (rel && cId > 0) { if (!cache.has(rel)) { let p = cId; for (const part of rel.split(path.sep)) p = await folder(p, part); cache.set(rel, p); } pid = cache.get(rel)!; }
      const r = await file(pid, f); if (r === "added") { added++; bytes += fs.statSync(f).size; } else there++;
    }
    let url = "(link made on --commit)";
    if (COMMIT) url = (await createShareLink(sId, USER)).url;
    console.log(`${sponsor}\t${added} added (${(bytes / 1e6).toFixed(1)} MB), ${there} already there\t${url}`);
  }
  console.log(COMMIT ? "DONE" : "rehearsal only: nothing uploaded");
  await pool.end(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
