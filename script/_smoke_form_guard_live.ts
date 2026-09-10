/* One bot-shaped submission against LIVE production, to prove the guard runs
 * there and not just in a test. Deletes everything it creates.
 *   npx tsx --env-file=.env script/_smoke_form_guard_live.ts
 */
import { Client } from "pg";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// A real, currently-registerable MFL slug + a real division id, so the request
// gets past validation and actually reaches the guard.
const prog = await c.query(`SELECT slug, league_competition_id FROM programs
                            WHERE league_competition_id IS NOT NULL AND is_active = true
                            ORDER BY id DESC LIMIT 1`);
if (!prog.rows.length) { console.log("no live league programme to probe against — skipping"); process.exit(0); }
const { slug, league_competition_id } = prog.rows[0];
const div = await c.query(`SELECT id FROM league_divisions WHERE competition_id = $1 LIMIT 1`, [league_competition_id]);
if (!div.rows.length) { console.log("no division — skipping"); process.exit(0); }

const email = `guardsmoke-${Date.now()}@example.invalid`;
const before = await c.query(`SELECT count(*)::int n FROM public_form_submissions`);

const r = await fetch("https://app.usg.co.nz/api/public/league/waitlist", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    // The 9 Sept bot shape: random name, random free text, no form token.
    teamName: "Rqqcdq Rnsxkvm", contactName: "Kczf Gtritlcw", email,
    phone: "7131806329", slug, divisionIds: [div.rows[0].id],
  }),
});
console.log(`live POST /api/public/league/waitlist → ${r.status}`);
await new Promise((res) => setTimeout(res, 1500));

const log = await c.query(`SELECT form, outcome, reasons FROM public_form_submissions WHERE email = $1`, [email]);
const after = await c.query(`SELECT count(*)::int n FROM public_form_submissions`);
let pass = 0; const fails: string[] = [];
const ok = (n: string, cond: boolean, d = "") => { if (cond) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n} ${d}`); } };

ok("the guard RAN on production", after.rows[0].n > before.rows[0].n);
ok("it logged this submission", log.rows.length === 1, JSON.stringify(log.rows));
ok("and HELD it — no email to the captain, none to Isaac", log.rows[0]?.outcome === "held", log.rows[0]?.outcome);
ok("naming why", (log.rows[0]?.reasons ?? []).length >= 2, JSON.stringify(log.rows[0]?.reasons));
console.log(`     reasons: ${JSON.stringify(log.rows[0]?.reasons)}`);

// Clean up: the waitlist row is stored by design, so remove the test one.
const del = await c.query(`DELETE FROM league_waitlist WHERE email = $1`, [email]);
await c.query(`DELETE FROM public_form_submissions WHERE email = $1`, [email]);
ok(`removed the test waitlist row (${del.rowCount}) and its log`, true);
const left = await c.query(`SELECT count(*)::int n FROM league_waitlist WHERE email = $1`, [email]);
ok("nothing left behind", left.rows[0].n === 0);

await c.end();
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
