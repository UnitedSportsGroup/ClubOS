// The Ethnic Cup became NINE a side at $500. Re-price it.
//
//   npx tsx --env-file=.env script/reprice-ethnic-cup.ts            (dry run)
//   npx tsx --env-file=.env script/reprice-ethnic-cup.ts --commit
//
// Isaac Living, 17 Sep 2026 20:22: "Ryan's happy with it so I think let's go
// 9aside and $500 if that works for you."  Daniel, 21:33: "Yes, sounds like a
// plan." Ryan Edwards (GM) had already signed it off. It was 11-a-side at $800.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 WHY THE ENTRIES NEED TOUCHING AT ALL, AND WHY THAT IS DANGEROUS
//
// `teampay_entries.fee_cents` is COPIED from the competition when a team
// enters, precisely so that changing the Cup's fee next week cannot silently
// re-price a squad that is halfway through paying. That is the right default
// and it is why this script exists rather than one UPDATE on the competition:
// the two teams already entered would otherwise still owe $800 for a
// tournament that now costs $500, and nobody would notice until a captain
// queried their bill.
//
// So this deliberately reaches into live entries — and therefore refuses, hard,
// to touch any entry where money has already moved:
//
//   · a player has paid a share      → refuse
//   · the manager has paid the fee   → refuse
//   · the entry is already paid up   → refuse
//
// Re-pricing after a payment is the one thing the whole system is built to
// prevent: the first payer bought their seat at a different price from the
// last, and no amount of arithmetic afterwards makes that fair. An entry that
// has taken money is listed for a HUMAN to decide about — a partial refund is a
// commercial conversation, not a migration.
// ─────────────────────────────────────────────────────────────────────────────
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const SLUG = "ethnic-cup-2026";

const NEW_FEE_CENTS = 50_000;   // $500 per team

/**
 * ⚠️ NOBODY SPECIFIED A SQUAD SIZE. The chat says "9aside and $500" and nothing
 * else — no pitch size, no match length, no squad number.
 *
 * 14 is nine on the pitch plus five, which leaves room across a two-day
 * tournament and makes the share $35.72. It is only a DEFAULT: every captain
 * picks their own on the entry form, and it is editable per team until somebody
 * pays. Too small would be worse than too big — the roster capacity trigger
 * would refuse the extra player — which is the other reason it is not 12.
 *
 * Change it here, or per competition in ClubOS, the moment a real number exists.
 */
const NEW_SQUAD_SIZE = 14;

/**
 * 🔴 The venue caveat is GONE from this blurb, and it was wrong from the start.
 * Daniel, 2026-09-19: "it was always United Sports Centre, our facility, our
 * ONLY facility." The "still being confirmed" line was an unchecked flag
 * inherited from the site's first build and repeated here; the club has one
 * ground and the Cup was always going to be on it.
 */
const NEW_BLURB =
  "A nine-a-side tournament for teams representing Christchurch's communities, played at " +
  "United Sports Centre, 466 Yaldhurst Road. Room for eight teams. Pay the $500 team fee " +
  "yourself, or split it across your squad so every player pays their own share on their " +
  "own card — you choose, and you can change your mind until it is paid.";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  console.log(`\n  Ethnic Cup → nine a side, ${money(NEW_FEE_CENTS)} — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await db.query("BEGIN");

  const refused: string[] = [];

  try {
    const [comp] = (await db.query(
      `select id, fee_cents, default_squad_size from teampay_competitions where slug = $1`, [SLUG])).rows;
    if (!comp) throw new Error(`no competition '${SLUG}'`);

    console.log(`  competition   ${money(comp.fee_cents)} / squad ${comp.default_squad_size}` +
                `  →  ${money(NEW_FEE_CENTS)} / squad ${NEW_SQUAD_SIZE}`);
    await db.query(
      `update teampay_competitions
          set fee_cents = $2, default_squad_size = $3, blurb = $4, updated_at = now()
        where id = $1`,
      [comp.id, NEW_FEE_CENTS, NEW_SQUAD_SIZE, NEW_BLURB]);

    // ── the entries already taken ──────────────────────────────────────────
    const entries = (await db.query(
      `select e.id, e.team_name, e.manager_name, e.manager_email, e.fee_cents,
              e.squad_size, e.payment_mode, e.paid_up_at, e.team_paid_cents,
              coalesce(sum(p.paid_cents), 0)::int as players_paid,
              count(p.paid_at)::int              as paid_count
         from teampay_entries e
         left join teampay_players p on p.entry_id = e.id
        where e.competition_id = $1
        group by e.id
        order by e.id`, [comp.id])).rows;

    console.log(`\n  ${entries.length} entr${entries.length === 1 ? "y" : "ies"} on this competition:\n`);

    for (const e of entries) {
      const taken = Number(e.players_paid) + Number(e.team_paid_cents ?? 0);
      const label = `#${e.id} ${e.team_name} (${e.manager_name})`;

      if (taken > 0 || e.paid_up_at) {
        // 🔴 Money has moved. Not ours to re-price.
        refused.push(`${label} — ${money(taken)} already taken from ${e.paid_count} payer(s)`);
        console.log(`  ✋ ${label}`);
        console.log(`      ${money(taken)} already paid — LEFT AT ${money(e.fee_cents)}. A human decides this one.`);
        continue;
      }

      if (e.fee_cents === NEW_FEE_CENTS) {
        console.log(`  ·  ${label} — already ${money(NEW_FEE_CENTS)}, nothing to do`);
        continue;
      }

      const oldShare = Math.ceil(e.fee_cents / e.squad_size);
      const newShare = Math.ceil(NEW_FEE_CENTS / e.squad_size);
      await db.query(
        `update teampay_entries set fee_cents = $2, updated_at = now() where id = $1`,
        [e.id, NEW_FEE_CENTS]);
      await db.query(
        `insert into teampay_events (entry_id, kind, actor, detail)
         values ($1, 'fee_changed', 'system', $2)`,
        [e.id, JSON.stringify({ from: e.fee_cents, to: NEW_FEE_CENTS, reason: "9-a-side repricing, 2026-09-17" })]);

      console.log(`  ✓  ${label}`);
      console.log(`      ${money(e.fee_cents)} → ${money(NEW_FEE_CENTS)}` +
                  (e.payment_mode === "whole"
                    ? `   (manager pays the lot)`
                    : `   share ${money(oldShare)} → ${money(newShare)} across ${e.squad_size}`));
    }

    if (refused.length) {
      console.log(`\n  ⚠️  ${refused.length} entr${refused.length === 1 ? "y" : "ies"} NOT re-priced because money has moved:`);
      for (const r of refused) console.log(`      · ${r}`);
      console.log(`      Re-pricing a squad after somebody has paid means the first payer`);
      console.log(`      bought the same seat at a different price. Refund or top-up is a`);
      console.log(`      conversation, not a migration.`);
    }

    // Nobody is emailed by this script. The two captains affected have not paid
    // a cent and their price has gone DOWN, but telling a real customer is
    // Daniel and Isaac's call and they are already mid-comms.
    console.log(`\n  ✉️  No captain has been emailed. ${entries.length - refused.length} team(s) will simply see the new price.`);

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
