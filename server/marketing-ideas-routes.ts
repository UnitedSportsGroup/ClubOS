/**
 * Marketing → Ideas: the ideas backlog and the plan.
 * See shared/marketing-ideas.ts and migrations/2026-11-12_marketing_ideas.sql.
 *
 * Who may see or change an idea: someone holding the Ideas tab (every idea), or
 * the tab of the section the idea belongs to (that section's ideas) — in the
 * United Sports Group workspace only, 404 from anywhere else.
 *
 * 🔴 Removing archives. 🔴 A blank cost or time is NULL.
 */
import type { Express, Request, Response } from "express";
import { canAccessTab } from "@shared/tabs";
import { IDEAS_TAB, IDEA_SECTIONS, ideaSection, parseIdeaInput, type IdeasResponse, type MarketingIdea } from "@shared/marketing-ideas";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { requireHubWorkspace } from "./marketing-hub/common";
import { storage } from "./storage";

const BASE = "/api/admin/marketing-ideas";

/** What this person may reach: every idea (the Ideas tab), and which sections. Re-read on every request. */
async function reach(req: Request): Promise<{ all: boolean; sections: Set<string> }> {
  const none = { all: false, sections: new Set<string>() };
  const user = await storage.getUser(req.session.userId!);
  if (!user) return none;
  const keys = IDEA_SECTIONS.map((s) => s.key);
  if (user.role === "super_admin") return { all: true, sections: new Set(keys) };
  const slug = req.headers["x-workspace-slug"];
  const membership = (await storage.getUserOrganizations(user.id)).find((o) => o.slug === slug);
  if (!membership) return none;
  const holds = (tabSlug: string) =>
    canAccessTab({
      globalRole: user.role,
      membershipRole: membership.userRole,
      membershipTabs: membership.userTabs,
      membershipUnlockedTabs: membership.userUnlockedTabs,
      tabSlug,
    });
  const all = holds(IDEAS_TAB);
  return { all, sections: new Set(all ? keys : keys.filter(holds)) };
}

const SELECT = `
  SELECT i.*, NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS created_by_name,
         NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '') AS promoted_by_name
  FROM marketing_ideas i LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users p ON p.id = i.promoted_by`;

function toIdea(r: any): MarketingIdea {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    section: r.section,
    stage: r.stage === "plan" ? "plan" : "idea",
    costCents: r.cost_cents,
    timeEstimate: r.time_estimate,
    createdAt: new Date(r.created_at).toISOString(),
    createdByName: r.created_by_name,
    promotedAt: r.promoted_at ? new Date(r.promoted_at).toISOString() : null,
    promotedByName: r.promoted_by_name,
    archived: r.archived_at != null,
  };
}

function handle(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      console.error(`[MarketingIdeas] ${req.method} ${req.path} failed:`, e?.message ?? e);
      res.status(500).json({ message: "That could not be saved. Try again." });
    }
  };
}

const denied = (res: Response) => res.status(403).json({ message: "You do not have access to these ideas." });

export function registerMarketingIdeasRoutes(app: Express) {
  const gate = [requireAuth, requireHubWorkspace] as const;

  // Every idea (the Ideas tab), or one section's ideas (?section=signage).
  app.get(BASE, ...gate, handle(async (req, res) => {
    const who = await reach(req);
    const removed = req.query.removed === "1";
    let sections: string[];
    if (req.query.section != null) {
      const s = ideaSection(req.query.section);
      if (!s) return res.status(404).json({ message: "Not found" });
      if (!who.sections.has(s.key)) return denied(res);
      sections = [s.key];
    } else {
      if (!who.all) return denied(res);
      sections = IDEA_SECTIONS.map((s) => s.key);
    }
    const { rows } = await pool.query(
      `${SELECT} WHERE i.section = ANY($1::text[]) AND ($2::boolean OR i.archived_at IS NULL)
       ORDER BY i.archived_at IS NOT NULL, COALESCE(i.promoted_at, i.created_at) DESC, i.id DESC`,
      [sections, removed],
    );
    const body: IdeasResponse = { ideas: rows.map(toIdea), sections: Array.from(who.sections) };
    res.json(body);
  }));

  app.post(BASE, ...gate, handle(async (req, res) => {
    const parsed = parseIdeaInput(req.body);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    const v = parsed.value;
    const who = await reach(req);
    if (!who.sections.has(v.section)) return denied(res);
    const { rows } = await pool.query(
      `INSERT INTO marketing_ideas (title, description, section, cost_cents, time_estimate, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [v.title, v.description, v.section, v.costCents, v.timeEstimate, req.session.userId ?? null],
    );
    res.status(201).json({ id: rows[0].id });
  }));

  app.patch(`${BASE}/:id`, ...gate, handle(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Not found" });
    const found = await pool.query(`SELECT section FROM marketing_ideas WHERE id = $1`, [id]);
    if (!found.rowCount) return res.status(404).json({ message: "Not found" });
    const who = await reach(req);
    // Not reachable reads as not there.
    if (!who.sections.has(found.rows[0].section)) return res.status(404).json({ message: "Not found" });
    const me = req.session.userId ?? null;

    // Remove / put back, and promote / move back, are their own small changes so they can never blank the other fields.
    if (typeof req.body?.archived === "boolean") {
      await pool.query(`UPDATE marketing_ideas SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_by = $3, updated_at = now() WHERE id = $1`, [id, req.body.archived, me]);
      return res.json({ ok: true });
    }
    if (req.body?.stage === "plan" || req.body?.stage === "idea") {
      const toPlan = req.body.stage === "plan";
      // Promoting something already in the plan keeps its first promoter and time.
      await pool.query(
        `UPDATE marketing_ideas SET stage = $2,
                promoted_at = CASE WHEN $4 THEN COALESCE(promoted_at, now()) ELSE NULL END,
                promoted_by = CASE WHEN $4 THEN COALESCE(promoted_by, $3) ELSE NULL END,
                updated_by = $3, updated_at = now()
         WHERE id = $1`,
        [id, req.body.stage, me, toPlan],
      );
      return res.json({ ok: true });
    }
    const parsed = parseIdeaInput(req.body);
    if ("error" in parsed) return res.status(400).json({ message: parsed.error });
    const v = parsed.value;
    if (!who.sections.has(v.section)) return denied(res);
    await pool.query(
      `UPDATE marketing_ideas SET title=$2, description=$3, section=$4, cost_cents=$5, time_estimate=$6, updated_by=$7, updated_at=now() WHERE id = $1`,
      [id, v.title, v.description, v.section, v.costCents, v.timeEstimate, me],
    );
    res.json({ ok: true });
  }));
}
