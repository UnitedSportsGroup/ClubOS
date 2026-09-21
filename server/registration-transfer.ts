/**
 * Moving a child to the programme they should have been on.
 *
 * Daniel, 2026-09-21: "if 10 year old signed up for u4-u8 fundamentals on
 * accident and he can just move them… for sake of rolls and accurate numbers."
 * And 2026-09-22, from Jack Zhu's profile: "This parent had actually booked in
 * this one payment for registration for two kids… when you click Move on that
 * specific player page, the player just comes up… show the sessions… 'Move all
 * across all sessions'… showing the shift from these sessions to these
 * sessions in World Cup."
 *
 * So a move is PER CHILD. One registration can cover several children (63 do
 * today), and moving "the registration" would have moved the sibling too —
 * the exact thing the profile button must never do. When the moving children
 * are only SOME of the children on a booking, the booking is SPLIT: a new
 * registration on the new programme carries their days and their share of
 * the money (shared/registration-split.ts is the one decider); the original
 * keeps the rest, untouched. When every child on it moves, it moves whole.
 *
 * 🔴 NEVER MOVES MONEY. Nothing is charged, nothing is refunded. The Stripe
 * payment id is copied to the new row so a later refund of the moved child
 * still finds the charge; each row is capped at its own total, and the two
 * totals add back to the one payment — so the pair can never refund more than
 * was paid.
 *
 * 🔴 ONE PLAN, TWO CALLERS. `planTransfer` is what the preview shows and what
 * `executeTransfer` writes. A preview built one way and a write built another
 * is how a dialog ends up promising ten days and moving nine.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { registrations, registrationItems, campDates, contacts, type Registration, type Program } from "@shared/schema";
import { isRealRegistration } from "@shared/registrations";
import { lineCents, splitRegistrationMoney, type SplitSide } from "@shared/registration-split";
import { nzTodayIso } from "@shared/academy";

export type PlannedSession = {
  itemId: number;
  date: string;
  startTime: string | null;
  name: string | null;
  productType: string;
  priceCents: number;
  refundedCents: number;
  /** The matching session on the new programme, or null when it has none that day. */
  target: { dateId: number; date: string; startTime: string | null; name: string | null } | null;
};

export type PlannedChild = {
  /** null for the academy shape, where the registrant is the contact and there are no per-day lines. */
  childId: number | null;
  name: string;
  moving: boolean;
  sessions: PlannedSession[];
};

export type TransferPlan = {
  registration: {
    id: number; status: string; programId: number; programName: string;
    totalCents: number; amountPaidCents: number; refundedCents: number;
  };
  to: { id: number; name: string } | null;
  children: PlannedChild[];
  movingNames: string[];
  stayingNames: string[];
  /** Day labels on the new programme's calendar that have no session — only meaningful once `to` is set. */
  unmatched: string[];
  /** Present only when SOME of the children move: the money each side keeps. Null for a whole move. */
  split: { moving: SplitSide; staying: SplitSide } | null;
  toTermId: number | null;
};

export class TransferError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const dayLabel = (d: { date: unknown; startTime?: string | null }) =>
  `${String(d.date).slice(0, 10)}${d.startTime ? ` ${d.startTime}` : ""}`;

const fullName = (p: { firstName?: string | null; lastName?: string | null } | undefined) =>
  [p?.firstName, p?.lastName].filter(Boolean).join(" ").trim();

export async function planTransfer(args: {
  reg: Registration; from: Program; to: Program | null; childIds: number[] | null;
}): Promise<TransferPlan> {
  const { reg, from, to } = args;
  if (!isRealRegistration(reg.status)) {
    throw new TransferError(400, "Only a paid registration can be moved — this one was never completed.");
  }
  if (reg.status === "refunded") throw new TransferError(400, "This registration was fully refunded — there is nothing left to move.");
  if (to && to.id === reg.programId) throw new TransferError(400, "They are already on that programme");

  const items = await storage.getRegistrationItems(reg.id);
  const dayLines = items.filter((i) => i.campDateId != null);
  const pricing = await storage.getCampPricing(reg.programId);
  const priceByProduct = new Map(pricing.map((p) => [p.productType, p.priceCents]));

  // Who is on this booking.
  const children: PlannedChild[] = [];
  if (dayLines.length === 0) {
    // Academy shape: the registrant IS the contact; a term enrolment writes no per-day lines.
    const [c] = reg.contactId ? await db.select().from(contacts).where(eq(contacts.id, reg.contactId)) : [];
    children.push({ childId: null, name: fullName(c) || "This registration", moving: true, sessions: [] });
    if (args.childIds && args.childIds.length) {
      throw new TransferError(400, "This registration has no per-child days — it moves as one.");
    }
  } else {
    const byChild = new Map<number, PlannedChild>();
    for (const line of dayLines) {
      const cid = Number(line.childId);
      if (!byChild.has(cid)) byChild.set(cid, { childId: cid, name: fullName(line.child) || `Child ${cid}`, moving: false, sessions: [] });
      byChild.get(cid)!.sessions.push({
        itemId: line.id,
        date: String(line.campDate?.date ?? "").slice(0, 10),
        startTime: line.campDate?.startTime ?? null,
        name: line.campDate?.name ?? null,
        productType: line.productType,
        priceCents: lineCents(line, priceByProduct),
        refundedCents: line.refundedAmountCents ?? 0,
        target: null,
      });
    }
    for (const c of Array.from(byChild.values())) c.sessions.sort((a: PlannedSession, b: PlannedSession) => a.date.localeCompare(b.date) || String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")));
    children.push(...Array.from(byChild.values()));

    const wanted = args.childIds && args.childIds.length ? new Set(args.childIds) : null;
    if (wanted) {
      const known = new Set(children.map((c) => c.childId));
      for (const id of Array.from(wanted)) if (!known.has(id)) throw new TransferError(400, "That child is not on this registration.");
    }
    for (const c of children) c.moving = wanted ? wanted.has(c.childId as number) : true;
  }

  const moving = children.filter((c) => c.moving);
  const staying = children.filter((c) => !c.moving);
  if (moving.length === 0) throw new TransferError(400, "Nobody is moving.");

  // Match each moving child's day to the new programme's session on the same date and time.
  const unmatched: string[] = [];
  if (to) {
    const targetDates = await db.select().from(campDates).where(eq(campDates.campId, to.id));
    const seen = new Set<string>();
    for (const c of moving) {
      for (const s of c.sessions) {
        const match = targetDates.find(
          (d) => String(d.date).slice(0, 10) === s.date && String(d.startTime ?? "") === String(s.startTime ?? ""),
        );
        s.target = match ? { dateId: match.id, date: String(match.date).slice(0, 10), startTime: match.startTime ?? null, name: match.name ?? null } : null;
        if (!match) {
          const label = dayLabel({ date: s.date, startTime: s.startTime });
          if (!seen.has(label)) { seen.add(label); unmatched.push(label); }
        }
      }
    }
  }

  // Money, only when the booking is being split.
  let split: TransferPlan["split"] = null;
  if (staying.length > 0) {
    if (reg.stripeSubscriptionId || (reg.depositCents ?? 0) > 0 || (reg.balanceStatus && reg.balanceStatus !== "none")) {
      throw new TransferError(400, "This booking is on a payment plan — move everyone on it together, or sort the plan first.");
    }
    const movingIds = new Set(moving.flatMap((c) => c.sessions.map((s) => s.itemId)));
    const lines = items.map((i) => ({
      id: i.id,
      priceCents: lineCents(i, priceByProduct),
      refundedCents: i.refundedAmountCents ?? 0,
      moving: movingIds.has(i.id),
    }));
    try {
      split = splitRegistrationMoney({
        subtotalCents: reg.subtotalCents ?? reg.totalCents ?? 0,
        discountCents: reg.discountCents ?? 0,
        totalCents: reg.totalCents ?? 0,
        amountPaidCents: Math.round(Number(reg.amountPaid ?? 0) * 100),
        refundedCents: reg.refundedAmountCents ?? 0,
      }, lines);
    } catch (e: any) {
      throw new TransferError(400, `This booking cannot be split cleanly: ${e.message}`);
    }
  }

  return {
    registration: {
      id: reg.id, status: reg.status, programId: reg.programId, programName: from.name,
      totalCents: reg.totalCents ?? 0,
      amountPaidCents: Math.round(Number(reg.amountPaid ?? 0) * 100),
      refundedCents: reg.refundedAmountCents ?? 0,
    },
    to: to ? { id: to.id, name: to.name } : null,
    children,
    movingNames: moving.map((c) => c.name),
    stayingNames: staying.map((c) => c.name),
    unmatched,
    split,
    // The term the new programme is selling, when it sells by term — stamped
    // on the registration, never read back from the programme later.
    toTermId: to && to.scheduleType === "term" ? (to.termId ?? null) : null,
  };
}

export type TransferResult = {
  ok: true;
  movedTo: { id: number; name: string };
  moved: { names: string[]; registrationId: number };
  stayed: { names: string[]; registrationId: number } | null;
  sessions: { child: string; from: { date: string; startTime: string | null }; to: { date: string; startTime: string | null } | null }[];
  daysRemapped: number;
  daysDropped: number;
  money: { moving: SplitSide; staying: SplitSide } | null;
  priceNote: string;
  note: string;
};

export async function executeTransfer(args: {
  reg: Registration; from: Program; to: Program; plan: TransferPlan; dropUnmatchedDays: boolean; userId: number;
}): Promise<TransferResult> {
  const { reg, from, to, plan, userId } = args;
  if (plan.unmatched.length && !args.dropUnmatchedDays) {
    throw new TransferError(409,
      `${to.name} has no session on ${plan.unmatched.length === 1 ? "this day" : "these days"}: ${plan.unmatched.join(", ")}. Move them anyway and drop those days, or pick a different programme.`,
      { unmatched: plan.unmatched, needsConfirmation: true });
  }

  const moving = plan.children.filter((c) => c.moving);
  const remap = moving.flatMap((c) => c.sessions.filter((s) => s.target).map((s) => ({ itemId: s.itemId, toDateId: s.target!.dateId, priceCents: s.priceCents })));
  const drop = moving.flatMap((c) => c.sessions.filter((s) => !s.target).map((s) => s.itemId));
  const who = plan.movingNames.join(" and ");
  const today = nzTodayIso();

  const sessions: TransferResult["sessions"] = moving.flatMap((c) => c.sessions.map((s) => ({
    child: c.name,
    from: { date: s.date, startTime: s.startTime },
    to: s.target ? { date: s.target.date, startTime: s.target.startTime } : null,
  })));

  if (!plan.split) {
    // Everyone on the booking moves: the registration itself moves.
    const note = `Moved ${who} from ${from.name} to ${to.name} on ${today}`
      + (drop.length ? ` — ${drop.length} booked day(s) dropped: ${plan.unmatched.join(", ")}` : "")
      + ` by user ${userId}`;
    await db.transaction(async (tx) => {
      for (const r of remap) {
        // 🔴 Stamp what was PAID for the day, so a later per-session refund
        // prices it at the old programme's rate, never the new one's.
        await tx.update(registrationItems).set({ campDateId: r.toDateId, priceCents: r.priceCents }).where(eq(registrationItems.id, r.itemId));
      }
      if (drop.length) await tx.delete(registrationItems).where(inArray(registrationItems.id, drop));
      await tx.update(registrations).set({
        programId: to.id,
        termId: plan.toTermId,
        // Appended, never replaced — the reason a child is on this programme is part of the record.
        notes: [reg.notes, note].filter(Boolean).join("\n"),
      }).where(eq(registrations.id, reg.id));
    });
    return {
      ok: true, movedTo: { id: to.id, name: to.name },
      moved: { names: plan.movingNames, registrationId: reg.id }, stayed: null,
      sessions, daysRemapped: remap.length, daysDropped: drop.length, money: null,
      priceNote: "The amount paid was left exactly as it was — moving never moves money.",
      note,
    };
  }

  // Some of the children move: SPLIT the booking.
  const { moving: mv, staying: st } = plan.split;
  const stayedWho = plan.stayingNames.join(" and ");
  const newNote = `Split from registration #${reg.id} on ${today}: ${who} moved from ${from.name} to ${to.name}`
    + ` — $${(mv.totalCents / 100).toFixed(2)} of the $${(plan.registration.totalCents / 100).toFixed(2)} booking`
    + (mv.refundedCents ? ` (incl. $${(mv.refundedCents / 100).toFixed(2)} already refunded)` : "")
    + (drop.length ? `; ${drop.length} booked day(s) dropped: ${plan.unmatched.join(", ")}` : "")
    + `. Paid once under the original booking (order ${reg.orderNumber ?? "—"}); nothing charged or refunded. By user ${userId}`;
  const oldNote = `${who} moved to ${to.name} on ${today} as registration #NEW — ${stayedWho} stay${plan.stayingNames.length === 1 ? "s" : ""} here.`
    + ` This booking now carries $${(st.totalCents / 100).toFixed(2)} of the original $${(plan.registration.totalCents / 100).toFixed(2)}; nothing charged or refunded. By user ${userId}`;

  const newId = await db.transaction(async (tx) => {
    const { id: _id, ...copy } = reg as any;
    const [created] = await tx.insert(registrations).values({
      ...copy,
      programId: to.id,
      termId: plan.toTermId,
      status: mv.status,
      subtotalCents: mv.subtotalCents,
      discountCents: mv.discountCents,
      totalCents: mv.totalCents,
      amountPaid: (mv.amountPaidCents / 100).toFixed(2),
      refundedAmountCents: mv.refundedCents || null,
      refundedAt: mv.refundedCents ? reg.refundedAt : null,
      refundReason: mv.refundedCents ? reg.refundReason : null,
      refundedBy: mv.refundedCents ? reg.refundedBy : null,
      // The Stripe refund object belongs to the original row; a later refund here writes its own.
      stripeRefundId: null,
      stripeRefundStatus: null,
      // A register sale is linked to the row that was rung up, not to both halves.
      posSaleId: null,
      notes: newNote,
    }).returning({ id: registrations.id });

    for (const r of remap) {
      await tx.update(registrationItems)
        .set({ registrationId: created.id, campDateId: r.toDateId, priceCents: r.priceCents })
        .where(eq(registrationItems.id, r.itemId));
    }
    if (drop.length) await tx.delete(registrationItems).where(inArray(registrationItems.id, drop));
    // Stamp the staying lines too, so both halves refund at what was paid.
    for (const c of plan.children.filter((x) => !x.moving)) {
      for (const s of c.sessions) {
        await tx.update(registrationItems).set({ priceCents: s.priceCents }).where(eq(registrationItems.id, s.itemId));
      }
    }
    await tx.update(registrations).set({
      status: st.status,
      subtotalCents: st.subtotalCents,
      discountCents: st.discountCents,
      totalCents: st.totalCents,
      amountPaid: (st.amountPaidCents / 100).toFixed(2),
      refundedAmountCents: st.refundedCents || null,
      notes: [reg.notes, oldNote.replace("#NEW", `#${created.id}`)].filter(Boolean).join("\n"),
    }).where(eq(registrations.id, reg.id));

    // 🔴 Belt and braces, inside the transaction: the two rows must add back to the one payment.
    const [a] = await tx.select().from(registrations).where(eq(registrations.id, created.id));
    const [b] = await tx.select().from(registrations).where(eq(registrations.id, reg.id));
    const cents = (x: any) => Math.round(Number(x ?? 0) * 100);
    if ((a.totalCents ?? 0) + (b.totalCents ?? 0) !== plan.registration.totalCents
      || cents(a.amountPaid) + cents(b.amountPaid) !== plan.registration.amountPaidCents
      || (a.refundedAmountCents ?? 0) + (b.refundedAmountCents ?? 0) !== plan.registration.refundedCents) {
      throw new Error("Split did not add back to the original payment — nothing was changed.");
    }
    return created.id;
  });

  return {
    ok: true, movedTo: { id: to.id, name: to.name },
    moved: { names: plan.movingNames, registrationId: newId },
    stayed: { names: plan.stayingNames, registrationId: reg.id },
    sessions, daysRemapped: remap.length, daysDropped: drop.length,
    money: plan.split,
    priceNote: "Nothing was charged or refunded — the one payment is now filed under two registrations that add back to it.",
    note: newNote,
  };
}
