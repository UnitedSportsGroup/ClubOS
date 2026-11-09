// ─────────────────────────────────────────────────────────────────────────────
// Upload a folder on this Mac into Club Drive — the club's photo archive path.
//
//   Survey:  npx tsx --env-file=.env script/import-local-folder-to-drive.ts --src <dir> --dest "History/50th Anniversary Book" --dry-run
//   Upload:  npx tsx --env-file=.env script/import-local-folder-to-drive.ts --src <dir> --dest "History/50th Anniversary Book" --tag gala50
//   Folders: npx tsx --env-file=.env script/import-local-folder-to-drive.ts --list
//
// Built 2026-11-09 for the 50th-anniversary book photos Con sent over (the
// first batch of the club's historical photo archive). The originals also
// live on the NAS; Club Drive is the copy staff can search and share.
//
// 🔴 IDEMPOTENT: every file records source='local_import', source_id=<tag>:<sha256>,
// behind the same unique index the Google importer uses, so a re-run skips
// what is already here and the same photo never lands twice.
// 🔴 --dest is a path of folder NAMES from the Drive root; missing folders are
// created, existing ones (case-insensitive, live) are reused. A new top-level
// folder carries no gate, i.e. it is open to every staff member — right for
// history photos, wrong for anything with personal data in it.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative } from "path";
import { Pool } from "pg";
import { driveStorage } from "../server/drive-storage";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const DRY = args.includes("--dry-run");
const SRC = flag("src");
const DEST = flag("dest");
const TAG = flag("tag", "local");
const SKIP = new Set(["Get Started with Dropbox.pdf", ".DS_Store"]);

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff", ".heic": "image/heic",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".mov": "video/quicktime",
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function child(parentId: number | null, name: string): Promise<number | null> {
  const r = await pool.query(
    `SELECT id FROM drive_nodes WHERE kind='folder' AND trashed_at IS NULL
       AND lower(name)=lower($1) AND parent_id IS NOT DISTINCT FROM $2`,
    [name, parentId],
  );
  return r.rows[0]?.id ?? null;
}

async function ensureFolder(parentId: number | null, name: string): Promise<number> {
  const got = await child(parentId, name);
  if (got !== null) return got;
  const r = await pool.query(
    `INSERT INTO drive_nodes (parent_id, kind, name) VALUES ($1,'folder',$2) RETURNING id`,
    [parentId, name],
  );
  console.log(`📁 created "${name}"`);
  return r.rows[0].id;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

try {
  if (args.includes("--list")) {
    const r = await pool.query(
      `SELECT n.id, n.name, (SELECT count(*) FROM drive_nodes c WHERE c.parent_id=n.id AND c.trashed_at IS NULL) AS items
         FROM drive_nodes n WHERE n.parent_id IS NULL AND n.trashed_at IS NULL AND n.kind='folder' ORDER BY n.name`,
    );
    console.table(r.rows);
    process.exit(0);
  }
  if (!SRC || !DEST) throw new Error("Need --src <dir> and --dest <Folder/Sub>");

  const files = walk(SRC);
  const total = files.reduce((s, f) => s + statSync(f).size, 0);
  console.log(`\n${DRY ? "SURVEY" : "UPLOAD"}: ${files.length} files, ${(total / 1048576).toFixed(0)} MB → Drive /${DEST}\n`);
  if (DRY) { for (const f of files.slice(0, 10)) console.log("  " + relative(SRC, f)); process.exit(0); }

  // Destination folder chain (plus any sub-folders inside --src).
  let root: number | null = null;
  for (const part of DEST.split("/").filter(Boolean)) root = await ensureFolder(root, part);

  let done = 0, here = 0, failed = 0, bytes = 0;
  for (const f of files) {
    const rel = relative(SRC, f).split("/");
    const name = rel.pop()!;
    let parent = root!;
    for (const d of rel) parent = await ensureFolder(parent, d);

    const buf = readFileSync(f);
    const sha = createHash("sha256").update(buf).digest("hex");
    const sourceId = `${TAG}:${sha}`;
    const dup = await pool.query(`SELECT id FROM drive_nodes WHERE source='local_import' AND source_id=$1`, [sourceId]);
    if (dup.rows.length) { here++; continue; }

    try {
      const mime = MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
      const put = await driveStorage().put(buf, mime, name);
      await pool.query(
        `INSERT INTO drive_nodes (parent_id, kind, name, storage_key, storage_backend, mime_type, size_bytes,
                                  checksum, extract_status, source, source_id, source_modified_at)
         VALUES ($1,'file',$2,$3,$4,$5,$6,$7,'unsupported','local_import',$8,$9)`,
        [parent, name, put.storageKey, put.backend, mime, put.sizeBytes, put.checksum, sourceId, statSync(f).mtime],
      );
      done++; bytes += put.sizeBytes;
      if (done % 25 === 0) console.log(`  ${done} uploaded…`);
    } catch (e: any) {
      failed++;
      console.log(`✗ ${name} — ${String(e.message ?? e).slice(0, 160)}`);
    }
  }
  console.log(`\nuploaded ${done} (${(bytes / 1048576).toFixed(0)} MB) · already here ${here} · failed ${failed}\n`);
  if (failed) process.exitCode = 1;
} catch (e: any) {
  console.error(`\n${e.message}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
