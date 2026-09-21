// Neutralise leftover verify-script accounts on production.
//
//   npx tsx --env-file=.env script/retire-probe-accounts.ts            (dry run)
//   npx tsx --env-file=.env script/retire-probe-accounts.ts --commit
//
// Found 2026-09-21 while granting Zach scoped refund rights: 26 accounts on
// `@example.com` left behind by verify scripts since 13 August — 7 still
// active, 11 able to ISSUE REFUNDS against real Stripe payments, and 2 holding
// super_admin.
//
// 🔴 `@example.com` is reserved by RFC 2606 and can never be a real person, so
// this cannot touch a human being. That is the whole reason it is safe to run.
//
// 🔴 DEACTIVATE AND REVOKE, NEVER DELETE. These ids are referenced by
// `served_by_user_id`, `refunded_by`, `view_as_events` and others, several of
// them ON DELETE RESTRICT — and "who did this" is load-bearing in this
// codebase. A deactivated account cannot sign in; a deleted one takes an audit
// trail with it.
//
// Reversible: set active=true on the row to undo.
import pg from "pg";

const COMMIT = process.argv.includes("--commit");

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(`
      select id, email, role, active, can_issue_refunds, created_at::date::text made
        from users where email like '%@example.com' order by id`);
    if (!rows.length) { console.log("\n  Nothing to retire.\n"); return; }

    const live = rows.filter((r) => r.active || r.can_issue_refunds || r.role === "super_admin");
    console.log(`\n  ${rows.length} probe account(s); ${live.length} still carrying something:\n`);
    for (const r of live) {
      const flags = [r.active && "active", r.can_issue_refunds && "CAN REFUND", r.role === "super_admin" && "SUPER ADMIN"]
        .filter(Boolean).join(" · ");
      console.log(`    #${String(r.id).padEnd(4)} ${r.email.padEnd(36)} ${r.made}  ${flags}`);
    }
    if (!live.length) { console.log("  All already neutral.\n"); return; }

    if (!COMMIT) { console.log(`\n  Dry run — re-run with --commit.\n`); return; }

    // Demote to the least-privileged role rather than leaving super_admin on a
    // row somebody might reactivate by hand later.
    const { rowCount } = await c.query(`
      update users
         set active = false,
             can_issue_refunds = false,
             role = case when role = 'super_admin' then 'coach' else role end
       where email like '%@example.com'
         and (active or can_issue_refunds or role = 'super_admin')`);
    const { rows: after } = await c.query(`
      select count(*) filter (where active)::int active,
             count(*) filter (where can_issue_refunds)::int refunds,
             count(*) filter (where role='super_admin')::int supers
        from users where email like '%@example.com'`);
    console.log(`\n  ${rowCount} updated. Now: ${after[0].active} active, ${after[0].refunds} with refunds, ${after[0].supers} super admins.`);
    console.log(`  Nothing deleted — every audit reference is intact.\n`);
  } finally { await c.end(); }
}
main();
