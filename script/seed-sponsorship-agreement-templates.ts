/**
 * Seed the Sponsorship Agreement e-Sign templates (South Island United and
 * Christchurch United) into the United Sports Group workspace.
 *
 *   npx tsx --env-file=.env script/seed-sponsorship-agreement-templates.ts            # dry run
 *   npx tsx --env-file=.env script/seed-sponsorship-agreement-templates.ts --commit   # write
 *   … --commit --replace   # overwrite a template that already exists (discards edits made in the builder)
 *
 * The wording and where it came from: shared/sponsorship-agreement-template.ts.
 * Every template passes through cleanTemplate() — the same decider the builder
 * and the send path use — and is refused if it reports a problem.
 */
import pg from "pg";
import { cleanTemplate } from "../shared/esign-template";
import { contractVariablesFor, cleanProposal } from "../shared/sponsor-proposals";
import { sponsorshipAgreementTemplate } from "../shared/sponsorship-agreement-template";

const COMMIT = process.argv.includes("--commit");
const REPLACE = process.argv.includes("--replace");

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n  Sponsorship Agreement templates — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);
  const org = (await client.query(`select id from organizations where slug = 'united-sports-group'`)).rows[0]?.id;
  if (!org) throw new Error("no united-sports-group organisation");
  let failed = false;
  await client.query("BEGIN");
  try {
    for (const brand of ["siu", "cufc"] as const) {
      const raw = sponsorshipAgreementTemplate(brand);
      const { template, problems } = cleanTemplate(raw, { brandKey: raw.brandKey });
      if (problems.length) { failed = true; console.log(`  ✗ ${raw.name}:`); for (const p of problems) console.log(`      - ${p}`); continue; }
      // Every variable a proposal fills must exist on the template, and the other way round.
      const fills = Object.keys(contractVariablesFor(cleanProposal({ brand })));
      const keys = template.variables.map((v) => v.key);
      const missing = fills.filter((k) => !keys.includes(k));
      const unfilled = keys.filter((k) => !fills.includes(k));
      if (missing.length || unfilled.length) { failed = true; console.log(`  ✗ ${raw.name}: proposal and template disagree — missing ${missing.join(", ") || "none"}, unfilled ${unfilled.join(", ") || "none"}`); continue; }
      const sections = template.content.sections.length;
      const existing = (await client.query(`select id from esign_templates where organization_id = $1 and slug = $2 and active = true`, [org, raw.slug])).rows[0];
      if (existing && !REPLACE) { console.log(`  · ${raw.name}: already there (#${existing.id}), left alone. --replace overwrites it.`); continue; }
      const values = [template.name, template.description, JSON.stringify(template.brand), JSON.stringify(template.content), JSON.stringify(template.variables), JSON.stringify(template.form), JSON.stringify(template.settings)];
      if (existing) {
        await client.query(`update esign_templates set name=$2, description=$3, brand=$4::jsonb, content=$5::jsonb, variables=$6::jsonb, form=$7::jsonb, settings=$8::jsonb where id=$1`, [existing.id, ...values]);
        console.log(`  ✓ ${raw.name}: replaced #${existing.id} (${sections} sections, ${keys.length} details to set)`);
      } else {
        const made = await client.query(
          `insert into esign_templates (organization_id, slug, name, description, brand, content, variables, form, settings, active)
           values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, true) returning id`, [org, raw.slug, ...values]);
        console.log(`  ✓ ${raw.name}: created #${made.rows[0].id} (${sections} sections, ${keys.length} details to set, published)`);
      }
    }
    if (failed) throw new Error("a template was refused");
    if (COMMIT) { await client.query("COMMIT"); console.log("\n  ✅ Written.\n"); }
    else { await client.query("ROLLBACK"); console.log("\n  ✅ Dry run: nothing was written.\n"); }
  } catch (e: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`\n  ❌ ${e.message}\n`);
    process.exitCode = 1;
  } finally { await client.end(); }
}
main();
