// Remove / restore a registration, with a name on every change (2026-10-28).
// The rules are in @shared/registration-removal; this file only writes what
// they allow. The row is never deleted — see the migration of the same date.
import { sql } from "drizzle-orm";
import { db } from "./db";
import { removalBlocker, reasonProblem, REMOVED_STATUS } from "@shared/registration-removal";

export class RemovalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

/** Everything a person would want to read about the registration at the moment
 *  it was changed, without a join — the event row must make sense on its own
 *  years later, even if a programme is renamed. */
async function snapshotOf(tx: any, regId: number) {
  const [row] = rowsOf(await tx.execute(sql`
    SELECT r.id, r.order_number, r.status::text AS status, r.total_cents, r.amount_paid,
           r.payment_method, r.payment_reference, r.registration_location, r.source,
           r.registered_at, r.paid_at, r.term_id, r.stripe_payment_intent_id, r.pos_sale_id,
           p.id AS program_id, p.name AS program_name, p.organization_id,
           t.name AS term_name,
           trim(coalesce(ch.first_name,'') || ' ' || coalesce(ch.last_name,'')) AS child_name,
           trim(coalesce(g.first_name,'') || ' ' || coalesce(g.last_name,'')) AS guardian_name,
           g.email AS guardian_email,
           trim(coalesce(sb.first_name,'') || ' ' || coalesce(sb.last_name,'')) AS served_by_name
      FROM registrations r
      JOIN programs p ON p.id = r.program_id
      LEFT JOIN terms t ON t.id = r.term_id
      LEFT JOIN contacts ch ON ch.id = r.contact_id
      LEFT JOIN contacts g ON g.id = r.guardian_id
      LEFT JOIN users sb ON sb.id = r.served_by_user_id
     WHERE r.id = ${regId}`));
  return row ?? null;
}

/** Remove a registration. `orgAllowed` is the caller's workspace check, run on
 *  the programme's organisation inside the same transaction as the write. */
export async function removeRegistration(opts: {
  regId: number; userId: number; reason: unknown; orgAllowed: (orgId: number | null) => boolean;
}) {
  const problem = reasonProblem(opts.reason);
  if (problem) throw new RemovalError(400, problem);
  const reason = String(opts.reason).trim();

  return db.transaction(async (tx) => {
    const [reg] = rowsOf(await tx.execute(sql`
      SELECT r.id, r.status::text AS status, r.stripe_payment_intent_id, r.pos_sale_id,
             r.total_cents, r.refunded_amount_cents, p.organization_id
        FROM registrations r JOIN programs p ON p.id = r.program_id
       WHERE r.id = ${opts.regId}
       FOR UPDATE OF r`));
    // Out of the caller's workspaces → 404, never 403: the id must not confirm existence.
    if (!reg || !opts.orgAllowed(reg.organization_id)) throw new RemovalError(404, "Registration not found");
    const blocker = removalBlocker({
      status: reg.status, stripePaymentIntentId: reg.stripe_payment_intent_id, posSaleId: reg.pos_sale_id,
      totalCents: reg.total_cents, refundedAmountCents: reg.refunded_amount_cents,
    });
    if (blocker) throw new RemovalError(409, blocker);

    const snapshot = await snapshotOf(tx, opts.regId);
    await tx.execute(sql`
      UPDATE registrations
         SET removed_from_status = status,
             status = ${REMOVED_STATUS},
             removed_at = now(),
             removed_by_user_id = ${opts.userId},
             removed_reason = ${reason}
       WHERE id = ${opts.regId}`);
    await tx.execute(sql`
      INSERT INTO registration_removal_events (registration_id, action, user_id, reason, snapshot)
      VALUES (${opts.regId}, 'removed', ${opts.userId}, ${reason}, ${JSON.stringify(snapshot)}::jsonb)`);
    return { ok: true, id: opts.regId };
  });
}

/** Put a removed registration back exactly as it was. Also recorded by name. */
export async function restoreRegistration(opts: {
  regId: number; userId: number; orgAllowed: (orgId: number | null) => boolean;
}) {
  return db.transaction(async (tx) => {
    const [reg] = rowsOf(await tx.execute(sql`
      SELECT r.id, r.status::text AS status, r.removed_from_status::text AS from_status, p.organization_id
        FROM registrations r JOIN programs p ON p.id = r.program_id
       WHERE r.id = ${opts.regId}
       FOR UPDATE OF r`));
    if (!reg || !opts.orgAllowed(reg.organization_id)) throw new RemovalError(404, "Registration not found");
    if (reg.status !== REMOVED_STATUS || !reg.from_status) throw new RemovalError(409, "This registration is not removed.");

    const snapshot = await snapshotOf(tx, opts.regId);
    await tx.execute(sql`
      UPDATE registrations
         SET status = removed_from_status,
             removed_at = NULL, removed_by_user_id = NULL, removed_reason = NULL, removed_from_status = NULL
       WHERE id = ${opts.regId}`);
    await tx.execute(sql`
      INSERT INTO registration_removal_events (registration_id, action, user_id, reason, snapshot)
      VALUES (${opts.regId}, 'restored', ${opts.userId}, NULL, ${JSON.stringify(snapshot)}::jsonb)`);
    return { ok: true, id: opts.regId, status: reg.from_status };
  });
}

/** The trail: every remove and restore in the caller's workspaces, newest
 *  first, each with who did it and whether the registration is still removed. */
export async function removalHistory(orgIds: number[] | "all", limit = 300) {
  if (orgIds !== "all" && orgIds.length === 0) return [];
  const orgFilter = orgIds === "all"
    ? sql``
    : sql`AND (e.snapshot->>'organization_id')::int IN (${sql.join(orgIds.map((id) => sql`${id}`), sql`, `)})`;
  return rowsOf(await db.execute(sql`
    SELECT e.id, e.registration_id, e.action, e.reason, e.snapshot, e.created_at,
           e.user_id, trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS user_name, u.email AS user_email,
           (r.status::text = ${REMOVED_STATUS}) AS still_removed
      FROM registration_removal_events e
      JOIN users u ON u.id = e.user_id
      JOIN registrations r ON r.id = e.registration_id
     WHERE TRUE ${orgFilter}
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT ${limit}`));
}
