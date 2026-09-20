// Create (or repair) a full-access ClubOS staff account.
//
// Daniel, 2026-09-20: "let's get slava finally set up on ClubOS mobile app for
// his ipad, iphone and web app access, create a login with full access for him
// on his email slava.meyn.888@gmail.com."
//
//   npx tsx --env-file=.env script/create-super-admin.ts <email> "<First>" "<Last>" '<password>'
//   … --commit        to actually write it
//
// 🔴 FULL ACCESS MEANS SUPER ADMIN, and super admin is not "every tab" — it is
// EVERY CHECK BYPASSED. That includes the tabs deliberately kept off every
// other staff account: Coding Budget (eleven roles named against a salary),
// Cashflow, Invoices, Payouts, Vehicles (licence numbers and a home address),
// Accommodation (tenants' arrears), Fines, and the club dossier. Appropriate
// for the club's president; never a default.
//
// 🔴 It mirrors Daniel's own shape exactly: role `super_admin` on the user AND
// a membership per workspace, tabs NULL. The role alone short-circuits the
// permission checks, but the workspace switcher lists MEMBERSHIPS — without
// them he would sign in to an app with nothing in it.
//
// 🔴 The password is bcrypt, matching every other staff login ($2b$, 60 chars).
// There is no authenticated change-password route in ClubOS, so "he can change
// it later" means Forgot password on the sign-in page, which emails him a
// reset link. Say that to him rather than implying a settings screen.
//
// 🔴 Idempotent and non-destructive. An existing account is never downgraded
// and its password is never silently reset — re-running tops up missing
// workspace memberships and reports the rest.
import pg from "pg";
import bcrypt from "bcryptjs";

const args = process.argv.slice(2).filter((a) => a !== "--commit");
const COMMIT = process.argv.includes("--commit");
const [EMAIL, FIRST, LAST, PASSWORD] = args;

if (!EMAIL || !FIRST || !LAST || !PASSWORD) {
  console.error(`\n  usage: script/create-super-admin.ts <email> "<First>" "<Last>" '<password>' [--commit]\n`);
  process.exit(1);
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`\n  Full-access account for ${EMAIL} — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    const { rows: existing } = await c.query(
      `select id, email, role, active from users where lower(email) = lower($1)`, [EMAIL]);

    let userId: number;
    if (existing.length) {
      userId = existing[0].id;
      console.log(`  account already exists — user #${userId}, role '${existing[0].role}', active ${existing[0].active}`);
      // Never silently reset a password somebody may already be using.
      await c.query(`update users set role='super_admin', active=true where id=$1`, [userId]);
      console.log(`  role raised to super_admin, account activated (password left ALONE)`);
    } else {
      const hash = await bcrypt.hash(PASSWORD, 10);
      const { rows } = await c.query(
        `insert into users (email, first_name, last_name, password, role, active)
         values ($1,$2,$3,$4,'super_admin',true) returning id`,
        [EMAIL, FIRST, LAST, hash]);
      userId = rows[0].id;
      console.log(`  created user #${userId} — ${FIRST} ${LAST}, role super_admin`);
    }

    const { rows: orgs } = await c.query(`select id, slug from organizations order by id`);
    let added = 0, already = 0;
    for (const o of orgs) {
      const ins = await c.query(
        `insert into user_organizations (user_id, organization_id, role, tabs)
         values ($1,$2,'super_admin',NULL)
         on conflict do nothing returning user_id`, [userId, o.id]);
      if (ins.rowCount) { added++; console.log(`    + ${o.slug}`); } else already++;
    }
    console.log(`\n  workspaces: ${added} added, ${already} already there (${orgs.length} total)`);

    // Prove it reads back the way a sign-in will see it.
    const { rows: check } = await c.query(`
      select u.role,
             (select count(*)::int from user_organizations where user_id=u.id) as memberships,
             left(u.password,4) as scheme
        from users u where u.id=$1`, [userId]);
    console.log(`  reads back: role ${check[0].role} · ${check[0].memberships} memberships · password ${check[0].scheme}…`);
    const good = check[0].role === "super_admin" && check[0].memberships === orgs.length && check[0].scheme === "$2b$";
    if (!good) throw new Error("account did not read back as full access");

    if (COMMIT) { await c.query("COMMIT"); console.log(`\n  COMMITTED.\n`); }
    else { await c.query("ROLLBACK"); console.log(`\n  Rolled back — re-run with --commit.\n`); }
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED:", e.message, "\n");
    process.exit(1);
  } finally {
    await c.end();
  }
}
main();
