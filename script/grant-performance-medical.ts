// Let ONE named person read and write clinical notes in SIU Performance.
//
//   npx tsx --env-file=.env script/grant-performance-medical.ts --list
//   npx tsx --env-file=.env script/grant-performance-medical.ts <email>             (dry run)
//   npx tsx --env-file=.env script/grant-performance-medical.ts <email> --commit
//   npx tsx --env-file=.env script/grant-performance-medical.ts <email> --revoke --commit
//
// 🔴 Daniel, 2026-11-14: injury notes are for "medical staff only". This grant is
//    SEPARATE from the Performance tab and there is NO super-admin bypass — a
//    super admin sees clinical notes only if they hold this grant themselves.
// 🔴 The person must already hold the Performance tab in South Island United.
import pg from "pg";
import { PERFORMANCE_MEDICAL_GRANT, PERFORMANCE_TAB, SIU_ORG_SLUG } from "../shared/performance";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const REVOKE = args.includes("--revoke");
const email = args.find((a) => !a.startsWith("--"))?.toLowerCase();

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    if (args.includes("--list") || !email) {
      const { rows } = await c.query(`
        select u.email, trim(u.first_name || ' ' || coalesce(u.last_name,'')) name
        from user_organizations uo join users u on u.id = uo.user_id join organizations o on o.id = uo.organization_id
        where o.slug = $1 and uo.unlocked_tabs ? $2 order by 2`, [SIU_ORG_SLUG, PERFORMANCE_MEDICAL_GRANT]);
      console.log(rows.length ? rows.map((r) => `  ${r.name} <${r.email}>`).join("\n") : "  Nobody holds the medical grant.");
      return;
    }
    const { rows: [m] } = await c.query(`
      select uo.id, coalesce(uo.unlocked_tabs, '[]'::jsonb) tabs, u.role
      from user_organizations uo join users u on u.id = uo.user_id join organizations o on o.id = uo.organization_id
      where lower(u.email) = $1 and o.slug = $2`, [email, SIU_ORG_SLUG]);
    if (!m) throw new Error(`${email} has no South Island United membership. Add them in Team first.`);
    const tabs: string[] = m.tabs;
    if (!REVOKE && !tabs.includes(PERFORMANCE_TAB) && m.role !== "super_admin") throw new Error(`${email} does not hold the Performance tab. Grant that first (script/grant-unlocked-tab.ts).`);
    const next = REVOKE ? tabs.filter((t) => t !== PERFORMANCE_MEDICAL_GRANT) : Array.from(new Set([...tabs, PERFORMANCE_MEDICAL_GRANT]));
    console.log(`  ${email}: ${JSON.stringify(tabs)} → ${JSON.stringify(next)}`);
    if (COMMIT) {
      await c.query(`update user_organizations set unlocked_tabs = $1::jsonb where id = $2`, [JSON.stringify(next), m.id]);
      console.log("  ✓ committed — takes effect on their next request.");
    } else console.log("  dry run — add --commit");
  } finally { await c.end(); }
}
main().catch((e) => { console.error("  ✗", e.message); process.exit(1); });
