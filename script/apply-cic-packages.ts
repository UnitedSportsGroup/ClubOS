// Apply migrations/2026-11-06_cic_packages.sql and seed the extras catalogue,
// rehearsing first.
//
//   npx tsx --env-file=.env script/apply-cic-packages.ts            (dry run, rolled back)
//   npx tsx --env-file=.env script/apply-cic-packages.ts --commit
//
// Must be REFUSED: a deposit that isn't 10% · a hold longer than 14 days · a
// deposit after the hold · an instalment before the deposit · a 14th player in
// a squad of 13 · a second PAID deposit · extras on a non-player payment.
// Seed: extras are inserted ON CONFLICT DO NOTHING, so staff edits survive a re-run.
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const problems: string[] = [];
let checks = 0;
const ok = (l: string) => { checks++; console.log(`  ✓ ${l}`); };
const bad = (l: string) => { checks++; problems.push(l); console.log(`  ✗ ${l}`); };

async function refuse(c: pg.Client, label: string, sql: string, p: any[] = []) {
  await c.query("SAVEPOINT s");
  try { await c.query(sql, p); await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — ALLOWED`); }
  catch { await c.query("ROLLBACK TO SAVEPOINT s"); ok(`refused: ${label}`); }
}
async function accept(c: pg.Client, label: string, sql: string, p: any[] = []) {
  await c.query("SAVEPOINT s");
  try { const r = await c.query(sql, p); await c.query("RELEASE SAVEPOINT s"); ok(`accepted: ${label}`); return r; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT s"); bad(`${label} — REFUSED: ${e.message}`); return null; }
}

// Real prices only. `null` = not on sale until staff set a price in ClubOS.
// Sources checked 6 Nov 2026 on each operator's own site.
const EXTRAS: [string, string, string, string | null, number | null, string[], string, number][] = [
  // category, name, description, partner, price (cents), options, source, sort
  ["promo", "CIC merch pack", "CIC hoodie and CIC cap together.", "CIC Store", 9500, ["Y12", "Y14", "S", "M", "L", "XL", "2XL"],
    "CIC Store: hoodie $70 + cap $25 (shop.cicyouth.com), no discount", 10],
  ["merch", "CIC hoodie", "The 2026 CIC hoodie.", "CIC Store", 7000, ["Y12", "Y14", "S", "M", "L", "XL", "2XL"], "CIC Store price", 20],
  ["merch", "CIC cap", null as any, "CIC Store", 2500, ["Kids", "Adults"], "CIC Store price", 21],
  ["merch", "CIC keyring", null as any, "CIC Store", 1490, [], "CIC Store price", 22],
  ["merch", "CIC pin badge", null as any, "CIC Store", 600, [], "CIC Store price", 23],
  ["meal", "Extra lunch at the ground", "Victoria Foods lunch, one game day.", "Victoria Foods", 1800, [],
    "ESTIMATE until Victoria Foods quotes (same as packages page)", 30],
  ["meal", "Extra dinner", "Victoria Foods dinner, one night.", "Victoria Foods", 2800, [],
    "ESTIMATE until Victoria Foods quotes (same as packages page)", 31],
  ["experience", "International Antarctic Centre", "Snow storm room, Hägglund ride and the blue penguins.", "International Antarctic Centre", 5000, [],
    "Child price read out in the 22 Oct meeting; iceberg.co.nz lists general admission from $74 adult", 40],
  ["experience", "Orana Wildlife Park", "New Zealand's open-range zoo.", "Orana Wildlife Park", 1000, [],
    "Group child price quoted to Isaac (usual $12.50, oranawildlifepark.co.nz)", 41],
  ["experience", "Willowbank Wildlife Reserve", "Kiwi, native birds and Māori culture.", "Willowbank", 1300, [],
    "willowbank.co.nz/prices child 5–15 $13.00 (20% group discount offered, not applied)", 42],
  ["experience", "Christchurch Adventure Park chairlift", "Chairlift up the Port Hills and back.", "Christchurch Adventure Park", 2000, [],
    "christchurchadventurepark.com youth (17 and under) sightseeing $20", 43],
  ["experience", "Christchurch Tram city tour", "The heritage tram loop around the central city.", "Christchurch Attractions", 1000, [],
    "christchurchattractions.nz/tram child 5–15 $10", 44],
  ["experience", "Te Kaha stadium tour", "Behind the scenes at One New Zealand Stadium.", "One New Zealand Stadium", null, [],
    "Price not published — set it here once the stadium quotes", 45],
  ["experience", "Christchurch Gondola", "Up the Port Hills for the view.", "Christchurch Attractions", null, [],
    "Child price not published — set it here once confirmed", 46],
];

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  console.log(`\n  cic packages — ${COMMIT ? "COMMIT" : "DRY RUN (rolled back)"}\n`);
  await c.query("BEGIN");
  try {
    await c.query(readFileSync(join(process.cwd(), "migrations/2026-11-06_cic_packages.sql"), "utf8"));
    ok("migration ran");
    await c.query(readFileSync(join(process.cwd(), "migrations/2026-11-06_cic_packages.sql"), "utf8"));
    ok("migration re-runs cleanly");

    await c.query("SAVEPOINT fx");
    const ins = (over: Record<string, any> = {}) => {
      const v: Record<string, any> = {
        organization_id: 5, token: Math.random().toString(16).slice(2).padEnd(32, "0"), join_token: Math.random().toString(16).slice(2).padEnd(32, "1"),
        club_name: "Rehearsal FC", manager_name: "Test", manager_email: "t@example.com", manager_phone: "021000000",
        origin: "north", package_id: "base", age_group: "U12", players: 2, staff: 1, adults: 0,
        input: "{}", lines: "[]", total_cents: 120000, flights_cents: 20000, invoice_cents: 100000, deposit_cents: 10000,
        per_player_cents: 60000, player_share_cents: 40000, per_adult_cents: 0,
        terms_accepted_at: "now()", expires_at: "now() + interval '14 days'", ...over,
      };
      const cols = Object.keys(v);
      const vals = cols.map((k, i) => (String(v[k]).startsWith("now()") ? String(v[k]) : `$${i + 1}`));
      const params = cols.map((k) => v[k]).filter((x) => !String(x).startsWith("now()"));
      // renumber placeholders
      let n = 0; const sqlVals = vals.map((x) => (x.startsWith("$") ? `$${++n}` : x));
      return [`INSERT INTO cic_pkg_bookings (${cols.join(",")}) VALUES (${sqlVals.join(",")}) RETURNING id`, params] as const;
    };
    await refuse(c, "a deposit that isn't 10% of the invoice", ...ins({ deposit_cents: 9999 }));
    await refuse(c, "invoice + flights not adding up to the total", ...ins({ flights_cents: 1 }));
    await refuse(c, "a hold longer than 14 days", ...ins({ expires_at: "now() + interval '20 days'" }));
    const b = await accept(c, "a valid booking", ...ins());
    const id = b?.rows[0].id;
    const lapsed = await accept(c, "a booking whose hold has lapsed", ...ins({ expires_at: "now() - interval '1 day'" }));
    await refuse(c, "an instalment before the deposit", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents) VALUES ($1,'instalment',5000)`, [id]);
    await refuse(c, "a deposit of the wrong amount", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents) VALUES ($1,'deposit',5000)`, [id]);
    await refuse(c, "a deposit after the hold lapsed", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents) VALUES ($1,'deposit',10000)`, [lapsed?.rows[0].id]);
    await refuse(c, "extras on a deposit", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, extras_cents) VALUES ($1,'deposit',10000,500)`, [id]);
    await accept(c, "the deposit", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, paid_at, stripe_payment_intent_id) VALUES ($1,'deposit',10000,now(),'pi_rehearsal_1')`, [id]);
    await refuse(c, "a second PAID deposit", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents, paid_at, stripe_payment_intent_id) VALUES ($1,'deposit',10000,now(),'pi_rehearsal_2')`, [id]);
    await c.query(`UPDATE cic_pkg_bookings SET deposit_paid_at=now() WHERE id=$1`, [id]);
    await accept(c, "an instalment after the deposit", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents) VALUES ($1,'instalment',30000)`, [id]);
    const pl = `INSERT INTO cic_pkg_players (booking_id, token, first_name, last_name, guardian_name, guardian_email, guardian_phone) VALUES ($1, md5(random()::text), 'A','B','C','c@example.com','021') RETURNING id`;
    const p1 = await accept(c, "player 1 of 2", pl, [id]);
    await accept(c, "player 2 of 2", pl, [id]);
    await refuse(c, "a 3rd player in a squad of 2", pl, [id]);
    await refuse(c, "a player payment without a player", `INSERT INTO cic_pkg_payments (booking_id, kind, amount_cents) VALUES ($1,'player',100)`, [id]);
    await accept(c, "a player share + extras", `INSERT INTO cic_pkg_payments (booking_id, kind, player_id, amount_cents, extras_cents) VALUES ($1,'player',$2,40000,9500)`, [id, p1?.rows[0].id]);
    await refuse(c, "a player from another booking", `INSERT INTO cic_pkg_payments (booking_id, kind, player_id, amount_cents) VALUES ($1,'player',$2,100)`, [lapsed?.rows[0].id, p1?.rows[0].id]);
    await c.query("ROLLBACK TO SAVEPOINT fx");
    ok("fixtures discarded");

    let seeded = 0;
    for (const [category, name, description, partner, price, options, source, sort] of EXTRAS) {
      const r = await c.query(
        `INSERT INTO cic_pkg_extras (organization_id, category, name, description, partner, price_cents, options, source_note, sort)
         VALUES (5,$1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id, name) DO NOTHING`,
        [category, name, description ?? null, partner, price, options, source, sort]);
      seeded += r.rowCount ?? 0;
    }
    ok(`extras seeded: ${seeded} new of ${EXTRAS.length}`);
    const rls = await c.query(`SELECT relname FROM pg_class WHERE relname LIKE 'cic_pkg_%' AND relkind='r' AND NOT relrowsecurity`);
    rls.rowCount ? bad(`RLS off on ${rls.rows.map((r) => r.relname).join(", ")}`) : ok("RLS on all four tables");

    if (problems.length) throw new Error(`${problems.length} check(s) failed`);
    if (COMMIT) { await c.query("COMMIT"); console.log(`\n  COMMITTED — ${checks} checks passed\n`); }
    else { await c.query("ROLLBACK"); console.log(`\n  DRY RUN OK — ${checks} checks passed, nothing kept\n`); }
  } catch (e: any) {
    await c.query("ROLLBACK").catch(() => {});
    console.error(`\n  ROLLED BACK: ${e.message}\n`);
    process.exitCode = 1;
  } finally { await c.end(); }
}
main();
