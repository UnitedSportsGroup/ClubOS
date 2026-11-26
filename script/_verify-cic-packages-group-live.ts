// Live check of CIC multi-team booking: book two teams as one group, read the
// group page, start the ONE deposit (a real PaymentIntent, never confirmed), check
// each team's page refuses its own deposit, then cancel the intent and delete
// every probe row. Run: npx tsx --env-file=.env script/_verify-cic-packages-group-live.ts
import pg from "pg";
const BASE = "https://join.cicyouth.com/api/public/cic/packages";
let fails = 0;
const ok = (c: boolean, l: string) => { console.log(`  ${c ? "✓" : "✗"} ${l}`); if (!c) fails++; };
const post = async (u: string, b: any) => { const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const team = (age: string, players: number) => ({ origin: "north", pkg: "base", age, players, staff: 2, adults: 0, nights: 3, vans: 2, breakfast: true, entryMarquee: false, entryLunch: false, addOns: [], city: "AKL", flights: true });

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const form = { clubName: "ZZ Probe Group FC", managerName: "Probe", managerEmail: "probe-group@example.com", managerPhone: "0210000000", termsAccepted: true, website: "probe", source: "verify" };
  let groupId: number | null = null;
  try {
    const dup = await post(`${BASE}/book-group`, { inputs: [team("U12", 13), team("U12", 13)], ...form });
    ok(dup.status === 400, `the same age group twice is refused (${dup.body.message})`);
    const r = await post(`${BASE}/book-group`, { inputs: [team("U12", 13), team("U14", 16)], ...form });
    ok(r.status === 200 && /cic-package-group\/[a-f0-9]{32}$/.test(r.body.url || ""), `booked two teams → ${r.body.url}`);
    const token = String(r.body.url).split("/").pop()!;
    groupId = (await db.query(`SELECT id FROM cic_pkg_groups WHERE token=$1`, [token])).rows[0]?.id ?? null;
    const g = await (await fetch(`${BASE}/group/${token}`)).json();
    ok(g.teams?.length === 2 && g.status === "held", `group page: ${g.teams?.length} teams, ${g.status}`);
    const sumDep = (await db.query(`SELECT sum(deposit_cents)::int s FROM cic_pkg_bookings WHERE group_id=$1`, [groupId])).rows[0].s;
    ok(sumDep === g.depositCents, `one deposit $${(g.depositCents / 100).toFixed(2)} = the two teams' 10% added up`);
    const teamTok = (await db.query(`SELECT token FROM cic_pkg_bookings WHERE group_id=$1 LIMIT 1`, [groupId])).rows[0].token;
    const tb = await (await fetch(`${BASE}/booking/${teamTok}`)).json();
    ok(!!tb.groupUrl, "a team's own page points at the group page");
    const own = await post(`${BASE}/booking/${teamTok}/pay`, { kind: "deposit" });
    ok(own.status === 400, `a team's own deposit is refused (${own.body.message})`);
    const pay = await post(`${BASE}/group/${token}/pay`, {});
    ok(pay.status === 200 && !!pay.body.clientSecret && pay.body.amountCents === g.depositCents, `ONE card charge started for $${(pay.body.amountCents / 100).toFixed(2)}`);
    const rows = (await db.query(`SELECT count(*)::int n FROM cic_pkg_payments p JOIN cic_pkg_bookings b ON b.id=p.booking_id WHERE b.group_id=$1 AND p.kind='deposit' AND p.group_payment_id IS NOT NULL`, [groupId])).rows[0].n;
    ok(rows === 2, `a deposit row waiting on each team (${rows})`);
    const again = await post(`${BASE}/group/${token}/pay`, {});
    ok(again.body.paymentId === pay.body.paymentId, "a second tap reuses the same charge");
  } finally {
    if (groupId) {
      const pis = (await db.query(`SELECT stripe_payment_intent_id FROM cic_pkg_group_payments WHERE group_id=$1 AND stripe_payment_intent_id IS NOT NULL`, [groupId])).rows;
      for (const p of pis) {
        const res = await fetch(`https://api.stripe.com/v1/payment_intents/${p.stripe_payment_intent_id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
        ok(res.ok, `cancelled intent ${p.stripe_payment_intent_id}`);
      }
      await db.query(`DELETE FROM cic_pkg_payments WHERE booking_id IN (SELECT id FROM cic_pkg_bookings WHERE group_id=$1)`, [groupId]);
      await db.query(`DELETE FROM cic_pkg_bookings WHERE group_id=$1`, [groupId]);
      await db.query(`DELETE FROM cic_pkg_group_payments WHERE group_id=$1`, [groupId]);
      await db.query(`DELETE FROM cic_pkg_groups WHERE id=$1`, [groupId]);
      const left = (await db.query(`SELECT count(*)::int n FROM cic_pkg_groups WHERE club_name='ZZ Probe Group FC'`)).rows[0].n;
      ok(left === 0, "probe rows deleted");
    }
    await db.end();
  }
  console.log(fails ? `\n${fails} FAILED` : "\nAll passed");
  process.exit(fails ? 1 : 0);
}
main();
