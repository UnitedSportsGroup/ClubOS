/**
 * Put each signed sponsor's logo on their Partners profile (Daniel, 2026-10-25:
 * "all the existing signed on sponsors essentially have to be treated as the
 * sponsor's profile so need to add their logos there").
 *
 * The files are the club websites' own partner artwork, copied into
 * client/public/sponsors/ (served by ClubOS itself — never the egress-capped
 * Supabase bucket). Most of it is WHITE artwork drawn for a dark page, so each
 * row also says which GROUND to draw it on. Only a partner with NO logo yet is
 * touched — a logo a person uploaded is never overwritten.
 *
 *   npx tsx --env-file=.env script/seed-sponsor-logos.ts            # dry run
 *   npx tsx --env-file=.env script/seed-sponsor-logos.ts --commit
 */
import pg from "pg";
import { existsSync } from "fs";
import { join } from "path";

const COMMIT = process.argv.includes("--commit");

// company (as in sponsorship_partners) → file under client/public/sponsors + ground
const LOGOS: Record<string, { file: string; ground: "light" | "dark"; note?: string }> = {
  "CUPRA Christchurch (Miles Group)": { file: "cupra.svg", ground: "dark" },
  "Formosa Foods":                    { file: "formosa-foods.png", ground: "dark" },
  "Fusion5":                          { file: "fusion5.svg", ground: "dark" },
  "Go Media":                         { file: "go-media.svg", ground: "dark" },
  "Heartland Technology":             { file: "heartland-technology.svg", ground: "light" },  // ink artwork (aria-label "Heartland Technology Print & Design")
  "Lone Star":                        { file: "lone-star.svg", ground: "dark" },
  "LT McGuinness":                    { file: "lt-mcguinness.png", ground: "dark", note: "175×88 — low-res, worth a proper file" },
  "Milano Tiling":                    { file: "milano-tiling.png", ground: "light" },
  "Revamp Digital":                   { file: "revamp-digital.svg", ground: "dark" },
  "Shadeplus":                        { file: "shadeplus.png", ground: "dark" },
  "SMC Design Studio":                { file: "smc-design-studio.png", ground: "dark" },
  "The Drifter":                      { file: "the-drifter.svg", ground: "dark" },
  "Victoria Foods":                   { file: "victoria-foods.png", ground: "dark" },
  "Your Local Services":              { file: "your-local-services.png", ground: "dark" },
};

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Sponsor logos — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);
  const { rows } = await c.query(`SELECT id, company, logo_url FROM sponsorship_partners WHERE archived_at IS NULL ORDER BY company`);
  let set = 0, kept = 0, missing: string[] = [];
  await c.query("BEGIN");
  for (const r of rows) {
    const l = LOGOS[r.company];
    if (!l) { missing.push(r.company); continue; }
    const path = join(process.cwd(), "client", "public", "sponsors", l.file);
    if (!existsSync(path)) throw new Error(`file missing for ${r.company}: ${path}`);
    if (r.logo_url) { kept++; console.log(`  = ${r.company}: keeps ${r.logo_url}`); continue; }
    await c.query(`UPDATE sponsorship_partners SET logo_url = $1, logo_ground = $2, updated_at = now() WHERE id = $3`, [`/sponsors/${l.file}`, l.ground, r.id]);
    set++;
    console.log(`  + ${r.company}: /sponsors/${l.file} on ${l.ground}${l.note ? ` (${l.note})` : ""}`);
  }
  await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
  console.log(`\n  ${set} set · ${kept} already had one · no file for: ${missing.join(", ") || "—"}\n  ${COMMIT ? "COMMITTED" : "rolled back"}\n`);
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
