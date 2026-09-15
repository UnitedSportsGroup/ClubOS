/**
 * Register the accounts the Marketing hub pulls from.
 *
 *   npx tsx --env-file=.env script/seed-marketing-sources.ts           # show the plan
 *   npx tsx --env-file=.env script/seed-marketing-sources.ts --commit  # write it
 *
 * Every id below was read from the live platform on 2026-09-15 — none typed
 * from memory:
 *   GA4        the four properties the cufc-aios service account can see
 *              (Analytics Admin API accountSummaries)
 *   Meta ads   GET /me/adaccounts with the system-user token
 *   Pages/IG   GET /me/accounts with the social token
 *
 * Idempotent on (platform, external_id). A re-run updates the label, workspace
 * and site; it never deletes or deactivates an account (retire one by setting
 * active = false).
 *
 * The workspace on each account is a fact about who owns it. For the CUFC ad
 * account it is only the fallback: that account also runs Mini Football, Cup and
 * Academy campaigns, and each campaign is filed by its own name.
 */
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

type Seed = { platform: string; externalId: string; label: string; workspace: string; site?: string };

const SOURCES: Seed[] = [
  // Google Analytics 4 — 30-day sessions when checked: cufc.co.nz 4,891 ·
  // CUFC Shop 356 · South Island United 4 · CIC Youth 0. The last two sites no
  // longer send Google Analytics data; they are registered so the page says so.
  { platform: "ga4", externalId: "515883325", label: "cufc.co.nz", workspace: "christchurch-united", site: "cufc.co.nz" },
  { platform: "ga4", externalId: "517773620", label: "CUFC Shop", workspace: "christchurch-united", site: "cufcshop.com" },
  { platform: "ga4", externalId: "515879416", label: "South Island United", workspace: "south-island-united", site: "southislandunited.com" },
  { platform: "ga4", externalId: "526147452", label: "CIC Youth", workspace: "christchurch-international-cup", site: "cicyouth.com" },

  // Meta ad accounts, all NZD, all Pacific/Auckland.
  { platform: "meta_ads", externalId: "act_1666479797158354", label: "Christchurch United FC ad account", workspace: "christchurch-united" },
  { platform: "meta_ads", externalId: "act_894929833225476", label: "South Island United ad account", workspace: "south-island-united" },
  { platform: "meta_ads", externalId: "act_1048454051064587", label: "United Gymnastics ad account", workspace: "united-gymnastics" },

  // Facebook pages.
  { platform: "facebook_page", externalId: "628369870533437", label: "Christchurch United FC", workspace: "christchurch-united" },
  { platform: "facebook_page", externalId: "925104854025263", label: "Christchurch United Academy", workspace: "christchurch-united" },
  { platform: "facebook_page", externalId: "862050420321303", label: "South Island United", workspace: "south-island-united" },
  { platform: "facebook_page", externalId: "394808607055485", label: "Mini Football Leagues", workspace: "mini-football-leagues" },
  { platform: "facebook_page", externalId: "1739186766319115", label: "Christchurch International Cup", workspace: "christchurch-international-cup" },
  { platform: "facebook_page", externalId: "760799280454675", label: "CIC 7's", workspace: "christchurch-international-cup" },

  // Instagram accounts.
  { platform: "instagram", externalId: "17841408330461472", label: "@christchurchunitedfc", workspace: "christchurch-united" },
  { platform: "instagram", externalId: "17841479611227352", label: "@cufc.academy", workspace: "christchurch-united" },
  { platform: "instagram", externalId: "17841477314715773", label: "@southislandunited", workspace: "south-island-united" },
  { platform: "instagram", externalId: "17841469460080448", label: "@minifootballnz", workspace: "mini-football-leagues" },
  { platform: "instagram", externalId: "17841448748238822", label: "@christchurchinternationalcup", workspace: "christchurch-international-cup" },
  { platform: "instagram", externalId: "17841476847536777", label: "@cicsummer7s", workspace: "christchurch-international-cup" },
];

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n  Marketing hub sources — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await client.query("BEGIN");
  try {
    const orgRows = (await client.query(`select id, slug from organizations`)).rows as { id: number; slug: string }[];
    const orgId = new Map(orgRows.map((o) => [o.slug, o.id]));
    let inserted = 0;
    let updated = 0;
    for (const s of SOURCES) {
      const id = orgId.get(s.workspace);
      if (!id) throw new Error(`No workspace with slug "${s.workspace}" (for ${s.label})`);
      const r = await client.query(
        `insert into marketing_sources (platform, external_id, label, organization_id, site)
         values ($1, $2, $3, $4, $5)
         on conflict (platform, external_id) do update
           set label = excluded.label, organization_id = excluded.organization_id, site = excluded.site
         returning id, (xmax = 0) as inserted`,
        [s.platform, s.externalId, s.label, id, s.site ?? null],
      );
      const row = r.rows[0];
      if (row.inserted) inserted++;
      else updated++;
      console.log(`  ${row.inserted ? "+" : "~"} #${row.id} ${s.platform.padEnd(14)} ${s.label}`);
    }
    if (COMMIT) {
      await client.query("COMMIT");
      console.log(`\n  COMMITTED — ${inserted} added, ${updated} updated.\n`);
    } else {
      await client.query("ROLLBACK");
      console.log(`\n  Dry run rolled back — would add ${inserted}, update ${updated}.\n`);
    }
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\n  ROLLED BACK — ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
