/**
 * Move cufc.co.nz's in-code news into the Website tab so it can be edited.
 *   npx tsx --env-file=.env script/migrate-cufc-news-to-sites.ts            # dry run (rolled back)
 *   npx tsx --env-file=.env script/migrate-cufc-news-to-sites.ts --commit
 *   … --site-root /path/to/apps/cufc-website                                 # if not found automatically
 *
 * Reads apps/cufc-website/src/content/{editorial,news-archive,news-history}.json
 * — the same three files, in the same precedence, that scripts/gen-news-api.mjs
 * merges (editorial wins a slug collision). Each becomes a PUBLISHED article:
 *   - slug kept EXACTLY (it carries SEO and the 301 table)
 *   - date → display_date, standfirst → summary, image → hero_image, tag → tags
 *   - body blocks → markdown (shared/sites.ts; the round trip is proven on all
 *     of them by script/_test-sites.ts)
 *   - version 1 written as "imported from the site's code"
 * Idempotent: an article already in ClubOS is NEVER overwritten (someone may
 * have edited it). The code copy is not deleted; it stays the site's fallback.
 * One transaction; refuses to commit if any body fails the round trip.
 */
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import pg from "pg";
import { blocksToMarkdown, markdownToBlocks, type BodyBlock } from "../shared/sites";

const COMMIT = process.argv.includes("--commit");
const argRoot = process.argv.includes("--site-root") ? process.argv[process.argv.indexOf("--site-root") + 1] : null;
const candidates = [argRoot, resolve(process.cwd(), "../../../cufc-website"), resolve(process.cwd(), "../cufc-website")].filter(Boolean) as string[];
const root = candidates.find((p) => existsSync(join(p, "src/content/editorial.json")));
if (!root) { console.error("cufc-website not found — pass --site-root"); process.exit(1); }

const SOURCES = [["editorial", "editorial.json"], ["archive", "news-archive.json"], ["history", "news-history.json"]] as const;
const norm = (bs: BodyBlock[]) => JSON.stringify(bs.filter((b) => typeof b !== "string" || b.trim()).map((b) => {
  if (typeof b === "string") return b.trim();
  if ("image" in b) { const o: any = { image: b.image }; if (b.alt) o.alt = b.alt; if (b.caption) o.caption = b.caption; return o; }
  return b;
}));

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  CUFC news → Website — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n  from ${root}\n`);
  await c.query("BEGIN");
  try {
    const site = (await c.query(`SELECT id, settings FROM site_sites WHERE key = 'cufc'`)).rows[0];
    if (!site) throw new Error("no cufc site row — run script/seed-sites.ts --commit first");
    const known: string[] = site.settings?.tags ?? [];
    const seen = new Set<string>();
    let inserted = 0, kept = 0, shadowed = 0; const broken: string[] = []; const odd: string[] = [];
    for (const [source, file] of SOURCES) {
      const items = JSON.parse(readFileSync(join(root!, "src/content", file), "utf8"));
      for (const a of items) {
        if (seen.has(a.slug)) { shadowed++; continue; } // editorial already won this slug
        seen.add(a.slug);
        const body = blocksToMarkdown(a.body ?? []);
        if (norm(markdownToBlocks(body)) !== norm(a.body ?? [])) { broken.push(a.slug); continue; }
        if (a.tag && !known.includes(a.tag)) odd.push(`${a.slug} (${a.tag})`);
        const extra = a.source ? { source: a.source } : null;
        const r = await c.query(
          `INSERT INTO site_articles (site_id, slug, title, summary, body, hero_image, tags, status, display_date, source, source_extra,
                                      first_published_at, created_by_user_id, updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7::text[],'published',$8::date,$9,$10::jsonb, now(), NULL, NULL)
           ON CONFLICT (site_id, slug) DO NOTHING RETURNING id`,
          [site.id, a.slug, a.title, a.standfirst ?? "", body, a.image || null, a.tag ? [a.tag] : [], a.date, source, extra ? JSON.stringify(extra) : null]);
        if (!r.rows[0]) { kept++; continue; }
        const id = r.rows[0].id;
        const snap = { slug: a.slug, title: a.title, summary: a.standfirst ?? "", body, heroImage: a.image || null, authorName: null, tags: a.tag ? [a.tag] : [],
          displayDate: a.date, seoTitle: null, seoDescription: null, status: "published", publishAt: null };
        await c.query(`INSERT INTO site_versions (article_id, version, action, snapshot, saved_by_label) VALUES ($1, 1, $2, $3::jsonb, 'Imported from the site''s code')`,
          [id, `imported from ${file}`, JSON.stringify(snap)]);
        inserted++;
      }
    }
    if (broken.length) throw new Error(`${broken.length} bodies would not round-trip: ${broken.slice(0, 5).join(", ")}`);
    await c.query(`INSERT INTO site_events (site_id, user_label, action, detail) VALUES ($1, 'Import script', 'imported-from-code', $2::jsonb)`,
      [site.id, JSON.stringify({ inserted, kept, shadowed })]);
    const counts = (await c.query(`SELECT status, count(*)::int n FROM site_articles WHERE site_id = $1 GROUP BY status`, [site.id])).rows;
    console.log(`  ✓ ${inserted} imported · ${kept} already in ClubOS (left alone) · ${shadowed} code duplicates (editorial won)`);
    if (odd.length) console.log(`  · ${odd.length} with a section the site doesn't list: ${odd.slice(0, 5).join(", ")}`);
    console.log(`  · site now holds: ${JSON.stringify(counts)}`);
    await c.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(`\n  ${COMMIT ? "Committed." : "Rolled back (dry run)."}\n`);
  } catch (e: any) {
    await c.query("ROLLBACK");
    console.error(`\n  Rolled back: ${e.message}\n`);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main();
