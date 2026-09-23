// ─────────────────────────────────────────────────────────────────────────────
// SALES — United Print prospect database + pipeline. Prints workspace,
// super-admin only while Daniel shapes it (see SUPER_ADMIN_ONLY_TABS).
//
//   GET|POST         /api/admin/sales/prospects
//   GET|PATCH|DELETE /api/admin/sales/prospects/:id
//   POST             /api/admin/sales/prospects/:id/activities
//   PATCH|DELETE     /api/admin/sales/prospects/:id/activities/:childId
//   POST             /api/admin/sales/prospects/:id/email   (send + log + New→Contacted)
//
// Org scoping. `organizationId` always comes from the X-Workspace-Slug header
// via `workspaceOrg`, never from the request body — same as vehicles/housing.
//
// Pipeline rules:
//   - A stage change always leaves an activity row behind. Who was contacted
//     when is the sales history Daniel is training himself on.
//   - Moving to won/paid promotes the prospect into print_contacts (the CRM
//     tab) exactly once — a customer should exist where orders live.
//   - "Follow-up due" is DERIVED from next_follow_up_on vs today, never stored.
//   - Money in integer cents; dates as ISO strings, never through `new Date()`.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";
import { organizations, printContacts, salesActivities, salesEmails, salesProspects, users } from "@shared/schema";
import { sendEmailDetailed } from "./email";
import crypto from "crypto";
import { emailJourneys } from "./sales-email-tracking";
import { nzTodayIso } from "@shared/academy";
import {
  OPEN_PIPELINE_STAGES,
  OUTREACH_FOOTER,
  OUTREACH_ATTACHMENT_MAX_BYTES,
  OUTREACH_ATTACHMENT_MAX_FILES,
  OUTREACH_ATTACHMENT_TYPES,
  outreachPlainText,
  renderOutreachBody,
  isIsoDate,
  isSalesActivityType,
  isSalesOutcome,
  isSalesRegion,
  isSalesStage,
  isSalesTier,
  stageLabel,
  type SalesStage,
} from "@shared/sales";

// ── Org scoping (mirrors workspaceOrg in routes.ts, which isn't exported) ─────
async function workspaceOrg(req: Request): Promise<{ id: number; slug: string } | null> {
  const slug = String(req.headers["x-workspace-slug"] || "").trim();
  if (!slug) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
  return org ? { id: org.id, slug: org.slug } : null;
}

class BadRequest extends Error {}
class NotFound extends Error {}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};
const reqStr = (v: unknown, field: string): string => {
  const s = str(v);
  if (!s) throw new BadRequest(`${field} is required`);
  return s;
};
const int = (v: unknown, field: string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isInteger(n)) throw new BadRequest(`${field} must be a whole number`);
  return n;
};
const reqInt = (v: unknown, field: string): number => {
  const n = int(v, field);
  if (n === null) throw new BadRequest(`${field} is required`);
  return n;
};
const isoDate = (v: unknown, field: string): string | null => {
  const s = str(v);
  if (!s) return null;
  if (!isIsoDate(s)) throw new BadRequest(`${field} must be a date (YYYY-MM-DD)`);
  return s;
};
function pick<T extends string>(v: unknown, guard: (x: unknown) => x is T, field: string, fallback?: T): T {
  const s = str(v);
  if (!s) {
    if (fallback !== undefined) return fallback;
    throw new BadRequest(`${field} is required`);
  }
  if (!guard(s)) throw new BadRequest(`${field} "${s}" is not one of the allowed values`);
  return s;
}
/** services_match: an array of short strings, or nothing. Never trusted deep. */
const strArray = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim().slice(0, 40));
  return out.length ? out.slice(0, 12) : null;
};

function friendlyDbError(err: any): { status: number; message: string } | null {
  if (err?.code === "23505") {
    switch (err.constraint) {
      case "sales_prospects_org_website_unq":
        return { status: 409, message: "A prospect with that website is already in the database." };
      default:
        return { status: 409, message: "That record already exists." };
    }
  }
  if (err?.code === "23514") {
    return { status: 400, message: "That value isn't allowed." };
  }
  return null;
}

function handler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      if (err instanceof BadRequest) return res.status(400).json({ message: err.message });
      if (err instanceof NotFound) return res.status(404).json({ message: err.message });
      const friendly = friendlyDbError(err);
      if (friendly) return res.status(friendly.status).json({ message: friendly.message });
      console.error("[sales]", req.method, req.path, err);
      if (!res.headersSent) res.status(500).json({ message: "Something went wrong." });
    }
  };
}

export function registerSalesRoutes(app: Express) {
  const tab = requireTab("sales");

  async function orgOf(req: Request): Promise<number> {
    const org = await workspaceOrg(req);
    if (!org) throw new BadRequest("X-Workspace-Slug header required");
    return org.id;
  }

  async function prospectOf(req: Request, orgId: number) {
    const id = reqInt(req.params.id, "prospect id");
    const [p] = await db
      .select()
      .from(salesProspects)
      .where(and(eq(salesProspects.id, id), eq(salesProspects.organizationId, orgId)));
    if (!p) throw new NotFound("Prospect not found");
    return p;
  }

  const userId = (req: Request) => req.session.userId ?? null;

  /** Winning a deal creates the customer where orders live — print_contacts,
   *  the CRM tab — exactly once per prospect. */
  async function promoteToContact(prospect: typeof salesProspects.$inferSelect, orgId: number): Promise<number | null> {
    if (prospect.promotedContactId) return prospect.promotedContactId;
    const full = (prospect.contactName ?? "").trim();
    const firstName = full ? full.split(/\s+/)[0] : prospect.name;
    const lastName = full ? full.split(/\s+/).slice(1).join(" ") : "";
    const [contact] = await db
      .insert(printContacts)
      .values({
        organizationId: orgId,
        firstName,
        lastName,
        email: prospect.email,
        phone: prospect.phone,
        company: prospect.name,
        type: "customer",
        notes: `Promoted from the Sales pipeline (prospect #${prospect.id}).`,
      })
      .returning();
    await db
      .update(salesProspects)
      .set({ promotedContactId: contact.id, updatedAt: new Date() })
      .where(and(eq(salesProspects.id, prospect.id), eq(salesProspects.organizationId, orgId)));
    return contact.id;
  }

  /** One place performs every stage move, so the activity trail can't be
   *  skipped and the won→CRM promotion can't be forgotten. */
  async function moveStage(
    prospect: typeof salesProspects.$inferSelect,
    orgId: number,
    to: SalesStage,
    by: number | null,
    viaNote?: string | null,
  ) {
    if (prospect.stage === to) return prospect;
    const [row] = await db
      .update(salesProspects)
      .set({ stage: to, stageChangedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(salesProspects.id, prospect.id), eq(salesProspects.organizationId, orgId)))
      .returning();
    await db.insert(salesActivities).values({
      organizationId: orgId,
      prospectId: prospect.id,
      type: "stage_change",
      note: [`${stageLabel(prospect.stage)} → ${stageLabel(to)}`, viaNote].filter(Boolean).join(" · "),
      createdBy: by,
    });
    if (to === "won" || to === "paid") await promoteToContact(row, orgId);
    return row;
  }

  function prospectFields(body: Record<string, unknown>, mode: "create" | "patch") {
    const req_ = mode === "create";
    const f: Record<string, unknown> = {};
    const set = (k: string, parse: () => unknown) => {
      if (req_ || k in body) f[k] = parse();
    };

    set("name", () => reqStr(body.name, "Name"));
    set("website", () => str(body.website));
    set("city", () => str(body.city));
    set("region", () => (str(body.region) ? pick(body.region, isSalesRegion, "Region") : null));
    set("category", () => str(body.category));
    set("subcategory", () => str(body.subcategory));
    set("whyFit", () => str(body.whyFit));
    set("servicesMatch", () => strArray(body.servicesMatch));
    set("contactName", () => str(body.contactName));
    set("contactRole", () => str(body.contactRole));
    set("email", () => str(body.email));
    set("phone", () => str(body.phone));
    set("evidenceUrl", () => str(body.evidenceUrl));
    set("fitScore", () => int(body.fitScore, "Fit score"));
    set("volumeScore", () => int(body.volumeScore, "Volume score"));
    set("tier", () => (str(body.tier) ? pick(body.tier, isSalesTier, "Tier") : null));
    set("nextFollowUpOn", () => isoDate(body.nextFollowUpOn, "Follow-up date"));
    set("declinedReason", () => str(body.declinedReason));
    set("dealValueCents", () => int(body.dealValueCents, "Deal value"));
    set("notes", () => str(body.notes));
    // stage deliberately NOT here — it only moves through moveStage(), so the
    // activity trail and the won→CRM promotion can never be bypassed.
    return f;
  }

  // ── Prospects ──────────────────────────────────────────────────────────────

  app.get(
    "/api/admin/sales/prospects",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const today = nzTodayIso();

      const prospects = await db
        .select()
        .from(salesProspects)
        .where(eq(salesProspects.organizationId, orgId))
        .orderBy(desc(salesProspects.totalScore), asc(salesProspects.name));

      // `today` ships even on the empty response — the client must never fall
      // back to its own clock, which is UTC and reads a day behind in NZ.
      res.json({ prospects, summary: summarise(prospects, today), today });
    }),
  );

  app.post(
    "/api/admin/sales/prospects",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const fields = prospectFields(req.body ?? {}, "create");
      const [row] = await db
        .insert(salesProspects)
        .values({ ...(fields as any), organizationId: orgId, source: "manual", createdBy: userId(req) })
        .returning();
      res.status(201).json({ prospect: row });
    }),
  );

  app.get(
    "/api/admin/sales/prospects/:id",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      const activities = await db
        .select()
        .from(salesActivities)
        .where(and(eq(salesActivities.prospectId, prospect.id), eq(salesActivities.organizationId, orgId)))
        .orderBy(desc(salesActivities.occurredAt));
      res.json({ prospect, activities, today: nzTodayIso() });
    }),
  );

  app.patch(
    "/api/admin/sales/prospects/:id",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      let prospect = await prospectOf(req, orgId);
      const body = req.body ?? {};

      const fields = prospectFields(body, "patch");
      if (Object.keys(fields).length) {
        const [row] = await db
          .update(salesProspects)
          .set({ ...(fields as any), updatedAt: new Date() })
          .where(and(eq(salesProspects.id, prospect.id), eq(salesProspects.organizationId, orgId)))
          .returning();
        prospect = row;
      }

      if ("stage" in body) {
        const to = pick(body.stage, isSalesStage, "Stage");
        prospect = await moveStage(prospect, orgId, to, userId(req));
      }

      res.json({ prospect });
    }),
  );

  /** A prospect with logged history is sales knowledge — decline it, don't
   *  delete it. Only a bare row (a data-entry mistake) is genuinely deleted. */
  app.delete(
    "/api/admin/sales/prospects/:id",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      const [activity] = await db
        .select({ id: salesActivities.id })
        .from(salesActivities)
        .where(and(eq(salesActivities.prospectId, prospect.id), eq(salesActivities.organizationId, orgId)))
        .limit(1);
      if (activity) {
        return res.status(400).json({
          message: "This prospect has call history — decline it instead of deleting, so the record of who said what survives.",
        });
      }
      await db
        .delete(salesProspects)
        .where(and(eq(salesProspects.id, prospect.id), eq(salesProspects.organizationId, orgId)));
      res.json({ deleted: true });
    }),
  );

  // ── Outreach email ─────────────────────────────────────────────────────────
  // The dialog pre-fills a draft (outreachEmailDraft in @shared/sales); this
  // sends exactly what the person finally wrote — never rewritten — plus the
  // fixed legal footer. Only AFTER Resend accepts it do we log the activity,
  // set the follow-up and move New → Contacted, so a failed send never reads
  // as a contacted lead.
  const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;
  const PUBLIC_BASE = (process.env.PUBLIC_APP_URL || "https://app.usg.co.nz").replace(/\/$/, "");
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  /** The plainest HTML: a personal email, not a newsletter — which is also
   *  what keeps it in the Primary tab rather than Promotions. */
  function outreachShell(inner: string, pixelUrl: string): string {
    const foot = esc(OUTREACH_FOOTER).replace(/\n/g, "<br/>");
    return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111;margin:0;padding:16px">
<div style="max-width:600px">${inner}<p style="margin:28px 0 0;font-size:11px;line-height:1.5;color:#888">${foot}</p></div><img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" /></body></html>`;
  }
  /** Our own site's links carry where the visit came from, so a quote that
   *  follows can be read against the email in analytics too. */
  function tagOwnLink(url: string, prospectId: number): string {
    try {
      const u = new URL(url);
      if (!/(^|\.)unitedprints\.co\.nz$/i.test(u.hostname)) return url;
      u.searchParams.set("utm_source", "sales-email");
      u.searchParams.set("utm_medium", "email");
      u.searchParams.set("utm_campaign", "united-prints-outreach");
      u.searchParams.set("utm_content", `prospect-${prospectId}`);
      return u.toString();
    } catch { return url; }
  }
  function readAttachments(v: unknown): Array<{ filename: string; content: string; contentType: string; bytes: number }> {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new BadRequest("Attachments must be a list.");
    if (v.length > OUTREACH_ATTACHMENT_MAX_FILES) throw new BadRequest(`Attach up to ${OUTREACH_ATTACHMENT_MAX_FILES} files.`);
    let total = 0;
    return v.map((a: any) => {
      const filename = String(a?.filename ?? "").replace(/[\\/\u0000-\u001f<>:"|?*]+/g, "_").trim().slice(0, 120);
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      const contentType = OUTREACH_ATTACHMENT_TYPES[ext];
      if (!filename || !contentType) throw new BadRequest(`“${filename || "file"}” — PDFs, pictures and Office files only.`);
      const content = String(a?.contentBase64 ?? "");
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(content)) throw new BadRequest(`“${filename}” couldn't be read.`);
      const bytes = Math.floor((content.length * 3) / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
      total += bytes;
      if (total > OUTREACH_ATTACHMENT_MAX_BYTES) throw new BadRequest("Attachments add up to more than 10 MB — send a link instead.");
      return { filename, content, contentType, bytes };
    });
  }

  app.post(
    "/api/admin/sales/prospects/:id/email",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      const b = req.body ?? {};

      const to = reqStr(b.to, "To").toLowerCase();
      if (!EMAIL_RE.test(to)) throw new BadRequest("That doesn't look like an email address.");
      const subject = reqStr(b.subject, "Subject");
      if (subject.length > 200) throw new BadRequest("Subject is too long (200 characters max).");
      const body = String(b.body ?? "").replace(/\r\n/g, "\n").trim();
      if (body.length < 20) throw new BadRequest("Write a message first.");
      if (body.length > 10000) throw new BadRequest("That message is too long.");
      const followUp = isoDate(b.nextFollowUpOn, "Follow-up date");
      const files = readAttachments(b.attachments);

      // A double-click is not a second email. One minute is long enough to
      // catch it and short enough that a deliberate resend still works.
      const [recent] = await db
        .select({ id: salesActivities.id })
        .from(salesActivities)
        .where(and(
          eq(salesActivities.prospectId, prospect.id),
          eq(salesActivities.organizationId, orgId),
          eq(salesActivities.type, "email"),
          gte(salesActivities.occurredAt, new Date(Date.now() - 60_000)),
        ))
        .limit(1);
      if (recent) return res.status(409).json({ message: "An email to this prospect went out less than a minute ago." });

      // The sender is the signed-in person, read from the database — never the
      // request body — and replies come back to their own inbox.
      const uid = userId(req);
      const [me] = uid
        ? await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, uid))
        : [];
      if (!me) throw new BadRequest("Couldn't work out who is sending this.");
      const senderName = `${me.firstName} ${me.lastName}`.replace(/[^\p{L}\p{N} '.-]/gu, "").trim() || "United Prints";

      // Every web link goes through /t/se/:token/:i, which reads the
      // destination from THIS row — so the redirect can't be pointed elsewhere.
      const token = crypto.randomBytes(24).toString("base64url");
      const rendered = renderOutreachBody(body, (_u, i) => `${PUBLIC_BASE}/t/se/${token}/${i}`);
      const links = rendered.links.map((l) => ({ url: tagOwnLink(l.url, prospect.id), label: l.label }));

      const sent = await sendEmailDetailed({
        to,
        from: `${senderName} from United Prints <orders@unitedprints.co.nz>`,
        replyTo: me.email,
        subject,
        html: outreachShell(rendered.html, `${PUBLIC_BASE}/t/se/${token}/o.gif`),
        text: `${outreachPlainText(body)}\n\n--\n${OUTREACH_FOOTER}`,
        attachments: files.map((f) => ({ filename: f.filename, content: f.content, contentType: f.contentType })),
      });
      if (!sent.ok) {
        return res.status(502).json({ message: "The email didn't send, so nothing was logged. Try again in a moment." });
      }

      const attachmentNote = files.length ? `\nAttached: ${files.map((f) => f.filename).join(", ")}` : "";
      const [activity] = await db
        .insert(salesActivities)
        .values({
          organizationId: orgId,
          prospectId: prospect.id,
          type: "email",
          note: `To: ${to}\nSubject: ${subject}${attachmentNote}\n\n${body}`,
          createdBy: uid,
        })
        .returning();
      await db.insert(salesEmails).values({
        organizationId: orgId,
        prospectId: prospect.id,
        activityId: activity.id,
        token,
        toEmail: to,
        subject,
        body,
        links,
        attachments: files.map((f) => ({ filename: f.filename, bytes: f.bytes })),
        providerMessageId: sent.id,
        sentBy: uid,
      });

      const patch: Record<string, unknown> = {};
      if ("nextFollowUpOn" in b) patch.nextFollowUpOn = followUp;
      if (!prospect.email) patch.email = to;
      if (Object.keys(patch).length) {
        await db
          .update(salesProspects)
          .set({ ...(patch as any), updatedAt: new Date() })
          .where(and(eq(salesProspects.id, prospect.id), eq(salesProspects.organizationId, orgId)));
      }
      const updated = prospect.stage === "new"
        ? await moveStage(prospect, orgId, "contacted", uid, "via email")
        : prospect;

      res.status(201).json({ activity, prospect: updated });
    }),
  );

  // Every email to one prospect, each with its journey.
  app.get(
    "/api/admin/sales/prospects/:id/emails",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      res.json({ emails: await emailJourneys(orgId, prospect.id) });
    }),
  );

  // The whole outreach: where each prospect's emails have got to, and totals.
  // Orders and quotes are counted once each even when two emails match them.
  app.get(
    "/api/admin/sales/outreach",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const all = await emailJourneys(orgId);
      const RANK = ["sent", "delivered", "opened", "clicked", "quoted", "ordered", "paid"];
      const byProspect: Record<number, { reached: string; emails: number; lastSentAt: string; opens: number; clicks: number; bounced: boolean }> = {};
      const quoteIds = new Set<number>(); const orders = new Map<number, { totalCents: number; paidCents: number }>();
      let delivered = 0, opened = 0, clicked = 0, bounced = 0;
      for (const e of all) {
        const p = (byProspect[e.prospectId] ??= { reached: "sent", emails: 0, lastSentAt: e.sentAt, opens: 0, clicks: 0, bounced: false });
        p.emails++; p.opens += e.opens; p.clicks += e.clicks; p.bounced ||= e.bounced;
        if (e.sentAt > p.lastSentAt) p.lastSentAt = e.sentAt;
        if (RANK.indexOf(e.reached) > RANK.indexOf(p.reached)) p.reached = e.reached;
        if (e.events.some((x) => x.step === "delivered")) delivered++;
        if (e.opens) opened++;
        if (e.clicks) clicked++;
        if (e.bounced) bounced++;
        e.quotes.forEach((q) => quoteIds.add(q.id));
        e.orders.forEach((o) => orders.set(o.id, { totalCents: o.totalCents, paidCents: o.paidCents }));
      }
      const orderList = Array.from(orders.values());
      res.json({
        byProspect,
        totals: {
          sent: all.length, delivered, opened, clicked, bounced,
          quotes: quoteIds.size, orders: orders.size,
          orderValueCents: orderList.reduce((s, o) => s + o.totalCents, 0),
          paidCents: orderList.reduce((s, o) => s + o.paidCents, 0),
        },
      });
    }),
  );

  // ── Activities (calls, emails, meetings, notes) ────────────────────────────

  app.post(
    "/api/admin/sales/prospects/:id/activities",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      const b = req.body ?? {};

      const type = pick(b.type, isSalesActivityType, "Activity type", "call");
      if (type === "stage_change") throw new BadRequest("Stage changes are logged automatically — move the stage instead.");
      const outcome = str(b.outcome) ? pick(b.outcome, isSalesOutcome, "Outcome") : null;
      const note = str(b.note);
      const followUp = isoDate(b.nextFollowUpOn, "Follow-up date");

      const [activity] = await db
        .insert(salesActivities)
        .values({
          organizationId: orgId,
          prospectId: prospect.id,
          type,
          outcome,
          note,
          createdBy: userId(req),
        })
        .returning();

      // A quick-log can carry its consequences in the same request: the next
      // follow-up date, and an obvious stage move (booked a call, got a no).
      const patch: Record<string, unknown> = {};
      if ("nextFollowUpOn" in b) patch.nextFollowUpOn = followUp;
      if (Object.keys(patch).length) {
        await db
          .update(salesProspects)
          .set({ ...(patch as any), updatedAt: new Date() })
          .where(and(eq(salesProspects.id, prospect.id), eq(salesProspects.organizationId, orgId)));
      }

      let updated = null;
      if (str(b.moveStage)) {
        const to = pick(b.moveStage, isSalesStage, "Stage");
        updated = await moveStage(prospect, orgId, to, userId(req), `via ${type} outcome ${outcome ?? "—"}`);
      }

      res.status(201).json({ activity, prospect: updated ?? undefined });
    }),
  );

  app.patch(
    "/api/admin/sales/prospects/:id/activities/:childId",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      const childId = reqInt(req.params.childId, "id");
      const b = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if ("note" in b) patch.note = str(b.note);
      if ("outcome" in b) patch.outcome = str(b.outcome) ? pick(b.outcome, isSalesOutcome, "Outcome") : null;
      if (!Object.keys(patch).length) throw new BadRequest("Nothing to update");
      const [row] = await db
        .update(salesActivities)
        .set(patch as any)
        .where(
          and(
            eq(salesActivities.id, childId),
            eq(salesActivities.prospectId, prospect.id),
            eq(salesActivities.organizationId, orgId),
          ),
        )
        .returning();
      if (!row) return res.status(404).json({ message: "Not found" });
      res.json({ row });
    }),
  );

  app.delete(
    "/api/admin/sales/prospects/:id/activities/:childId",
    requireAuth,
    tab,
    handler(async (req, res) => {
      const orgId = await orgOf(req);
      const prospect = await prospectOf(req, orgId);
      const childId = reqInt(req.params.childId, "id");
      const deleted = await db
        .delete(salesActivities)
        .where(
          and(
            eq(salesActivities.id, childId),
            eq(salesActivities.prospectId, prospect.id),
            eq(salesActivities.organizationId, orgId),
          ),
        )
        .returning({ id: salesActivities.id });
      if (!deleted.length) return res.status(404).json({ message: "Not found" });
      res.json({ deleted: true });
    }),
  );
}

// ── Rollups ──────────────────────────────────────────────────────────────────

function summarise(
  rows: Array<{
    stage: string;
    tier: string | null;
    nextFollowUpOn: string | null;
    dealValueCents: number | null;
  }>,
  todayIso: string,
) {
  const byStage: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  let followUpsDue = 0;
  let pipelineValueCents = 0;
  let wonValueCents = 0;
  let paidValueCents = 0;

  for (const r of rows) {
    byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
    if (r.tier) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
    // ISO strings compare chronologically — derived, never stored.
    if (r.nextFollowUpOn && r.nextFollowUpOn <= todayIso && r.stage !== "declined" && r.stage !== "paid") followUpsDue++;
    if (r.dealValueCents) {
      if ((OPEN_PIPELINE_STAGES as readonly string[]).includes(r.stage)) pipelineValueCents += r.dealValueCents;
      if (r.stage === "won") wonValueCents += r.dealValueCents;
      if (r.stage === "paid") paidValueCents += r.dealValueCents;
    }
  }

  return { total: rows.length, byStage, byTier, followUpsDue, pipelineValueCents, wonValueCents, paidValueCents };
}
