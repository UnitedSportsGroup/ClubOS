// One-shot migration: scan all text columns in the DB for "/objects/..." paths,
// fetch each from the still-live Replit ClubOS deployment, and re-upload to
// Supabase Storage at the same path. Also creates ACL rows (defaulting to
// public for facility/program assets, since they're served on customer pages).
//
// Usage:
//   REPLIT_BASE="https://clubbase.replit.app" npx tsx script/migrate-files-from-replit.ts

import "dotenv/config";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const REPLIT_BASE = process.env.REPLIT_BASE || "https://clubbase.replit.app";
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "clubos-uploads";

if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required env: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findReferencedObjectPaths(): Promise<Set<string>> {
  // List every (table, column) pair where the column type is text-like.
  const colRes = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
    ORDER BY table_name, column_name
  `);

  const paths = new Set<string>();

  for (const { table_name: table, column_name: col } of colRes.rows) {
    // Skip the ACL table itself — paths there are by definition already known.
    if (table === "object_acls") continue;
    try {
      // For text columns: pattern match on /objects/<...>
      // For json/jsonb: cast to text and match.
      const q = `
        SELECT DISTINCT (regexp_matches("${col}"::text, '/objects/[a-zA-Z0-9._/\\-]+', 'g'))[1] AS p
        FROM "${table}"
        WHERE "${col}"::text LIKE '%/objects/%'
      `;
      const res = await pool.query(q);
      for (const row of res.rows) {
        if (row.p && typeof row.p === "string") paths.add(row.p);
      }
    } catch {
      // Ignore tables/columns that can't be regex-cast (e.g. weird types)
    }
  }
  return paths;
}

async function uploadOneFile(objectPath: string): Promise<{ ok: boolean; reason?: string }> {
  const storagePath = objectPath.replace(/^\/objects\//, "");
  if (!storagePath) return { ok: false, reason: "empty storage path" };

  // Skip if already in Supabase
  const slash = storagePath.lastIndexOf("/");
  const dir = slash >= 0 ? storagePath.slice(0, slash) : "";
  const name = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;
  const { data: existing } = await supabase.storage
    .from(BUCKET)
    .list(dir, { limit: 1000, search: name });
  if (existing?.some((f) => f.name === name)) {
    return { ok: true, reason: "already in supabase" };
  }

  const url = `${REPLIT_BASE}${objectPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { ok: false, reason: `fetch ${url} → ${res.status}` };
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await res.arrayBuffer());

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType,
      cacheControl: "public, max-age=86400",
      upsert: true,
    });
  if (error) return { ok: false, reason: `upload: ${error.message}` };

  // Default ACL: public (these are facility/program assets shown on the booking site)
  await pool.query(
    `INSERT INTO public.object_acls (object_path, owner_user_id, visibility)
     VALUES ($1, NULL, 'public')
     ON CONFLICT (object_path) DO UPDATE SET visibility='public', updated_at = now()`,
    [objectPath]
  );

  return { ok: true };
}

async function main() {
  console.log(`→ Source:  ${REPLIT_BASE}`);
  console.log(`→ Target:  ${SUPABASE_URL!} bucket=${BUCKET}\n`);
  console.log("→ Scanning DB for /objects/... references…");
  const paths = await findReferencedObjectPaths();
  console.log(`  Found ${paths.size} unique object paths referenced in DB`);
  if (paths.size === 0) {
    await pool.end();
    return;
  }

  let copied = 0;
  let skipped = 0;
  let failed = 0;
  let i = 0;
  for (const p of paths) {
    i++;
    const r = await uploadOneFile(p);
    if (r.ok) {
      if (r.reason === "already in supabase") {
        console.log(`  [${i}/${paths.size}] · ${p} (already migrated)`);
        skipped++;
      } else {
        console.log(`  [${i}/${paths.size}] ✓ ${p}`);
        copied++;
      }
    } else {
      console.log(`  [${i}/${paths.size}] ✗ ${p} — ${r.reason}`);
      failed++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Copied:  ${copied}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
