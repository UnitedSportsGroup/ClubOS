// A working captain account with a team to play with.
//
//   npx tsx --env-file=.env script/seed-captain-demo.ts            (dry run)
//   npx tsx --env-file=.env script/seed-captain-demo.ts --commit
//   npx tsx --env-file=.env script/seed-captain-demo.ts --commit --remove
//
// Daniel, 2026-09-17: "give me a login on here with a test team."
//
// 🔴 IT IS ON THE **PREVIEW** COMPETITION (`preview-ethnic-cup`), NOT the live
// one, for two reasons:
//
//   1. The live Ethnic Cup board already carries two REAL entries — She Was
//      Only XI and Matakanui Rangers. A demo team sitting between them is how
//      somebody counts it in an entry tally or chases a captain who does not
//      exist.
//   2. The preview competition already has three fill-ins in its pool, so the
//      marketplace and the invite flow are actually testable. On the live Cup
//      the pool is empty and the drawer would show nothing.
//
// It carries the same brand, the same $800 fee and the same code paths, so
// everything behaves exactly as the real thing.
//
// 🔴 The squad is seeded in FOUR different states on purpose — paid, opened but
// not paid, never opened, and can't play — because a dashboard with an empty
// squad demonstrates none of what it is for.
//
// Idempotent: re-running resets the team to this exact state.
import pg from "pg";
import crypto from "crypto";

const COMMIT = process.argv.includes("--commit");
const REMOVE = process.argv.includes("--remove");

const EMAIL = "danielmeyn963@gmail.com";
const PASSWORD = "Growth2020!";
const NAME = "Daniel Meyn";
const COMP_SLUG = "preview-ethnic-cup";
const TEAM = "Daniel's Test Team";
const SQUAD_SIZE = 14;

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const hashPassword = (plain: string) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `s1$${salt}$${crypto.scryptSync(plain, salt, 64, SCRYPT).toString("hex")}`;
};
const token = () => crypto.randomBytes(16).toString("hex");

/**
 * 🔴 The password is set HERE rather than through the API, because
 * "Growth2020!" is ELEVEN characters and the endpoint enforces a floor of
 * twelve (reference/app-baseline-standard.md §1 — length is the only
 * composition rule that matters).
 *
 * That is a deliberate, flagged exception for a test account Daniel asked for
 * by name, and it has one real consequence worth knowing: if he ever uses
 * "forgotten your password" he will NOT be able to set this same password
 * again — the endpoint will refuse it. Any 12-character password will work.
 *
 * The floor is not being lowered. One account, set by hand, with the reason
 * written down.
 */
const PASSWORD_IS_SHORT = PASSWORD.length < 12;

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.log(`\n  Captain demo — ${REMOVE ? "REMOVE" : COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await db.query("BEGIN");

  try {
    if (REMOVE) {
      const e = await db.query(`delete from teampay_entries where team_name = $1`, [TEAM]);
      await db.query(`delete from teampay_captain_auth_events where lower(email) = $1`, [EMAIL]);
      const c = await db.query(`delete from teampay_captains where lower(email) = $1`, [EMAIL]);
      console.log(`  removed ${e.rowCount} team(s) and ${c.rowCount} captain account(s)\n`);
      await db.query(COMMIT ? "COMMIT" : "ROLLBACK");
      await db.end();
      return;
    }

    const [comp] = (await db.query(
      `select id, organization_id, fee_cents from teampay_competitions where slug = $1`, [COMP_SLUG])).rows;
    if (!comp) throw new Error(`no competition '${COMP_SLUG}'`);

    // ── the account ────────────────────────────────────────────────────────
    await db.query(
      `insert into teampay_captains (email, password_hash, name)
       values ($1, $2, $3)
       on conflict (lower(email)) do update
         set password_hash = excluded.password_hash, name = excluded.name, updated_at = now()`,
      [EMAIL, hashPassword(PASSWORD), NAME]);
    const [cap] = (await db.query(
      `select id from teampay_captains where lower(email) = $1`, [EMAIL])).rows;
    console.log(`  captain #${cap.id}  ${EMAIL}`);

    // 🔴 Any session already issued to this account is revoked, because the
    // password just changed. Re-running this script must not leave an older
    // browser signed in on a credential that no longer exists.
    await db.query(
      `update teampay_captain_sessions set revoked_at = now()
        where captain_id = $1 and revoked_at is null`, [cap.id]);

    // ── the team ───────────────────────────────────────────────────────────
    // Replaced wholesale so a re-run is a reset, not an accumulation.
    await db.query(`delete from teampay_entries where team_name = $1`, [TEAM]);
    const organiserToken = token();
    const [entry] = (await db.query(
      `insert into teampay_entries
         (competition_id, organization_id, team_name, community, manager_name, manager_email,
          manager_phone, squad_size, fee_cents, organiser_token, payment_mode)
       values ($1,$2,$3,'Testing',$4,$5,'021 321 171',$6,$7,$8,'split')
       returning id, organiser_token`,
      [comp.id, comp.organization_id, TEAM, NAME, EMAIL, SQUAD_SIZE, comp.fee_cents, organiserToken])).rows;

    const share = Math.ceil(comp.fee_cents / SQUAD_SIZE);

    /**
     * Four states, so the board actually shows what it is for:
     *   paid          — a green row, and money in the progress bar
     *   opened        — the one worth nudging, and the reason "opened" exists
     *   invited       — never touched their link
     *   declined      — can't play, and does not count towards the squad
     */
    const squad: Array<[string, string | null, string | null, "paid" | "opened" | "invited" | "declined"]> = [
      ["Isaac Living",   "isaac@example.invalid",  "021 111 1111", "paid"],
      ["Travis Graham",  "travis@example.invalid", "021 222 2222", "opened"],
      ["Ryan Edwards",   "ryan@example.invalid",   null,           "invited"],
      ["Zach Bennett",   null,                     "021 444 4444", "invited"],
      ["Olga Streletsky","olga@example.invalid",   "021 555 5555", "declined"],
    ];

    for (const [name, email, phone, state] of squad) {
      const now = new Date();
      await db.query(
        `insert into teampay_players
           (entry_id, name, email, phone, invite_token, source,
            first_opened_at, last_opened_at, open_count,
            paid_at, paid_cents, declined_at)
         values ($1,$2,$3,$4,$5,'manager',
                 $6,$6,$7,
                 $8,$9,$10)`,
        [
          entry.id, name, email, phone, token(),
          state === "paid" || state === "opened" ? now : null,
          state === "paid" || state === "opened" ? 1 : 0,
          // 🔴 paid_at and paid_cents move together — the table refuses one
          // without the other, because "Paid — $0.00" is worse than no row.
          state === "paid" ? now : null,
          state === "paid" ? share : null,
          state === "declined" ? now : null,
        ]);
    }

    const counts = (await db.query(
      `select count(*)::int total, count(paid_at)::int paid,
              coalesce(sum(paid_cents),0)::int cents
         from teampay_players where entry_id = $1`, [entry.id])).rows[0];

    console.log(`  team #${entry.id}   "${TEAM}" on ${COMP_SLUG}`);
    console.log(`  squad        ${counts.total} players · ${counts.paid} paid · $${(counts.cents / 100).toFixed(2)} of $${(comp.fee_cents / 100).toFixed(2)}`);
    console.log(`  share        $${(share / 100).toFixed(2)} each across ${SQUAD_SIZE}`);
    console.log(`\n  Sign in:     https://app.usg.co.nz/captain`);
    console.log(`  Email:       ${EMAIL}`);
    console.log(`  Password:    ${PASSWORD}`);
    console.log(`  Direct link: https://app.usg.co.nz/team/${entry.organiser_token}`);

    if (PASSWORD_IS_SHORT) {
      console.log(
        `\n  ⚠️  "${PASSWORD}" is ${PASSWORD.length} characters and the sign-in floor is 12.\n` +
        `      Set here by hand on purpose. "Forgotten your password" will REFUSE\n` +
        `      to set this same password again — use 12+ characters if you reset it.`);
    }

    await db.query(COMMIT ? "COMMIT" : "ROLLBACK");
    console.log(COMMIT ? "\n  COMMITTED\n" : "\n  rolled back — re-run with --commit\n");
  } catch (e: any) {
    await db.query("ROLLBACK");
    console.error(`\n  ✗ ${e.message}\n`);
    await db.end();
    process.exit(1);
  }
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
