// Read-only: every Stripe payout that has landed in the club's bank since 1 Dec 2025, opened into the actual charges
// inside it — each one resolved to what ClubOS sold (the child and programme, the league team and its night, the
// Player Pay share, the ticket, the order) — so the Financial Report shows the registrations, never the payout lumps.
//
// Daniel, 2 Nov 2026: "It's important to have the actual transactions here, not the payouts. The payouts don't tell us
// anything… Monday 5s, Thursday 7s… the individual team… the actual person, the registration rather than the payout."
//
// Uses the SAME walker the Xero payout poster uses (server/xero-payout.ts: walkPayout + resolvePaymentIntents, incl. the
// subscription stage that finds the weekly league charges), so the report can never disagree with what was posted.
// Cached per payout in outputs/club-finance-2026/stripe_payout_items.json — a payout never changes, so each is walked once.
//
//   cd apps/clubos && npx tsx --env-file=.env script/_export-payout-items-finance.ts            # new payouts only
//   cd apps/clubos && npx tsx --env-file=.env script/_export-payout-items-finance.ts --rewalk   # everything again
import Stripe from "stripe";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { walkPayout, PayoutNotSplittable } from "../server/xero-payout";

const OUT = "/Users/danielmeyn/Desktop/AIOS/DanielMeynOS/outputs/club-finance-2026/stripe_payout_items.json";
const SINCE = Math.floor(Date.parse("2025-11-25T00:00:00Z") / 1000);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2025-04-30.basil" as any });
const nzDate = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
const ids = (xs: (string | number | null | undefined)[]) => Array.from(new Set(xs.filter((x) => x != null && x !== "").map(String)));
const q = async (s: string) => (await db.execute(sql.raw(s))).rows as any[];
const inList = (xs: string[]) => xs.map((x) => `'${String(x).replace(/'/g, "")}'`).join(",");

async function main() {
  const rewalk = process.argv.includes("--rewalk");
  const cache: Record<string, any> = existsSync(OUT) && !rewalk ? JSON.parse(readFileSync(OUT, "utf8")).payouts ?? {} : {};
  // every payout that landed since the window opened
  const payouts: Stripe.Payout[] = [];
  let starting_after: string | undefined;
  for (;;) {
    const page = await stripe.payouts.list({ status: "paid", arrival_date: { gte: SINCE }, limit: 100, ...(starting_after ? { starting_after } : {}) });
    payouts.push(...page.data);
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  const todo = payouts.filter((p) => !cache[p.id]);
  console.log(`${payouts.length} payouts since ${nzDate(SINCE)} · ${payouts.length - todo.length} cached · ${todo.length} to walk`);

  // the Xero account each category / programme posts to (the poster's own map, every org)
  const mapRows = await q(`SELECT organization_id, category, program_id, xero_account_code FROM xero_account_map`);
  const acct = (category: string, programId: number | null, org: number | null) => {
    const hit = mapRows.find((m) => m.category === category && m.program_id != null && programId != null && Number(m.program_id) === Number(programId))
      ?? mapRows.find((m) => m.category === category && m.program_id == null && (org == null || Number(m.organization_id) === Number(org)))
      ?? mapRows.find((m) => m.category === category && m.program_id == null);
    return hit?.xero_account_code ?? null;
  };

  let n = 0;
  for (const p of todo) {
    let walked;
    try { walked = await walkPayout(p.id); }
    catch (e: any) {
      if (e instanceof PayoutNotSplittable) { cache[p.id] = { id: p.id, arrival: nzDate(p.arrival_date), amountCents: p.amount, unsplittable: String(e.message), items: [] }; continue; }
      throw e;
    }
    const items = walked.items.map((i) => ({
      bt: i.balanceTxnId, type: i.type, pi: i.paymentIntentId, gross: i.grossCents, fee: i.feeCents,
      category: i.category, source: i.resolved?.source ?? null, recordId: i.resolved?.recordId ?? null,
      programId: i.resolved?.programId ?? null, programType: i.resolved?.programType ?? null, org: i.resolved?.organizationId ?? null,
      playerShare: !!i.resolved?.isPlayerShare, desc: i.description ?? i.resolved?.description ?? null,
      account: acct(i.category, i.resolved?.programId ?? null, i.resolved?.organizationId ?? null),
    }));
    cache[p.id] = { id: p.id, arrival: nzDate(p.arrival_date), amountCents: p.amount, balances: walked.split.balances, reversalCents: walked.split.reversalCents, items };
    if (++n % 10 === 0) { writeFileSync(OUT, JSON.stringify({ payouts: cache })); console.log(`${n}/${todo.length} walked`); }
  }

  // charge dates: one balance-transaction read per payout is already done inside walkPayout; the created date is not kept
  // there, so read it in bulk here for every item that lacks one (resumable — only items without `date`).
  const needDates = Object.values(cache).flatMap((p: any) => p.items.filter((i: any) => !i.date).map((i: any) => [p.id, i] as const));
  if (needDates.length) {
    const byPayout = new Map<string, any[]>();
    for (const [pid, i] of needDates) (byPayout.get(pid) ?? byPayout.set(pid, []).get(pid)!).push(i);
    for (const [pid, its] of Array.from(byPayout.entries())) {
      const want = new Map(its.map((i) => [i.bt, i]));
      let after: string | undefined;
      for (;;) {
        const page = await stripe.balanceTransactions.list({ payout: pid, limit: 100, ...(after ? { starting_after: after } : {}) });
        for (const t of page.data) { const i = want.get(t.id); if (i) i.date = nzDate(t.created); }
        if (!page.has_more) break; after = page.data[page.data.length - 1].id;
      }
    }
  }

  // enrich: who / what, read in ONE query per table across every item
  const all = Object.values(cache).flatMap((p: any) => p.items as any[]);
  const by = (src: string) => ids(all.filter((i) => i.source === src).map((i) => i.recordId));
  const enrich = (src: string, rows: any[], key = "id") => { const m = new Map(rows.map((r) => [String(r[key]), r])); for (const i of all) if (i.source === src && m.has(String(i.recordId))) i.detail = m.get(String(i.recordId)); };
  const regIds = by("registrations");
  if (regIds.length) enrich("registrations", await q(`
    SELECT r.id, r.payment_mode, r.team_name, r.total_cents, p.name AS program, p.type AS program_type, p.organization_id AS org, po.name AS option_name,
           t.name AS term, t.year AS term_year, c.first_name AS child_first, c.last_name AS child_last, c.date_of_birth AS dob,
           g.first_name AS g_first, g.last_name AS g_last,
           lt.name AS team, d.name AS division, d.day_of_week AS night, lc.name AS competition
      FROM registrations r JOIN programs p ON p.id = r.program_id
      LEFT JOIN program_options po ON po.id = r.program_option_id LEFT JOIN terms t ON t.id = r.term_id
      LEFT JOIN contacts c ON c.id = r.contact_id LEFT JOIN contacts g ON g.id = r.guardian_id
      LEFT JOIN league_teams lt ON lt.registration_id = r.id LEFT JOIN league_divisions d ON d.id = lt.division_id LEFT JOIN league_competitions lc ON lc.id = lt.competition_id
     WHERE r.id IN (${inList(regIds)})`));
  const smIds = by("split_members");
  if (smIds.length) enrich("split_members", await q(`
    SELECT m.id, m.name, m.charged_cents, s.team_name AS split_team, s.registration_id, s.program_id, s.funding_type, p.name AS program,
           d.name AS division, d.day_of_week AS night, lt.name AS team, lc.name AS competition, t.name AS term, t.year AS term_year
      FROM split_members m JOIN split_sessions s ON s.id = m.split_session_id
      LEFT JOIN programs p ON p.id = s.program_id LEFT JOIN league_divisions d ON d.id = s.league_division_id
      LEFT JOIN league_teams lt ON lt.registration_id = s.registration_id LEFT JOIN league_competitions lc ON lc.id = lt.competition_id
      LEFT JOIN registrations r ON r.id = s.registration_id LEFT JOIN terms t ON t.id = r.term_id
     WHERE m.id IN (${inList(smIds)})`));
  const tpIds = by("teampay_players");
  if (tpIds.length) enrich("teampay_players", await q(`
    SELECT tp.id, tp.name, e.team_name AS team, c.name AS competition, c.kind FROM teampay_players tp JOIN teampay_entries e ON e.id = tp.entry_id JOIN teampay_competitions c ON c.id = e.competition_id WHERE tp.id IN (${inList(tpIds)})`));
  const teIds = by("teampay_entries");
  if (teIds.length) enrich("teampay_entries", await q(`
    SELECT e.id, e.team_name AS team, e.manager_name AS name, c.name AS competition, c.kind FROM teampay_entries e JOIN teampay_competitions c ON c.id = e.competition_id WHERE e.id IN (${inList(teIds)})`));
  const ceIds = by("club_event_orders");
  if (ceIds.length) enrich("club_event_orders", await q(`SELECT o.id, o.buyer_name AS name, o.quantity, ev.name AS event FROM club_event_orders o JOIN club_events ev ON ev.id = o.event_id WHERE o.id IN (${inList(ceIds)})`));
  const soIds = by("shop_orders");
  if (soIds.length) enrich("shop_orders", await q(`SELECT id, order_number, first_name || ' ' || last_name AS name, team_name FROM shop_orders WHERE id IN (${inList(soIds)})`));
  const fbIds = by("facility_bookings");
  if (fbIds.length) enrich("facility_bookings", await q(`SELECT b.id, b.customer_name AS name, f.name AS facility, b.booking_date::text AS booked FROM facility_bookings b LEFT JOIN facilities f ON f.id = b.facility_id WHERE b.id IN (${inList(fbIds)})`));
  const mbIds = by("members");
  if (mbIds.length) enrich("members", await q(`SELECT id, name, tier_name FROM members WHERE id IN (${inList(mbIds)})`));
  const prIds = by("print_orders");
  if (prIds.length) enrich("print_orders", await q(`SELECT id, order_number, customer_name AS name FROM print_orders WHERE id IN (${inList(prIds)})`));
  const cgIds = by("cugc_registrations");
  if (cgIds.length) enrich("cugc_registrations", await q(`SELECT id, gymnast_name AS name, program_name AS program FROM cugc_registrations WHERE id IN (${inList(cgIds)})`));
  const uiIds = by("usg_invoices");
  if (uiIds.length) enrich("usg_invoices", await q(`SELECT id, number AS invoice, recipient_name AS name, brand FROM usg_invoices WHERE id IN (${inList(uiIds)})`));

  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), payouts: cache }));
  const tot = Object.values(cache).length, items = all.length, dated = all.filter((i) => i.date).length, resolved = all.filter((i) => i.source).length;
  console.log(`wrote ${OUT}: ${tot} payouts · ${items} charges (${resolved} resolved to a ClubOS record, ${dated} dated)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
