/**
 * Football Fest — registrations of interest.
 *
 * The festival is 14-15 November 2026 at United Sports Centre, the weekend the
 * All Whites play India. footballfest.co.nz used to print "$200 a day" for a
 * business expo stall; nobody had agreed that number with the businesses it was
 * aimed at, so the page now takes an enquiry and a human quotes.
 *
 * 🔴 THIS ROUTE NEVER EMAILS THE PERSON WHO FILLED THE FORM IN. A public form
 * that sends a confirmation to the address typed into it does not merely
 * RECEIVE spam, it SENDS it — a bot types a stranger's address and our verified
 * domain mails that stranger (the Ata Rangi lodge, 50 messages to 25 harvested
 * addresses in one day). Staff are notified at a FIXED internal address, which
 * an attacker cannot point anywhere, and the reply comes from a human.
 *
 * 🔴 The guard HOLDS, it does not refuse. A held submission is still written,
 * still on the board, still workable — it just does not fire the staff email
 * and it carries a flag saying why. A bot that gets through costs one junk row;
 * a real business turned away costs a stall and nobody ever finds out.
 *
 * Lives under the CIC organisation and is surfaced in the CIC workspace's
 * Ethnic view, beside the Ethnic Cup that shares the weekend.
 */
import type { Express, Request, Response } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db } from "./db";
import { guardPublicForm } from "./form-guard";
import { footballFestRegistrations, organizations } from "@shared/schema";
import { requireAuth, requireTab } from "./auth";
import { sendEmail } from "./email";

const CIC_ORG_SLUG = "christchurch-international-cup";
const TAB = "football-fest";

/** Where a new enquiry is announced. FIXED — never a value from the request. */
const NOTIFY = "community@cufc.co.nz";

// Validated in app code, never by a DB CHECK: a stale CHECK constraint is how
// the MFL checkout once 500'd.
const STATUSES = ["new", "contacted", "confirmed", "declined", "archived"] as const;
type Status = (typeof STATUSES)[number];

const KINDS = ["expo", "food_truck", "sponsor", "other"] as const;

let orgIdCache: number | null = null;
async function cicOrgId(): Promise<number> {
  if (orgIdCache) return orgIdCache;
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, CIC_ORG_SLUG));
  if (!org) throw new Error("CIC organization not found");
  orgIdCache = org.id;
  return org.id;
}

const SITE_ORIGINS = ["https://footballfest.co.nz", "https://www.footballfest.co.nz"];
function setCors(req: Request, res: Response) {
  const origin = String(req.headers.origin || "");
  if (SITE_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
}

/** Public input goes into a staff email as HTML. Escape it, always. */
function esc(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function registerFootballFestRoutes(app: Express) {
  // ── public: the "Ask about a stall" form on footballfest.co.nz ────────────
  app.options("/api/public/football-fest/register-interest", (req, res) => {
    setCors(req, res);
    res.sendStatus(204);
  });

  app.post("/api/public/football-fest/register-interest", async (req: Request, res: Response) => {
    setCors(req, res);
    try {
      const businessName = String(req.body?.businessName || "").trim().slice(0, 200);
      const contactName = String(req.body?.contactName || "").trim().slice(0, 200);
      const email = String(req.body?.email || "").trim().slice(0, 200);
      const phone = String(req.body?.phone || "").trim().slice(0, 60);
      const days = String(req.body?.days || "").trim().slice(0, 60);
      const about = String(req.body?.about || "").trim().slice(0, 2000);
      const message = String(req.body?.message || "").trim().slice(0, 2000);
      const sourceUrl = String(req.body?.sourceUrl || "footballfest.co.nz").slice(0, 300);
      const rawKind = String(req.body?.kind || "expo").trim();
      const kind = (KINDS as readonly string[]).includes(rawKind) ? rawKind : "other";

      if (!businessName || !contactName || !/.+@.+\..+/.test(email)) {
        return res.status(400).json({ message: "Please add your business, your name and a valid email." });
      }

      /* 🔴 `about` and `message` are prose; `businessName` is a NAME and is
       * judged by name rules — "TheKickers2026" is a real team and "Kaikoura
       * Coffee Co 2026" is a real business, and prose rules call both random. */
      const verdict = await guardPublicForm({
        form: "football_fest_expo", req, email,
        name: contactName,
        names: [businessName],
        text: [about, message],
        page: sourceUrl,
      });

      const organizationId = await cicOrgId();
      const [row] = await db
        .insert(footballFestRegistrations)
        .values({
          organizationId,
          kind,
          businessName,
          contactName,
          email,
          phone: phone || null,
          days: days || null,
          about: about || null,
          message: message || null,
          sourceUrl,
          status: "new",
          held: !verdict.ok,
          heldReasons: verdict.reasons.length ? verdict.reasons : null,
        })
        .returning({ id: footballFestRegistrations.id });

      /* Staff notification. Best-effort and fixed-recipient: a send failure must
       * never read to the business as a failed enquiry, and the address can
       * never be steered by the request. Held submissions do not send. */
      if (verdict.ok) {
        const line = (k: string, v: string | null) =>
          v ? `<tr><td style="padding:6px 14px 6px 0;color:#9aa0a6;font-size:13px;">${k}</td><td style="padding:6px 0;color:#111;font-size:14px;font-weight:600;">${esc(v)}</td></tr>` : "";
        sendEmail({
          to: NOTIFY,
          // cufc.co.nz is verified on Resend; footballfest.co.nz is not, and a
          // send from an unverified domain silently fails.
          from: "Football Fest <noreply@cufc.co.nz>",
          // So a staff member can just hit reply. The address is the submitter's
          // — safe here because this message goes to US, never to them.
          replyTo: email,
          subject: `Football Fest enquiry — ${businessName}`,
          html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px">
            <h2 style="margin:0 0 4px;font-size:18px">New Football Fest enquiry</h2>
            <p style="margin:0 0 16px;color:#666;font-size:14px">14-15 November 2026 · United Sports Centre</p>
            <table style="border-collapse:collapse">
              ${line("Business", businessName)}
              ${line("Contact", contactName)}
              ${line("Email", email)}
              ${line("Phone", phone)}
              ${line("Interested in", kind === "expo" ? "Business expo stall" : kind.replace(/_/g, " "))}
              ${line("Days", days)}
              ${line("About", about)}
              ${line("Message", message)}
            </table>
            <p style="margin:18px 0 0;font-size:13px;color:#666">
              Work it in ClubOS: CIC workspace &rarr; Ethnic &rarr; Football Fest.
            </p>
          </div>`,
        }).catch((e) => console.error("[FootballFest] notify failed:", e?.message || e));
      }

      // Identical answer either way, or a bot tunes itself until it passes.
      res.json({ ok: true, id: row?.id });
    } catch (e: any) {
      console.error("[FootballFest register] error:", e?.message || e);
      res.status(500).json({ message: "Could not save that just now. Please try again." });
    }
  });

  // ── admin: the Football Fest board in the CIC workspace ──────────────────
  app.get("/api/admin/football-fest/registrations", requireAuth, requireTab(TAB), async (_req, res) => {
    try {
      const organizationId = await cicOrgId();
      const rows = await db
        .select()
        .from(footballFestRegistrations)
        .where(eq(footballFestRegistrations.organizationId, organizationId))
        .orderBy(desc(footballFestRegistrations.createdAt));

      // Counts are DERIVED from the rows on every read, never stored — a stored
      // count is a second source of truth that drifts on the first manual edit.
      const counts: Record<string, number> = { total: rows.length, held: 0 };
      for (const s of STATUSES) counts[s] = 0;
      for (const r of rows) {
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        if (r.held) counts.held++;
      }
      res.json({ rows, counts, statuses: [...STATUSES] });
    } catch (e: any) {
      console.error("[FootballFest list] error:", e?.message || e);
      res.status(500).json({ message: "Could not load registrations." });
    }
  });

  app.patch("/api/admin/football-fest/registrations/:id", requireAuth, requireTab(TAB), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Bad id." });

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof req.body?.status === "string") {
        if (!(STATUSES as readonly string[]).includes(req.body.status)) {
          return res.status(400).json({ message: "Unknown status." });
        }
        patch.status = req.body.status;
      }
      if (typeof req.body?.notes === "string") patch.notes = req.body.notes.slice(0, 4000) || null;
      if (Object.keys(patch).length === 1) return res.status(400).json({ message: "Nothing to change." });

      // Scoped to the CIC org as well as the id: a tab-gated route must still
      // not reach a row that belongs to somebody else.
      const organizationId = await cicOrgId();
      const [row] = await db
        .update(footballFestRegistrations)
        .set(patch)
        .where(and(eq(footballFestRegistrations.id, id), eq(footballFestRegistrations.organizationId, organizationId)))
        .returning();
      if (!row) return res.status(404).json({ message: "Not found." });
      res.json({ ok: true, row });
    } catch (e: any) {
      console.error("[FootballFest patch] error:", e?.message || e);
      res.status(500).json({ message: "Could not save that change." });
    }
  });
}
