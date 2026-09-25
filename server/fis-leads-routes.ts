/**
 * Football in Schools — the outreach PIPELINE (2026-09-25).
 *
 * Daniel: "in additional programs add Football In Schools and create full
 * pipeline view … with all school and early learning centres that we created
 * presentations for … so connor can start workflowing this."
 *
 * Rows are fis_leads (44 schools + 115 early learning centres, seeded by
 * script/seed-fis-pipeline.ts). `status` is the pipeline STAGE; every move,
 * call, email, drop-in and note writes a fis_lead_activities row carrying WHO
 * did it, in the same transaction as the change it describes.
 *
 * 🔴 Gated on the `football-in-schools` tab AND on the CUFC workspace itself.
 *    canAccessTab() answers true for ANY slug when a membership is admin/manager,
 *    so without the workspace check an admin of another workspace would reach
 *    every school's contact list by sending a different X-Workspace-Slug.
 *    Answered 404 outside CUFC. Its own tab (not `academy`) so Connor can be
 *    given this board without being given every child's registration.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { requireTab } from "./auth";
import { fisLeads, fisLeadActivities, organizations, users, userOrganizations } from "@shared/schema";
import {
  isFisStage, FIS_CLOSED, isFisReasonFor, isFisPriority, isIsoDate, isFisActivityType,
  FIS_QUICK_LOGS, fisAdvancedStage, addDaysIso, fisReasonLabel, type FisStage,
} from "@shared/fis-leads";
import { nzTodayIso } from "@shared/dashboard";

const CUFC_SLUG = "christchurch-united";
const TAB = "football-in-schools";

let orgIdCache: number | null = null;
async function cufcOrgId(): Promise<number> {
  if (orgIdCache) return orgIdCache;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, CUFC_SLUG));
  if (!org) throw new Error("CUFC organization not found");
  orgIdCache = org.id;
  return org.id;
}

/**
 * The board is CUFC's and always shows CUFC's leads, but it opens from TWO
 * workspaces: CUFC (Academy → Additional Programs) and United Sports Group.
 * 🔴 USG exists for Connor. Any CUFC membership — even one holding only this
 *    tab — reads every registration through older routes that check membership
 *    and not tabs (measured 2026-09-25: 12 MB of /api/admin/registrations). So
 *    the person who works schools gets this tab in USG, not a seat in CUFC.
 */
const BOARD_WORKSPACES = new Set([CUFC_SLUG, "united-sports-group"]);
function requireCufcWorkspace(req: Request, res: Response, next: NextFunction) {
  if (!BOARD_WORKSPACES.has(String(req.headers["x-workspace-slug"] || ""))) return res.status(404).json({ message: "Not found" });
  next();
}
export const fisLeadGate = [requireTab(TAB), requireCufcWorkspace];

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const send = (res: Response, e: any) =>
  res.status(e instanceof HttpError ? e.status : 500).json({ message: e?.message || "Something went wrong" });

/** People who can own a lead: members of either workspace the board opens in. */
async function cufcTeam(_orgId: number) {
  const rows = await db
    .selectDistinct({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(userOrganizations)
    .innerJoin(users, eq(users.id, userOrganizations.userId))
    .innerJoin(organizations, eq(organizations.id, userOrganizations.organizationId))
    .where(inArray(organizations.slug, Array.from(BOARD_WORKSPACES)));
  return rows
    .map((u) => ({ id: u.id, name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** THE one place a lead's stage changes — with its history row, same transaction. */
async function moveStage(tx: Tx, opts: {
  orgId: number; id: number; to: FisStage; reason?: string | null; note?: string | null; userId: number;
}) {
  const [row] = await tx.select().from(fisLeads)
    .where(and(eq(fisLeads.id, opts.id), eq(fisLeads.organizationId, opts.orgId)))
    .for("update");
  if (!row) throw new HttpError(404, "Lead not found");
  const from = isFisStage(row.status) ? row.status : "new";
  const closing = FIS_CLOSED.includes(opts.to);
  if (closing && !isFisReasonFor(opts.to, opts.reason)) throw new HttpError(400, "Pick a reason for closing this lead.");
  const reason = closing ? opts.reason! : null;
  if (from === opts.to && (row.closedReason ?? null) === reason) return { changed: false };

  await tx.update(fisLeads).set({
    status: opts.to,
    closedReason: reason,
    ...(closing ? { nextFollowUpOn: null } : {}),
    stageChangedAt: new Date(),
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(fisLeads.id, opts.id));

  await tx.insert(fisLeadActivities).values({
    organizationId: opts.orgId, leadId: opts.id, type: "stage_change",
    fromStage: from, toStage: opts.to, outcome: reason,
    note: opts.note?.trim() || (reason ? fisReasonLabel(opts.to, reason) : null),
    createdBy: opts.userId,
  });
  return { changed: true };
}

async function validOwner(orgId: number, raw: unknown): Promise<number | null> {
  if (raw === null) return null;
  const team = await cufcTeam(orgId);
  if (!team.some((t) => t.id === Number(raw))) throw new HttpError(400, "That person isn't on the Christchurch United or United Sports Group team.");
  return Number(raw);
}

export function registerFisLeadRoutes(app: Express) {
  // ── The board: every lead, the team, today in NZ ──────────────────────────
  app.get("/api/admin/fis/leads", ...fisLeadGate, async (_req, res) => {
    try {
      const orgId = await cufcOrgId();
      const rows = await db
        .select({
          r: fisLeads,
          activityCount: sql<number>`(SELECT count(*)::int FROM fis_lead_activities a WHERE a.lead_id = ${fisLeads.id} AND a.type <> 'stage_change')`,
        })
        .from(fisLeads)
        .where(eq(fisLeads.organizationId, orgId))
        .orderBy(fisLeads.name);
      res.json({
        today: nzTodayIso(),
        team: await cufcTeam(orgId),
        leads: rows.map(({ r, activityCount }) => ({ ...r, stage: isFisStage(r.status) ? r.status : "new", activityCount })),
      });
    } catch (e) { send(res, e); }
  });

  // ── A small summary for the Academy page's Additional Programs row ─────────
  app.get("/api/admin/fis/summary", ...fisLeadGate, async (_req, res) => {
    try {
      const orgId = await cufcOrgId();
      const rows = (await db.execute(sql`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'booked')::int AS booked,
               count(*) FILTER (WHERE status NOT IN ('new','booked','not_now','not_a_fit'))::int AS in_play
        FROM fis_leads WHERE organization_id = ${orgId}`)).rows as any[];
      res.json({ total: rows[0]?.total ?? 0, booked: rows[0]?.booked ?? 0, inPlay: rows[0]?.in_play ?? 0 });
    } catch (e) { send(res, e); }
  });

  // ── Edit one lead ─────────────────────────────────────────────────────────
  app.patch("/api/admin/fis/leads/:id", ...fisLeadGate, async (req, res) => {
    try {
      const orgId = await cufcOrgId();
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
      const b = req.body || {};
      const userId = req.session.userId!;
      const patch: Record<string, unknown> = {};

      if ("priority" in b) {
        if (b.priority !== null && !isFisPriority(b.priority)) throw new HttpError(400, "Priority is hot, warm or cold.");
        patch.priority = b.priority;
      }
      if ("nextFollowUpOn" in b) {
        if (b.nextFollowUpOn !== null && !isIsoDate(b.nextFollowUpOn)) throw new HttpError(400, "Follow-up must be a date.");
        patch.nextFollowUpOn = b.nextFollowUpOn;
      }
      if ("notes" in b) {
        if (b.notes !== null && typeof b.notes !== "string") throw new HttpError(400, "Notes must be text.");
        patch.notes = b.notes ? String(b.notes).slice(0, 5000) : null;
      }
      // Contact details go stale (three coordinators had already left by August),
      // so the person working the lead can correct them in place.
      for (const k of ["contactName", "contactRole", "contactEmail", "contactPhone", "phone", "email"] as const) {
        if (k in b) {
          if (b[k] !== null && typeof b[k] !== "string") throw new HttpError(400, "Contact details must be text.");
          patch[k] = b[k] ? String(b[k]).trim().slice(0, 300) || null : null;
        }
      }
      if ("ownerUserId" in b) patch.ownerUserId = await validOwner(orgId, b.ownerUserId);
      if ("stage" in b && !isFisStage(b.stage)) throw new HttpError(400, "Unknown stage.");

      await db.transaction(async (tx) => {
        if ("stage" in b) await moveStage(tx, { orgId, id, to: b.stage, reason: b.closedReason ?? null, note: b.stageNote ?? null, userId });
        if (Object.keys(patch).length) {
          const done = await tx.update(fisLeads).set({ ...patch, updatedAt: new Date() })
            .where(and(eq(fisLeads.id, id), eq(fisLeads.organizationId, orgId)))
            .returning({ id: fisLeads.id });
          if (!done.length) throw new HttpError(404, "Lead not found");
        }
      });
      res.json({ ok: true });
    } catch (e) { send(res, e); }
  });

  // ── Bulk: move a batch, assign an owner ───────────────────────────────────
  app.post("/api/admin/fis/leads/bulk", ...fisLeadGate, async (req, res) => {
    try {
      const orgId = await cufcOrgId();
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length) throw new HttpError(400, "Select at least one.");
      if (ids.length > 500) throw new HttpError(400, "At most 500 at a time.");
      const { stage, closedReason, ownerUserId } = req.body || {};
      if (stage !== undefined && !isFisStage(stage)) throw new HttpError(400, "Unknown stage.");
      const owner = ownerUserId !== undefined ? await validOwner(orgId, ownerUserId) : undefined;
      if (stage === undefined && owner === undefined) throw new HttpError(400, "Nothing to change.");

      let moved = 0;
      await db.transaction(async (tx) => {
        if (stage !== undefined) {
          for (const id of ids) {
            const r = await moveStage(tx, { orgId, id, to: stage, reason: closedReason ?? null, userId: req.session.userId! });
            if (r.changed) moved++;
          }
        }
        if (owner !== undefined) {
          await tx.update(fisLeads).set({ ownerUserId: owner, updatedAt: new Date() })
            .where(and(inArray(fisLeads.id, ids), eq(fisLeads.organizationId, orgId)));
        }
      });
      res.json({ ok: true, moved });
    } catch (e) { send(res, e); }
  });

  // ── A lead's timeline ─────────────────────────────────────────────────────
  app.get("/api/admin/fis/leads/:id/activities", ...fisLeadGate, async (req, res) => {
    try {
      const orgId = await cufcOrgId();
      const rows = await db
        .select({ a: fisLeadActivities, firstName: users.firstName, lastName: users.lastName })
        .from(fisLeadActivities)
        .leftJoin(users, eq(users.id, fisLeadActivities.createdBy))
        .where(and(eq(fisLeadActivities.leadId, Number(req.params.id)), eq(fisLeadActivities.organizationId, orgId)))
        .orderBy(desc(fisLeadActivities.createdAt), desc(fisLeadActivities.id));
      res.json(rows.map(({ a, firstName, lastName }) => ({
        ...a, byName: firstName ? `${firstName} ${lastName ?? ""}`.trim() : null,
      })));
    } catch (e) { send(res, e); }
  });

  // ── Log a touch ───────────────────────────────────────────────────────────
  app.post("/api/admin/fis/leads/:id/activities", ...fisLeadGate, async (req, res) => {
    try {
      const orgId = await cufcOrgId();
      const id = Number(req.params.id);
      const userId = req.session.userId!;
      const b = req.body || {};
      const quick = FIS_QUICK_LOGS.find((q) => q.key === b.quick);
      const type = quick ? quick.type : b.type;
      if (!isFisActivityType(type) || type === "stage_change") throw new HttpError(400, "Unknown activity.");
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 5000) : "";
      if (type === "note" && !note) throw new HttpError(400, "Write something first.");
      if (b.nextFollowUpOn !== undefined && b.nextFollowUpOn !== null && !isIsoDate(b.nextFollowUpOn)) {
        throw new HttpError(400, "Follow-up must be a date.");
      }

      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(fisLeads)
          .where(and(eq(fisLeads.id, id), eq(fisLeads.organizationId, orgId)))
          .for("update");
        if (!row) throw new HttpError(404, "Lead not found");
        const current: FisStage = isFisStage(row.status) ? row.status : "new";

        await tx.insert(fisLeadActivities).values({
          organizationId: orgId, leadId: id, type,
          outcome: quick ? quick.outcome : (typeof b.outcome === "string" ? b.outcome.slice(0, 60) : null),
          note: note || null, createdBy: userId,
        });

        if (quick) {
          const next = fisAdvancedStage(current, quick.advanceTo as FisStage);
          if (next !== current) await moveStage(tx, { orgId, id, to: next, userId });
        }
        const closed = FIS_CLOSED.includes(current);
        const followUp = b.nextFollowUpOn !== undefined
          ? b.nextFollowUpOn
          : quick && !closed ? addDaysIso(nzTodayIso(), quick.followUpDays) : undefined;
        await tx.update(fisLeads).set({
          lastActivityAt: new Date(), updatedAt: new Date(),
          ...(followUp !== undefined && !closed ? { nextFollowUpOn: followUp } : {}),
        }).where(eq(fisLeads.id, id));
      });
      res.json({ ok: true });
    } catch (e) { send(res, e); }
  });
}
