// Setup script: creates the Supabase Storage bucket if it doesn't exist,
// confirms credentials work, and tests round-trip upload/download/delete.
//
// Usage: npx tsx script/setup-supabase-storage.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "clubos-uploads";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`→ Project: ${SUPABASE_URL}`);
  console.log(`→ Target bucket: ${BUCKET}\n`);

  console.log("→ Listing existing buckets…");
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error("  ✗ Cannot list buckets:", listErr.message);
    process.exit(1);
  }
  const existing = buckets?.map((b) => b.name) ?? [];
  console.log(`  Existing buckets: ${existing.length ? existing.join(", ") : "(none)"}`);

  if (!existing.includes(BUCKET)) {
    console.log(`\n→ Creating bucket "${BUCKET}" (private)…`);
    const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 26214400, // 25 MB per-file cap, matching the existing facility upload limit
    });
    if (createErr) {
      console.error("  ✗ Bucket create failed:", createErr.message);
      process.exit(1);
    }
    console.log("  ✓ Bucket created");
  } else {
    console.log(`\n  ✓ Bucket "${BUCKET}" already exists`);
  }

  console.log("\n→ Round-trip test (upload → download → delete)…");
  const testPath = `_setup-test/${Date.now()}.txt`;
  const testContent = "supabase storage round-trip test";

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(testPath, new Blob([testContent], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: true,
    });
  if (uploadErr) {
    console.error("  ✗ Upload failed:", uploadErr.message);
    process.exit(1);
  }
  console.log("  ✓ Upload");

  const { data: dlData, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(testPath);
  if (dlErr || !dlData) {
    console.error("  ✗ Download failed:", dlErr?.message);
    process.exit(1);
  }
  const dlText = await dlData.text();
  if (dlText !== testContent) {
    console.error(`  ✗ Round-trip content mismatch: got ${JSON.stringify(dlText)}`);
    process.exit(1);
  }
  console.log("  ✓ Download (content matches)");

  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([testPath]);
  if (rmErr) {
    console.error("  ✗ Delete failed:", rmErr.message);
    process.exit(1);
  }
  console.log("  ✓ Delete");

  console.log("\n✓ Supabase Storage is ready.");
}

void main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
