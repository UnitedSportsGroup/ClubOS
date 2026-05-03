// Bulk upload club logos from outputs/logos/<slug>.{ext} to ClubOS, matching
// each file to a club by its slug. Uses session auth via the local sync
// admin user — must be run from a logged-in session, OR set CLUBOS_API_KEY
// for an API-key-based upload (future capability).
//
// Pairs with the logo-fetcher skill: that fetches files into outputs/logos/
// keyed by slug; this picks them up and POSTs each to the right club.
//
// Usage:
//   cd apps/clubos
//   npx tsx script/upload-club-logos.ts                 # all CIC org clubs
//   npx tsx script/upload-club-logos.ts --org-id 5      # specific org
//   npx tsx script/upload-club-logos.ts --dry-run       # match only, don't upload
//
// What it does:
//   1. List clubs for the org
//   2. For each club, derive its slug
//   3. Look in outputs/logos/<slug>.{svg,png,webp,avif,jpg} — first match wins
//   4. POST the file to /api/admin/clubs/:id/logo (multipart form)
//   5. Skip clubs that already have a logoUrl (use --force to overwrite)

import "dotenv/config";
import { Pool } from "pg";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..", "..", "..");
const LOGOS_DIR = resolve(ROOT, "outputs", "logos");
const API_BASE = process.env.CLUBOS_API_BASE || "https://app.usg.co.nz";

const orgIdArg = process.argv.find(a => a.startsWith("--org-id="));
const ORG_ID = orgIdArg ? parseInt(orgIdArg.split("=")[1], 10) : 5; // CIC default
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const SESSION_COOKIE = process.env.CLUBOS_SESSION; // e.g. "session=abc123..."

if (!DRY_RUN && !SESSION_COOKIE) {
  console.error(
    "Missing CLUBOS_SESSION env var. Get it from Chrome devtools while\n" +
    "logged into app.usg.co.nz: Application → Cookies → 'session' → copy value.\n" +
    "Then: export CLUBOS_SESSION='session=<value>'\n" +
    "Or run with --dry-run to just see which clubs would be updated."
  );
  process.exit(1);
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const FORMAT_PRIORITY = ["svg", "png", "webp", "avif", "jpg", "jpeg", "gif"] as const;

function findLogoFile(slug: string): { path: string; ext: string } | null {
  for (const ext of FORMAT_PRIORITY) {
    const p = resolve(LOGOS_DIR, `${slug}.${ext}`);
    if (existsSync(p)) return { path: p, ext };
  }
  return null;
}

const MIME = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
} as const;

async function uploadLogo(clubId: number, file: { path: string; ext: string }): Promise<void> {
  const form = new FormData();
  const buf = readFileSync(file.path);
  const mime = MIME[file.ext as keyof typeof MIME] || "application/octet-stream";
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), `logo.${file.ext}`);

  const res = await fetch(`${API_BASE}/api/admin/clubs/${clubId}/logo`, {
    method: "POST",
    body: form,
    headers: SESSION_COOKIE ? { Cookie: SESSION_COOKIE } : {},
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(
    `SELECT id, name, logo_url FROM clubs WHERE organization_id = $1 ORDER BY name`,
    [ORG_ID]
  );
  await pool.end();

  console.log(`Org ${ORG_ID}: ${r.rowCount} clubs.\n`);
  console.log(`Looking for files in: ${LOGOS_DIR}\n`);

  let uploaded = 0;
  let skippedHasLogo = 0;
  let skippedNoFile = 0;
  let failed = 0;

  for (const club of r.rows) {
    const slug = slugify(club.name);
    const file = findLogoFile(slug);

    if (!file) {
      console.log(`  ✗  ${club.name.padEnd(40)}  no file: ${slug}.{svg,png,webp,…}`);
      skippedNoFile++;
      continue;
    }

    if (club.logo_url && !FORCE) {
      console.log(`  ↷  ${club.name.padEnd(40)}  has logo already (use --force to overwrite)`);
      skippedHasLogo++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  →  ${club.name.padEnd(40)}  ${file.ext.toUpperCase().padEnd(4)}  (dry-run)`);
      continue;
    }

    try {
      await uploadLogo(club.id, file);
      console.log(`  ✓  ${club.name.padEnd(40)}  ${file.ext.toUpperCase()} uploaded`);
      uploaded++;
    } catch (e: any) {
      console.log(`  ✗  ${club.name.padEnd(40)}  upload failed: ${e.message?.slice(0, 80)}`);
      failed++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  Uploaded:               ${uploaded}`);
  console.log(`  Skipped (already set):  ${skippedHasLogo}`);
  console.log(`  Skipped (no file):      ${skippedNoFile}`);
  console.log(`  Failed:                 ${failed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
