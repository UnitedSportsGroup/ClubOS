// Live end-to-end check of CIC 2027 packages against production.
//   npx tsx --env-file=.env script/_verify-cic-packages-live.ts
// Books a probe team through the public API exactly as the page does, checks
// the server's price against the shared engine, opens the deposit (a real but
// never-confirmed PaymentIntent, cancelled after), marks the probe's deposit
// paid IN THE DB (no card is charged), registers a player, opens a player
// payment with extras, then deletes every probe row and cancels every intent.
import pg from "pg";
import Stripe from "stripe";
import { quote, cleanInput } from "../shared/cic-packages-core";

const BASE = process.env.VERIFY_BASE || "https://join.cicyouth.com";
const API = `${BASE}/api/public/cic/packages`;
let n = 0, bad = 0;
const ok = (c: boolean, l: string) => { n++; if (!c) bad++; console.log(`  ${c ? "✓" : "✗"} ${l}`); };
const j = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", Origin: "https://packages.cicyouth.com" } });
  return { status: r.status, body: await r.json().catch(() => ({})), cors: r.headers.get("access-control-allow-origin") };
};

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const pis: string[] = [];
  let bookingId: number | null = null;
  try {
    const input = { origin: "north", pkg: "base", age: "U12", players: 2, staff: 1, adults: 0, nights: 3, vans: 1,
      breakfast: true, entryMarquee: false, entryLunch: false, addOns: ["antarctic"], city: "AKL", flights: true };
    const pre = await fetch(`${API}/book`, { method: "OPTIONS", headers: { Origin: "https://packages.cicyouth.com" } });
    ok(pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://packages.cicyouth.com", "CORS preflight allows packages.cicyouth.com");

    const refused = await j(`${API}/book`, { method: "POST", body: JSON.stringify({ input, clubName: "x", managerName: "y", managerEmail: "z@example.com", managerPhone: "0211234567" }) });
    ok(refused.status === 400, "booking without the non-refundable tick is refused");

    const r = await j(`${API}/book`, { method: "POST", body: JSON.stringify({
      input, clubName: "ZZ Probe FC (automated check)", managerName: "Probe Manager", managerEmail: "delivered+cicpkg@resend.dev",
      managerPhone: "0210000000", termsAccepted: true, website: "", source: "verify script" }) });
    ok(r.status === 200 && /\/cic-package\/[a-f0-9]{32}$/.test(r.body.url || ""), "book returns a team page link");
    const token = String(r.body.url).split("/").pop()!;
    const row = (await db.query(`SELECT * FROM cic_pkg_bookings WHERE token=$1`, [token])).rows[0];
    bookingId = row?.id ?? null;
    ok(!!row && row.organization_id === 5, "booking stored under CIC");

    const tp = await (await fetch("https://packages.cicyouth.com/packages/trip-prices.json")).json();
    const q = quote(cleanInput(input)!, tp);
    const total = Math.round(q.total * 100), flights = Math.round(q.flightsTotal * 100);
    ok(row.total_cents === total, `server total ${row.total_cents} = engine ${total}`);
    ok(row.invoice_cents === total - flights && row.flights_cents === flights, "invoice excludes flights");
    ok(row.deposit_cents === Math.round(row.invoice_cents / 10), `deposit ${row.deposit_cents} = 10% of invoice`);
    const holdDays = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86400000;
    ok(Math.abs(holdDays - 14) < 0.01, "hold is 14 days");

    const page = await j(`${API}/booking/${token}`);
    ok(page.status === 200 && page.body.status === "held" && page.body.joinUrl === null, "team page: held, no join link before deposit");
    ok(page.body.schedule?.length === 3, "three instalments");
    const early = await j(`${API}/booking/${token}/pay`, { method: "POST", body: JSON.stringify({ kind: "instalment" }) });
    ok(early.status === 400, "an instalment before the deposit is refused");

    const dep = await j(`${API}/booking/${token}/pay`, { method: "POST", body: JSON.stringify({ kind: "deposit" }) });
    ok(dep.status === 200 && dep.body.amountCents === row.deposit_cents && !!dep.body.clientSecret, "deposit intent for exactly the deposit");
    const depPay = (await db.query(`SELECT * FROM cic_pkg_payments WHERE id=$1`, [dep.body.paymentId])).rows[0];
    if (depPay?.stripe_payment_intent_id) pis.push(depPay.stripe_payment_intent_id);
    const pi = await stripe.paymentIntents.retrieve(depPay.stripe_payment_intent_id);
    ok(pi.amount === row.deposit_cents && pi.metadata.kind === "cic_package" && pi.payment_method_types.join() === "card", "Stripe intent: amount, kind, card only");
    const again = await j(`${API}/booking/${token}/pay`, { method: "POST", body: JSON.stringify({ kind: "deposit" }) });
    ok(again.body.paymentId === dep.body.paymentId, "a second tap reuses the same intent");
    const notPaid = await j(`${API}/booking/${token}/confirm`, { method: "POST", body: JSON.stringify({ paymentId: dep.body.paymentId }) });
    ok(notPaid.body.paid === false, "confirm says not paid until Stripe says so");

    // Simulate the deposit landing (no card is charged): what markPaid does.
    await db.query(`UPDATE cic_pkg_payments SET paid_at=now() WHERE id=$1`, [dep.body.paymentId]);
    await db.query(`UPDATE cic_pkg_bookings SET deposit_paid_at=now() WHERE id=$1`, [bookingId]);
    const booked = await j(`${API}/booking/${token}`);
    ok(booked.body.status === "booked" && /\/cic-join\/[a-f0-9]{32}$/.test(booked.body.joinUrl || ""), "after deposit: booked + join link");
    ok(booked.body.outstandingCents === row.invoice_cents - row.deposit_cents, "outstanding = invoice − deposit");
    const joinToken = booked.body.joinUrl.split("/").pop();

    const join = await j(`${API}/join/${joinToken}`);
    ok(join.status === 200 && join.body.spotsLeft === row.players, `join page: ${row.players} places (squad as priced)`);
    const noDob = await j(`${API}/join/${joinToken}`, { method: "POST", body: JSON.stringify({ firstName: "A", lastName: "B", guardianName: "C", guardianEmail: "delivered+cicp@resend.dev", guardianPhone: "0210000001" }) });
    ok(noDob.status === 400, "registering without a date of birth is refused");
    const reg = await j(`${API}/join/${joinToken}`, { method: "POST", body: JSON.stringify({ firstName: "Probe", lastName: "Player", dateOfBirth: "2015-03-04", guardianName: "Probe Parent", guardianEmail: "delivered+cicp@resend.dev", guardianPhone: "0210000001" }) });
    ok(reg.status === 200 && /\/cic-player\//.test(reg.body.url || ""), "player registers and gets their own page");
    const ptoken = reg.body.url.split("/").pop();
    const pl = await j(`${API}/player/${ptoken}`);
    ok(pl.status === 200 && pl.body.shareDueCents === row.player_share_cents, `player share ${row.player_share_cents} due`);
    const merch = pl.body.extras.find((x: any) => x.name === "CIC merch pack");
    const tram = pl.body.extras.find((x: any) => x.name === "Christchurch Tram city tour");
    ok(!!merch && merch.priceCents === 9500 && !!tram, "extras catalogue live (merch pack $95, tram)");
    ok(!pl.body.extras.some((x: any) => x.name === "Te Kaha stadium tour"), "an extra with no price is not on sale");
    const noSize = await j(`${API}/player/${ptoken}/pay`, { method: "POST", body: JSON.stringify({ payShare: true, items: [{ extraId: merch.id, qty: 1 }] }) });
    ok(noSize.status === 400, "merch without a size is refused");
    const fake = await j(`${API}/player/${ptoken}/pay`, { method: "POST", body: JSON.stringify({ payShare: false, items: [{ extraId: merch.id, qty: 1, option: "M", priceCents: 1 }] }) });
    ok(fake.status === 200 && fake.body.amountCents === 9500, "a price sent by the browser is ignored");
    const fp = (await db.query(`SELECT stripe_payment_intent_id FROM cic_pkg_payments WHERE id=$1`, [fake.body.paymentId])).rows[0];
    if (fp?.stripe_payment_intent_id) pis.push(fp.stripe_payment_intent_id);
    const both = await j(`${API}/player/${ptoken}/pay`, { method: "POST", body: JSON.stringify({ payShare: true, items: [{ extraId: merch.id, qty: 1, option: "M" }, { extraId: tram.id, qty: 2 }] }) });
    ok(both.status === 200 && both.body.amountCents === row.player_share_cents + 9500 + tram.priceCents * 2, "share + extras = one charge, priced by the server");
    const bp = (await db.query(`SELECT * FROM cic_pkg_payments WHERE id=$1`, [both.body.paymentId])).rows[0];
    if (bp?.stripe_payment_intent_id) pis.push(bp.stripe_payment_intent_id);
    ok(bp.amount_cents === row.player_share_cents && bp.extras_cents === 9500 + tram.priceCents * 2, "share and extras recorded apart");

    const miss = await j(`${API}/booking/${"0".repeat(32)}`);
    ok(miss.status === 404, "unknown token → 404");
    const admin = await fetch("https://app.usg.co.nz/api/admin/cic-packages");
    ok(admin.status === 401, "staff board needs a login");
  } finally {
    for (const id of pis) { try { await stripe.paymentIntents.cancel(id); } catch { /* already done */ } }
    if (bookingId) {
      await db.query(`DELETE FROM cic_pkg_payments WHERE booking_id=$1`, [bookingId]);
      await db.query(`DELETE FROM cic_pkg_players WHERE booking_id=$1`, [bookingId]);
      await db.query(`DELETE FROM cic_pkg_bookings WHERE id=$1`, [bookingId]);
    }
    await db.end();
    console.log(`\n  ${n - bad}/${n} passed · probe rows deleted · ${pis.length} intents cancelled\n`);
    if (bad) process.exitCode = 1;
  }
}
main();
