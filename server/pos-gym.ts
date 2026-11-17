// ─────────────────────────────────────────────────────────────────────────────
// POS — United Gymnastics classes on the tills (Daniel, 2026-11-16).
//
// "anything gymnastics-related goes to the gymnastics payout bank account,
// because we have two different Stripe accounts." A gym class sold at a
// counter is the SAME row cugc.co.nz's enrol form writes (cugc_registrations)
// — priced by the SAME engine (server/cugc-pricing.ts), its class checked
// against the SAME timetable (shared/cugc-classes.ts) — carried on a till sale
// that banks with the gym's Stripe account. The gym's roll, its Registrations
// tab and its analytics read that row exactly as they read a website one.
//
// 🔴 The browser never sends a price. 🔴 A gym registration is checkout
// scaffolding (pending_payment) until the SALE is paid; fulfilPaidSale in
// pos-routes.ts is what makes it 'paid' and emails the family — the same
// "if you ain't paid you ain't registered" rule as everything else.
// ─────────────────────────────────────────────────────────────────────────────
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { cugcRegistrations, organizations } from "@shared/schema";
import { CUGC_PROGRAMS, computeCugcEnrolPrice } from "./cugc-pricing";
import { nzTodayIso, resolveTermForSale } from "@shared/cugc-terms";
import { optionChoices } from "@shared/cugc-classes";
import { ageFromDob } from "@shared/family";
import { hdyhauLabel, isHdyhauValue } from "@shared/hdyhau";
import { normaliseNzPhone } from "./hdyhau";
import type { TillGymCatalogue, TillGymProgramme } from "@shared/pos-counter-till";

export const CUGC_ORG_SLUG = "united-gymnastics";
let orgCache: number | null = null;
export async function cugcOrgId(): Promise<number> {
  if (orgCache) return orgCache;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, CUGC_ORG_SLUG));
  if (!org) throw new Error("United Gymnastics organisation not found");
  orgCache = org.id;
  return org.id;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * What the tills may sell today: the term being sold (the one running, else
 * the next open one — the same choice the website makes for an old bundle),
 * every programme, every option priced for THAT term, and the class times a
 * family may choose. Invite-only programmes are listed and flagged — the
 * counter is exactly where an invited family pays.
 */
export async function gymCatalogue(todayIso: string = nzTodayIso()): Promise<TillGymCatalogue | null> {
  const r = resolveTermForSale(null, todayIso);
  if (!r.ok) return null;
  const term = r.term;
  const programmes: TillGymProgramme[] = CUGC_PROGRAMS.map((p) => ({
    slug: p.slug, title: p.title, ages: p.ages, inviteOnly: p.inviteOnly === true,
    options: p.options.map((o, index) => {
      const priced = computeCugcEnrolPrice(p.slug, index, term, new Date(`${todayIso}T12:00:00+13:00`))!;
      return {
        index, label: o.label,
        fullPriceCents: priced.pricing.fullPrice * 100, priceCents: priced.pricing.price * 100,
        prorated: priced.pricing.prorated, weeksLeft: priced.pricing.weeksLeft,
        choices: optionChoices(p.slug, o.label, term.id).map((c) => c.label),
      };
    }),
  }));
  return { orgId: await cugcOrgId(), term: { id: term.id, name: term.name }, programmes };
}

/** The website's own rule (routes.ts cugcDobError), kept to the letter. */
export function gymDobError(dob: string, todayIso: string = nzTodayIso()): string {
  if (!dob) return "The gymnast's date of birth is needed.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "Enter the date of birth as a date.";
  if (dob > todayIso) return "That date of birth is in the future — check it.";
  const age = ageFromDob(dob, todayIso);
  if (age === null) return "Check the date of birth.";
  if (age > 30) return "That date of birth looks like a typo — check the year.";
  return "";
}

export type GymRegistrationInput = {
  programSlug?: unknown; optionIndex?: unknown; sessionTime?: unknown; termId?: unknown;
  gymnast?: { firstName?: unknown; lastName?: unknown; dob?: unknown };
  parent?: { name?: unknown; email?: unknown; phone?: unknown };
  emergencyName?: unknown; emergencyPhone?: unknown; medical?: unknown; photoConsent?: unknown;
  /** Free text, or an HDYHAU value (`referralSource`) the reader's ask screen answers with. */
  heardVia?: unknown; referralSource?: unknown;
  acknowledgeDuplicate?: unknown;
};
export type GymRegistrationResult =
  | { ok: true; row: typeof cugcRegistrations.$inferSelect }
  | { ok: false; status: number; code?: string; message: string };

/**
 * Validate and write a gym registration for a till sale, status
 * pending_payment, priced server-side. Answers the same codes the reader's
 * academy flow already asks about — hdyhau_required, already_registered,
 * on_sale_already — so both tills ask one more question and send again.
 */
export async function createGymRegistration(input: GymRegistrationInput, ctx: { saleId: number; userId: number }): Promise<GymRegistrationResult> {
  const todayIso = nzTodayIso();
  const programSlug = str(input.programSlug, 40);
  const optionIndex = Number(input.optionIndex);
  const termRes = resolveTermForSale(str(input.termId, 20) || null, todayIso);
  if (!termRes.ok) return { ok: false, status: 400, message: termRes.message };
  const term = termRes.term;
  const priced = computeCugcEnrolPrice(programSlug, optionIndex, term);
  if (!priced) return { ok: false, status: 400, message: "Choose a gymnastics programme and option." };
  const { program, option, pricing } = priced;

  const firstName = str(input.gymnast?.firstName, 60), lastName = str(input.gymnast?.lastName, 60);
  if (!firstName || !lastName) return { ok: false, status: 400, message: "The gymnast's first and last name are needed." };
  const gymnastName = `${firstName} ${lastName}`;
  const dob = str(input.gymnast?.dob, 10);
  const dobErr = gymDobError(dob, todayIso);
  if (dobErr) return { ok: false, status: 400, message: dobErr };

  const parentName = str(input.parent?.name, 120);
  const email = str(input.parent?.email, 200).toLowerCase();
  const phoneRaw = str(input.parent?.phone, 40);
  if (!parentName) return { ok: false, status: 400, message: "The parent's name is needed." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, status: 400, message: "A parent email is needed — the confirmation goes there." };
  // The counter asks for a phone (the website does not): the gym needs to reach
  // a parent on the day, and a counter sale is the one time staff can ask.
  if (phoneRaw.replace(/\D/g, "").length < 8) return { ok: false, status: 400, message: "A parent phone number is needed." };
  const phone = normaliseNzPhone(phoneRaw) ?? phoneRaw;

  // 🔴 The class must run in the term being bought (the website's own check).
  const sessionTime = str(input.sessionTime, 80);
  const choices = optionChoices(program.slug, option.label, term.id);
  if (choices.length && !choices.some((c) => c.label === sessionTime)) {
    return { ok: false, status: 400, message: sessionTime ? `${sessionTime} isn't on the ${term.name} timetable. Choose a class time again.` : "Choose a class time." };
  }

  const orgId = await cugcOrgId();

  // "How did you hear about us?" — required for a NEW gym family, same rule as
  // every other new sale. A family with a PAID gym registration on this email
  // or phone is returning. Stored as the words the family would recognise.
  const heardVia = str(input.heardVia, 80) || (isHdyhauValue(input.referralSource) ? hdyhauLabel(input.referralSource) ?? "" : "");
  if (!heardVia) {
    const digits = phone.replace(/\D/g, "");
    const back = await db.execute(sql`
      SELECT 1 FROM cugc_registrations
       WHERE organization_id = ${orgId} AND status = 'paid'
         AND (lower(email) = ${email} OR (${digits.length >= 8} AND right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 8) = ${digits.slice(-8)}))
       LIMIT 1`);
    if (!back.rows.length) return { ok: false, status: 409, code: "hdyhau_required", message: "A new gym family — ask how they heard about us." };
  }

  // Double booking, checked BEFORE anything is written: the same child, the
  // same programme, the same term — already paid, or already on this sale.
  const twin = await db.execute(sql`
    SELECT id, status, pos_sale_id FROM cugc_registrations
     WHERE organization_id = ${orgId} AND program_slug = ${program.slug} AND term = ${term.name}
       AND lower(trim(gymnast_name)) = ${gymnastName.toLowerCase()}
       AND (status = 'paid' OR (status = 'pending_payment' AND pos_sale_id = ${ctx.saleId}))
     ORDER BY (status = 'pending_payment') DESC LIMIT 1`);
  const t: any = twin.rows[0];
  if (t && t.status === "pending_payment") return { ok: false, status: 409, code: "on_sale_already", message: `${firstName} is already on this sale for ${program.title}.` };
  if (t && input.acknowledgeDuplicate !== true) return { ok: false, status: 409, code: "already_registered", message: `${firstName} is already registered and paid for ${program.title} in ${term.name}.` };

  const consent = str(input.photoConsent, 10).toLowerCase();
  const [row] = await db.insert(cugcRegistrations).values({
    organizationId: orgId,
    programSlug: program.slug, programName: program.title, optionLabel: option.label,
    sessionTime: sessionTime || null,
    priceCents: pricing.price * 100, fullPriceCents: pricing.fullPrice * 100,
    term: term.name,
    gymnastName, gymnastDob: dob,
    parentName, email, phone,
    emergencyName: str(input.emergencyName, 120) || null, emergencyPhone: str(input.emergencyPhone, 40) || null,
    medical: str(input.medical, 1000) || null,
    photoConsent: consent === "yes" || consent === "true" ? "Yes" : consent === "no" || consent === "false" ? "No" : null,
    heardVia: heardVia || null,
    status: "pending_payment",
    posSaleId: ctx.saleId, servedByUserId: ctx.userId,
  } as any).returning();
  return { ok: true, row };
}

/** What a gym line reads on the sale, the receipt and the reader. */
export function gymLineText(row: { programName: string; optionLabel: string; gymnastName: string; sessionTime: string | null; term: string | null }) {
  return {
    title: `${row.programName} · ${row.optionLabel}`,
    detail: [row.gymnastName, row.sessionTime, row.term].filter(Boolean).join(" · "),
  };
}

/** A refused gym registration is checkout scaffolding: cancelled and unlinked, never deleted. */
export async function abandonGymRegistration(id: number) {
  await db.execute(sql`UPDATE cugc_registrations SET status = 'cancelled', pos_sale_id = NULL WHERE id = ${id} AND status = 'pending_payment'`);
}
