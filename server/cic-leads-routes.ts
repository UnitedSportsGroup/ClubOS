/**
 * CIC Youth — registrations of interest as a LEAD PIPELINE (2026-09-25).
 *
 * Daniel: "so isaac can actually workflow, action, track and project manage very
 * easily all the leads we getting and like disqualify some leads if just spam."
 *
 * The rows are the cicyouth.com "Register your interest" submissions
 * (cic_interest_registrations). `status` is now the pipeline STAGE; every move,
 * call, email, WhatsApp and note writes a cic_interest_activities row carrying
 * WHO did it, in the same transaction as the change it describes.
 *
 * 🔴 Gated on the `cic-registrations` tab AND on the CIC workspace itself.
 *    canAccessTab() answers true for ANY slug when a membership is admin/manager,
 *    so without the workspace check an admin of Mini Football would reach every
 *    club's phone number by sending a different X-Workspace-Slug. Answered 404,
 *    not 403 — outside this workspace the thing does not exist.
 *    (These routes were `requireAuth` ALONE until today — CLAUDE.md listed it as
 *    an unfixed hole: a coach account in United Prints read 95 CIC registrations.)
 *
 * 🔴 Nothing here disqualifies automatically. Flags (shared/cic-leads.ts) are
 *    shown to Isaac; the decision is his.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { requireTab } from "./auth";
import {
  cicInterestRegistrations, cicInterestActivities, organizations, users, userOrganizations,
} from "@shared/schema";
import {
  isLeadStage, normaliseStage, CLOSED_STAGES, isReasonFor, isPriority, isIsoDate, isActivityType,
  QUICK_LOGS, advancedStage, addDaysIso, reasonLabel, type LeadStage,
} from "@shared/cic-leads";
import { nzTodayIso } from "@shared/dashboard";

const CIC_SLUG = "christchurch-international-cup";
const TAB = "cic-registrations";

let orgIdCache: number | null = null;
async function cicOrgId(): Promise<number> {
  if (orgIdCache) return orgIdCache;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, CIC_SLUG));
  if (!org) throw new Error("CIC organization not found");
  orgIdCache = org.id;
  return org.id;
}

/** Runs AFTER requireTab: the tab must be asked for from inside the CIC workspace. */
function requireCicWorkspace(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-workspace-slug"] !== CIC_SLUG) return res.status(404).json({ message: "Not found" });
  next();
}
export const cicLeadGate = [requireTab(TAB), requireCicWorkspace];

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const send = (res: Response, e: any) =>
  res.status(e instanceof HttpError ? e.status : 500).json({ message: e?.message || "Something went wrong" });

/** People who can own a lead: members of the CIC workspace. */
async function cicTeam(orgId: number) {
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(userOrganizations)
    .innerJoin(users, eq(users.id, userOrganizations.userId))
    .where(eq(userOrganizations.organizationId, orgId));
  return rows
    .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() || u.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * THE one place a lead's stage changes. Validates the reason against the stage,
 * clears what a closed lead cannot have, and writes the trail row in the SAME
 * transaction — a stage without its history is how "who disqualified this?"
 * becomes unanswerable.
 */
async function moveStage(tx: Tx, opts: {
  orgId: number; id: number; to: LeadStage; reason?: string | null; note?: string | null; userId: number;
}) {
  const [row] = await tx.select().from(cicInterestRegistrations)
    .where(and(eq(cicInterestRegistrations.id, opts.id), eq(cicInterestRegistrations.organizationId, opts.orgId)))
    .for("update");
  if (!row) throw new HttpError(404, "Lead not found");
  const from = normaliseStage(row.status);
  const closing = CLOSED_STAGES.includes(opts.to);
  if (closing && !isReasonFor(opts.to, opts.reason)) throw new HttpError(400, "Pick a reason for closing this lead.");
  const reason = closing ? opts.reason! : null;
  if (from === opts.to && (row.closedReason ?? null) === reason) return { changed: false };

  await tx.update(cicInterestRegistrations).set({
    status: opts.to,
    closedReason: reason,
    // A closed lead has nothing to follow up; re-opening one starts clean.
    ...(closing ? { nextFollowUpOn: null } : {}),
    stageChangedAt: new Date(),
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(cicInterestRegistrations.id, opts.id));

  await tx.insert(cicInterestActivities).values({
    organizationId: opts.orgId, registrationId: opts.id, type: "stage_change",
    fromStage: from, toStage: opts.to, outcome: reason,
    note: opts.note?.trim() || (reason ? reasonLabel(opts.to, reason) : null),
    createdBy: opts.userId,
  });
  return { changed: true };
}

export function registerCicLeadRoutes(app: Express) {
  // ── The board's data: every lead, the team, and today in NZ ───────────────
  app.get("/api/admin/cic/leads", ...cicLeadGate, async (_req, res) => {
    try {
      const orgId = await cicOrgId();
      const rows = await db
        .select({
          r: cicInterestRegistrations,
          activityCount: sql<number>`(SELECT count(*)::int FROM cic_interest_activities a WHERE a.registration_id = ${cicInterestRegistrations.id} AND a.type <> 'stage_change')`,
        })
        .from(cicInterestRegistrations)
        .where(eq(cicInterestRegistrations.organizationId, orgId))
        .orderBy(desc(cicInterestRegistrations.createdAt));
      res.json({
        today: nzTodayIso(),
        team: await cicTeam(orgId),
        leads: rows.map(({ r, activityCount }) => ({ ...r, stage: normaliseStage(r.status), activityCount })),
      });
    } catch (e) { send(res, e); }
  });

  // ── Edit one lead: stage, owner, priority, follow-up, notes ───────────────
  app.patch("/api/admin/cic/leads/:id", ...cicLeadGate, async (req, res) => {
    try {
      const orgId = await cicOrgId();
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new HttpError(400, "Bad id");
      const b = req.body || {};
      const userId = req.session.userId!;
      const patch: Record<string, unknown> = {};

      if ("priority" in b) {
        if (b.priority !== null && !isPriority(b.priority)) throw new HttpError(400, "Priority is hot, warm or cold.");
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
      if ("ownerUserId" in b) {
        if (b.ownerUserId === null) patch.ownerUserId = null;
        else {
          const team = await cicTeam(orgId);
          if (!team.some((t) => t.id === Number(b.ownerUserId))) throw new HttpError(400, "That person isn't in the CIC workspace.");
          patch.ownerUserId = Number(b.ownerUserId);
        }
      }
      if ("stage" in b && !isLeadStage(b.stage)) throw new HttpError(400, "Unknown stage.");

      await db.transaction(async (tx) => {
        if ("stage" in b) await moveStage(tx, { orgId, id, to: b.stage, reason: b.closedReason ?? null, note: b.stageNote ?? null, userId });
        if (Object.keys(patch).length) {
          const done = await tx.update(cicInterestRegistrations).set({ ...patch, updatedAt: new Date() })
            .where(and(eq(cicInterestRegistrations.id, id), eq(cicInterestRegistrations.organizationId, orgId)))
            .returning({ id: cicInterestRegistrations.id });
          if (!done.length) throw new HttpError(404, "Lead not found");
        }
      });
      res.json({ ok: true });
    } catch (e) { send(res, e); }
  });

  // ── Bulk: sweep spam, assign an owner, move a batch ───────────────────────
  app.post("/api/admin/cic/leads/bulk", ...cicLeadGate, async (req, res) => {
    try {
      const orgId = await cicOrgId();
      const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length) throw new HttpError(400, "Select at least one lead.");
      if (ids.length > 500) throw new HttpError(400, "At most 500 at a time.");
      const { stage, closedReason, ownerUserId } = req.body || {};
      if (stage !== undefined && !isLeadStage(stage)) throw new HttpError(400, "Unknown stage.");
      let owner: number | null | undefined;
      if (ownerUserId !== undefined) {
        if (ownerUserId === null) owner = null;
        else {
          const team = await cicTeam(orgId);
          if (!team.some((t) => t.id === Number(ownerUserId))) throw new HttpError(400, "That person isn't in the CIC workspace.");
          owner = Number(ownerUserId);
        }
      }
      if (stage === undefined && owner === undefined) throw new HttpError(400, "Nothing to change.");

      let moved = 0;
      await db.transaction(async (tx) => {
        for (const id of ids) {
          if (stage !== undefined) {
            const r = await moveStage(tx, { orgId, id, to: stage, reason: closedReason ?? null, userId: req.session.userId! });
            if (r.changed) moved++;
          }
        }
        if (owner !== undefined) {
          await tx.update(cicInterestRegistrations).set({ ownerUserId: owner, updatedAt: new Date() })
            .where(and(inArray(cicInterestRegistrations.id, ids), eq(cicInterestRegistrations.organizationId, orgId)));
        }
      });
      res.json({ ok: true, moved });
    } catch (e) { send(res, e); }
  });

  // ── A lead's timeline ─────────────────────────────────────────────────────
  app.get("/api/admin/cic/leads/:id/activities", ...cicLeadGate, async (req, res) => {
    try {
      const orgId = await cicOrgId();
      const rows = await db
        .select({ a: cicInterestActivities, firstName: users.firstName, lastName: users.lastName })
        .from(cicInterestActivities)
        .leftJoin(users, eq(users.id, cicInterestActivities.createdBy))
        .where(and(eq(cicInterestActivities.registrationId, Number(req.params.id)), eq(cicInterestActivities.organizationId, orgId)))
        .orderBy(desc(cicInterestActivities.createdAt), desc(cicInterestActivities.id));
      res.json(rows.map(({ a, firstName, lastName }) => ({
        ...a, byName: firstName ? `${firstName} ${lastName ?? ""}`.trim() : null,
      })));
    } catch (e) { send(res, e); }
  });

  // ── Log a touch: a quick button, or a typed call/email/WhatsApp/note ──────
  app.post("/api/admin/cic/leads/:id/activities", ...cicLeadGate, async (req, res) => {
    try {
      const orgId = await cicOrgId();
      const id = Number(req.params.id);
      const userId = req.session.userId!;
      const b = req.body || {};
      const quick = QUICK_LOGS.find((q) => q.key === b.quick);
      const type = quick ? quick.type : b.type;
      if (!isActivityType(type) || type === "stage_change") throw new HttpError(400, "Unknown activity.");
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 5000) : "";
      if (type === "note" && !note) throw new HttpError(400, "Write something first.");
      if (b.nextFollowUpOn !== undefined && b.nextFollowUpOn !== null && !isIsoDate(b.nextFollowUpOn)) {
        throw new HttpError(400, "Follow-up must be a date.");
      }

      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(cicInterestRegistrations)
          .where(and(eq(cicInterestRegistrations.id, id), eq(cicInterestRegistrations.organizationId, orgId)))
          .for("update");
        if (!row) throw new HttpError(404, "Lead not found");
        const current = normaliseStage(row.status);

        await tx.insert(cicInterestActivities).values({
          organizationId: orgId, registrationId: id, type,
          outcome: quick ? quick.outcome : (typeof b.outcome === "string" ? b.outcome.slice(0, 60) : null),
          note: note || null, createdBy: userId,
        });

        // A touch moves a lead FORWARD only, and never re-opens a closed one.
        if (quick) {
          const next = advancedStage(current, quick.advanceTo as LeadStage);
          if (next !== current) await moveStage(tx, { orgId, id, to: next, userId });
        }
        const closed = CLOSED_STAGES.includes(current);
        const followUp = b.nextFollowUpOn !== undefined
          ? b.nextFollowUpOn
          : quick && !closed ? addDaysIso(nzTodayIso(), quick.followUpDays) : undefined;
        await tx.update(cicInterestRegistrations).set({
          lastActivityAt: new Date(), updatedAt: new Date(),
          ...(followUp !== undefined && !closed ? { nextFollowUpOn: followUp } : {}),
        }).where(eq(cicInterestRegistrations.id, id));
      });
      res.json({ ok: true });
    } catch (e) { send(res, e); }
  });

  // ── Legacy: the page's old list + status buttons, and the staff app ───────
  // Kept (the app on TestFlight still calls both) and now gated like the rest.
  app.get("/api/admin/cic/registrations", ...cicLeadGate, async (_req, res) => {
    try {
      const orgId = await cicOrgId();
      const rows = await db.select().from(cicInterestRegistrations)
        .where(eq(cicInterestRegistrations.organizationId, orgId))
        .orderBy(desc(cicInterestRegistrations.createdAt));
      res.json(rows);
    } catch (e) { send(res, e); }
  });
  app.post("/api/admin/cic/registrations/:id/status", ...cicLeadGate, async (req, res) => {
    try {
      const legacy: Record<string, { to: LeadStage; reason: string | null }> = {
        new: { to: "new", reason: null }, confirmed: { to: "entered", reason: null },
        declined: { to: "not_coming", reason: "other" }, archived: { to: "disqualified", reason: "other" },
      };
      const m = legacy[String(req.body?.status || "")];
      if (!m) throw new HttpError(400, "invalid status");
      const orgId = await cicOrgId();
      await db.transaction((tx) => moveStage(tx, { orgId, id: Number(req.params.id), to: m.to, reason: m.reason, userId: req.session.userId! }));
      res.json({ ok: true });
    } catch (e) { send(res, e); }
  });
}
