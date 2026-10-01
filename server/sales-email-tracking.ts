// ─────────────────────────────────────────────────────────────────────────────
// SALES EMAIL TRACKING — what happened after a sales email went out.
//
//   GET  /t/se/:token/o.gif        open pixel (always answers the gif)
//   GET  /t/se/:token/:i           tracked link → 302 to links[i] of THAT email
//   POST /api/public/resend/webhook  delivered / bounced / complained / delayed
//
// 🔴 The redirect reads the destination from the email's own stored links, so
//    it can never be used as an open redirect: an unknown token or index goes
//    to unitedprints.co.nz, never to a URL taken from the request.
// 🔴 The webhook is verified (Svix signature, RESEND_WEBHOOK_SECRET) and its
//    event id is UNIQUE in the table, so a retry is a no-op. Resend sends every
//    ClubOS email's events here; only ones belonging to a sales email are kept.
// 🔴 Quote submitted / order confirmed / paid are DERIVED from print_quotes and
//    print_orders at read time — never copied — matched on the exact address,
//    or the company's domain when it isn't a free mailbox (FREE_MAIL_DOMAINS),
//    and only if they happened AFTER the email was sent.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { FREE_MAIL_DOMAINS, emailDomain, type OutreachStep } from "@shared/sales";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const FALLBACK = "https://unitedprints.co.nz/";

/** Mail scanners (Outlook Safe Links, Mimecast, Barracuda…) fetch links and
 *  images before a human does. Recorded, but labelled, never counted as a person. */
export function looksLikeScanner(ua: string | null | undefined): boolean {
  return /bot|crawler|spider|preview|scanner|safelinks|mimecast|barracuda|proofpoint|urldefense|symantec|trend ?micro|headless/i.test(ua ?? "");
}

async function emailByToken(token: string): Promise<{ id: number; links: Array<{ url: string }> } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const r: any = await db.execute(sql`SELECT id, links FROM sales_emails WHERE token = ${token} LIMIT 1`);
  const row = r.rows?.[0];
  return row ? { id: Number(row.id), links: Array.isArray(row.links) ? row.links : [] } : null;
}

async function record(emailId: number, type: string, extra: { linkIndex?: number; url?: string; ua?: string | null; at?: string; providerEventId?: string } = {}) {
  await db.execute(sql`
    INSERT INTO sales_email_events (sales_email_id, type, link_index, url, user_agent, occurred_at, provider_event_id)
    VALUES (${emailId}, ${type}, ${extra.linkIndex ?? null}, ${extra.url ?? null}, ${(extra.ua ?? "").slice(0, 300) || null},
            ${extra.at ?? new Date().toISOString()}, ${extra.providerEventId ?? null})
    ON CONFLICT (provider_event_id) DO NOTHING`);
}

/** Svix: HMAC-SHA256 of "id.timestamp.body" with the base64 secret after "whsec_". */
function verifySvix(req: Request, secret: string): boolean {
  const id = String(req.headers["svix-id"] ?? "");
  const ts = String(req.headers["svix-timestamp"] ?? "");
  const sigs = String(req.headers["svix-signature"] ?? "");
  const raw = (req as any).rawBody as Buffer | undefined;
  if (!id || !ts || !sigs || !raw) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw.toString("utf8")}`).digest();
  return sigs.split(" ").some((part) => {
    const [, b64] = part.split(",");
    if (!b64) return false;
    const got = Buffer.from(b64, "base64");
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

const RESEND_TYPES: Record<string, string> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.delivery_delayed": "delivery_delayed",
};

export function registerSalesEmailPublicRoutes(app: Express) {
  app.get("/t/se/:token/o.gif", async (req: Request, res: Response) => {
    res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(GIF.length) });
    try {
      const e = await emailByToken(String(req.params.token));
      if (e) await record(e.id, "opened", { ua: req.headers["user-agent"] ?? null });
    } catch (err) { console.error("[sales-email] open", err); }
    res.end(GIF);
  });

  // ── Unsubscribe ───────────────────────────────────────────────────────────
  // 🔴 GET only SHOWS a confirm button; the POST does it. Mail scanners and
  // link-preview bots fetch every URL in an email, and a GET that unsubscribed
  // would silently opt people out who never asked. Gmail/Apple's own button
  // uses RFC 8058 one-click, which is a POST, so it lands on the same handler.
  // Registered BEFORE "/t/se/:token/:i", which would otherwise swallow it.
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · United Prints</title></head><body style="margin:0;background:#f4f6fa;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0b1b33">
<div style="max-width:440px;margin:12vh auto 0;padding:32px 24px;background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(11,27,51,.08);text-align:center">
<div style="font-weight:800;letter-spacing:.06em;font-size:13px;color:#1f4fd8">UNITED PRINTS</div>${body}</div></body></html>`;
  async function unsubTarget(token: string): Promise<{ id: number; orgId: number; email: string } | null> {
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
    const r: any = await db.execute(sql`SELECT id, organization_id, to_email FROM sales_emails WHERE token = ${token} LIMIT 1`);
    const row = (r.rows ?? r)[0];
    return row ? { id: Number(row.id), orgId: Number(row.organization_id), email: String(row.to_email) } : null;
  }
  const escHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

  app.get("/t/se/:token/unsubscribe", async (req: Request, res: Response) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    const t = await unsubTarget(String(req.params.token)).catch(() => null);
    if (!t) return res.status(404).send(page("Link not found", `<h1 style="font-size:20px;margin:16px 0 8px">That link doesn't work any more</h1><p style="color:#52607a;font-size:14px">Email <a href="mailto:orders@unitedprints.co.nz">orders@unitedprints.co.nz</a> and we'll take you off our list.</p>`));
    res.send(page("Unsubscribe", `<h1 style="font-size:20px;margin:16px 0 8px">Stop emails from United Prints?</h1>
<p style="color:#52607a;font-size:14px;margin:0 0 20px">We won't email <b>${escHtml(t.email)}</b> again.</p>
<form method="post"><button type="submit" style="background:#1f4fd8;color:#fff;border:0;border-radius:10px;padding:13px 22px;font-size:15px;font-weight:700;cursor:pointer;min-height:44px">Unsubscribe</button></form>`));
  });

  app.post("/t/se/:token/unsubscribe", async (req: Request, res: Response) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    try {
      const t = await unsubTarget(String(req.params.token));
      if (!t) return res.status(404).send(page("Link not found", `<h1 style="font-size:20px;margin:16px 0 8px">That link doesn't work any more</h1><p style="color:#52607a;font-size:14px">Email <a href="mailto:orders@unitedprints.co.nz">orders@unitedprints.co.nz</a> and we'll take you off our list.</p>`));
      const oneClick = /List-Unsubscribe=One-Click/i.test(JSON.stringify(req.body ?? {}));
      const ins: any = await db.execute(sql`
        INSERT INTO sales_email_optouts (organization_id, email, sales_email_id, source)
        VALUES (${t.orgId}, ${t.email.toLowerCase()}, ${t.id}, ${oneClick ? "one-click" : "link"})
        ON CONFLICT (organization_id, lower(email)) DO NOTHING RETURNING id`);
      // One event, the first time — a second click is not a second unsubscribe.
      // 🔴 Best-effort: the opt-out above IS the unsubscribe. A failure to log the
      // journey event must never show the person an error page for something
      // that worked (it did, once — the type CHECK didn't know 'unsubscribed').
      if ((ins.rows ?? ins).length) {
        await record(t.id, "unsubscribed", { ua: req.headers["user-agent"] ?? null })
          .catch((e) => console.error("[sales-email] unsubscribe event not logged", e));
      }
      res.send(page("Unsubscribed", `<h1 style="font-size:20px;margin:16px 0 8px">You're unsubscribed</h1><p style="color:#52607a;font-size:14px;margin:0">We won't email <b>${escHtml(t.email)}</b> again. If you ever need printing, we're at <a href="https://unitedprints.co.nz">unitedprints.co.nz</a>.</p>`));
    } catch (err) {
      console.error("[sales-email] unsubscribe", err);
      res.status(500).send(page("Something went wrong", `<h1 style="font-size:20px;margin:16px 0 8px">That didn't go through</h1><p style="color:#52607a;font-size:14px">Please email <a href="mailto:orders@unitedprints.co.nz">orders@unitedprints.co.nz</a> and we'll take you off our list.</p>`));
    }
  });

  app.get("/t/se/:token/:i", async (req: Request, res: Response) => {
    let to = FALLBACK;
    try {
      const e = await emailByToken(String(req.params.token));
      const i = Number(req.params.i);
      const link = e && Number.isInteger(i) && i >= 0 ? e.links[i] : undefined;
      if (e && link?.url && /^https?:\/\//i.test(link.url)) {
        to = link.url;
        await record(e.id, "clicked", { linkIndex: i, url: link.url, ua: req.headers["user-agent"] ?? null });
      }
    } catch (err) { console.error("[sales-email] click", err); }
    res.set("Cache-Control", "no-store");
    res.redirect(302, to);
  });

  app.post("/api/public/resend/webhook", async (req: Request, res: Response) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ message: "Webhook not configured" });
    if (!verifySvix(req, secret)) return res.status(401).json({ message: "Bad signature" });
    try {
      const type = RESEND_TYPES[String(req.body?.type ?? "")];
      const messageId = String(req.body?.data?.email_id ?? "");
      if (type && messageId) {
        const r: any = await db.execute(sql`SELECT id FROM sales_emails WHERE provider_message_id = ${messageId} LIMIT 1`);
        const row = r.rows?.[0];
        if (row) await record(Number(row.id), type, { at: req.body?.created_at ?? undefined, providerEventId: String(req.headers["svix-id"]) });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[sales-email] webhook", err);
      res.status(500).json({ message: "Failed" }); // Resend retries
    }
  });
}

// ── The journey, read side ──────────────────────────────────────────────────

export interface JourneyEvent { step: OutreachStep | "bounced" | "complained" | "delivery_delayed"; at: string | null; detail?: string; scanner?: boolean; href?: string }
export interface EmailJourney {
  id: number; prospectId: number; to: string; subject: string; body: string; sentAt: string;
  attachments: Array<{ filename: string; bytes: number }>;
  links: Array<{ url: string; label: string; clicks: number }>;
  opens: number; clicks: number;
  reached: OutreachStep; bounced: boolean;
  events: JourneyEvent[];
  quotes: Array<{ id: number; at: string; totalCents: number; status: string; matchedBy: "address" | "domain" }>;
  orders: Array<{ id: number; number: string | null; at: string; totalCents: number; paidCents: number; paidAt: string | null; status: string; matchedBy: "address" | "domain" }>;
}

const iso = (v: any): string | null => (v == null ? null : new Date(v).toISOString());
const ORDER_NOT_CONFIRMED = new Set(["draft", "inquiry", "quoted", "quote_sent", "cancelled"]);

/** Every sales email for these prospects (or the whole org), with its journey. */
export async function emailJourneys(orgId: number, prospectId?: number): Promise<EmailJourney[]> {
  const emails: any = await db.execute(sql`
    SELECT id, prospect_id, to_email, subject, body, links, attachments, sent_at
    FROM sales_emails WHERE organization_id = ${orgId} ${prospectId ? sql`AND prospect_id = ${prospectId}` : sql``}
    ORDER BY sent_at DESC`);
  const rows: any[] = emails.rows ?? [];
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const ev: any = await db.execute(sql`
    SELECT sales_email_id, type, occurred_at, link_index, url, user_agent FROM sales_email_events
    WHERE sales_email_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY occurred_at`);
  const byEmail = new Map<number, any[]>();
  for (const e of ev.rows ?? []) {
    const k = Number(e.sales_email_id);
    if (!byEmail.has(k)) byEmail.set(k, []);
    byEmail.get(k)!.push(e);
  }

  // Quotes and orders from the addresses and company domains these went to.
  const addrs = Array.from(new Set(rows.map((r) => String(r.to_email).toLowerCase())));
  const domains = Array.from(new Set(addrs.map(emailDomain).filter((d): d is string => !!d && !FREE_MAIL_DOMAINS.has(d))));
  const who = (col: string) => sql`(lower(${sql.raw(col)}) IN (${sql.join(addrs.map((a) => sql`${a}`), sql`, `)})
      ${domains.length ? sql`OR split_part(lower(${sql.raw(col)}), '@', 2) IN (${sql.join(domains.map((d) => sql`${d}`), sql`, `)})` : sql``})`;
  const quotes: any = await db.execute(sql`
    SELECT id, lower(customer_email) AS email, created_at, total_cents, status FROM print_quotes
    WHERE organization_id = ${orgId} AND customer_email IS NOT NULL AND ${who("customer_email")}`);
  const orders: any = await db.execute(sql`
    SELECT o.id, o.order_number, lower(o.customer_email) AS email, o.created_at, o.total_cents, o.paid_cents, o.status::text AS status,
           (SELECT min(e.created_at) FROM print_order_events e WHERE e.order_id = o.id AND e.event_type = 'paid') AS paid_at
    FROM print_orders o
    WHERE o.organization_id = ${orgId} AND o.customer_email IS NOT NULL AND ${who("o.customer_email")}`);

  return rows.map((r) => {
    const sentAt = iso(r.sent_at)!;
    const to = String(r.to_email).toLowerCase();
    const dom = emailDomain(to);
    const match = (email: string): "address" | "domain" | null =>
      email === to ? "address" : dom && !FREE_MAIL_DOMAINS.has(dom) && emailDomain(email) === dom ? "domain" : null;
    const after = (at: any) => new Date(at).getTime() >= new Date(sentAt).getTime();

    const links: Array<{ url: string; label: string }> = Array.isArray(r.links) ? r.links : [];
    const evs = byEmail.get(Number(r.id)) ?? [];
    const events: JourneyEvent[] = [{ step: "sent", at: sentAt, detail: `to ${r.to_email}` }];
    let opens = 0, clicks = 0;
    const linkClicks = links.map(() => 0);
    for (const e of evs) {
      const scanner = looksLikeScanner(e.user_agent);
      if (e.type === "opened") { if (!scanner) opens++; events.push({ step: "opened", at: iso(e.occurred_at), scanner }); }
      else if (e.type === "clicked") {
        if (!scanner) { clicks++; if (e.link_index != null && linkClicks[e.link_index] != null) linkClicks[e.link_index]++; }
        events.push({ step: "clicked", at: iso(e.occurred_at), detail: links[e.link_index]?.label ?? e.url, href: e.url ?? undefined, scanner });
      } else events.push({ step: e.type, at: iso(e.occurred_at) });
    }
    const q = (quotes.rows ?? []).map((x: any) => ({ x, m: match(x.email) })).filter((y: any) => y.m && after(y.x.created_at))
      .map(({ x, m }: any) => ({ id: Number(x.id), at: iso(x.created_at)!, totalCents: Number(x.total_cents), status: String(x.status), matchedBy: m }));
    const o = (orders.rows ?? []).map((x: any) => ({ x, m: match(x.email) })).filter((y: any) => y.m && after(y.x.created_at) && !ORDER_NOT_CONFIRMED.has(y.x.status))
      .map(({ x, m }: any) => ({
        id: Number(x.id), number: x.order_number ?? null, at: iso(x.created_at)!, totalCents: Number(x.total_cents), paidCents: Number(x.paid_cents),
        paidAt: iso(x.paid_at), status: String(x.status), matchedBy: m,
      }));
    for (const x of q) events.push({ step: "quoted", at: x.at, detail: `Quote #${x.id} · $${(x.totalCents / 100).toFixed(2)}${x.matchedBy === "domain" ? " · same company" : ""}` });
    for (const x of o) {
      events.push({ step: "ordered", at: x.at, detail: `${x.number ?? `Order #${x.id}`} · $${(x.totalCents / 100).toFixed(2)}${x.matchedBy === "domain" ? " · same company" : ""}` });
      const paid = x.status === "paid" || (x.totalCents > 0 && x.paidCents >= x.totalCents);
      if (paid || x.paidAt) events.push({ step: "paid", at: x.paidAt, detail: `${x.number ?? `Order #${x.id}`} · $${(x.paidCents / 100).toFixed(2)}${x.paidAt ? "" : " · time not recorded"}` });
    }
    events.sort((a, b) => (a.at ?? "9999").localeCompare(b.at ?? "9999"));

    const has = (s: string) => events.some((e) => e.step === s && !e.scanner);
    const order: OutreachStep[] = ["paid", "ordered", "quoted", "clicked", "opened", "delivered", "sent"];
    const reached = order.find((s) => has(s)) ?? "sent";
    return {
      id: Number(r.id), prospectId: Number(r.prospect_id), to: String(r.to_email), subject: String(r.subject), body: String(r.body),
      sentAt, attachments: Array.isArray(r.attachments) ? r.attachments : [],
      links: links.map((l, i) => ({ ...l, clicks: linkClicks[i] })),
      opens, clicks, reached, bounced: has("bounced"), events, quotes: q, orders: o,
    };
  });
}
