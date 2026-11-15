// NZ bank direct debit on academy registrations (Daniel, 4 Nov 2026).
//
// A card payment is succeeded-or-declined in seconds. A bank debit is
// `processing` for 2–3 working days and THEN succeeds or fails. ClubOS's rule is
// "if you ain't paid you ain't registered", so while it clears the registration
// stays `pending` — and this module records what is going on so nobody is in the
// dark:
//
//   processing → stamp `payment_processing_at`, email the parent "we've got it,
//                it takes 2–3 working days" (ONCE — the stamp is the guard)
//   succeeded  → the existing handlePaymentSuccess confirms it (nothing here)
//   failed     → stamp `payment_failed_at` + reason, email the parent a way to
//                pay again and tell the office (ONCE per failure)
//
// Every write is an atomic `UPDATE … WHERE … IS NULL RETURNING`, so the browser's
// confirm call and the webhook racing each other send one email, not two.
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";

const OFFICE_EMAIL = "accounts@cufc.co.nz";

function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : (r?.rows ?? []);
}

function methodOf(pi: any): string | null {
  const t = pi?.payment_method_types;
  const pm = pi?.payment_method;
  if (pm && typeof pm === "object" && typeof pm.type === "string") return pm.type;
  if (Array.isArray(t) && t.length === 1) return t[0];
  return null;
}

/** Is this PaymentIntent a bank debit that is still clearing? */
export function isClearingBankDebit(pi: any): boolean {
  return pi?.status === "processing";
}

function shell(title: string, intro: string, body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0C1640">
    <div style="background:linear-gradient(135deg,#263996,#0C1640);padding:30px;border-radius:16px 16px 0 0;text-align:center;color:#fff">
      <div style="font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#D4AF37">Christchurch United FC</div>
      <h1 style="margin:10px 0 0;font-size:21px;letter-spacing:.02em">${title}</h1>
      <p style="margin:6px 0 0;opacity:.8;font-size:14px">${intro}</p>
    </div>
    <div style="background:#f7f8fb;padding:30px;border:1px solid #e4e7ef;border-top:0;border-radius:0 0 16px 16px;font-size:14px;line-height:1.65;color:#525c73">
      ${body}
    </div>
  </div>`;
}

/**
 * The bank debit was submitted and is clearing. Idempotent: only the first call
 * stamps and emails. Returns true when this call did the stamping.
 */
export async function markBankDebitClearing(registrationId: number, pi: any): Promise<boolean> {
  const method = methodOf(pi) ?? "nz_bank_account";
  const won = rowsOf(await db.execute(sql`
    UPDATE registrations
       SET payment_processing_at = now(), payment_method_type = ${method},
           payment_failed_at = NULL, payment_failure_reason = NULL
     WHERE id = ${registrationId} AND status = 'pending'
       AND (payment_processing_at IS NULL OR payment_failed_at IS NOT NULL)
     RETURNING id`));
  if (won.length === 0) return false;

  try {
    const reg = await storage.getRegistration(registrationId);
    if (!reg) return true;
    const program = await storage.getProgram(reg.programId);
    const child = await storage.getContact(reg.contactId);
    const guardian = reg.guardianId ? await storage.getContact(reg.guardianId) : null;
    if (!guardian?.email || !program) return true;
    const amount = ((reg.totalCents ?? 0) / 100).toFixed(2);
    const { sendEmail } = await import("./email");
    await sendEmail({
      to: guardian.email,
      from: "Christchurch United FC <noreply@cufc.co.nz>",
      replyTo: "info@cufc.co.nz",
      subject: `${program.name}: we've got your bank payment`,
      html: shell("PAYMENT ON ITS WAY", program.name, `
        <p style="font-size:16px;color:#0C1640;margin:0 0 14px">Hi ${guardian.firstName},</p>
        <p style="margin:0 0 14px">Thanks. Your bank payment of <strong>$${amount} NZD</strong> for
        ${child?.firstName ?? "your child"}'s place in ${program.name} has been sent to your bank.</p>
        <p style="margin:0 0 14px">Bank payments take <strong>2–3 working days</strong> to clear.
        We'll email you again as soon as it has, and that email confirms the registration.</p>
        <p style="margin:0">If your bank declines it, we'll email you straight away with a link to pay another way.
        Reply to this email if anything looks wrong.</p>`),
      registrationId,
      campId: program.id,
    });
  } catch (e: any) {
    console.error("[bank-debit] clearing email failed:", e?.message || e);
  }
  return true;
}

/**
 * The bank debit failed. Idempotent per failure: a webhook retry sends nothing.
 * Only acts on a registration that is still pending (a confirmed one was paid
 * some other way and must never be told it failed).
 */
export async function markBankDebitFailed(registrationId: number, pi: any): Promise<boolean> {
  const err = pi?.last_payment_error;
  const reason = String(err?.message || err?.decline_code || err?.code || "The bank declined the payment").slice(0, 300);
  const won = rowsOf(await db.execute(sql`
    UPDATE registrations
       SET payment_failed_at = now(), payment_failure_reason = ${reason},
           payment_method_type = COALESCE(payment_method_type, ${methodOf(pi)})
     WHERE id = ${registrationId} AND status = 'pending'
       AND payment_processing_at IS NOT NULL AND payment_failed_at IS NULL
     RETURNING id`));
  if (won.length === 0) return false;

  try {
    const reg = await storage.getRegistration(registrationId);
    if (!reg) return true;
    const program = await storage.getProgram(reg.programId);
    const child = await storage.getContact(reg.contactId);
    const guardian = reg.guardianId ? await storage.getContact(reg.guardianId) : null;
    if (!program) return true;
    const amount = ((reg.totalCents ?? 0) / 100).toFixed(2);
    const payAgain = `https://join.cufc.co.nz/academy/${program.slug}`;
    const { sendEmail } = await import("./email");
    if (guardian?.email) {
      await sendEmail({
        to: guardian.email,
        from: "Christchurch United FC <noreply@cufc.co.nz>",
        replyTo: "info@cufc.co.nz",
        subject: `${program.name}: your bank payment didn't go through`,
        html: shell("PAYMENT DIDN'T GO THROUGH", program.name, `
          <p style="font-size:16px;color:#0C1640;margin:0 0 14px">Hi ${guardian.firstName},</p>
          <p style="margin:0 0 14px">Your bank couldn't complete the payment of <strong>$${amount} NZD</strong>
          for ${child?.firstName ?? "your child"}'s place in ${program.name}, so the registration isn't confirmed yet.</p>
          <p style="margin:0 0 18px">You haven't been charged. You can pay again by card or with a different bank account here:</p>
          <p style="margin:0 0 18px"><a href="${payAgain}" style="display:inline-block;background:#263996;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Pay for ${program.name}</a></p>
          <p style="margin:0">If money is tight right now, just reply to this email. It goes to the office, and we'll work something out with you.</p>`),
        registrationId,
        campId: program.id,
      });
    }
    await sendEmail({
      to: OFFICE_EMAIL,
      from: "ClubOS <noreply@cufc.co.nz>",
      subject: `Bank payment failed: ${child?.firstName ?? ""} ${child?.lastName ?? ""}, ${program.name} ($${amount})`,
      html: `<p>A bank direct debit failed in ClubOS.</p>
        <ul>
          <li>Registration #${reg.id} (still not confirmed, so not on the roll)</li>
          <li>Player: ${child?.firstName ?? ""} ${child?.lastName ?? ""}</li>
          <li>Parent: ${guardian ? `${guardian.firstName} ${guardian.lastName}, ${guardian.email ?? "no email"}, ${guardian.phone ?? "no phone"}` : "unknown"}</li>
          <li>Amount: $${amount} NZD</li>
          <li>Bank said: ${reason}</li>
        </ul>
        <p>The parent has been emailed a link to pay again. It also shows in ClubOS under CUFC → Registrations → Payments due → Bank payments.</p>`,
      registrationId,
      campId: program.id,
    });
  } catch (e: any) {
    console.error("[bank-debit] failure emails failed:", e?.message || e);
  }
  return true;
}

/** Stamp which method actually paid (card vs bank) once money has landed. */
export async function stampPaidMethod(registrationId: number, pi: any): Promise<void> {
  const method = methodOf(pi);
  if (!method) return;
  try {
    await db.execute(sql`UPDATE registrations SET payment_method_type = ${method}
      WHERE id = ${registrationId} AND payment_method_type IS DISTINCT FROM ${method}`);
  } catch (e: any) {
    console.error("[bank-debit] stamp method failed:", e?.message || e);
  }
}

/** Every academy registration whose bank debit is clearing or failed, newest first. */
export async function listBankDebits(orgId: number) {
  return rowsOf(await db.execute(sql`
    SELECT r.id, r.status, r.total_cents, r.payment_processing_at, r.payment_failed_at,
           r.payment_failure_reason, r.registered_at,
           p.name AS programme, p.slug AS programme_slug, t.name AS term_name,
           c.id AS child_id, c.first_name AS child_first, c.last_name AS child_last,
           g.id AS guardian_id, g.first_name AS guardian_first, g.last_name AS guardian_last,
           g.email AS guardian_email, g.phone AS guardian_phone
      FROM registrations r
      JOIN programs p ON p.id = r.program_id
      LEFT JOIN terms t ON t.id = r.term_id
      LEFT JOIN contacts c ON c.id = r.contact_id
      LEFT JOIN contacts g ON g.id = r.guardian_id
     WHERE p.organization_id = ${orgId}
       AND r.status = 'pending'
       AND r.payment_processing_at IS NOT NULL
       -- A family who paid again (card or another account) is sorted: a later
       -- REAL registration for the same child, programme and term closes it.
       AND NOT EXISTS (
         SELECT 1 FROM registrations r2
          WHERE r2.contact_id = r.contact_id AND r2.program_id = r.program_id
            AND r2.term_id IS NOT DISTINCT FROM r.term_id
            AND r2.status IN ('confirmed','refunded','partially_refunded'))
     ORDER BY COALESCE(r.payment_failed_at, r.payment_processing_at) DESC
     LIMIT 200`));
}
