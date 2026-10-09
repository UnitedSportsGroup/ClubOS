// Post each day's Stripe payout into Xero, already split.
//
// 🔴 A SWEEP, not a webhook. A missed `payout.paid` delivery would leave a day
// uncoded with nothing to notice it; a sweep that re-reads recent payouts every
// hour simply picks it up next time. It is safe to run repeatedly because the
// poster refuses a payout that is already posted (a unique index) or that Xero
// already has a hand-coded entry for.
//
// 🔴 OFF unless XERO_PAYOUT_AUTOPOST=1 — the same doctrine as the Sporty and
// Xero invoice pushes. Code reaching production must not start writing to the
// club's ledger just because it was deployed.

import { listRecentPayouts, PayoutNotSplittable } from "./xero-payout";
import { planPayout, postPayout, isAlreadyPosted, markHandledByHand, findStripeDuplicates } from "./xero-payout-post";
import { syncAcademyContacts } from "./xero-contact-profile";
import { db } from "./db";
import { sql } from "drizzle-orm";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;   // hourly
const BOOT_DELAY_MS = 3 * 60 * 1000;        // let the app settle after a deploy
const LOOK_BACK = 8;                        // payouts, so a long weekend still catches up
const RETRY_DAYS = 45;                      // a FAILED payout is retried this long, wherever it sits

async function notify(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
  } catch { /* a failed notification must never fail the sweep */ }
}

async function sweep() {
  let posted = 0;
  const blocked: string[] = [];
  try {
    const payouts = await listRecentPayouts(LOOK_BACK);
    // 🔴 A payout that FAILED is retried until it posts or a person is seen to
    // have done it — not only while it is one of the latest eight. The 25 Sep
    // 2026 deposit ($9,590.03) failed during the chart change, fell out of the
    // window, and sat uncoded for eleven days until Olga asked for it by hand.
    const stuck = await db.execute(sql`
      SELECT stripe_payout_id AS id, payout_cents AS "amountCents", currency,
             to_char(arrival_date AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM-DD') AS "arrivalDate"
        FROM xero_payout_posts
       WHERE stripe_account = 'club' AND status IN ('failed', 'pending')
         AND stripe_payout_id LIKE 'po\\_%' AND stripe_payout_id <> 'po_test_1'
         AND arrival_date > now() - make_interval(days => ${RETRY_DAYS})
       ORDER BY arrival_date DESC`);
    const known = new Set(payouts.map(p => p.id));
    for (const r of stuck.rows as any[]) if (!known.has(r.id)) { payouts.push(r); known.add(r.id); }
    // Oldest first, so a catch-up lands in the order the bank statement shows.
    for (const p of payouts.slice().reverse()) {
      try {
        // 🔴 Ask our own ledger BEFORE planning. `planPayout` walks the payout in
        // Stripe and asks Xero for the chart of accounts and a window of bank
        // transactions — two Xero calls — and only then reports `alreadyPosted`.
        // Doing that hourly for eight payouts on two machines burned ~768 Xero
        // calls a day re-deciding work finished days ago, against a 5,000/day
        // tenant limit. The duplicate guard is untouched: anything actually
        // postable still gets the full check.
        if (await isAlreadyPosted(p.id)) continue;
        const plan = await planPayout(p.id);
        if (plan.alreadyPosted) continue;
        // Already coded by a human, or an account nobody has agreed: both are
        // reasons to leave it alone, and only the second is worth reporting.
        if (plan.blockers.length) {
          const human = plan.blockers.some(b => b.includes("already has an entry"));
          if (human) {
            // Done by a person — remember it, so it is never re-planned hourly
            // (each plan costs several Xero calls against a shared daily limit).
            await markHandledByHand(p.id, plan.arrivalDate, plan.payoutCents, plan.currency);
            continue;
          }
          blocked.push(`${plan.arrivalDate} $${(plan.payoutCents / 100).toFixed(2)} — ${plan.blockers[0]}`);
          continue;
        }
        const r = await postPayout(p.id, { by: "auto" });
        posted++;
        console.log(`[xero-payout] posted ${p.id} (${p.arrivalDate}, $${(p.amountCents / 100).toFixed(2)}) → ${r.xeroId}`);
      } catch (e: any) {
        if (e instanceof PayoutNotSplittable) { blocked.push(e.message); continue; }
        blocked.push(`${p.arrivalDate} $${(p.amountCents / 100).toFixed(2)} — ${e?.message ?? e}`);
      }
    }
  } catch (e: any) {
    // 🔴 Reaching Stripe or Xero at all failed. This is the one that must be
    // shouted about: everything below it looks like "nothing to do".
    console.error("[xero-payout] sweep failed:", e?.message ?? e);
    await notify(`🔴 <b>Xero payout sweep failed</b>\n${String(e?.message ?? e).slice(0, 300)}`);
    return;
  }

  // A person keying their own entry AFTER ours leaves the deposit counted
  // twice. One Xero call; each duplicate is reported once, never deleted here.
  try {
    const dupes = await findStripeDuplicates();
    if (dupes.length) await notify(`🔴 <b>Stripe deposit entered twice in Xero</b> — income is overstated until one is deleted\n\n` +
      dupes.slice(0, 8).map(d => `• ${d}`).join("\n") + (dupes.length > 8 ? `\n• …and ${dupes.length - 8} more` : ""));
  } catch (e: any) {
    console.error("[xero-payout] duplicate check failed:", e?.message ?? e);
  }

  // Every new "(A U…)" contact — one the poster raised an invoice for, or one Olga
  // keyed by hand — gets its phone, address and other parent from ClubOS. Blanks
  // only, never overwritten. Hourly: contacts touched in the last 3 hours (one
  // Xero call when nothing changed). 3am NZ: every contact, for a child whose
  // ClubOS registration landed AFTER Olga made their Xero contact.
  try {
    const nzHour = Number(new Intl.DateTimeFormat("en-NZ", { hour: "numeric", hour12: false, timeZone: "Pacific/Auckland" }).format(new Date()));
    const full = nzHour === 3;
    const rows = await syncAcademyContacts(1, { commit: true, since: full ? undefined : new Date(Date.now() - 3 * 3600_000) });
    const filled = rows.filter(r => r.outcome === "filled");
    const errors = rows.filter(r => r.outcome === "error");
    if (filled.length) console.log(`[xero-contacts] filled ${filled.length}: ${filled.map(r => r.name).join(", ").slice(0, 400)}`);
    if (errors.length) await notify(`⚠️ <b>Xero academy contacts — ${errors.length} could not be filled</b>\n\n` +
      errors.slice(0, 6).map(r => `• ${r.name}: ${r.detail}`).join("\n"));
  } catch (e: any) {
    console.error("[xero-contacts] fill failed:", e?.message ?? e);
  }

  // 🔴 Silence is the failure mode here. A payout that refuses to post looks
  // exactly like a quiet day, so anything left behind is reported by name.
  if (blocked.length) {
    await notify(`⚠️ <b>Xero payout split — ${blocked.length} not posted</b>\n\n` +
      blocked.slice(0, 6).map(b => `• ${b}`).join("\n") +
      (blocked.length > 6 ? `\n• …and ${blocked.length - 6} more` : ""));
  }
  if (posted) console.log(`[xero-payout] sweep complete — ${posted} posted, ${blocked.length} left`);
}

export function startXeroPayoutCron(): void {
  if (process.env.XERO_PAYOUT_AUTOPOST !== "1") {
    console.log("[xero-payout] auto-post disabled (XERO_PAYOUT_AUTOPOST != 1) — payouts are posted by hand");
    return;
  }
  setInterval(sweep, SWEEP_INTERVAL_MS);
  setTimeout(sweep, BOOT_DELAY_MS);
  console.log("[xero-payout] auto-post enabled — hourly sweep armed");
}
