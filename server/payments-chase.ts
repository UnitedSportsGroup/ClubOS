// Payments due → Reminder and Escalation emails (Ryan, 2026-11-04):
//   "Reminder button that sends out automatic email with a link to pay.
//    Escalation button that sends out official email from GM, no pay no play. And a link to pay."
//
// 🔴 ONE email per FAMILY, never per invoice — two children and a uniform are one conversation.
// 🔴 Amounts are RE-READ FROM XERO at preview and at send, never taken from the 10-minute
//    snapshot: a family that paid five minutes ago must not be chased for it.
// 🔴 The "link to pay" is Xero's own online invoice (in.xero.com/…) — the invoice the family
//    already has, with the bank details on it. A payment there is reconciled in Xero by Olga
//    exactly as today; no new money path. If a card payment service is switched on in Xero
//    (Settings → Payment services → Stripe), the same link gains "Pay now" with no code change.
// 🔴 Escalation is sent in the GM's name, so only leadership can send it (super admin, or an
//    admin/manager of the CUFC workspace). A reminder needs only the page's own permission.
// 🔴 The same kind of email to the same family is refused within 3 days (409), and every send
//    is an append-only row in payment_chase_emails — "were they told, by whom, when?".
import { sql } from "drizzle-orm";
import { db } from "./db";
import { getXeroForOrg } from "./xero";
import { sendEmailDetailed } from "./email";
import { paymentsDue, type DueRow } from "./payments-due";
import { nzTodayIso } from "@shared/academy";

const ORG = 1;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const cents = (n: unknown) => Math.round((Number(n) || 0) * 100);
export const CHASE_GAP_HOURS = 72;

export type ChaseKind = "reminder" | "escalation";

export const SENDERS: Record<ChaseKind, { fromName: string; email: string; signOff: string[] }> = {
  reminder: { fromName: "Christchurch United FC Accounts", email: "accounts@cufc.co.nz", signOff: ["Christchurch United FC Accounts", "accounts@cufc.co.nz"] },
  escalation: { fromName: "Ryan Edwards · Christchurch United FC", email: "ryan@cufc.co.nz", signOff: ["Ryan Edwards", "General Manager, Christchurch United Football Club"] },
};

// From the club's own printed invoice (Xero branding theme, "Bank details for Payments").
const BANK = { bank: "ANZ", name: "Christchurch United Football Club Inc", account: "01-0635-0374823-00" };

export class ChaseError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (c: number) => `$${(c / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso: string | null) => { if (!iso) return "—"; const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const daysBetween = (a: string, b: string) => { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000); };
const joinNames = (n: string[]) => n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;

export async function canEscalate(userId: number): Promise<boolean> {
  const [u] = rowsOf(await db.execute(sql`SELECT role FROM users WHERE id = ${userId}`));
  if (u?.role === "super_admin") return true;
  const [m] = rowsOf(await db.execute(sql`SELECT role FROM user_organizations WHERE user_id = ${userId} AND organization_id = ${ORG}`));
  return m?.role === "admin" || m?.role === "manager";
}

/** Per invoice: the last reminder and the last escalation it was part of (for the page's badges). */
export async function chaseHistory(invoiceIds: string[]): Promise<Record<string, Partial<Record<ChaseKind, { at: string; by: string }>>>> {
  if (!invoiceIds.length) return {};
  const res = rowsOf(await db.execute(sql`
    SELECT e.kind, e.invoice_ids, e.sent_at, NULLIF(btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), '') AS who
      FROM payment_chase_emails e JOIN users u ON u.id = e.sent_by_user_id
     WHERE e.organization_id = ${ORG} AND e.invoice_ids && ${sql`ARRAY[${sql.join(invoiceIds.map((i) => sql`${i}`), sql`, `)}]::text[]`}
     ORDER BY e.sent_at ASC`));
  const out: Record<string, Partial<Record<ChaseKind, { at: string; by: string }>>> = {};
  for (const r of res) for (const id of r.invoice_ids as string[]) {
    (out[id] ??= {})[r.kind as ChaseKind] = { at: new Date(r.sent_at).toISOString(), by: r.who ?? "staff" };
  }
  return out;
}

type Line = { invoiceId: string; invoiceNumber: string | null; childName: string; what: string; due: string | null; daysOverdue: number; owedCents: number; payUrl: string | null };

const payUrlCache = new Map<string, { at: number; url: string | null }>();

/** The family's invoices for this kind, with amounts re-read live from Xero and a pay link each. */
async function liveLines(kind: ChaseKind, familyKey: string): Promise<{ rows: DueRow[]; lines: Line[] }> {
  const snap = await paymentsDue();
  const fam = snap.rows.filter((r) => r.familyKey === familyKey);
  if (!fam.length) throw new ChaseError(404, "That family isn't on the list any more — refresh the page.");
  const picked = kind === "escalation" ? fam.filter((r) => r.status === "overdue") : fam;
  if (!picked.length) throw new ChaseError(409, "Nothing this family owes is overdue yet, so there is nothing to escalate. Send a reminder instead.");

  const { xero, tenantId } = await getXeroForOrg(ORG);
  const r = await xero.accountingApi.getInvoices(tenantId, undefined, undefined, undefined, picked.map((p) => p.invoiceId),
    undefined, undefined, ["AUTHORISED"], undefined, false, undefined, undefined, false);
  const live = new Map(((r.body.invoices ?? []) as any[]).map((i) => [String(i.invoiceID), i]));
  const today = nzTodayIso();
  const lines: Line[] = [];
  for (const p of picked) {
    const i = live.get(p.invoiceId);
    const owed = i ? cents(i.amountDue) : 0;
    if (owed <= 0) continue; // paid, voided or credited since the snapshot
    let payUrl: string | null = null;
    const c = payUrlCache.get(p.invoiceId);
    if (c && Date.now() - c.at < 6 * 3600_000) payUrl = c.url;
    else {
      try {
        const o: any = await xero.accountingApi.getOnlineInvoice(tenantId, p.invoiceId);
        payUrl = o.body.onlineInvoices?.[0]?.onlineInvoiceUrl ?? null;
      } catch { payUrl = null; }
      payUrlCache.set(p.invoiceId, { at: Date.now(), url: payUrl });
    }
    lines.push({
      invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber, childName: p.childName,
      what: p.reference || p.programmeLabel, due: p.due,
      daysOverdue: p.due ? Math.max(0, daysBetween(p.due, today)) : 0, owedCents: owed, payUrl,
    });
  }
  if (!lines.length) throw new ChaseError(409, "Xero shows everything this family owed is now paid — nothing to send.");
  return { rows: fam, lines };
}

function render(kind: ChaseKind, rows: DueRow[], lines: Line[], note: string | null) {
  const first = (rows.find((r) => r.parentName)?.parentName ?? "").trim().split(/\s+/)[0] || "there";
  const kids = Array.from(new Set(lines.map((l) => l.childName.trim().split(/\s+/)[0]))).filter(Boolean);
  const kidsLong = joinNames(Array.from(new Set(lines.map((l) => l.childName))));
  const total = lines.reduce((s, l) => s + l.owedCents, 0);
  const oldest = Math.max(...lines.map((l) => l.daysOverdue));
  const s = SENDERS[kind];

  const subject = kind === "reminder"
    ? `Reminder: club fees for ${joinNames(kids)}`
    : `Overdue club fees for ${joinNames(kids)}: action needed`;

  const intro = kind === "reminder"
    ? [`Kia ora ${first},`, `A friendly reminder that the following is still owing to Christchurch United for ${kidsLong}.`]
    : [`Kia ora ${first},`, `I'm writing as General Manager of Christchurch United because the fees below for ${kidsLong} are overdue${oldest > 0 ? `, the oldest by ${oldest} day${oldest === 1 ? "" : "s"}` : ""}.`];
  const after = kind === "reminder"
    ? ["You can pay with the <b>View &amp; pay</b> link beside each invoice, or by bank transfer using the details below.",
       "If you've paid in the last few days, thank you, and please ignore this. Questions, or want to spread it out? Just reply to this email."]
    : ["Our policy is simple: <b>no pay, no play</b>. Until this is paid, or a payment plan is agreed with us, " + esc(joinNames(kids)) + " can't take part in training or games.",
       "Please pay within 7 days with the <b>View &amp; pay</b> link beside each invoice, or by bank transfer using the details below.",
       "If something is making it hard to pay right now, reply to this email and we'll work out a plan together."];

  const P = (t: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1f2e;">${t}</p>`;
  const tr = lines.map((l) => `
    <tr>
      <td style="padding:10px 8px 10px 0;border-top:1px solid #e6e8ee;font-size:14px;color:#1a1f2e;vertical-align:top;">
        <b>${esc(l.childName)}</b><br><span style="color:#5b6275;font-size:13px;">${esc(l.what)} · ${esc(l.invoiceNumber ?? "")}</span><br>
        <span style="font-size:13px;color:${l.daysOverdue > 0 ? "#b42318" : "#5b6275"};">${l.daysOverdue > 0 ? `Due ${dateLabel(l.due)} · ${l.daysOverdue} day${l.daysOverdue === 1 ? "" : "s"} overdue` : `Due ${dateLabel(l.due)}`}</span>
      </td>
      <td style="padding:10px 0;border-top:1px solid #e6e8ee;font-size:15px;font-weight:700;color:#1a1f2e;text-align:right;vertical-align:top;white-space:nowrap;">
        ${money(l.owedCents)}<br>${l.payUrl ? `<a href="${esc(l.payUrl)}" style="display:inline-block;margin-top:6px;background:#0b1a3a;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:7px 12px;border-radius:8px;">View &amp; pay</a>` : ""}
      </td>
    </tr>`).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f7;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:28px 14px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ee;border-radius:14px;padding:28px 24px;">
      <img src="https://app.usg.co.nz/mailer/crests/cufc.png" alt="Christchurch United FC" width="56" style="display:block;margin:0 0 18px;height:auto;">
      ${intro.map((t) => P(esc(t))).join("")}
      ${note ? P(esc(note).replace(/\n/g, "<br>")) : ""}
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:6px 0 4px;">
        ${tr}
        <tr><td style="padding:12px 0;border-top:2px solid #1a1f2e;font-size:14px;font-weight:700;color:#1a1f2e;">Total owing</td>
            <td style="padding:12px 0;border-top:2px solid #1a1f2e;font-size:16px;font-weight:800;color:#1a1f2e;text-align:right;">${money(total)}</td></tr>
      </table>
      ${after.map((t) => P(t)).join("")}
      <div style="background:#f6f7fa;border-radius:10px;padding:12px 14px;margin:4px 0 18px;font-size:13px;line-height:1.7;color:#1a1f2e;">
        <b>Bank transfer</b><br>${BANK.bank} · ${esc(BANK.name)}<br>Account ${BANK.account}<br>Reference: the invoice number
      </div>
      <p style="margin:0;font-size:15px;line-height:1.6;color:#1a1f2e;">Ngā mihi,<br><b>${esc(s.signOff[0])}</b><br><span style="color:#5b6275;font-size:13px;">${esc(s.signOff[1])}</span></p>
    </div>
    <p style="text-align:center;color:#8a90a2;font-size:11px;margin:16px 0 0;">Christchurch United Football Club · 466 Yaldhurst Road, Christchurch</p>
  </div></body></html>`;

  const text = [
    ...intro, ...(note ? [note] : []), "",
    ...lines.map((l) => `${l.childName} · ${l.what} · ${l.invoiceNumber ?? ""} · due ${dateLabel(l.due)}${l.daysOverdue > 0 ? ` (${l.daysOverdue} days overdue)` : ""} · ${money(l.owedCents)}${l.payUrl ? `\n  View & pay: ${l.payUrl}` : ""}`),
    `Total owing: ${money(total)}`, "",
    ...after.map((t) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")), "",
    `Bank transfer: ${BANK.bank} · ${BANK.name} · ${BANK.account} · reference: the invoice number`, "",
    "Ngā mihi,", ...s.signOff,
  ].join("\n");
  return { subject, html, text, totalCents: total };
}

async function lastSent(familyKey: string, kind: ChaseKind) {
  const [r] = rowsOf(await db.execute(sql`
    SELECT e.sent_at, e.to_email, NULLIF(btrim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')), '') AS who
      FROM payment_chase_emails e JOIN users u ON u.id = e.sent_by_user_id
     WHERE e.organization_id = ${ORG} AND e.family_key = ${familyKey} AND e.kind = ${kind}
     ORDER BY e.sent_at DESC LIMIT 1`));
  return r ? { at: new Date(r.sent_at).toISOString(), by: (r.who as string) ?? "staff", to: String(r.to_email) } : null;
}

function recipient(rows: DueRow[]): string {
  const to = rows.find((r) => r.parentEmail)?.parentEmail?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ChaseError(409, "There's no email address on file for this family — call them instead.");
  return to;
}

export async function previewChase(kind: ChaseKind, familyKey: string, note: string | null) {
  const { rows, lines } = await liveLines(kind, familyKey);
  const to = recipient(rows);
  const msg = render(kind, rows, lines, note);
  const last = await lastSent(familyKey, kind);
  const s = SENDERS[kind];
  return {
    to, from: `${s.fromName} <${s.email}>`, subject: msg.subject, html: msg.html, totalCents: msg.totalCents,
    invoices: lines.map((l) => ({ invoiceNumber: l.invoiceNumber, childName: l.childName, owedCents: l.owedCents, hasPayLink: !!l.payUrl })),
    lastSent: last,
    blockedUntil: last && Date.now() - Date.parse(last.at) < CHASE_GAP_HOURS * 3600_000 ? new Date(Date.parse(last.at) + CHASE_GAP_HOURS * 3600_000).toISOString() : null,
  };
}

export async function sendChase(kind: ChaseKind, familyKey: string, note: string | null, userId: number) {
  if (kind === "escalation" && !(await canEscalate(userId))) throw new ChaseError(403, "An escalation goes out in the GM's name, so only club leadership can send it.");
  const last = await lastSent(familyKey, kind);
  if (last && Date.now() - Date.parse(last.at) < CHASE_GAP_HOURS * 3600_000) {
    throw new ChaseError(409, `${last.by} already sent this family a${kind === "escalation" ? "n escalation" : " reminder"} on ${new Date(last.at).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Wait 3 days before sending another.`);
  }
  const { rows, lines } = await liveLines(kind, familyKey);
  const to = recipient(rows);
  const msg = render(kind, rows, lines, note);
  const s = SENDERS[kind];
  const res = await sendEmailDetailed({ from: `${s.fromName} <${s.email}>`, replyTo: s.email, to, subject: msg.subject, html: msg.html, text: msg.text });
  if (!res.ok) throw new ChaseError(502, "The email didn't go — nothing was recorded. Try again in a minute.");
  await db.execute(sql`
    INSERT INTO payment_chase_emails (organization_id, kind, family_key, to_email, from_email, invoice_ids, invoice_numbers, owed_cents, note, sent_by_user_id, resend_id)
    VALUES (${ORG}, ${kind}, ${familyKey}, ${to}, ${s.email},
            ${sql`ARRAY[${sql.join(lines.map((l) => sql`${l.invoiceId}`), sql`, `)}]::text[]`},
            ${sql`ARRAY[${sql.join(lines.map((l) => sql`${l.invoiceNumber ?? ""}`), sql`, `)}]::text[]`},
            ${msg.totalCents}, ${note}, ${userId}, ${res.id})`);
  return { to, subject: msg.subject, invoices: lines.length, totalCents: msg.totalCents };
}
