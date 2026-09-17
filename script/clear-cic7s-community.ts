// Clear the grade that the CIC 7's bridge used to write into `community`.
//
//   npx tsx --env-file=.env script/clear-cic7s-community.ts            (dry run)
//   npx tsx --env-file=.env script/clear-cic7s-community.ts --commit
//
// Until 2026-09-17 the interest→entry bridge put the tournament grade ("Open" /
// "Social") into teampay_entries.community, which is the slot meaning "the
// community this team represents". That made 7's teams read as "Matakanui
// Rangers (Social)" on the player page, the fill-in ask, the captain view and
// the staff board — and the grade is already implied by which competition the
// team is in.
//
// 🔴 Deliberately narrow. It only clears a value that is EXACTLY a grade name,
// and only on a competition that does not collect a community
// (collectsCommunity() — i.e. never the Ethnic Cup). A community a human typed
// is never touched, whatever it says.
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
/** The only values the bridge could have written. */
const GRADE_WORDS = ["Open", "Social", "Mens", "Masters"];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  Clear bridge-written community — ${COMMIT ? "COMMIT" : "DRY RUN"}\n`);

  const targets = (await c.query(
    `select e.id, e.team_name, e.community, c.slug, c.brand
       from teampay_entries e
       join teampay_competitions c on c.id = e.competition_id
      where c.brand <> 'ethniccup'
        and e.community = any($1::text[])
      order by e.id`, [GRADE_WORDS])).rows;

  if (!targets.length) {
    console.log("  Nothing to clear — no entry carries a grade in its community field.\n");
    await c.end();
    return;
  }
  for (const t of targets) {
    console.log(`  #${t.id}  ${t.team_name}  (${t.slug})  community "${t.community}" → null`);
  }

  // Anything NOT being touched, so the narrowness is visible rather than assumed.
  const kept = (await c.query(
    `select e.id, e.team_name, e.community, c.brand
       from teampay_entries e join teampay_competitions c on c.id = e.competition_id
      where e.community is not null and not (c.brand <> 'ethniccup' and e.community = any($1::text[]))
      order by e.id`, [GRADE_WORDS])).rows;
  if (kept.length) {
    console.log(`\n  Leaving ${kept.length} community value(s) alone:`);
    for (const k of kept) console.log(`    #${k.id}  ${k.team_name}  (${k.brand})  "${k.community}"`);
  }

  if (!COMMIT) {
    console.log(`\n  Dry run — re-run with --commit to apply.\n`);
    await c.end();
    return;
  }

  const res = await c.query(
    `update teampay_entries e
        set community = null, updated_at = now()
       from teampay_competitions c
      where c.id = e.competition_id
        and c.brand <> 'ethniccup'
        and e.community = any($1::text[])
      returning e.id`, [GRADE_WORDS]);
  console.log(`\n  Cleared ${res.rowCount} row(s).`);

  const left = (await c.query(
    `select count(*)::int as n from teampay_entries e join teampay_competitions c on c.id = e.competition_id
      where c.brand <> 'ethniccup' and e.community = any($1::text[])`, [GRADE_WORDS])).rows[0].n;
  console.log(left === 0 ? "  ✓ confirmed by read-back\n" : `  ✗ ${left} still set — check by hand\n`);
  await c.end();
  process.exit(left === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
