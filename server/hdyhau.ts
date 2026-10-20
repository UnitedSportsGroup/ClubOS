// "How did you hear about us?" — who MUST answer, decided here and only here.
//
// A buyer NEW to an organisation must answer before any money moves; a
// returning buyer may skip it. "New" is per ORGANISATION, not per club group:
// a CUFC academy family entering Mini Football is new to MFL, because what we
// want to know is how MFL found them.
//
// Returning = there is a REAL registration (shared/registrations.ts — paid, or
// paid and refunded; never pending or cancelled) in that organisation whose
// registrant OR guardian contact matches the buyer's email (lower + trim) or
// their NZ mobile (digits only, +64 → 0). A signed-in parent account counts
// through its own address too.
//
// 🔴 Fail CLOSED. If the lookup breaks, the buyer is treated as new and asked.
// A missing answer is cheaper than a missing lookup, and asking a returning
// family one extra question costs nothing.
//
// 🔴 `referral_detail` is written and read ONLY through this file, with raw SQL,
// never through the Drizzle `registrations` table object. If this code reaches
// production before migrations/2026-10-20_hdyhau_detail.sql is applied, a
// Drizzle column would make EVERY registration read and write fail — every
// checkout down at once. Here a missing column (42703) falls back to the
// legacy "Other: …" form in referral_source, so the answer is never lost.

import type { Express, Request } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import { REAL_REGISTRATION_STATUSES } from "@shared/registrations";
import { parseHdyhau, HDYHAU_REQUIRED_MESSAGE, type HdyhauValue } from "@shared/hdyhau";
import { parentEmailFromRequest } from "./parent-routes";
import { clientIp } from "./api-security";

/** Digits only, NZ country code folded to a leading 0. Null when too short to be a phone. */
export function normaliseNzPhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (digits.startsWith("64") && digits.length >= 9) return `0${digits.slice(2)}`;
  return digits;
}

function normaliseEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

// The same fold as normaliseNzPhone, in SQL, applied to the stored phone.
const PHONE_SQL = `CASE WHEN regexp_replace(coalesce(c.phone,''),'\\D','','g') LIKE '64%'
                         AND length(regexp_replace(coalesce(c.phone,''),'\\D','','g')) >= 9
                        THEN '0' || substr(regexp_replace(coalesce(c.phone,''),'\\D','','g'), 3)
                        ELSE regexp_replace(coalesce(c.phone,''),'\\D','','g') END`;

/**
 * Has this person a real registration in this organisation already?
 * Programmes with no organisation are the original CUFC camps (org 1), the
 * same fallback the booking route uses.
 */
export async function isReturningBuyer(opts: {
  orgId: number;
  email?: unknown;
  phone?: unknown;
  extraEmails?: Array<string | null | undefined>;
}): Promise<boolean> {
  const emails = Array.from(new Set(
    [opts.email, ...(opts.extraEmails ?? [])].map(normaliseEmail).filter((e): e is string => !!e),
  ));
  const phone = normaliseNzPhone(opts.phone);
  if (!Number.isFinite(opts.orgId) || (emails.length === 0 && !phone)) return false;

  const { rows } = await pool.query(
    `SELECT 1
       FROM registrations r
       JOIN programs p ON p.id = r.program_id
       JOIN contacts c ON c.id IN (r.contact_id, r.guardian_id)
      WHERE COALESCE(p.organization_id, 1) = $1
        AND r.status::text = ANY($2::text[])   -- an enum: compare as text or Postgres refuses the operator
        AND ( lower(trim(c.email)) = ANY($3::text[])
              OR ($4::text IS NOT NULL AND ${PHONE_SQL} = $4::text) )
      LIMIT 1`,
    [opts.orgId, [...REAL_REGISTRATION_STATUSES], emails, phone],
  );
  return rows.length > 0;
}

export type HdyhauDecision =
  | { ok: true; source: HdyhauValue | null; detail: string | null; returning: boolean }
  | { ok: false; message: string };

/**
 * The gate every sale route calls BEFORE it writes a contact, a registration or
 * a PaymentIntent. Reads `referralSource` / `referralDetail` off the body.
 *
 * - A value that was sent and is invalid → refused, new or returning.
 * - Nothing sent and the buyer is new to the organisation → refused.
 * - Nothing sent and the buyer is returning → allowed, stored as null.
 *
 * `useParentSession` is for public checkouts only: a signed-in parent's own
 * address counts toward "returning". The office route passes false — a staff
 * session must never stand in for the family at the counter.
 */
export async function decideHdyhau(
  req: Request,
  opts: { orgId: number; email?: unknown; phone?: unknown; useParentSession?: boolean },
): Promise<HdyhauDecision> {
  const body: any = req.body ?? {};
  const parsed = parseHdyhau(body.referralSource, body.referralDetail);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.source) return { ok: true, source: parsed.source, detail: parsed.detail, returning: false };

  let returning = false;
  try {
    const sessionEmail = opts.useParentSession ? await parentEmailFromRequest(req).catch(() => null) : null;
    returning = await isReturningBuyer({
      orgId: opts.orgId,
      email: opts.email,
      phone: opts.phone,
      extraEmails: sessionEmail ? [sessionEmail] : [],
    });
  } catch (e: any) {
    console.error("[hdyhau] returning-buyer lookup failed — asking the buyer:", e?.message || e);
    returning = false;
  }
  if (!returning) return { ok: false, message: HDYHAU_REQUIRED_MESSAGE };
  return { ok: true, source: null, detail: null, returning: true };
}

/** Write the "Other" free text. Tolerates the column not existing yet (see header). */
export async function saveReferralDetail(registrationId: number, detail: string | null | undefined): Promise<void> {
  const text = (detail ?? "").trim();
  if (!registrationId || !text) return;
  try {
    await pool.query(`UPDATE registrations SET referral_detail = $2 WHERE id = $1`, [registrationId, text]);
  } catch (e: any) {
    if (e?.code === "42703") {
      // Migration not applied yet: keep the answer in the legacy shape the
      // camp survey already uses, rather than drop it.
      await pool.query(`UPDATE registrations SET referral_source = $2 WHERE id = $1`, [registrationId, `Other: ${text}`])
        .catch((err) => console.error("[hdyhau] legacy detail write failed:", err?.message || err));
      return;
    }
    console.error("[hdyhau] referral_detail write failed:", e?.message || e);
  }
}

/** Read the "Other" free text for a set of registrations. Empty map if the column isn't there yet. */
export async function referralDetailsFor(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const clean = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)));
  if (clean.length === 0) return out;
  try {
    const { rows } = await pool.query(
      `SELECT id, referral_detail FROM registrations WHERE id = ANY($1::int[]) AND referral_detail IS NOT NULL`,
      [clean],
    );
    for (const r of rows) out.set(Number(r.id), String(r.referral_detail));
  } catch (e: any) {
    if (e?.code !== "42703") console.error("[hdyhau] referral_detail read failed:", e?.message || e);
  }
  return out;
}

// ── Public "do I have to answer?" lookup ─────────────────────────────────────
// Asked by every checkout once an email or phone is typed. Answers ONLY a
// boolean, in the same shape whatever happens — unknown programme, rate
// limited, lookup broken all read `{ required: true }`, which is also the
// fail-closed answer. Nothing about the person is ever returned.

const hits = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
// Generous: a checkout asks on each field blur, and a family office on shared
// NAT should not be locked out after three siblings' bookings.
const MAX_PER_HOUR = 120;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, times] of Array.from(hits.entries())) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_HOUR) { hits.set(ip, recent); return true; }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

async function orgForLookup(body: any): Promise<number | null> {
  if (body?.programId != null && body.programId !== "") {
    const p: any = await storage.getProgram(Number(body.programId));
    return p ? (p.organizationId ?? 1) : null;
  }
  if (typeof body?.slug === "string" && body.slug.trim()) {
    const p: any = await storage.getProgramBySlug(body.slug.trim());
    return p ? (p.organizationId ?? 1) : null;
  }
  const n = Number(body?.orgId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function registerHdyhauRoutes(app: Express) {
  app.post("/api/public/hdyhau/required", async (req, res) => {
    let required = true;
    try {
      if (!rateLimited(clientIp(req) || "unknown")) {
        const orgId = await orgForLookup(req.body);
        if (orgId != null) {
          const sessionEmail = await parentEmailFromRequest(req).catch(() => null);
          const returning = await isReturningBuyer({
            orgId,
            email: req.body?.email,
            phone: req.body?.phone,
            extraEmails: sessionEmail ? [sessionEmail] : [],
          });
          required = !returning;
        }
      }
    } catch (e: any) {
      console.error("[hdyhau] /required lookup failed:", e?.message || e);
      required = true;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ required });
  });
}
