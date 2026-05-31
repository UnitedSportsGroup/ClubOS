// One-shot script: generate iCal feed tokens for every active facility that
// doesn't already have one. Prints the per-facility public URL — copy/paste
// into the electrician's Home Assistant config.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/generate-facility-calendar-tokens.mjs
//   # optional: filter to one workspace by slug
//   DATABASE_URL=... node scripts/generate-facility-calendar-tokens.mjs --workspace united-sports-centre
//   # optional: rotate ALL tokens (use sparingly — invalidates existing URLs)
//   DATABASE_URL=... node scripts/generate-facility-calendar-tokens.mjs --rotate
//
// Base URL defaults to https://app.usg.co.nz. Override with --base-url.

import pg from "pg";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
};

const ROTATE = flag("--rotate");
const WORKSPACE_SLUG = flagValue("--workspace");
const BASE_URL = flagValue("--base-url") || "https://app.usg.co.nz";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var required.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  // Pull facilities, optionally filtered by workspace slug.
  const params = [];
  let where = "f.active = true";
  if (WORKSPACE_SLUG) {
    params.push(WORKSPACE_SLUG);
    where += ` AND o.slug = $${params.length}`;
  }
  const { rows: facilities } = await pool.query(
    `SELECT f.id, f.name, f.calendar_token, o.slug AS workspace_slug, o.name AS workspace_name
     FROM facilities f
     JOIN organizations o ON o.id = f.organization_id
     WHERE ${where}
     ORDER BY o.name, f.display_order, f.name`,
    params,
  );

  if (facilities.length === 0) {
    console.log("No facilities matched.");
    process.exit(0);
  }

  const updated = [];
  const skipped = [];
  for (const f of facilities) {
    const needsToken = ROTATE || !f.calendar_token;
    if (!needsToken) {
      skipped.push(f);
      continue;
    }
    const newToken = crypto.randomBytes(24).toString("base64url");
    await pool.query(
      `UPDATE facilities SET calendar_token = $1 WHERE id = $2`,
      [newToken, f.id],
    );
    updated.push({ ...f, calendar_token: newToken });
  }

  // Output: grouped by workspace, ready to paste into an email.
  const byWorkspace = new Map();
  for (const f of [...updated, ...skipped]) {
    const key = f.workspace_name;
    if (!byWorkspace.has(key)) byWorkspace.set(key, []);
    byWorkspace.get(key).push(f);
  }

  console.log("");
  console.log("═".repeat(70));
  console.log("  FACILITY CALENDAR URLS — for Home Assistant subscription");
  console.log("═".repeat(70));

  for (const [workspaceName, list] of byWorkspace) {
    console.log("");
    console.log(`▶ ${workspaceName}`);
    console.log("─".repeat(70));
    for (const f of list) {
      const status = updated.includes(f) ? (ROTATE && f.calendar_token ? "[ROTATED]" : "[NEW]") : "[EXISTING]";
      console.log(`  ${status} ${f.name}`);
      console.log(`      ${BASE_URL}/api/public/facility-calendar/${f.calendar_token}.ics`);
    }
  }

  console.log("");
  console.log("═".repeat(70));
  console.log(`  ${updated.length} new/rotated · ${skipped.length} kept existing`);
  console.log("═".repeat(70));
  console.log("");
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
