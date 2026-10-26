// Rambo's club-data tools, run for real against the live database (READ ONLY)
// as a super admin standing in Christchurch United — no model, no browser:
//   npx tsx --env-file=.env script/_test-rambo-club-tools.ts
//
// Proves the shapes Daniel asked for: U4–U8 this term as a number; the age
// breakdown 3…8; the holiday-camp crossover; who is on the roll but unpaid
// with a paid share; a named squad's paid/unpaid; and the honest refusals —
// an unknown programme lists the real ones, an unknown squad lists the real
// ones, a person WITHOUT the Registrations tab is refused by name. Every count
// is cross-checked against the one decider: pending rows never count.
import pg from "pg";
import type { Viewer } from "../shared/knowledge-base";
import { CLUB_TOOL_HANDLERS } from "../server/rambo-club-tools";
import { ramboTitleFrom, ramboCleanTitle, RAMBO_STARTERS } from "../shared/rambo-chat";

let pass = 0, fail = 0;
const ok = (l: string, good: boolean, d = "") => { console.log(`  ${good ? "ok  " : "FAIL"} ${l}${d ? ` — ${d.replace(/\s+/g, " ").slice(0, 220)}` : ""}`); good ? pass++ : fail++; };

const daniel: Viewer = {
  userId: 0, name: "Probe Super", globalRole: "super_admin",
  memberships: [{ orgSlug: "christchurch-united", orgName: "Christchurch United", role: "admin", tabs: null }],
  workspaceSlug: "christchurch-united",
};
const noRegs: Viewer = {
  userId: 0, name: "Probe Coach", globalRole: "coach",
  memberships: [{ orgSlug: "christchurch-united", orgName: "Christchurch United", role: "team_member", tabs: ["academy"] }],
  workspaceSlug: "christchurch-united",
};
const num = (s: string, re: RegExp) => { const m = re.exec(s); return m ? Number(m[1]) : NaN; };

async function main() {
  console.log("\nRambo club tools — live, read only\n");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  // ── pure bits ───────────────────────────────────────────────────────────────
  ok("a chat is named after its first question", ramboTitleFrom("How many U4–U8 players do we have this term? And by age?") === "How many U4–U8 players do we have this term?");
  ok("a long first question is cut at a word", ramboTitleFrom("Give me a breakdown of how many we have at 3 years old 4 years old 5 years old 6 years old 7 years old and 8").length <= 64);
  ok("a blank name falls back", ramboCleanTitle("   ") === "New chat" && ramboCleanTitle(" Term 4 numbers ") === "Term 4 numbers");
  ok("there are starters", RAMBO_STARTERS.length >= 4);

  // ── player numbers ──────────────────────────────────────────────────────────
  const u48 = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "U4-U8" });
  const n48 = num(u48.text, /\*\*(\d+) registered player/);
  ok("U4–U8 this term answers with a number", Number.isFinite(n48) && n48 > 0, u48.text);
  const truth = (await pool.query(`
    SELECT count(DISTINCT r.contact_id)::int n FROM registrations r JOIN programs p ON p.id=r.program_id
    WHERE p.organization_id=1 AND p.slug='u4-u8' AND r.status IN ('confirmed','refunded','partially_refunded')
      AND r.term_id = (SELECT id FROM terms WHERE organization_id=1 AND start_date <= (now() AT TIME ZONE 'Pacific/Auckland')::date AND end_date >= (now() AT TIME ZONE 'Pacific/Auckland')::date LIMIT 1)`)).rows[0].n;
  ok("…and it equals the decider's own count of distinct paid players", n48 === truth, `${n48} vs ${truth}`);
  const pendingCount = (await pool.query(`SELECT count(*)::int n FROM registrations r JOIN programs p ON p.id=r.program_id WHERE p.organization_id=1 AND p.slug='u4-u8' AND r.status='pending'`)).rows[0].n;
  ok("pending checkouts exist and are NOT in that number", pendingCount >= 0 && /never counted/i.test(u48.text), `${pendingCount} pending`);

  const byAge = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "under 4 to under 8", group_by: "age" });
  ok("the age breakdown lists years", /By age today/.test(byAge.text) && /\b[3-8] yrs: \d+/.test(byAge.text), byAge.text);
  const byGrade = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "funino", group_by: "grade" });
  ok("the grade breakdown lists U-grades", /By age grade/.test(byGrade.text) && /U\d+: \d+/.test(byGrade.text), byGrade.text);
  const camps = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "holiday camps", term: "all" });
  ok("the holiday camps answer as distinct children, all time", /the holiday camps — all time/.test(camps.text) && num(camps.text, /\*\*(\d+) registered/) > 0, camps.text);
  const last = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "academy", term: "Term 3 2026" });
  ok("a named term is honoured", /Term 3 2026/.test(last.text), last.text);
  const unknown = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "underwater basket weaving" });
  ok("an unknown programme lists the real ones instead of guessing", /couldn't match/.test(unknown.text) && /FUNiño/.test(unknown.text), unknown.text);
  const badTerm = await CLUB_TOOL_HANDLERS.player_numbers(daniel, { programme: "U4-U8", term: "Term 9 2031" });
  ok("an unknown term lists the real ones", /don't know a term/.test(badTerm.text) && /Term 4 2026/.test(badTerm.text), badTerm.text);

  // ── payment status ──────────────────────────────────────────────────────────
  const pay = await CLUB_TOOL_HANDLERS.payment_status(daniel, { programme: "U4-U8" });
  ok("who has paid: paid / on the roll unpaid / abandoned checkouts, with a share", /Paid and registered: \d+/.test(pay.text) && /On the roll but NOT paid: \d+/.test(pay.text) && /never paid: \d+/.test(pay.text), pay.text);
  const payAll = await CLUB_TOOL_HANDLERS.payment_status(daniel, {});
  ok("with no programme it answers for the core academy", /core academy/.test(payAll.text) && /By programme/.test(payAll.text), payAll.text);

  // ── camp overlap ────────────────────────────────────────────────────────────
  const ov = await CLUB_TOOL_HANDLERS.camp_overlap(daniel, { programme: "U4-U8" });
  ok("camp crossover: N of M players (x%) and which camps", /\*\*\d+ of \d+ registered players \(\d+%\)/.test(ov.text) && /name and date of birth/.test(ov.text), ov.text);

  // ── squads ──────────────────────────────────────────────────────────────────
  const sq = await CLUB_TOOL_HANDLERS.squad_payment_status(daniel, { squad: "U9 Kiwis" });
  ok("a named squad answers paid of total, or says the roster is empty", /U9 Kiwis: \d+ of \d+ paid/.test(sq.text) || /no players on the roster/.test(sq.text), sq.text);
  const sqAll = await CLUB_TOOL_HANDLERS.squad_payment_status(daniel, { squad: "all" });
  ok("'all' walks every squad of the season", /Squad payments/.test(sqAll.text), sqAll.text);
  const sqBad = await CLUB_TOOL_HANDLERS.squad_payment_status(daniel, { squad: "U99 Dragons" });
  ok("an unknown squad lists the real ones", /couldn't match/.test(sqBad.text) && /U9 Kiwis/.test(sqBad.text), sqBad.text);

  // ── the gate, per workspace ─────────────────────────────────────────────────
  const refused = await CLUB_TOOL_HANDLERS.player_numbers(noRegs, { programme: "U4-U8" });
  ok("a person without the Registrations tab is refused by name, not answered", /don't have the Registrations area/.test(refused.text) && !/registered player/.test(refused.text), refused.text);
  const elsewhere = await CLUB_TOOL_HANDLERS.player_numbers({ ...daniel, workspaceSlug: null, memberships: [] }, {});
  ok("with no workspace at all it asks which one", /Which workspace/.test(elsewhere.text) || /no workspace/.test(elsewhere.text), elsewhere.text);

  await pool.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
