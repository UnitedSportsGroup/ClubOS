/**
 * CIC 2027 packages — book, deposit, instalments, players, extras.
 *
 * A club builds a trip on packages.cicyouth.com and presses Book. The page sends
 * the CHOICES (never a price); this file prices them again with the shared
 * engine (shared/cic-packages-core.ts, byte-identical to the page's copy) and
 * the same checked-prices file the page was built from, freezes the quote, and
 * opens a 14-day hold. The manager pays a 10% non-refundable deposit on
 * join.cicyouth.com/cic-package/<token>; then shares the team join link, and
 * each player registers, pays their share of the balance and adds extras.
 *
 * Rules (Ryan Edwards 5 Nov, Daniel 6 Nov 2026):
 *   deposit = 10% of the CIC invoice (flights excluded), non-refundable
 *   hold    = 14 days; no deposit after it
 *   balance = 90%, due across Jan / Mar / Apr 2027; club and players pay ONE balance
 *   extras  = their own money; never reduce the team balance
 *
 * 🔴 Paid state is read back from Stripe (confirm) or arrives by the webhook
 * (metadata.kind = "cic_package"). Both go through markPaid(), an atomic flip.
 * Tokens are 128 random bits; every token miss is a 404.
 */
import crypto from "crypto";
import { pool } from "./db";
import { createCardPaymentIntent, getOrCreateCustomer, retrievePaymentIntent } from "./stripe";
import { sendEmail } from "./email";
import {
  quote, cleanInput, AGE_GROUPS, PACKAGES, ORIGINS, INSTALMENTS, QUOTE_HOLD_DAYS, DEPOSIT_RATE,
  type TripPrices, type QuoteInput,
} from "@shared/cic-packages-core";

export const CIC_ORG_ID = 5;
export const PUBLIC_BASE = "https://join.cicyouth.com";
const TRIP_PRICES_URL = "https://packages.cicyouth.com/packages/trip-prices.json";
const FROM = "Christchurch International Cup <noreply@cicyouth.com>";
const STAFF_TO = "info@cicyouth.com";

const token = () => crypto.randomBytes(16).toString("hex");
const isToken = (t: string) => /^[a-f0-9]{32}$/.test(t);
const c = (dollars: number) => Math.round(dollars * 100);
const q = (text: string, params: any[] = []) => pool.query(text, params);

// ── the checked prices the page was built from ───────────────────────────────
let tripCache: { at: number; tp: TripPrices } | null = null;
export async function tripPrices(): Promise<TripPrices> {
  if (tripCache && Date.now() - tripCache.at < 30 * 60_000) return tripCache.tp;
  try {
    const r = await fetch(TRIP_PRICES_URL, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`trip prices ${r.status}`);
    const tp = (await r.json()) as TripPrices;
    if (!tp || typeof tp !== "object" || !tp.windows) throw new Error("trip prices malformed");
    tripCache = { at: Date.now(), tp };
    return tp;
  } catch (e) {
    // A stale price beats no price only if we priced with it recently; a
    // cold start with no file refuses to quote rather than guess.
    if (tripCache) return tripCache.tp;
    throw e;
  }
}

// ── money for a booking ──────────────────────────────────────────────────────
export function priceBooking(input: QuoteInput, tp: TripPrices) {
  const r = quote(input, tp);
  const totalCents = c(r.total);
  const flightsCents = c(r.flightsTotal);
  const invoiceCents = totalCents - flightsCents;
  // Postgres checks deposit = round(invoice / 10); compute it the same way.
  const depositCents = Math.round(invoiceCents / 10);
  const perPlayerInvoiceCents = c(r.perPlayerInvoice);
  // A player's share of the BALANCE: their part of the invoice less the 10% the
  // deposit already covered for them.
  const playerShareCents = Math.max(0, Math.round(perPlayerInvoiceCents * (1 - DEPOSIT_RATE)));
  return {
    quote: r, totalCents, flightsCents, invoiceCents, depositCents,
    perPlayerCents: c(r.perPlayer), perAdultCents: c(r.perAdult), playerShareCents,
  };
}

/** What has been paid toward the balance, and what is due when. */
function money(b: any, paidTowardCents: number) {
  const balance = b.invoice_cents - b.deposit_cents;
  const outstanding = Math.max(0, b.invoice_cents - paidTowardCents);
  const schedule = INSTALMENTS.map((label, i) => {
    const dueCumulative = b.deposit_cents + Math.round((balance * (i + 1)) / INSTALMENTS.length);
    const remaining = Math.max(0, Math.min(dueCumulative - paidTowardCents, outstanding));
    return { label, dueCumulativeCents: dueCumulative, remainingCents: remaining, settled: remaining === 0 };
  });
  const next = schedule.find((s) => !s.settled) ?? null;
  return { balanceCents: balance, paidTowardCents, outstandingCents: outstanding, schedule, next };
}

function status(b: any): "held" | "expired" | "booked" | "cancelled" {
  if (b.cancelled_at) return "cancelled";
  if (!b.deposit_paid_at) return new Date(b.expires_at).getTime() < Date.now() ? "expired" : "held";
  return "booked";
}

async function paidToward(bookingId: number): Promise<number> {
  const r = await q(`SELECT coalesce(sum(amount_cents),0)::int AS s FROM cic_pkg_payments WHERE booking_id=$1 AND paid_at IS NOT NULL`, [bookingId]);
  return r.rows[0].s;
}

// ── rate limit (stranger-facing create endpoints only) ───────────────────────
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max = 10): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of Array.from(hits.entries())) if (!v.some((t) => now - t < 3_600_000)) hits.delete(k);
  return false;
}

const clean = (v: any, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// ── 1. book (from the page) ──────────────────────────────────────────────────
export async function createBooking(body: any): Promise<{ error?: string; url?: string }> {
  const input = cleanInput(body?.input);
  if (!input) return { error: "Something in your trip didn't come through. Go back a step and try again." };
  const clubName = clean(body.clubName);
  const managerName = clean(body.managerName);
  const managerEmail = clean(body.managerEmail).toLowerCase();
  const managerPhone = clean(body.managerPhone, 40);
  if (!clubName) return { error: "Please tell us your club." };
  if (!managerName) return { error: "Please tell us the team manager's name." };
  if (!emailOk(managerEmail)) return { error: "Please check the email address." };
  if (managerPhone.replace(/\D/g, "").length < 6) return { error: "Please add a mobile number." };
  if (body.termsAccepted !== true) return { error: "Please tick that you understand the deposit is non-refundable." };
  // Honeypot: stored, flagged, answered the same. Nothing is emailed before a
  // deposit is paid anyway, so a bot gets nothing out of this form.
  const quarantined = clean(body.website).length > 0;

  const tp = await tripPrices();
  const m = priceBooking(input, tp);
  if (m.invoiceCents <= 0 || m.depositCents < 50) return { error: "That trip comes to nothing we can take a deposit on." };

  const t = token();
  await q(
    `INSERT INTO cic_pkg_bookings
      (organization_id, token, join_token, club_name, team_name, manager_name, manager_email, manager_phone,
       origin, package_id, age_group, players, staff, adults, input, lines, prices_checked_at,
       total_cents, flights_cents, invoice_cents, deposit_cents, per_player_cents, player_share_cents, per_adult_cents,
       terms_accepted_at, expires_at, source, quarantined)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,now(),
             now() + ($25 || ' days')::interval, $26, $27)`,
    [CIC_ORG_ID, t, token(), clubName, clean(body.teamName) || null, managerName, managerEmail, managerPhone,
     input.origin, input.pkg, input.age, input.players, input.staff, input.adults,
     JSON.stringify(input), JSON.stringify(m.quote.lines), tp.checkedAt ?? null,
     m.totalCents, m.flightsCents, m.invoiceCents, m.depositCents, m.perPlayerCents, m.playerShareCents, m.perAdultCents,
     String(QUOTE_HOLD_DAYS), clean(body.source, 500) || null, quarantined],
  );
  return { url: `${PUBLIC_BASE}/cic-package/${t}` };
}

// ── 2. the manager's page ────────────────────────────────────────────────────
async function bookingByToken(t: string) {
  if (!isToken(t)) return null;
  const r = await q(`SELECT * FROM cic_pkg_bookings WHERE token=$1`, [t]);
  return r.rows[0] ?? null;
}

function publicBooking(b: any, m: ReturnType<typeof money>) {
  const age = AGE_GROUPS.find((a) => a.id === b.age_group);
  return {
    clubName: b.club_name, teamName: b.team_name, managerName: b.manager_name,
    packageName: PACKAGES[b.package_id as keyof typeof PACKAGES]?.name ?? b.package_id,
    packagePromise: PACKAGES[b.package_id as keyof typeof PACKAGES]?.promise ?? "",
    origin: ORIGINS.find((o) => o.id === b.origin)?.label ?? b.origin,
    ageGroup: b.age_group, dates: age?.dates ?? "",
    players: b.players, staff: b.staff, adults: b.adults, nights: b.input?.nights ?? 0,
    lines: b.lines,
    totalCents: b.total_cents, flightsCents: b.flights_cents, invoiceCents: b.invoice_cents,
    depositCents: b.deposit_cents, perPlayerCents: b.per_player_cents, perAdultCents: b.per_adult_cents,
    playerShareCents: b.player_share_cents,
    expiresAt: b.expires_at, depositPaidAt: b.deposit_paid_at, status: status(b),
    ...m,
  };
}

export async function getBooking(t: string) {
  const b = await bookingByToken(t);
  if (!b) return null;
  const m = money(b, await paidToward(b.id));
  const players = (await q(
    `SELECT p.id, p.first_name, p.last_name, p.withdrawn_at,
            coalesce((SELECT sum(amount_cents) FROM cic_pkg_payments x WHERE x.player_id=p.id AND x.paid_at IS NOT NULL),0)::int AS paid_cents,
            coalesce((SELECT sum(extras_cents) FROM cic_pkg_payments x WHERE x.player_id=p.id AND x.paid_at IS NOT NULL),0)::int AS extras_cents
       FROM cic_pkg_players p WHERE p.booking_id=$1 ORDER BY p.created_at`, [b.id],
  )).rows.map((p: any) => ({
    name: `${p.first_name} ${p.last_name}`, paidCents: p.paid_cents, extrasCents: p.extras_cents, withdrawn: !!p.withdrawn_at,
  }));
  const payments = (await q(
    `SELECT kind, amount_cents, extras_cents, paid_at FROM cic_pkg_payments WHERE booking_id=$1 AND paid_at IS NOT NULL ORDER BY paid_at`, [b.id],
  )).rows.map((p: any) => ({ kind: p.kind, amountCents: p.amount_cents, extrasCents: p.extras_cents, paidAt: p.paid_at }));
  return {
    ...publicBooking(b, m), roster: players, payments,
    joinUrl: b.deposit_paid_at ? `${PUBLIC_BASE}/cic-join/${b.join_token}` : null,
  };
}

type PayKind = "deposit" | "instalment" | "balance";

/** The manager pays the deposit, the next instalment, or the whole balance. */
export async function startManagerPayment(t: string, kind: PayKind) {
  const b = await bookingByToken(t);
  if (!b) return { error: "not_found" as const };
  const st = status(b);
  if (st === "cancelled") return { error: "This booking was cancelled. Talk to us if that's a surprise." };
  let amount = 0;
  if (kind === "deposit") {
    if (b.deposit_paid_at) return { error: "Your deposit is already paid." };
    if (st === "expired") return { error: `This quote's ${QUOTE_HOLD_DAYS}-day hold has ended. Build it again on packages.cicyouth.com to get today's price.` };
    amount = b.deposit_cents;
  } else {
    if (!b.deposit_paid_at) return { error: "Pay the deposit first." };
    const m = money(b, await paidToward(b.id));
    amount = kind === "balance" ? m.outstandingCents : (m.next?.remainingCents ?? 0);
    if (amount <= 0) return { error: "Nothing is owing. Thank you!" };
  }
  if (amount < 50) return { error: "That amount is too small to charge by card." };
  return createPayment({
    booking: b, kind, amountCents: amount, extrasCents: 0, items: [], playerId: null,
    email: b.manager_email, name: b.manager_name, phone: b.manager_phone,
    description: `CIC 2027 — ${b.club_name} ${b.age_group} — ${kind === "deposit" ? "10% deposit" : kind === "balance" ? "balance" : "instalment"}`,
  });
}

async function createPayment(o: {
  booking: any; kind: PayKind | "player"; amountCents: number; extrasCents: number; items: any[];
  playerId: number | null; email: string; name: string; phone?: string; description: string;
}) {
  const total = o.amountCents + o.extrasCents;
  // Reuse an unpaid attempt for the same thing in the last half hour (a double
  // tap or a reload must not mint a second charge to confirm).
  const itemsJson = JSON.stringify(o.items);
  const prev = await q(
    `SELECT id, stripe_payment_intent_id FROM cic_pkg_payments
      WHERE booking_id=$1 AND kind=$2 AND player_id IS NOT DISTINCT FROM $3 AND amount_cents=$4 AND extras_cents=$5
        AND items=$6::jsonb AND paid_at IS NULL AND stripe_payment_intent_id IS NOT NULL AND created_at > now() - interval '30 minutes'
      ORDER BY id DESC LIMIT 1`,
    [o.booking.id, o.kind, o.playerId, o.amountCents, o.extrasCents, itemsJson],
  );
  if (prev.rows[0]) {
    const pi = await retrievePaymentIntent(prev.rows[0].stripe_payment_intent_id);
    if (pi.status !== "canceled" && pi.status !== "succeeded" && pi.client_secret) {
      return { clientSecret: pi.client_secret, amountCents: total, paymentId: prev.rows[0].id as number };
    }
  }
  const ins = await q(
    `INSERT INTO cic_pkg_payments (booking_id, player_id, kind, amount_cents, extras_cents, items)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
    [o.booking.id, o.playerId, o.kind, o.amountCents, o.extrasCents, itemsJson],
  );
  const paymentId = ins.rows[0].id as number;
  let customerId: string | undefined;
  try { customerId = (await getOrCreateCustomer({ email: o.email, name: o.name, phone: o.phone })).id; }
  catch (e) { console.error("[cic-packages] customer failed:", e); }
  const pi = await createCardPaymentIntent({
    amountCents: total, currency: "NZD", receiptEmail: o.email, description: o.description,
    metadata: {
      // 🔴 `kind` is what the webhook branches on. Never `registrationId`.
      kind: "cic_package", cicPkgPaymentId: String(paymentId), cicPkgBookingId: String(o.booking.id),
    },
    customerId,
    idempotencyKey: `cic-pkg-payment-${paymentId}`,
  });
  await q(`UPDATE cic_pkg_payments SET stripe_payment_intent_id=$1 WHERE id=$2`, [pi.id, paymentId]);
  return { clientSecret: pi.client_secret, amountCents: total, paymentId };
}

/** Read the truth back from Stripe. */
export async function confirmPayment(paymentId: number, bookingId: number) {
  const r = await q(`SELECT * FROM cic_pkg_payments WHERE id=$1 AND booking_id=$2`, [paymentId, bookingId]);
  const p = r.rows[0];
  if (!p) return { error: "not_found" as const };
  if (p.paid_at) return { paid: true };
  if (!p.stripe_payment_intent_id) return { paid: false };
  const pi = await retrievePaymentIntent(p.stripe_payment_intent_id);
  if (pi.status !== "succeeded") return { paid: false };
  await markPaid(p.id, pi.id);
  return { paid: true };
}

export async function confirmManagerPayment(t: string, paymentId: number) {
  const b = await bookingByToken(t);
  if (!b) return { error: "not_found" as const };
  return confirmPayment(paymentId, b.id);
}

/** The atomic flip. Webhook and confirm both land here; the second is a no-op. */
async function markPaid(paymentId: number, piId: string): Promise<boolean> {
  const r = await q(
    `UPDATE cic_pkg_payments SET paid_at=now() WHERE id=$1 AND stripe_payment_intent_id=$2 AND paid_at IS NULL
     RETURNING booking_id, kind, amount_cents, extras_cents, player_id, items`,
    [paymentId, piId],
  );
  const p = r.rows[0];
  if (!p) return false;
  if (p.kind === "deposit") {
    const u = await q(
      `UPDATE cic_pkg_bookings SET deposit_paid_at=now(), updated_at=now() WHERE id=$1 AND deposit_paid_at IS NULL RETURNING *`,
      [p.booking_id],
    );
    if (u.rows[0]) await depositEmails(u.rows[0]).catch((e) => console.error("[cic-packages] deposit email:", e));
  }
  return true;
}

export async function markPaidByPaymentIntent(pi: any): Promise<boolean> {
  const id = Number(pi?.metadata?.cicPkgPaymentId);
  if (!Number.isInteger(id)) return false;
  return markPaid(id, pi.id);
}

const nzd = (cents: number) => "$" + (cents / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

async function depositEmails(b: any) {
  const page = `${PUBLIC_BASE}/cic-package/${b.token}`;
  const join = `${PUBLIC_BASE}/cic-join/${b.join_token}`;
  const balance = b.invoice_cents - b.deposit_cents;
  const each = Math.round(balance / INSTALMENTS.length);
  const pkg = PACKAGES[b.package_id as keyof typeof PACKAGES]?.name ?? b.package_id;
  // The deposit is real money from this address, so it is safe to email it now.
  await sendEmail({
    to: b.manager_email, from: FROM, replyTo: STAFF_TO,
    subject: `You're booked: CIC 2027 ${b.age_group} (${pkg})`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
      <p>Kia ora ${esc(b.manager_name.split(" ")[0])},</p>
      <p>Your ${nzd(b.deposit_cents)} deposit is in, so ${esc(b.club_name)}'s ${b.age_group} place at CIC 2027 is held.</p>
      <p><b>Your team page</b> (keep this link, it's how you pay and see who has registered):<br><a href="${page}">${page}</a></p>
      <p><b>Send this link to your players</b> so each one registers, pays their share and adds any extras:<br><a href="${join}">${join}</a></p>
      <p>The ${nzd(balance)} balance is due in three parts: ${INSTALMENTS.map((m) => `${m} (${nzd(each)})`).join(", ")}. Whatever your players pay comes off it.</p>
      <p>The deposit is non-refundable unless CIC cancels the tournament.</p>
      <p>Questions? Just reply to this email.</p>
      <p>Christchurch International Cup</p></div>`,
  });
  await sendEmail({
    to: STAFF_TO, from: FROM,
    subject: `New CIC 2027 package booking: ${b.club_name} ${b.age_group} (${pkg}) — deposit ${nzd(b.deposit_cents)}`,
    html: `<p>${esc(b.club_name)} · ${b.age_group} · ${pkg} · ${b.players} players, ${b.staff} staff, ${b.adults} adults.</p>
      <p>Invoice ${nzd(b.invoice_cents)} · deposit ${nzd(b.deposit_cents)} paid.</p>
      <p>Manager ${esc(b.manager_name)} · ${esc(b.manager_email)} · ${esc(b.manager_phone)}</p>
      <p>ClubOS → CIC → Packages.</p>`,
  });
}

// ── 3. the players' join link ────────────────────────────────────────────────
async function bookingByJoin(t: string) {
  if (!isToken(t)) return null;
  const r = await q(`SELECT * FROM cic_pkg_bookings WHERE join_token=$1 AND deposit_paid_at IS NOT NULL AND cancelled_at IS NULL`, [t]);
  return r.rows[0] ?? null;
}

export async function listExtras(orgId = CIC_ORG_ID) {
  const r = await q(
    `SELECT id, category, name, description, partner, price_cents, options FROM cic_pkg_extras
      WHERE organization_id=$1 AND active AND price_cents IS NOT NULL ORDER BY sort, id`, [orgId],
  );
  return r.rows.map((x: any) => ({
    id: x.id, category: x.category, name: x.name, description: x.description, partner: x.partner,
    priceCents: x.price_cents, options: x.options ?? [],
  }));
}

export async function getJoin(t: string) {
  const b = await bookingByJoin(t);
  if (!b) return null;
  const n = (await q(`SELECT count(*)::int AS n FROM cic_pkg_players WHERE booking_id=$1 AND withdrawn_at IS NULL`, [b.id])).rows[0].n;
  return {
    clubName: b.club_name, teamName: b.team_name, ageGroup: b.age_group,
    dates: AGE_GROUPS.find((a) => a.id === b.age_group)?.dates ?? "",
    packageName: PACKAGES[b.package_id as keyof typeof PACKAGES]?.name ?? b.package_id,
    playerShareCents: b.player_share_cents, spotsLeft: Math.max(0, b.players - n), squad: b.players,
  };
}

export async function registerPlayer(t: string, body: any) {
  const b = await bookingByJoin(t);
  if (!b) return { error: "not_found" as const };
  const first = clean(body.firstName, 80), last = clean(body.lastName, 80);
  const guardianName = clean(body.guardianName, 120);
  const guardianEmail = clean(body.guardianEmail).toLowerCase();
  const guardianPhone = clean(body.guardianPhone, 40);
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(String(body.dateOfBirth || "")) ? String(body.dateOfBirth) : null;
  if (!first || !last) return { error: "Please add the player's first and last name." };
  if (!dob) return { error: "Please add the player's date of birth." };
  const y = Number(dob.slice(0, 4));
  if (y < 2005 || y > 2022) return { error: "Please check the date of birth." };
  if (!guardianName) return { error: "Please add a parent or guardian's name." };
  if (!emailOk(guardianEmail)) return { error: "Please check the parent's email address." };
  if (guardianPhone.replace(/\D/g, "").length < 6) return { error: "Please add a parent's mobile number." };
  const pt = token();
  try {
    await q(
      `INSERT INTO cic_pkg_players (booking_id, token, first_name, last_name, date_of_birth, guardian_name, guardian_email, guardian_phone, medical, shirt_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [b.id, pt, first, last, dob, guardianName, guardianEmail, guardianPhone, clean(body.medical, 1000) || null, clean(body.shirtSize, 20) || null],
    );
  } catch (e: any) {
    if (String(e?.message).includes("cic_pkg_squad_full")) return { error: `All ${b.players} places in this squad are taken. Ask your team manager.` };
    throw e;
  }
  return { url: `${PUBLIC_BASE}/cic-player/${pt}` };
}

// ── 4. a player's own page ───────────────────────────────────────────────────
async function playerByToken(t: string) {
  if (!isToken(t)) return null;
  const r = await q(
    `SELECT p.*, b.id AS b_id FROM cic_pkg_players p JOIN cic_pkg_bookings b ON b.id=p.booking_id
      WHERE p.token=$1 AND b.cancelled_at IS NULL`, [t],
  );
  if (!r.rows[0]) return null;
  const b = (await q(`SELECT * FROM cic_pkg_bookings WHERE id=$1`, [r.rows[0].booking_id])).rows[0];
  return { player: r.rows[0], booking: b };
}

async function playerSharePaid(playerId: number) {
  const r = await q(`SELECT coalesce(sum(amount_cents),0)::int AS s FROM cic_pkg_payments WHERE player_id=$1 AND paid_at IS NOT NULL`, [playerId]);
  return r.rows[0].s as number;
}

export async function getPlayer(t: string) {
  const f = await playerByToken(t);
  if (!f) return null;
  const { player: p, booking: b } = f;
  const sharePaid = await playerSharePaid(p.id);
  const m = money(b, await paidToward(b.id));
  const shareDue = Math.max(0, Math.min(b.player_share_cents - sharePaid, m.outstandingCents));
  const bought = (await q(
    `SELECT items, paid_at FROM cic_pkg_payments WHERE player_id=$1 AND paid_at IS NOT NULL AND extras_cents > 0 ORDER BY paid_at`, [p.id],
  )).rows.flatMap((r: any) => r.items ?? []);
  return {
    firstName: p.first_name, lastName: p.last_name,
    clubName: b.club_name, teamName: b.team_name, ageGroup: b.age_group,
    dates: AGE_GROUPS.find((a) => a.id === b.age_group)?.dates ?? "",
    packageName: PACKAGES[b.package_id as keyof typeof PACKAGES]?.name ?? b.package_id,
    playerShareCents: b.player_share_cents, sharePaidCents: sharePaid, shareDueCents: shareDue,
    teamBalanceCleared: m.outstandingCents === 0,
    extras: await listExtras(b.organization_id), bought,
  };
}

export async function startPlayerPayment(t: string, body: any) {
  const f = await playerByToken(t);
  if (!f) return { error: "not_found" as const };
  const { player: p, booking: b } = f;
  const sharePaid = await playerSharePaid(p.id);
  const m = money(b, await paidToward(b.id));
  const shareDue = Math.max(0, Math.min(b.player_share_cents - sharePaid, m.outstandingCents));
  const share = body?.payShare === true ? shareDue : 0;

  // Extras are priced HERE from the catalogue. The browser names items, never prices.
  const catalogue = new Map((await listExtras(b.organization_id)).map((x) => [x.id, x]));
  const items: any[] = [];
  let extras = 0;
  for (const raw of Array.isArray(body?.items) ? body.items.slice(0, 30) : []) {
    const x = catalogue.get(Number(raw?.extraId));
    if (!x) continue;
    const qty = Math.min(10, Math.max(1, Math.round(Number(raw?.qty) || 1)));
    const option = x.options.length ? (x.options.includes(String(raw?.option)) ? String(raw.option) : null) : null;
    if (x.options.length && !option) return { error: `Please choose a size for ${x.name}.` };
    items.push({ extraId: x.id, name: x.name, option, qty, priceCents: x.priceCents });
    extras += x.priceCents * qty;
  }
  if (share + extras <= 0) return { error: "Choose what to pay for first." };
  if (share + extras < 50) return { error: "That amount is too small to charge by card." };
  return createPayment({
    booking: b, kind: "player", amountCents: share, extrasCents: extras, items, playerId: p.id,
    email: p.guardian_email, name: p.guardian_name, phone: p.guardian_phone,
    description: `CIC 2027 — ${b.club_name} ${b.age_group} — ${p.first_name} ${p.last_name}${extras ? " (incl. extras)" : ""}`,
  });
}

export async function confirmPlayerPayment(t: string, paymentId: number) {
  const f = await playerByToken(t);
  if (!f) return { error: "not_found" as const };
  return confirmPayment(paymentId, f.booking.id);
}

// ── 5. staff ─────────────────────────────────────────────────────────────────
export async function adminList(orgId: number) {
  const r = await q(
    `SELECT b.*,
       coalesce((SELECT sum(amount_cents) FROM cic_pkg_payments x WHERE x.booking_id=b.id AND x.paid_at IS NOT NULL),0)::int AS paid_toward,
       coalesce((SELECT sum(extras_cents) FROM cic_pkg_payments x WHERE x.booking_id=b.id AND x.paid_at IS NOT NULL),0)::int AS extras_paid,
       (SELECT count(*) FROM cic_pkg_players p WHERE p.booking_id=b.id AND p.withdrawn_at IS NULL)::int AS registered
     FROM cic_pkg_bookings b WHERE b.organization_id=$1 ORDER BY b.created_at DESC`, [orgId],
  );
  return r.rows.map((b: any) => {
    const m = money(b, b.paid_toward);
    return {
      id: b.id, clubName: b.club_name, teamName: b.team_name, ageGroup: b.age_group,
      packageName: PACKAGES[b.package_id as keyof typeof PACKAGES]?.name ?? b.package_id, origin: b.origin,
      managerName: b.manager_name, managerEmail: b.manager_email, managerPhone: b.manager_phone,
      players: b.players, staff: b.staff, adults: b.adults, registered: b.registered,
      totalCents: b.total_cents, invoiceCents: b.invoice_cents, depositCents: b.deposit_cents,
      paidTowardCents: b.paid_toward, extrasPaidCents: b.extras_paid, outstandingCents: m.outstandingCents,
      overpaidCents: Math.max(0, b.paid_toward - b.invoice_cents),
      status: status(b), quarantined: b.quarantined, createdAt: b.created_at, expiresAt: b.expires_at,
      depositPaidAt: b.deposit_paid_at, staffNotes: b.staff_notes,
      teamUrl: `${PUBLIC_BASE}/cic-package/${b.token}`,
      joinUrl: b.deposit_paid_at ? `${PUBLIC_BASE}/cic-join/${b.join_token}` : null,
    };
  });
}

export async function adminDetail(orgId: number, id: number) {
  const b = (await q(`SELECT * FROM cic_pkg_bookings WHERE id=$1 AND organization_id=$2`, [id, orgId])).rows[0];
  if (!b) return null;
  const players = (await q(
    `SELECT p.id, p.first_name, p.last_name, p.date_of_birth::text AS dob, p.guardian_name, p.guardian_email, p.guardian_phone,
            p.medical, p.shirt_size, p.withdrawn_at, p.created_at
       FROM cic_pkg_players p WHERE p.booking_id=$1 ORDER BY p.created_at`, [b.id],
  )).rows;
  const payments = (await q(
    `SELECT id, kind, player_id, amount_cents, extras_cents, items, paid_at, created_at, stripe_payment_intent_id
       FROM cic_pkg_payments WHERE booking_id=$1 AND paid_at IS NOT NULL ORDER BY paid_at`, [b.id],
  )).rows;
  return { booking: { ...b, lines: b.lines }, players, payments, money: money(b, await paidToward(b.id)) };
}

export async function adminExtrasOrders(orgId: number) {
  const r = await q(
    `SELECT x.paid_at, x.items, b.club_name, b.age_group, p.first_name, p.last_name, p.guardian_email, p.guardian_phone
       FROM cic_pkg_payments x JOIN cic_pkg_bookings b ON b.id=x.booking_id JOIN cic_pkg_players p ON p.id=x.player_id
      WHERE b.organization_id=$1 AND x.paid_at IS NOT NULL AND x.extras_cents > 0 ORDER BY x.paid_at DESC`, [orgId],
  );
  return r.rows.flatMap((row: any) => (row.items ?? []).map((it: any) => ({
    paidAt: row.paid_at, club: row.club_name, ageGroup: row.age_group,
    player: `${row.first_name} ${row.last_name}`, guardianEmail: row.guardian_email, guardianPhone: row.guardian_phone,
    item: it.name, option: it.option, qty: it.qty, priceCents: it.priceCents,
  })));
}

export async function adminExtras(orgId: number) {
  return (await q(`SELECT * FROM cic_pkg_extras WHERE organization_id=$1 ORDER BY sort, id`, [orgId])).rows;
}

export async function adminSaveExtra(orgId: number, body: any, id?: number) {
  const category = ["merch", "meal", "experience", "promo"].includes(body?.category) ? body.category : null;
  const name = clean(body?.name, 120);
  if (!category || !name) return { error: "Category and name are required." };
  const priceCents = body?.priceCents === null || body?.priceCents === "" || body?.priceCents === undefined
    ? null : Math.round(Number(body.priceCents));
  if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents <= 0)) return { error: "Price must be above $0, or blank for 'not on sale'." };
  const options = Array.isArray(body?.options) ? body.options.map((o: any) => clean(o, 30)).filter(Boolean).slice(0, 20) : [];
  const vals = [category, name, clean(body?.description, 400) || null, clean(body?.partner, 120) || null, priceCents, options,
    clean(body?.sourceNote, 300) || null, body?.active !== false, Math.round(Number(body?.sort) || 0)];
  if (id) {
    const r = await q(
      `UPDATE cic_pkg_extras SET category=$1,name=$2,description=$3,partner=$4,price_cents=$5,options=$6,source_note=$7,active=$8,sort=$9,updated_at=now()
        WHERE id=$10 AND organization_id=$11 RETURNING id`, [...vals, id, orgId]);
    return r.rows[0] ? { ok: true } : { error: "not_found" };
  }
  await q(
    `INSERT INTO cic_pkg_extras (category,name,description,partner,price_cents,options,source_note,active,sort,organization_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [...vals, orgId]);
  return { ok: true };
}

export async function adminUpdateBooking(orgId: number, id: number, body: any) {
  if (body?.cancel === true) {
    await q(`UPDATE cic_pkg_bookings SET cancelled_at=now(), cancelled_reason=$1, updated_at=now() WHERE id=$2 AND organization_id=$3 AND cancelled_at IS NULL`,
      [clean(body.reason, 300) || null, id, orgId]);
  }
  if (typeof body?.staffNotes === "string") {
    await q(`UPDATE cic_pkg_bookings SET staff_notes=$1, updated_at=now() WHERE id=$2 AND organization_id=$3`, [body.staffNotes.slice(0, 4000), id, orgId]);
  }
  return { ok: true };
}
