// ── Rambo's own page — chats, like ChatGPT and Claude ───────────────────────
//
// Daniel, 2026-10-26 (night): "I want to make Rambo a separate thing on the
// side. It's at the top of every single workspace … look exactly like ChatGPT
// and Claude, where it has your different chats. You can have separate chats
// for different topics, you can label those chats."
//
// Chats are the kb_chat_sessions / kb_chat_messages the Knowledge Base tab
// already used — one history, three doors. A chat belongs to the PERSON (never
// to a manager, never a club record); it remembers the workspace it was
// started in, so the club-data tools answer about the right organisation.
// Every answer is a priced row (tokens, US cents) and every prompt counts
// against the person's daily allowance (server/rambo-usage.ts), refused
// BEFORE the model is called.

import type { Express, Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { kbChatMessages, kbChatSessions } from "@shared/schema";
import { isKbBrand, ramboToolsFor, RAMBO_TOOLS } from "@shared/knowledge-base";
import { askRambo, buildViewer, RAMBO_MODEL } from "./rambo";
import { ramboCostCents, ramboDailyLimitFor, ramboPeopleThisMonth, ramboUsedToday } from "./rambo-usage";
import { RAMBO_QUESTION_MAX, ramboCleanTitle, ramboTitleFrom } from "@shared/rambo-chat";

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[];

function workspaceOf(req: Request): string | null {
  const slug = String(req.headers["x-workspace-slug"] || "").trim();
  return slug || null;
}

async function ownSession(userId: number, id: number) {
  if (!Number.isFinite(id)) return null;
  const [s] = await db.select().from(kbChatSessions).where(eq(kbChatSessions.id, id));
  return s && s.userId === userId ? s : null;
}

function shapeThread(s: any, preview?: string | null, count?: number) {
  return {
    id: s.id,
    title: s.title || "New chat",
    workspaceSlug: s.workspaceSlug ?? s.workspace_slug ?? null,
    brand: s.brand,
    createdAt: s.createdAt ?? s.created_at,
    updatedAt: s.updatedAt ?? s.updated_at,
    preview: preview ?? null,
    messages: count ?? undefined,
  };
}

export function registerRamboRoutes(app: Express) {
  /** The person's chats, newest first, with the last answer's first line. */
  app.get("/api/admin/rambo/threads", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const rows = rowsOf(await db.execute(sql`
        SELECT s.id, s.title, s.brand, s.workspace_slug, s.created_at, s.updated_at,
               (SELECT left(m.content, 140) FROM kb_chat_messages m WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1) AS preview,
               (SELECT count(*)::int FROM kb_chat_messages m WHERE m.session_id = s.id) AS n
        FROM kb_chat_sessions s WHERE s.user_id = ${userId}
        ORDER BY s.updated_at DESC LIMIT 100`));
      res.json({ threads: rows.map((r) => shapeThread(r, r.preview, Number(r.n))) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** Start an empty chat (the page creates one when you press New chat). */
  app.post("/api/admin/rambo/threads", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const brand = isKbBrand(req.body?.brand) ? req.body.brand : "all";
      const [created] = await db
        .insert(kbChatSessions)
        .values({ userId, brand, title: null, workspaceSlug: workspaceOf(req) })
        .returning();
      res.json({ thread: shapeThread(created, null, 0) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/rambo/threads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = await ownSession(req.session.userId!, parseInt(String(req.params.id), 10));
      if (!s) return res.status(404).json({ message: "Not found" });
      const messages = await db.select().from(kbChatMessages).where(eq(kbChatMessages.sessionId, s.id)).orderBy(kbChatMessages.createdAt);
      res.json({ thread: shapeThread(s, null, messages.length), messages });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** Rename. */
  app.patch("/api/admin/rambo/threads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = await ownSession(req.session.userId!, parseInt(String(req.params.id), 10));
      if (!s) return res.status(404).json({ message: "Not found" });
      const title = ramboCleanTitle(req.body?.title);
      const [updated] = await db.update(kbChatSessions).set({ title }).where(eq(kbChatSessions.id, s.id)).returning();
      res.json({ thread: shapeThread(updated) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/rambo/threads/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const s = await ownSession(req.session.userId!, parseInt(String(req.params.id), 10));
      if (!s) return res.status(404).json({ message: "Not found" });
      await db.delete(kbChatSessions).where(eq(kbChatSessions.id, s.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** Today's count and cap, what Rambo can see for this person, and (super
   *  admins) this month's usage per person across every door. */
  app.get("/api/admin/rambo/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ message: "Not signed in" });
      const viewer = await buildViewer(userId);
      const allowed = viewer ? ramboToolsFor(viewer) : [];
      const base: any = {
        used: await ramboUsedToday(userId),
        limit: ramboDailyLimitFor((user as any).mailerAiDailyLimit),
        model: RAMBO_MODEL,
        enabled: !!process.env.ANTHROPIC_API_KEY,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
        firstName: user.firstName || "",
        canSee: allowed.map((t) => ({ name: t.name, title: t.title })),
        cannotSee: RAMBO_TOOLS.filter((t) => !allowed.some((a) => a.name === t.name)).map((t) => ({ name: t.name, title: t.title, requiredTab: t.requiredTab })),
      };
      if (user.role === "super_admin") base.people = await ramboPeopleThisMonth();
      res.json(base);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  /** Ask, inside a chat. The line is kept open with whitespace while Rambo
   *  works (a numbers question can take a few tool rounds); the JSON comes last. */
  app.post("/api/admin/rambo/threads/:id/ask", requireAuth, async (req: Request, res: Response) => {
    const userId = req.session.userId!;
    let s: any = null;
    let user: any = null;
    try {
      s = await ownSession(userId, parseInt(String(req.params.id), 10));
      user = await storage.getUser(userId);
    } catch (e: any) {
      return res.status(500).json({ ok: false, message: e.message });
    }
    if (!s || !user) return res.status(404).json({ ok: false, message: "Not found" });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ ok: false, message: "Rambo isn't switched on — ANTHROPIC_API_KEY isn't set on the server." });
    const question = String(req.body?.question ?? "").trim();
    if (!question) return res.status(400).json({ ok: false, message: "Ask Rambo something." });
    if (question.length > RAMBO_QUESTION_MAX) return res.status(400).json({ ok: false, message: `That's over ${RAMBO_QUESTION_MAX} characters. Keep a question shorter than that.` });

    const limit = ramboDailyLimitFor(user.mailerAiDailyLimit);
    const used = await ramboUsedToday(userId);
    if (used >= limit) {
      return res.status(429).json({
        ok: false,
        message: limit === 0
          ? "Rambo is switched off for your account. A super admin can turn it on in Team."
          : `You've used today's ${limit} prompt${limit === 1 ? "" : "s"}. It resets at midnight NZ time, or a super admin can raise your limit in Team.`,
        usage: { used, limit },
      });
    }

    const viewer = await buildViewer(userId);
    if (!viewer) return res.status(401).json({ ok: false, message: "Not signed in" });
    const workspaceSlug = workspaceOf(req) ?? s.workspaceSlug ?? null;
    const brand = isKbBrand(s.brand) ? s.brand : "all";

    const prior = await db
      .select({ role: kbChatMessages.role, content: kbChatMessages.content })
      .from(kbChatMessages)
      .where(eq(kbChatMessages.sessionId, s.id))
      .orderBy(kbChatMessages.createdAt)
      .limit(24);
    const firstQuestion = prior.length === 0;
    await db.insert(kbChatMessages).values({ sessionId: s.id, role: "user", content: question });

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders?.();
    const keepAlive = setInterval(() => { try { res.write(" "); } catch { /* gone */ } }, 15000);
    const started = Date.now();
    try {
      const reply = await askRambo({
        viewer,
        brand,
        history: prior.filter((m) => m.content.trim() !== "").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        question,
        surface: "chat",
        workspaceSlug,
      });
      const cents = ramboCostCents(reply.model, reply.usage);
      const [saved] = await db
        .insert(kbChatMessages)
        .values({
          sessionId: s.id,
          role: "assistant",
          content: reply.content,
          toolsUsed: reply.toolsUsed,
          sources: reply.sources,
          model: reply.model,
          inputTokens: reply.usage.input,
          outputTokens: reply.usage.output,
          cacheReadTokens: reply.usage.cacheRead,
          cacheWriteTokens: reply.usage.cacheWrite,
          costUsdCents: String(cents),
          durationMs: Date.now() - started,
        })
        .returning();
      const patch: any = { updatedAt: new Date() };
      if (firstQuestion && !s.title) patch.title = ramboTitleFrom(question);
      if (!s.workspaceSlug && workspaceSlug) patch.workspaceSlug = workspaceSlug;
      const [thread] = await db.update(kbChatSessions).set(patch).where(eq(kbChatSessions.id, s.id)).returning();
      clearInterval(keepAlive);
      res.end(JSON.stringify({ ok: true, thread: shapeThread(thread), message: saved, usage: { used: used + 1, limit } }));
    } catch (e: any) {
      clearInterval(keepAlive);
      console.error("[rambo] ask failed:", e);
      const msg = /credit balance/i.test(String(e?.message)) ? "The club's Anthropic account is out of credit. Top it up at console.anthropic.com." : `Rambo hit a snag: ${String(e?.message || "").slice(0, 200)}`;
      res.end(JSON.stringify({ ok: false, message: msg, usage: { used: used + 1, limit } }));
    }
  });
}

// Keep the drizzle helpers referenced for the typecheck's sake when the
// query shapes change — `and`/`desc` are the usual next additions here.
void and; void desc;
