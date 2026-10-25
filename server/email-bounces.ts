// Bounces, fed back (Daniel, 2026-10-25: "feed back the bounces as that's
// useful data, how we do it in the best way is the question").
//
// THE BEST WAY, as built: Resend already calls ONE webhook for every email the
// account sends — booking receipts, Mailer campaigns, automations, sales
// outreach, chat away-mails. Every `email.bounced` / `email.complained` event
// lands in `email_bounces`, keyed by ADDRESS, whatever feature sent the
// message. One list, every sender, no feature has to remember to write it.
//
// Readers (the Mailer's search chips, Preview Recipients, the send itself)
// ask `bounceMap()` and get the same answer.
//
// 🔴 PERMANENT bounce or COMPLAINT = that mailbox will not take our mail; the
// Mailer flags it and leaves it out of a send. TRANSIENT (mailbox full,
// greylisted) = recorded and flagged, still sent to — a full inbox on Tuesday
// is not a dead address. 🔴 A human can CLEAR a record ("they fixed it"); the
// next bounce re-opens it. 🔴 Nothing here can BLOCK a webhook — a bad
// payload is logged and the event still answers 200, or Resend retries forever.
import { sql } from "drizzle-orm";
import { db } from "./db";

export type BounceKind = "permanent" | "transient" | "complaint";
export type BounceRecord = {
  email: string;
  kind: BounceKind;
  bounceType: string | null;
  bounceSubtype: string | null;
  reason: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  lastSubject: string | null;
};

const clean = (e: unknown) => String(e ?? "").trim().toLowerCase();

/** Resend's payload → a kind. `data.bounce.type` is "Permanent" | "Transient"
 *  | "Undetermined"; a complaint has no bounce block. Undetermined counts as
 *  transient: we were not told the mailbox is gone. */
function kindOf(eventType: string, bounce: any): BounceKind | null {
  if (eventType === "email.complained") return "complaint";
  if (eventType !== "email.bounced") return null;
  const t = String(bounce?.type ?? "").toLowerCase();
  return t === "permanent" ? "permanent" : "transient";
}

/** Record one Resend event. Returns how many addresses were written. */
export async function recordResendBounce(body: any): Promise<number> {
  const eventType = String(body?.type ?? "");
  const data = body?.data ?? {};
  const kind = kindOf(eventType, data.bounce);
  if (!kind) return 0;
  const to: string[] = (Array.isArray(data.to) ? data.to : [data.to]).map(clean).filter((e: string) => e.includes("@"));
  if (!to.length) return 0;
  const at = body?.created_at ? new Date(body.created_at) : new Date();
  const bounceType = data.bounce?.type ? String(data.bounce.type) : null;
  const bounceSubtype = data.bounce?.subType ? String(data.bounce.subType) : null;
  const reason = data.bounce?.message ? String(data.bounce.message).slice(0, 1000) : null;
  const subject = data.subject ? String(data.subject).slice(0, 300) : null;
  const providerId = data.email_id ? String(data.email_id) : null;
  let n = 0;
  for (const email of to) {
    // A permanent verdict is never downgraded by a later transient one; a
    // cleared record re-opens on any new bounce.
    await db.execute(sql`
      INSERT INTO email_bounces (email, kind, bounce_type, bounce_subtype, reason, count, first_at, last_at, last_subject, last_provider_id)
      VALUES (${email}, ${kind}, ${bounceType}, ${bounceSubtype}, ${reason}, 1, ${at}, ${at}, ${subject}, ${providerId})
      ON CONFLICT (email) DO UPDATE SET
        kind = CASE WHEN email_bounces.kind IN ('permanent','complaint') AND email_bounces.cleared_at IS NULL THEN email_bounces.kind ELSE EXCLUDED.kind END,
        bounce_type = COALESCE(EXCLUDED.bounce_type, email_bounces.bounce_type),
        bounce_subtype = COALESCE(EXCLUDED.bounce_subtype, email_bounces.bounce_subtype),
        reason = COALESCE(EXCLUDED.reason, email_bounces.reason),
        count = email_bounces.count + 1,
        last_at = GREATEST(email_bounces.last_at, EXCLUDED.last_at),
        last_subject = COALESCE(EXCLUDED.last_subject, email_bounces.last_subject),
        last_provider_id = COALESCE(EXCLUDED.last_provider_id, email_bounces.last_provider_id),
        cleared_at = NULL, cleared_by_user_id = NULL`);
    n++;
  }
  return n;
}

/** Open (uncleared) bounce records for these addresses. */
export async function bounceMap(emails: string[]): Promise<Map<string, BounceRecord>> {
  const out = new Map<string, BounceRecord>();
  const wanted = Array.from(new Set(emails.map(clean).filter((e) => e.includes("@"))));
  for (let i = 0; i < wanted.length; i += 1000) {
    const chunk = wanted.slice(i, i + 1000);
    const { rows }: any = await db.execute(sql`
      SELECT email, kind, bounce_type, bounce_subtype, reason, count, first_at, last_at, last_subject
        FROM email_bounces
       WHERE cleared_at IS NULL AND email IN (${sql.join(chunk.map((e) => sql`${e}`), sql`, `)})`);
    for (const r of rows) {
      out.set(r.email, {
        email: r.email, kind: r.kind, bounceType: r.bounce_type, bounceSubtype: r.bounce_subtype,
        reason: r.reason, count: Number(r.count), firstAt: String(r.first_at), lastAt: String(r.last_at), lastSubject: r.last_subject,
      });
    }
  }
  return out;
}

/** Addresses a send must leave out: a permanent bounce or a complaint. */
export function isDeadMailbox(b: BounceRecord | undefined): boolean {
  return !!b && (b.kind === "permanent" || b.kind === "complaint");
}

/** "bounced 3 Oct — mailbox doesn't exist" — one line for a chip. */
export function bounceLabel(b: BounceRecord): string {
  const when = new Date(b.lastAt);
  const day = isNaN(when.getTime()) ? "" : when.toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "Pacific/Auckland" });
  const what = b.kind === "complaint" ? "marked us as spam" : b.kind === "permanent" ? "bounced — mailbox doesn't exist" : "bounced — mailbox full or temporarily unavailable";
  return day ? `${what} (${day})` : what;
}
