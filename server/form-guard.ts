import crypto from "crypto";
import type { Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { clientIp } from "./api-security";
import { contentSignals, GUARD_THRESHOLD } from "@shared/form-guard";

/* 🔴 The gate every PUBLIC form that emails the submitter must pass through.
 *
 * A form that sends a confirmation to the address typed into it is not merely a
 * form that receives spam — it is one that SENDS it. Put a stranger's address in
 * the field and ClubOS mails that stranger from a verified club domain. That is
 * what happened to the Ata Rangi lodge site on 9 Sept 2026 (25 harvested
 * addresses in a day, one of them at nasa.gov), and the audit that followed
 * found the identical shape on minifootball.co.nz, cugc.co.nz and
 * unitedprints.co.nz.
 *
 * 🔴 What this deliberately does NOT do: block the submission or change what is
 * stored. A held waitlist entry is still a waitlist row, still in the admin,
 * still workable by a human — it just does not trigger the two automatic
 * emails. That keeps the blast radius of a false positive at "somebody has to
 * look at the list" rather than "a real family was turned away silently", and
 * it keeps this change out of three separate tables and three admin screens.
 */

export type FormName = "mfl_waitlist" | "cugc_free_session" | "print_quote" | "open_training";

/* 🔴 Per-form policy, because the same rule is right on one form and wrong on
 * another.
 *
 * `expectsToken` — count "no form token" as a signal ONLY once that site
 * actually mints one. Counting it before then puts every genuine submission at
 * one of the two signals needed to hold it, so a single other trip holds a real
 * family. Flip a form to true in the same wave as the website deploy that adds
 * the token, never before.
 *
 * `allowLinks` — a link is a bot signal on a booking enquiry and completely
 * normal on a print quote, where customers paste a Drive link to their artwork.
 * Found by the verifier: a real customer doing exactly that was held.
 */
const FORM_POLICY: Record<FormName, { expectsToken: boolean; allowLinks: boolean }> = {
  mfl_waitlist:      { expectsToken: false, allowLinks: false },
  cugc_free_session: { expectsToken: false, allowLinks: false },
  print_quote:       { expectsToken: false, allowLinks: true },
  open_training:     { expectsToken: false, allowLinks: false },
};

export interface GuardVerdict {
  /** True only when the submission looks like a person. The ONLY thing a caller checks. */
  ok: boolean;
  reasons: string[];
  ip: string;
}

/* ---------- the form token ----------
 * A signed, stateless nonce the page fetches before the form is filled in. It
 * proves the client asked for something first and that enough time passed for a
 * person to type — neither of which a straight POST at the API does.
 *
 * Stateless on purpose: a single-use token needs a store, and a store having a
 * bad minute would take a public registration form down with it. Replay is
 * bounded by the age window and covered by the rate limit underneath.
 */
function tokenSecret(): string | null {
  // 🔴 Never a constant fallback — a published default signs a bot's tokens too.
  return process.env.PUBLIC_FORM_SECRET || process.env.SESSION_SECRET || null;
}

export function mintFormToken(): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const ts = Date.now().toString(36);
  const sig = crypto.createHmac("sha256", secret).update(ts).digest("base64url").slice(0, 24);
  return `${ts}.${sig}`;
}

const MIN_DWELL_MS = 3_000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function tokenReason(token: unknown): string | null {
  const secret = tokenSecret();
  if (!secret) return null; // misconfiguration on our side is never the visitor's fault
  if (typeof token !== "string" || !token) return "no_form_token";
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return "bad_form_token";
  const expected = crypto.createHmac("sha256", secret).update(ts).digest("base64url").slice(0, 24);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "bad_form_token";
  const age = Date.now() - parseInt(ts, 36);
  if (Number.isNaN(age)) return "bad_form_token";
  if (age < MIN_DWELL_MS) return "submitted_too_fast";
  if (age > MAX_AGE_MS) return "stale_form_token";
  return null;
}

/* ---------- rate limits ----------
 * Generous by design, and counted across every form. A family enquiring about
 * two programmes from one household must not be stopped; a bot posting twice an
 * hour all day must.
 */
const IP_PER_HOUR = 5;
const IP_PER_DAY = 15;
const EMAIL_PER_HOUR = 3;

async function rateReasons(ip: string, email: string | null): Promise<string[]> {
  const out: string[] = [];
  try {
    const rows = await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE ip = ${ip} AND created_at > now() - interval '1 hour')  AS ip_hour,
        count(*) FILTER (WHERE ip = ${ip} AND created_at > now() - interval '1 day')   AS ip_day,
        count(*) FILTER (WHERE lower(email) = ${email ? email.toLowerCase() : null} AND created_at > now() - interval '1 hour') AS email_hour
      FROM public_form_submissions
    `);
    const r = (rows as any).rows?.[0] ?? (rows as any)[0] ?? {};
    if (Number(r.ip_hour ?? 0) >= IP_PER_HOUR) out.push("ip_rate_hour");
    if (Number(r.ip_day ?? 0) >= IP_PER_DAY) out.push("ip_rate_day");
    if (email && Number(r.email_hour ?? 0) >= EMAIL_PER_HOUR) out.push("email_rate_hour");
  } catch (e) {
    // 🔴 A rate limiter that cannot read its own table FAILS OPEN. The
    // alternative is a database blip closing a public registration form.
    console.error("[form-guard] rate check failed (failing open):", e);
    return [];
  }
  return out;
}

export interface GuardInput {
  form: FormName;
  req: Request;
  email?: string | null;
  name?: string | null;
  /** Free-text fields a human is supposed to have written. */
  text?: (string | null | undefined)[];
  /** Dates the form collected, as submitted. */
  dates?: (string | null | undefined)[];
  /** NZ today, for judging a date in the past. Pass it; never compute UTC here. */
  today?: string;
  page?: string | null;
}

/** The decision. Callers use `ok` to decide whether to send email — nothing else. */
export async function guardPublicForm(input: GuardInput): Promise<GuardVerdict> {
  const ip = clientIp(input.req);
  const body = (input.req.body ?? {}) as Record<string, unknown>;
  const reasons: string[] = [];

  // Honeypot: a field a person can neither see nor tab to. The one signal
  // strong enough to stand alone.
  const hp = typeof body.website === "string" ? body.website.trim() : "";
  if (hp) {
    await logSubmission(input, ip, "held", ["honeypot"]);
    return { ok: false, reasons: ["honeypot"], ip };
  }

  const policy = FORM_POLICY[input.form];
  const t = tokenReason(body.formToken);
  // A missing token only counts once the site is known to send one; a token that
  // is present and WRONG always counts.
  if (t && (t !== "no_form_token" || policy.expectsToken)) reasons.push(t);
  for (const r of contentSignals({ name: input.name, text: input.text, dates: input.dates, today: input.today })) {
    if (r === "link_in_message" && policy.allowLinks) continue;
    reasons.push(r);
  }
  reasons.push(...(await rateReasons(ip, input.email ?? null)));

  // 🔴 Two independent signals, never one. Any single rule fires on somebody
  // real eventually — a household on one connection, a one-word note, a tab
  // left open all afternoon.
  const ok = reasons.length < GUARD_THRESHOLD;
  await logSubmission(input, ip, ok ? "accepted" : "held", reasons);
  return { ok, reasons, ip };
}

async function logSubmission(input: GuardInput, ip: string, outcome: string, reasons: string[]) {
  try {
    await db.execute(sql`
      INSERT INTO public_form_submissions (form, ip, email, outcome, reasons, page)
      VALUES (${input.form}, ${ip}, ${input.email ? input.email.toLowerCase() : null}, ${outcome},
              ${reasons.length ? sql`ARRAY[${sql.join(reasons.map((r) => sql`${r}`), sql`, `)}]::text[]` : null},
              ${input.page ?? null})
    `);
  } catch (e) {
    // Logging must never be able to fail a real submission.
    console.error("[form-guard] log failed:", e);
  }
}
