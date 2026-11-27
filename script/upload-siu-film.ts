/**
 * Upload a film file from this Mac into the private SIU film store.
 *
 *   npx tsx --env-file=.env script/upload-siu-film.ts <folder-in-store> <file> [<file> …]
 *
 * Prints one JSON line per file ({ file, url, pathname, bytes }) and appends
 * it to SIU_FILM_UPLOAD_LOG when that is set. It only stores the bytes; the
 * film row is written by script/seed-siu-film.ts.
 */
import { createReadStream, statSync, appendFileSync } from "node:fs";
import { basename } from "node:path";
import { put } from "@vercel/blob";

const token = process.env.SIU_FILM_BLOB_TOKEN;
if (!token) { console.error("SIU_FILM_BLOB_TOKEN is not set"); process.exit(1); }
const [folder, ...files] = process.argv.slice(2);
if (!folder || !files.length) { console.error("usage: upload-siu-film.ts <folder> <file>…"); process.exit(1); }

const typeOf = (name: string) => (/\.jpe?g$/i.test(name) ? "image/jpeg" : /\.mov$/i.test(name) ? "video/quicktime" : "video/mp4");

(async () => {
  for (const file of files) {
    const bytes = statSync(file).size;
    const name = basename(file).replace(/[^A-Za-z0-9._-]+/g, "-");
    let last = -1;
    const started = Date.now();
    const blob = await put(`${folder.replace(/^\/+|\/+$/g, "")}/${name}`, createReadStream(file), {
      access: "private" as any, token, multipart: bytes > 32 * 1024 * 1024, addRandomSuffix: true, contentType: typeOf(name),
      onUploadProgress: (p: { percentage: number }) => {
        const pct = Math.floor(p.percentage / 5) * 5;
        if (pct !== last) { last = pct; console.error(`${name} ${pct}% (${Math.round((Date.now() - started) / 1000)}s)`); }
      },
    } as any);
    const line = JSON.stringify({ file, url: blob.url, pathname: blob.pathname, bytes });
    console.log(line);
    if (process.env.SIU_FILM_UPLOAD_LOG) appendFileSync(process.env.SIU_FILM_UPLOAD_LOG, line + "\n");
  }
})().catch((e) => { console.error("upload failed:", e?.message || e); process.exit(1); });
