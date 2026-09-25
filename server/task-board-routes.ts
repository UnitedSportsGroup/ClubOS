// ─────────────────────────────────────────────────────────────────────────────
// TASK BOARD — Daniel + Isaac's MFL project board (2026-09-25).
//
//   GET                /api/admin/task-board            → { projects, tasks, people, today }
//   POST               /api/admin/task-board/tasks
//   PATCH | DELETE     /api/admin/task-board/tasks/:id   (DELETE = archive)
//   POST               /api/admin/task-board/projects
//   PATCH | DELETE     /api/admin/task-board/projects/:id (DELETE = archive, tasks kept)
//
// SEPARATE from the org-wide Task Tracker (tt_*, server/task-tracker-routes.ts):
// Daniel wanted to start fresh. Access: requireTab("task-board"), and the slug
// is in SUPER_ADMIN_ONLY_TABS — Daniel as super admin, Isaac by name through
// user_organizations.unlocked_tabs. organizationId always comes from the
// X-Workspace-Slug header, never the body; every row is reached by (id AND org).
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth, requireTab } from "./auth";
import { organizations, tbProjects, tbTasks, users, userOrganizations } from "@shared/schema";
import { nzTodayIso } from "@shared/academy";
import { isTbStatus, isTbPriority, isTbColor, isIsoDate } from "@shared/task-board";

const TAB = "task-board";

async function workspace(req: Request) {
  const slug = String(req.headers["x-workspace-slug"] || "").trim();
  if (!slug) return null;
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
  return org ?? null;
}

/** Who can hold a task here: anyone granted the tab by name (Isaac), the
 *  person who set the board up (whoever created a project — Daniel), and the
 *  viewer. NOT every super admin: this is "me and Isaac's" board, and listing
 *  Slava as an owner option would say otherwise. Read live, never cached. */
async function peopleFor(orgId: number, viewerId?: number) {
  const creators = (await db.execute(sql`SELECT DISTINCT created_by AS id FROM tb_projects WHERE organization_id = ${orgId} AND created_by IS NOT NULL`)).rows as any[];
  const keep = new Set<number>([...creators.map((r) => Number(r.id)), ...(viewerId ? [viewerId] : [])]);
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email,
      avatarUrl: users.avatarUrl, globalRole: users.role, role: userOrganizations.role, unlocked: userOrganizations.unlockedTabs })
    .from(userOrganizations)
    .innerJoin(users, eq(users.id, userOrganizations.userId))
    .where(eq(userOrganizations.organizationId, orgId));
  return rows
    .filter((r) => keep.has(r.id) || (Array.isArray(r.unlocked) && (r.unlocked as string[]).includes(TAB)))
    .sort((a, b) => a.id - b.id)
    .map((r) => ({ id: r.id, name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email, firstName: r.firstName || r.email, avatarUrl: r.avatarUrl ?? null }));
}

const clean = (v: unknown, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function taskPatch(body: any, people: { id: number }[]) {
  const out: Record<string, any> = {};
  const errors: string[] = [];
  if ("title" in body) { const t = clean(body.title, 300); t ? (out.title = t) : errors.push("A task needs a title"); }
  if ("notes" in body) out.notes = clean(body.notes) || null;
  if ("status" in body) { isTbStatus(body.status) ? (out.status = body.status) : errors.push("Unknown status"); }
  if ("priority" in body) { isTbPriority(body.priority) ? (out.priority = body.priority) : errors.push("Unknown priority"); }
  if ("dueOn" in body) { body.dueOn == null || body.dueOn === "" ? (out.dueOn = null) : isIsoDate(body.dueOn) ? (out.dueOn = body.dueOn) : errors.push("Due date must be yyyy-mm-dd"); }
  if ("ownerUserId" in body) {
    if (body.ownerUserId == null || body.ownerUserId === "") out.ownerUserId = null;
    else if (people.some((p) => p.id === Number(body.ownerUserId))) out.ownerUserId = Number(body.ownerUserId);
    else errors.push("That person can't hold tasks on this board");
  }
  if ("projectId" in body) out.projectId = body.projectId == null || body.projectId === "" ? null : Number(body.projectId);
  if ("position" in body && Number.isFinite(Number(body.position))) out.position = Math.trunc(Number(body.position));
  return { out, errors };
}

export function registerTaskBoardRoutes(app: Express) {
  const gate = [requireAuth, requireTab(TAB)];

  app.get("/api/admin/task-board", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const [projects, tasks, people] = await Promise.all([
      db.select().from(tbProjects).where(and(eq(tbProjects.organizationId, org.id), isNull(tbProjects.archivedAt))).orderBy(asc(tbProjects.position), asc(tbProjects.id)),
      db.select().from(tbTasks).where(and(eq(tbTasks.organizationId, org.id), isNull(tbTasks.archivedAt))).orderBy(asc(tbTasks.position), asc(tbTasks.id)),
      peopleFor(org.id, req.session.userId),
    ]);
    res.json({ projects, tasks, people, today: nzTodayIso(), me: req.session.userId });
  });

  app.post("/api/admin/task-board/tasks", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const people = await peopleFor(org.id, req.session.userId);
    const { out, errors } = taskPatch({ status: "todo", ...req.body }, people);
    if (!out.title) errors.push("A task needs a title");
    if (errors.length) return res.status(400).json({ message: errors[0] });
    if (out.projectId != null) {
      const [p] = await db.select({ id: tbProjects.id }).from(tbProjects).where(and(eq(tbProjects.id, out.projectId), eq(tbProjects.organizationId, org.id)));
      if (!p) return res.status(400).json({ message: "Unknown project" });
    }
    const [{ max }] = (await db.execute(sql`SELECT coalesce(max(position), 0) AS max FROM tb_tasks WHERE organization_id = ${org.id}`)).rows as any[];
    const [row] = await db.insert(tbTasks).values({
      organizationId: org.id, title: out.title, notes: out.notes ?? null, status: out.status ?? "todo",
      priority: out.priority ?? "normal", ownerUserId: out.ownerUserId ?? null, dueOn: out.dueOn ?? null,
      projectId: out.projectId ?? null, position: Number(max) + 1, createdBy: req.session.userId ?? null,
      completedAt: out.status === "done" ? new Date() : null,
    }).returning();
    res.json(row);
  });

  app.patch("/api/admin/task-board/tasks/:id", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const id = Number(req.params.id);
    const [cur] = await db.select().from(tbTasks).where(and(eq(tbTasks.id, id), eq(tbTasks.organizationId, org.id), isNull(tbTasks.archivedAt)));
    if (!cur) return res.status(404).json({ message: "Not found" });
    const { out, errors } = taskPatch(req.body || {}, await peopleFor(org.id, req.session.userId));
    if (errors.length) return res.status(400).json({ message: errors[0] });
    if (out.projectId != null) {
      const [p] = await db.select({ id: tbProjects.id }).from(tbProjects).where(and(eq(tbProjects.id, out.projectId), eq(tbProjects.organizationId, org.id)));
      if (!p) return res.status(400).json({ message: "Unknown project" });
    }
    // completed_at is stamped by the server on the way INTO done, cleared on the way out.
    if (out.status && out.status !== cur.status) out.completedAt = out.status === "done" ? new Date() : null;
    const [row] = await db.update(tbTasks).set({ ...out, updatedAt: new Date() })
      .where(and(eq(tbTasks.id, id), eq(tbTasks.organizationId, org.id))).returning();
    res.json(row);
  });

  app.delete("/api/admin/task-board/tasks/:id", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const r = await db.update(tbTasks).set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tbTasks.id, Number(req.params.id)), eq(tbTasks.organizationId, org.id), isNull(tbTasks.archivedAt))).returning({ id: tbTasks.id });
    if (!r.length) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  app.post("/api/admin/task-board/projects", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const name = clean(req.body?.name, 120);
    if (!name) return res.status(400).json({ message: "A project needs a name" });
    const color = isTbColor(req.body?.color) ? req.body.color : "gold";
    const [{ max }] = (await db.execute(sql`SELECT coalesce(max(position), 0) AS max FROM tb_projects WHERE organization_id = ${org.id}`)).rows as any[];
    const [row] = await db.insert(tbProjects).values({ organizationId: org.id, name, color, position: Number(max) + 1, createdBy: req.session.userId ?? null }).returning();
    res.json(row);
  });

  app.patch("/api/admin/task-board/projects/:id", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const set: Record<string, any> = { updatedAt: new Date() };
    if ("name" in (req.body || {})) { const n = clean(req.body.name, 120); if (!n) return res.status(400).json({ message: "A project needs a name" }); set.name = n; }
    if ("color" in (req.body || {})) { if (!isTbColor(req.body.color)) return res.status(400).json({ message: "Unknown colour" }); set.color = req.body.color; }
    if ("position" in (req.body || {}) && Number.isFinite(Number(req.body.position))) set.position = Math.trunc(Number(req.body.position));
    const [row] = await db.update(tbProjects).set(set)
      .where(and(eq(tbProjects.id, Number(req.params.id)), eq(tbProjects.organizationId, org.id), isNull(tbProjects.archivedAt))).returning();
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  });

  // Archiving a project never takes its tasks with it — they drop to "No project".
  app.delete("/api/admin/task-board/projects/:id", ...gate, async (req: Request, res: Response) => {
    const org = await workspace(req);
    if (!org) return res.status(400).json({ message: "X-Workspace-Slug header required" });
    const id = Number(req.params.id);
    const [row] = await db.update(tbProjects).set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tbProjects.id, id), eq(tbProjects.organizationId, org.id), isNull(tbProjects.archivedAt))).returning({ id: tbProjects.id });
    if (!row) return res.status(404).json({ message: "Not found" });
    await db.update(tbTasks).set({ projectId: null, updatedAt: new Date() }).where(and(eq(tbTasks.projectId, id), eq(tbTasks.organizationId, org.id)));
    res.json({ ok: true });
  });
}
